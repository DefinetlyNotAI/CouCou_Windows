// Streaming local chat; request IDs keep resets and late events separate.
import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { Bridge, onEvent, type ChatContext, type ChatProgress, type ChatSource } from "../core/bridge";
import { BrowserAI } from "../core/browser-ai";
import { Sound } from "../core/sound";
import { State, type ChatMessage } from "../core/state";
import type { ViewHost } from "./views";

let nextId = 1;

function bubble(message: ChatMessage, sources: ChatSource[] = []): HTMLElement {
  if (message.role === "user") {
    return h("div", { class: "chat-row user" }, h("div", { class: "bubble", text: message.content }));
  }
  const reply = h("div", { class: "reply", text: message.content });
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
  const chipRow = h("div", { class: "chip-row" });
  const log = h("div", { class: "chat-log", "aria-live": "polite" });
  const status = h("div", { class: "chat-status", role: "status" });
  const input = h("input", { type: "text", class: "chat-input", placeholder: "Ask me anything…", spellcheck: "false", "aria-label": "Message" }) as HTMLInputElement;
  const send = h("button", { class: "send-btn", title: "Send", "aria-label": "Send" }, svg(ICONS.arrowUp, 11)) as HTMLButtonElement;
  const reset = h("button", { class: "chat-reset", title: "New chat", "aria-label": "New chat" }, svg(ICONS.plus, 13)) as HTMLButtonElement;
  const bar = h("div", { class: "chat-bar" }, reset, input, send);
  const el = h("div", { class: "view" }, h("div", { class: "card wash chat-card" }, h("div", { class: "chat-body" }, chipRow, log, status, bar)));
  (el.querySelector(".card") as HTMLElement).style.setProperty("--wash", "rgba(99,102,241,0.5)");

  let renderedKey = "";
  let assistant: ChatMessage | null = null;
  let stopping = false;
  let resetting = false;
  let turnFinished: Promise<void> | null = null;
  let activeBackend: "ollama" | "browser" = "ollama";
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
    } else if (event.phase === "tool-start" || event.phase === "tool-result") {
      State.chatStatus = event.text;
      State.stateOverride = event.tool?.startsWith("web_") ? "searching" : "working";
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
    const context: ChatContext | null = conversation.length === 0 && file ? { kind: "file", name: file.name, path: file.path } : null;
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
        State.chatRequestId = null;
        State.chatBusy = false;
        stopping = false;
        State.stateOverride = null;
        assistant = null;
        State.notify();
        onHeightChange();
        if (State.mode === "expanded" && State.view === "prompt") input.focus();
      }
    }
  }

  reset.addEventListener("click", async () => {
    if (resetting) return;
    resetting = true;
    if (State.chatBusy) stop();
    await turnFinished;
    await Bridge.chatReset();
    await BrowserAI.reset();
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
        if (label) chipRow.append(h("div", { class: "chip settled" }, h("i", { class: "chip-dot" }), h("span", { text: label })));
      }
      const key = JSON.stringify(State.chatHistory) + State.chatStatus;
      if (key !== renderedKey) {
        renderedKey = key;
        clear(log);
        for (const message of State.chatHistory) if (message.content) log.append(bubble(message, sources.get(message.id)));
        status.textContent = State.chatStatus;
        log.scrollTop = log.scrollHeight;
      }
      clear(send);
      send.append(svg(State.chatBusy ? ICONS.xmark : ICONS.arrowUp, 11));
      send.title = State.chatBusy ? "Stop reply" : "Send";
      send.setAttribute("aria-label", send.title);
      input.disabled = State.chatBusy;
      send.disabled = stopping || resetting;
      reset.disabled = resetting;
      input.placeholder = State.chatHistory.length ? "Continue…" : "Ask me anything…";
    },
    focus() { if (!State.chatBusy) { input.focus(); input.select(); } },
  };
}
