// Island views — DOM ports of the Windows app's existing visual language.

import { h, svg, clear, dot } from "./dom";
import { ICONS } from "./icons";
import { State } from "../core/state";
import { washRGBA, type IslandViewName, type Wash } from "../core/layout";
import { buildPrompt, reopenChat } from "./chat";
import { renderIntegrationCard, type IntegrationCardHooks } from "./integrations";
import { buildChoose, buildUpload, buildUploading } from "./upload";

export interface ViewActions {
  setView(view: IslandViewName): void;
  minimize(): void;
  toggleFullscreen(): void;
  toggleSound(): void;
  setVolume(value: number): void;
  setAutoClose(seconds: number): void;
  openSettingsWindow(): void;
  blip(): void;
}

export interface ViewHost {
  el: HTMLElement;
  sync(): void;
  /** Called when the view becomes active, for views with a text field. */
  focus?(): void;
  /** Called every frame while the view is on screen. */
  tick?(nowMs: number): void;
}

function card(wash: Wash, ...children: (Node | string)[]): HTMLElement {
  const el = h("div", { class: wash ? "card wash" : "card" }, ...children);
  if (wash) el.style.setProperty("--wash", washRGBA(wash));
  return el;
}

function btn(label: string, kind: "primary" | "secondary", onClick: () => void): HTMLElement {
  return h("button", { class: `btn ${kind}`, text: label, onclick: onClick });
}

// ── Header ────────────────────────────────────────────────────────────────────

export function buildHeader(actions: ViewActions): ViewHost {
  const tabHome = h("button", { class: "tab", title: "Overview", "aria-label": "Overview", onclick: () => go("overview") }, svg(ICONS.house, 13));
  const tabChat = h("button", { class: "tab", title: "Chat", "aria-label": "Chat", onclick: () => go("prompt") }, svg(ICONS.bubble, 13));
  const tabDrop = h("button", { class: "tab", title: "Drop", "aria-label": "Drop files", onclick: () => go("upload") }, svg(ICONS.plus, 13));

  const gearBtn = h("button", { title: "Settings", "aria-label": "Settings", onclick: () => go("settings") }, svg(ICONS.gear, 14));
  const soundBtn = h("button", { title: "Mute", "aria-label": "Mute", onclick: () => actions.toggleSound() }, svg(ICONS.speakerOn, 14));
  const minimizeBtn = h("button", {
    title: "Minimize",
    "aria-label": "Minimize",
    onclick: () => actions.minimize(),
  }, svg(ICONS.minimize, 14));
  const fullscreenBtn = h("button", { title: "Fullscreen", "aria-label": "Fullscreen", onclick: () => actions.toggleFullscreen() },
    svg("M4 9V4h5v2H6v3H4zm11-5h5v5h-2V6h-3V4zM4 15h2v3h3v2H4v-5zm14 0h2v5h-5v-2h3v-3z", 14));

  function go(view: IslandViewName) {
    if (view === "prompt") State.setFocus("integration_ollama");
    actions.blip();
    actions.setView(view);
  }

  const el = h(
    "div",
    { id: "header" },
    h("div", { class: "tabs" }, tabHome, tabChat, tabDrop),
    h("div", { class: "header-actions" }, gearBtn, soundBtn, fullscreenBtn, minimizeBtn),
  );

  return {
    el,
    sync() {
      const view = State.view;
      fullscreenBtn.title = State.fullscreen ? "Exit fullscreen" : "Fullscreen";
      fullscreenBtn.setAttribute("aria-label", fullscreenBtn.title);
      fullscreenBtn.setAttribute("aria-pressed", String(State.fullscreen));
      tabHome.classList.toggle("on", view === "overview" || view === "empty");
      tabChat.classList.toggle("on", view === "prompt");
      tabDrop.classList.toggle("on", view === "upload");
      gearBtn.classList.toggle("on", view === "settings");
      clear(gearBtn);
      gearBtn.append(svg(view === "settings" ? ICONS.gearFill : ICONS.gear, 14));
      const soundLabel = State.settings.soundEnabled ? "Mute" : "Unmute";
      soundBtn.title = soundLabel;
      soundBtn.setAttribute("aria-label", soundLabel);
      clear(soundBtn);
      soundBtn.append(svg(State.settings.soundEnabled ? ICONS.speakerOn : ICONS.speakerOff, 14));
      el.style.opacity = view === "confused" ? "0" : "1";
    },
  };
}

// ── Overview ──────────────────────────────────────────────────────────────────

function buildOverview(actions: ViewActions): ViewHost {
  const name = h("span", { class: "name", text: "Ollama" });
  const model = h("div", { class: "overview-model" });
  const status = h("div", { class: "overview-state" });
  const activity = h("div", { class: "activity-list" });
  const leftBody = h(
    "div",
    { class: "overview-summary" },
    h("div", { class: "overview-who" }, dot("#22C55E", 7), name),
    h("div", { class: "overview-label", text: "Selected model" }),
    model,
    status,
    h("div", { class: "overview-actions" },
      btn("Chat", "primary", () => actions.setView("prompt")),
      btn("Settings", "secondary", () => actions.openSettingsWindow()),
    ),
  );
  const tabs = h("div", { class: "provider-tabs" });
  const leftCard = card(null, leftBody);
  let detailOpen = false;
  let providerKey = "";
  let currentProvider = "";
  let tabsKey = "";
  const hooks: IntegrationCardHooks = {
    get detailOpen() { return detailOpen; },
    openDetail() { detailOpen = true; State.notify(); },
    closeDetail() { detailOpen = false; State.notify(); },
    openSettings() { actions.openSettingsWindow(); },
  };
  const rightBody = h(
    "div",
    { class: "overview-activity" },
    h("div", { class: "overview-label", text: "Recent activity" }),
    activity,
    tabs,
  );
  const el = h(
    "div",
    { class: "view overview" },
    h("div", { class: "left" }, leftCard),
    h("div", { class: "right" }, card(null, rightBody)),
  );
  let lastActivity: string | null = null;

  return {
    el,
    sync() {
      const task = State.focusTask;
      const browser = State.settings.chatBackend === "browser";
      name.textContent = browser ? "Browser AI" : "Ollama";
      model.textContent = (browser ? State.settings.browserModel : State.settings.ollamaModel) || "Choose a model in Settings";
      model.title = model.textContent;
      const provider = task?.id ?? "integration_ollama";
      if (provider !== currentProvider) { detailOpen = false; currentProvider = provider; }
      const keyForCard = JSON.stringify([provider, State.integrations[provider], task?.steps, task?.state, detailOpen]);
      if (keyForCard !== providerKey) {
        providerKey = keyForCard;
        clear(leftCard);
        leftCard.append(provider === "integration_ollama" || !task ? leftBody : renderIntegrationCard(task, hooks));
      }
      const choices = State.otherTasks;
      const keyForTabs = JSON.stringify([choices.map(item => [item.id, item.pillBadge]), browser]);
      if (keyForTabs !== tabsKey) {
        tabsKey = keyForTabs;
        clear(tabs);
        for (const choice of choices) {
          const label = choice.id === "integration_ollama" && browser ? "Browser AI" : choice.name;
          const button = h("button", { class: "service-tab", text: label, onclick: () => { detailOpen = false; State.setFocus(choice.id); } });
          button.prepend(dot(choice.color, 5));
          if (choice.pillBadge) button.append(h("span", { class: `service-badge ${choice.pillBadge}`, text: choice.pillBadge === "error" ? "!" : "✓" }));
          tabs.append(button);
        }
      }
      status.textContent = State.chatBusy
        ? State.chatStatus || "Working…"
        : task?.state === "idle"
          ? "Ready"
          : task?.state ?? "Ready";

      const steps = task?.steps.slice(-3) ?? [];
      const chats = provider === "integration_ollama" ? State.savedChats.slice(0, 8) : [];
      const key = JSON.stringify([steps, chats.map(chat => [chat.id, chat.updatedAt]), State.chatBusy, State.voiceBusy]);
      if (key === lastActivity) return;
      lastActivity = key;
      clear(activity);
      if (!steps.length && !chats.length) {
        activity.append(h("div", { class: "activity-empty", text: "No activity yet" }));
        return;
      }
      for (const step of steps) activity.append(h("div", { class: "activity-row", text: step }));
      for (const chat of chats) {
        const row = h("button", { class: "activity-row activity-chat", text: chat.title, title: chat.title,
          onclick: async () => { if (await reopenChat(chat.id)) { State.setFocus("integration_ollama"); actions.setView("prompt"); } },
        }) as HTMLButtonElement;
        row.disabled = State.chatBusy || State.voiceBusy;
        activity.append(row);
      }
    },
  };
}

function buildEmpty(actions: ViewActions): ViewHost {
  const body = h(
    "div",
    { class: "stack empty-body" },
    h("div", {},
      h("div", { class: "title", text: "Nothing to show yet." }),
      h("div", { class: "sub", text: "Ask Mochi or drop a file to get started." }),
    ),
    h("div", { class: "grow" }),
    btn("Chat", "primary", () => actions.setView("prompt")),
  );
  return { el: h("div", { class: "view" }, card(null, body)), sync() {} };
}

function buildConfused(): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 128px" },
    h("div", { class: "title", text: "Too many hits at once." }),
    h("div", { class: "sub", text: "Give me a sec — back to work in three seconds." }),
  );
  return { el: h("div", { class: "view" }, card("pink", body)), sync() {} };
}

function buildNote(): ViewHost {
  const title = h("div", { class: "title" });
  const el = h("div", { class: "view" }, card(null, h("div", { class: "stack", style: "padding:0 18px 0 98px" }, title)));
  return {
    el,
    sync() {
      title.textContent = State.noteMessage ?? "";
    },
  };
}

function buildSettings(actions: ViewActions): ViewHost {
  const soundSwitch = h("button", { class: "switch", "aria-label": "Toggle sound", onclick: () => actions.toggleSound() });
  const volume = h("input", {
    type: "range", min: "0", max: "1", step: "0.01",
    "aria-label": "Sound volume",
    oninput: (event: Event) => actions.setVolume(Number((event.target as HTMLInputElement).value)),
  }) as HTMLInputElement;
  const autoLabel = h("span", {});
  const autoButtons = [10, 15, 30].map((seconds) =>
    h("button", { onclick: () => actions.setAutoClose(seconds) }, `${seconds}s`),
  );
  const model = h("span", { class: "status-badge" });
  const rows = h(
    "div",
    { class: "settings-rows" },
    h("div", { class: "settings-row" }, soundSwitch, h("span", { text: "Sound" }), volume),
    h("div", { class: "settings-row" }, svg(ICONS.timer, 12), autoLabel, h("div", { class: "seg" }, ...autoButtons)),
    h("div", { class: "settings-row settings-model-row" }, model,
      h("div", { class: "grow" }),
      h("button", {
        class: "link-btn",
        text: "Settings…",
        onclick: () => actions.openSettingsWindow(),
      }),
    ),
  );
  const el = h("div", { class: "view" }, card(null, h("div", { class: "stack quick-settings" }, rows)));

  return {
    el,
    sync() {
      const current = State.settings;
      soundSwitch.classList.toggle("on", current.soundEnabled);
      soundSwitch.setAttribute("aria-pressed", String(current.soundEnabled));
      volume.value = String(current.soundVolume);
      volume.style.opacity = current.soundEnabled ? "1" : "0.4";
      autoLabel.textContent = `Auto-close · ${Math.round(current.autoCloseInterval)}s`;
      autoButtons.forEach((button, index) => button.classList.toggle("on", current.autoCloseInterval === [10, 15, 30][index]));
      clear(model);
      model.append(dot("#22C55E", 6), h("span", { text: current.ollamaModel || "Choose a local model" }));
    },
  };
}

function buildPlaceholder(title: string): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 118px" },
    h("div", { class: "title", text: title }),
  );
  return { el: h("div", { class: "view" }, card(null, body)), sync() {} };
}

export function buildViews(
  actions: ViewActions,
  onChatHeightChange: () => void,
): Map<IslandViewName, ViewHost> {
  const map = new Map<IslandViewName, ViewHost>();
  map.set("overview", buildOverview(actions));
  map.set("empty", buildEmpty(actions));
  map.set("confused", buildConfused());
  map.set("note", buildNote());
  map.set("settings", buildSettings(actions));
  map.set("prompt", buildPrompt(onChatHeightChange, id => { State.setFocus(id); actions.setView("overview"); },()=>actions.toggleFullscreen()));
  map.set("upload", buildUpload());
  map.set("uploading", buildUploading());
  map.set("choose", buildChoose(actions));
  map.set("searching", buildPlaceholder("Mochi is thinking…"));
  map.set("result", buildPlaceholder("Result"));
  return map;
}
