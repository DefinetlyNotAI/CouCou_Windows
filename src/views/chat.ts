// Streaming local chat; request IDs keep resets and late events separate.
import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { Bridge, IS_TAURI, onEvent, type ChatContext, type ChatProgress, type ChatSource } from "../core/bridge";
import { BrowserAI } from "../core/browser-ai";
import { Sound } from "../core/sound";
import { State, INTEGRATION_AGENTS, type ChatMessage } from "../core/state";
import type { ViewHost } from "./views";
import { marked } from "marked";
import DOMPurify from "dompurify";

let nextId = 1;

export async function reopenChat(id: string): Promise<boolean> {
  if (State.chatBusy || State.voiceBusy) return false;
  const chat = State.savedChats.find(item => item.id === id);
  if (!chat) return false;
  State.chatBusy = true;
  State.notify();
  try {
    const messages = chat.messages.map(({ role, content }) => ({ role, content }));
    if (IS_TAURI) await Bridge.chatRestore(messages);
    await BrowserAI.restore(messages);
    State.saveChat();
    State.chatId = chat.id;
    State.chatHistory = chat.messages.map(message => ({ ...message }));
    nextId = Math.max(nextId, ...chat.messages.map(message => message.id + 1));
    State.droppedFile = null;
    State.promptContext = null;
    State.chatStatus = "";
    State.tokensPerSecond = null;
    State.notify();
    return true;
  } catch (error) {
    State.chatStatus = String(error).replace(/^Error:\s*/, "");
    State.notify();
    return false;
  } finally {
    State.chatBusy = false;
    State.notify();
  }
}

function bubble(message: ChatMessage, sources: ChatSource[] = []): HTMLElement {
  if (message.role === "user") {
    return h("div", { class: "chat-row user" }, h("div", { class: "bubble", text: message.content }));
  }
  const reply = h("div", { class: "reply markdown" });
  reply.innerHTML = DOMPurify.sanitize(marked.parse(message.content, { async: false, gfm: true }), {
    USE_PROFILES: { html: true }, FORBID_TAGS: ["img", "style", "input", "button", "form"], FORBID_ATTR: ["style"],
  });
  for (const link of reply.querySelectorAll<HTMLAnchorElement>("a")) {
    link.addEventListener("click", event => {
      event.preventDefault();
      if (/^https?:\/\//i.test(link.getAttribute("href") ?? "")) void Bridge.openUrl(link.href);
    });
  }
  if (sources.length) {
    const links = h("div", { class: "chat-sources" });
    for (const source of sources) {
      const link = h("a", { href: source.url, text: source.title });
      link.addEventListener("click", (event) => { event.preventDefault(); void Bridge.openUrl(source.url); });
      links.append(link);
    }
    reply.append(links);
  }
  return h("div", { class: "chat-row" }, reply);
}

export function buildPrompt(onHeightChange: () => void): ViewHost {
  State.loadChats();
  const chipRow = h("div", { class: "chip-row" });
  const log = h("div", { class: "chat-log", "aria-live": "polite" });
  const status = h("div", { class: "chat-status", role: "status" });
  const input = h("input", { type: "text", class: "chat-input", placeholder: "Ask me anything…", spellcheck: "false", "aria-label": "Message" }) as HTMLInputElement;
  const send = h("button", { class: "send-btn", title: "Send", "aria-label": "Send" }, svg(ICONS.arrowUp, 11)) as HTMLButtonElement;
  const reset = h("button", { class: "chat-reset", title: "New chat", "aria-label": "New chat" }, svg(ICONS.plus, 13)) as HTMLButtonElement;
  const upload = h("button", { class: "chat-reset", title: "Attach file", "aria-label": "Attach file", onclick: async () => {
    try {
      const file = await Bridge.chooseFile();
      if (file) { State.droppedFile = file; State.promptContext = { kind: "file", name: file.name, path: file.path }; State.notify(); onHeightChange(); }
    } catch (error) { State.chatStatus = String(error).replace(/^Error:\s*/, ""); State.notify(); }
  } }, svg(ICONS.doc, 13));
  const microphone = h("button", { class: "chat-reset", title: "Microphone", "aria-label": "Microphone" },
    svg("M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3h2a7 7 0 01-6 6.93V21h-2v-3.07A7 7 0 015 11h2a5 5 0 0010 0z", 14)) as HTMLButtonElement;
  const call = h("button", { class: "chat-reset", title: "Start voice call", "aria-label": "Start voice call" },
    svg("M6.6 10.8a15 15 0 006.6 6.6l2.2-2.2a1 1 0 011-.24c1.1.37 2.3.56 3.6.56a1 1 0 011 1V20a1 1 0 01-1 1C10.1 21 3 13.9 3 5a1 1 0 011-1h3.5a1 1 0 011 1c0 1.2.2 2.5.56 3.6a1 1 0 01-.24 1l-2.22 2.2z", 14)) as HTMLButtonElement;
  const readAloud = h("button", { class: "chat-reset", title: "Read reply aloud", "aria-label": "Read reply aloud" }, svg(ICONS.speakerOn, 14)) as HTMLButtonElement;
  const bar = h("div", { class: "chat-bar" }, reset, upload, microphone, call, readAloud, input, send);
  const el = h("div", { class: "view" }, h("div", { class: "card wash chat-card" }, h("div", { class: "chat-body" }, chipRow, log, status, bar)));
  (el.querySelector(".card") as HTMLElement).style.setProperty("--wash", "rgba(99,102,241,0.5)");

  let renderedKey = "";
  let assistant: ChatMessage | null = null;
  let stopping = false;
  let resetting = false;
  let turnFinished: Promise<void> | null = null;
  let activeBackend: "ollama" | "browser" = "ollama";
  let voiceRequestId: string | null = null;
  let voiceMode: "listen" | "speak" | null = null;
  let callActive = false;
  let voiceEpoch = 0;
  let canListen = false;
  let canSpeak = false;
  let voiceError = IS_TAURI ? "Checking Windows speech…" : "Voice is available in the Windows app.";
  if (IS_TAURI) void Bridge.voiceRun(crypto.randomUUID(), "capabilities").then(result => {
    canListen = !!result.languages?.length;
    canSpeak = !!result.voices?.length;
    voiceError = !canListen ? "No Windows speech recognizer is installed. Install speech support for your language in Windows Settings." : !canSpeak ? "No Windows text-to-speech voice is installed." : "";
    State.notify();
  }).catch(error => { voiceError = String(error).replace(/^Error:\s*/, ""); State.notify(); });

  function stopVoice() {
    callActive = false;
    voiceEpoch++;
    const requestId = voiceRequestId;
    voiceRequestId = null;
    voiceMode = null;
    State.voiceBusy = false;
    if (requestId) void Bridge.voiceCancel(requestId);
    if (!State.chatBusy) State.chatStatus = "";
    State.notify();
  }

  async function runVoice(mode: "listen" | "speak", text = "") {
    const requestId = crypto.randomUUID();
    voiceRequestId = requestId;
    voiceMode = mode;
    State.voiceBusy = true;
    State.chatStatus = mode === "listen" ? "Listening…" : "Speaking…";
    State.notify();
    try {
      const result = await Bridge.voiceRun(requestId, mode, text, Math.round(State.settings.soundVolume * 100));
      if (voiceRequestId !== requestId) throw new Error("Voice stopped");
      return result.text || "";
    } finally {
      if (voiceRequestId === requestId) {
        voiceRequestId = null;
        voiceMode = null;
        State.voiceBusy = false;
        State.chatStatus = "";
        State.notify();
      }
    }
  }

  function voiceFailure(error: unknown) {
    stopVoice();
    State.chatStatus = String(error).replace(/^Error:\s*/, "");
    State.notify();
  }
  State.subscribe(() => {
    if ((voiceRequestId || callActive) && (State.view !== "prompt" || State.mode !== "expanded" || ((voiceMode === "speak" || callActive) && !State.settings.soundEnabled))) {
      const wasCall = callActive;
      stopVoice();
      if (wasCall && State.chatBusy) stop();
    }
  });
  function spokenReply(): string {
    const reply = State.chatHistory.at(-1);
    return reply?.role === "assistant" ? bubble(reply).textContent || "" : "";
  }
  microphone.addEventListener("click", async () => {
    if (voiceMode || callActive) { stopVoice(); return; }
    const epoch = voiceEpoch;
    try {
      const text = await runVoice("listen");
      if (voiceEpoch === epoch) { input.value = [input.value, text].filter(Boolean).join(" "); input.focus(); }
    } catch (error) { if (voiceEpoch === epoch) voiceFailure(error); }
  });
  readAloud.addEventListener("click", async () => {
    if (voiceMode === "speak") { stopVoice(); return; }
    const epoch = voiceEpoch;
    try { await runVoice("speak", spokenReply()); }
    catch (error) { if (voiceEpoch === epoch) voiceFailure(error); }
  });
  call.addEventListener("click", async () => {
    if (callActive) { stopVoice(); if (State.chatBusy) stop(); return; }
    callActive = true;
    const epoch = ++voiceEpoch;
    State.notify();
    try {
      while (callActive && voiceEpoch === epoch) {
        const text = await runVoice("listen");
        if (!callActive || voiceEpoch !== epoch) break;
        input.value = text;
        turnFinished = submit();
        await turnFinished;
        if (!callActive || voiceEpoch !== epoch) break;
        if (State.chatStatus) { callActive = false; State.notify(); break; }
        await runVoice("speak", spokenReply());
      }
    } catch (error) { if (voiceEpoch === epoch) voiceFailure(error); }
  });
  const sources = new Map<number, ChatSource[]>();
  const handleProgress = (event: ChatProgress) => {
    if (event.requestId !== State.chatRequestId || !State.chatBusy || stopping) return;
    const task = State.focusTask;
    if (event.phase === "generating") {
      if (assistant) assistant.content = "";
      State.chatStatus = event.text;
      State.stateOverride = "thinking";
    } else if (event.phase === "streaming") {
      if (assistant) assistant.content += event.text;
      State.chatStatus = "Generating reply…";
      State.stateOverride = "working";
    } else if (["tool-start", "tool-result", "tool-error", "agent-start", "agent-result", "agent-error"].includes(event.phase)) {
      State.chatStatus = event.text;
      State.stateOverride = event.tool?.startsWith("web_") ? "searching" : "working";
      const tool = event.tool || event.actor?.name || "Tool";
      const service = INTEGRATION_AGENTS.find(item => tool.toLowerCase().includes(item.name.toLowerCase()));
      const kind = event.actor?.kind ?? (event.phase.startsWith("agent-") ? "agent" : service ? "service" : /^mcp[._:/]/i.test(tool) ? "mcp" : "tool");
      const name = event.actor?.name || service?.name || (kind === "mcp" ? tool.split(/[.:/]/)[1] || "MCP" : tool.startsWith("web_") ? "Web" : tool === "get_current_time" ? "Clock" : tool.replace(/_/g, " "));
      const id = `${event.requestId}:${event.callId || tool}`;
      if (event.phase.endsWith("-start")) {
        const color = event.actor?.color && /^#[0-9a-f]{6}$/i.test(event.actor.color) ? event.actor.color : service?.color || (kind === "agent" ? "#2EC4A0" : "#38BDF8");
        State.startHandoff({ id, name, color, kind });
      } else State.finishHandoff(id, event.phase.endsWith("-error") ? "error" : "returning");
      if (task) State.appendStep(task.id, event.text);
    } else if (event.phase === "metrics") {
      const speed = Number(event.text);
      State.tokensPerSecond = Number.isFinite(speed) && speed >= 0 ? speed : null;
    } else if (event.phase === "loading" || event.phase === "thinking") {
      State.chatStatus = event.text;
    }
    State.notify();
  };
  const listening = onEvent<ChatProgress>("chat-progress", handleProgress);

  function stop() {
    const requestId = State.chatRequestId;
    if (!requestId) return;
    stopping = true;
    State.chatStatus = "Stopping reply…";
    void (activeBackend === "browser" ? BrowserAI.cancel(requestId) : Bridge.chatCancel(requestId));
    State.notify();
    onHeightChange();
  }

  let pendingUserId: number | null = null;
  async function submit() {
    if (resetting) return;
    if (State.chatBusy) { stop(); return; }
    const query = input.value.trim();
    if (!query) return;
    const requestId = crypto.randomUUID();
    const settings = { ...State.settings };
    activeBackend = settings.chatBackend;
    const conversation = State.chatHistory;
    const file = State.droppedFile;
    const context: ChatContext | null = file ? { kind: "file", name: file.name, path: file.path } : null;
    pendingUserId = nextId++;
    const user: ChatMessage = { id: pendingUserId, role: "user", content: query };
    const replyMessage: ChatMessage = { id: nextId++, role: "assistant", content: "" };
    assistant = replyMessage;
    stopping = false;
    input.value = "";
    State.chatRequestId = requestId;
    State.chatBusy = true;
    State.chatStatus = "Loading model…";
    State.tokensPerSecond = null;
    State.stateOverride = "thinking";
    conversation.push(user, replyMessage);
    const task = State.focusTask;
    if (task) { task.state = "working"; task.steps = ["Starting local chat"]; task.stepIndex = 0; }
    Sound.play("send");
    State.notify();
    onHeightChange();
    // Also recover if the native bridge itself never settles.
    let watchdog: number | null = null;
    try {
      const reply = await Promise.race([
        listening.then(() => {
          if (State.chatRequestId !== requestId || stopping) throw new Error("Reply stopped.");
          return activeBackend === "browser"
            ? BrowserAI.send(requestId, query, context, settings, handleProgress)
            : Bridge.chatSend(requestId, query, context);
        }),
        new Promise<never>((_, reject) => {
          const seconds = Math.max(30, Math.min(600, settings.chatTimeoutSeconds)) + (activeBackend === "browser" ? 605 : 5);
          watchdog = window.setTimeout(() => reject(new Error("The reply timed out. Check the model backend or try a smaller model.")), seconds * 1000);
        }),
      ]);
      if (State.chatRequestId !== requestId || State.chatHistory !== conversation) return;
      replyMessage.content = reply.text;
      if (State.droppedFile === file) { State.droppedFile = null; State.promptContext = null; }
      sources.set(replyMessage.id, reply.sources);
      State.chatStatus = "";
      if (task) { task.state = "finished"; State.appendStep(task.id, "Reply complete"); }
      Sound.play("finish");
    } catch (err) {
      if (State.chatRequestId !== requestId || State.chatHistory !== conversation) return;
      void (activeBackend === "browser" ? BrowserAI.cancel(requestId) : Bridge.chatCancel(requestId));
      conversation.splice(conversation.indexOf(user), 2);
      assistant = null;
      input.value = query;
      State.chatStatus = String(err).replace(/^Error:\s*/, "");
      if (task) { task.state = stopping ? "idle" : "error"; State.appendStep(task.id, State.chatStatus); }
      if (!stopping) Sound.play("error");
    } finally {
      if (watchdog !== null) window.clearTimeout(watchdog);
      if (State.chatRequestId === requestId) {
        State.endHandoffs(requestId, stopping);
        State.chatRequestId = null;
        State.chatBusy = false;
        stopping = false;
        State.stateOverride = null;
        assistant = null;
        State.saveChat();
        State.notify();
        onHeightChange();
        if (State.mode === "expanded" && State.view === "prompt") input.focus();
      }
    }
  }

  reset.addEventListener("click", async () => {
    if (resetting) return;
    stopVoice();
    resetting = true;
    if (State.chatBusy) stop();
    await turnFinished;
    await Bridge.chatReset();
    await BrowserAI.reset();
    State.saveChat();
    State.chatId = crypto.randomUUID();
    State.chatHistory = [];
    State.droppedFile = null;
    State.promptContext = null;
    State.chatStatus = "";
    State.tokensPerSecond = null;
    input.value = "";
    sources.clear();
    resetting = false;
    State.notify();
    onHeightChange();
  });
  function startSubmit() {
    if (voiceMode || callActive) stopVoice();
    if (State.chatBusy) { stop(); return; }
    turnFinished = submit();
  }
  send.addEventListener("click", startSubmit);
  input.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Enter") { event.preventDefault(); if (!State.chatBusy) startSubmit(); }
    if ((event as KeyboardEvent).key !== "Escape") event.stopPropagation();
  });

  return {
    el,
    sync() {
      const file = State.droppedFile;
      const label = file?.name ?? "";
      if (chipRow.dataset.label !== label) {
        chipRow.dataset.label = label;
        clear(chipRow);
        if (label) chipRow.append(h("div", { class: "chip settled" }, h("i", { class: "chip-dot" }), h("span", { text: label }),
          h("button", { class: "attachment-remove", title: "Remove attachment", "aria-label": "Remove attachment", onclick: () => {
            State.droppedFile = null; State.promptContext = null; State.notify(); onHeightChange();
          } }, svg(ICONS.xmark, 10))));
      }
      const key = JSON.stringify(State.chatHistory) + State.chatStatus;
      if (key !== renderedKey) {
        const follow = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
        const previousTop = log.scrollTop;
        renderedKey = key;
        clear(log);
        for (const message of State.chatHistory) if (message.content) log.append(bubble(message, sources.get(message.id)));
        status.textContent = State.chatStatus;
        log.scrollTop = follow ? log.scrollHeight : previousTop;
      }
      clear(send);
      send.append(svg(State.chatBusy ? ICONS.xmark : ICONS.arrowUp, 11));
      send.title = State.chatBusy ? "Stop reply" : "Send";
      send.setAttribute("aria-label", send.title);
      input.disabled = State.chatBusy;
      send.disabled = stopping || resetting;
      reset.disabled = resetting;
      microphone.disabled = !canListen || State.chatBusy;
      microphone.title = voiceMode || callActive ? "Stop voice" : voiceError || "Microphone";
      microphone.setAttribute("aria-label", voiceMode || callActive ? "Stop voice" : "Microphone");
      microphone.classList.toggle("voice-active", voiceMode === "listen");
      call.disabled = !callActive && (!canListen || !canSpeak || !State.settings.soundEnabled || State.chatBusy || State.voiceBusy);
      call.title = callActive ? "End voice call" : voiceError || "Start voice call";
      call.setAttribute("aria-label", callActive ? "End voice call" : "Start voice call");
      call.classList.toggle("voice-active", callActive);
      readAloud.disabled = !canSpeak || !State.settings.soundEnabled || State.chatBusy || voiceMode === "listen" || !spokenReply();
      readAloud.title = voiceMode === "speak" ? "Stop speaking" : voiceError || "Read reply aloud";
      readAloud.setAttribute("aria-label", voiceMode === "speak" ? "Stop speaking" : "Read reply aloud");
      readAloud.classList.toggle("voice-active", voiceMode === "speak");
      input.placeholder = State.chatHistory.length ? "Continue…" : "Ask me anything…";
    },
    focus() { if (!State.chatBusy) { input.focus(); input.select(); } },
  };
}
