// Settings for the Ollama connection and general island behavior.

import "./settings.css";
import { Bridge, onEvent } from "../core/bridge";
import { DEFAULT_SETTINGS, type Settings } from "../core/state";
import { h, clear } from "../views/dom";

let settings: Settings = { ...DEFAULT_SETTINGS };
let version = "";

const root = document.getElementById("settings-root")!;
const saveError = h("div", { class: "notice err" });
saveError.style.display = "none";

function errorText(error: unknown): string {
  return String(error).replace(/^Error:\s*/, "");
}

async function save() {
  try {
    await Bridge.saveSettings(settings);
    saveError.style.display = "none";
  } catch (error) {
    saveError.textContent = `Could not save settings: ${errorText(error)}`;
    saveError.style.display = "block";
  }
}

function toggle(on: boolean, onChange: (value: boolean) => void): HTMLElement {
  const el = h("button", {
    class: on ? "switch on" : "switch",
    "aria-pressed": on,
  });
  el.addEventListener("click", () => {
    const next = !el.classList.contains("on");
    el.classList.toggle("on", next);
    el.setAttribute("aria-pressed", String(next));
    onChange(next);
  });
  return el;
}

function statusDot(ok: boolean): HTMLElement {
  return h("i", { class: "dot", style: `background:${ok ? "#22c55e" : "#f4505e"}` });
}

function ollamaSection(keyPresent: boolean, keyCheckError: string): HTMLElement {
  const dot = statusDot(false);
  const state = h("div", { class: "hint", text: "Connect to Ollama to choose an installed model." });
  const url = h("input", {
    type: "text", value: settings.ollamaUrl, "aria-label": "Ollama server URL",
    style: "flex:1 1 auto;min-width:0", spellcheck: "false",
  }) as HTMLInputElement;
  const model = h("select", { "aria-label": "Local model", style: "flex:1 1 auto;min-width:0" }) as HTMLSelectElement;
  const connect = h("button", { text: "Connect", class: "primary" }) as HTMLButtonElement;
  const capability = h("div", { class: "hint" });
  const capabilityError = h("div", { class: "notice err" });
  capabilityError.style.display = "none";
  const keysStatus = h("div", { class: "hint" });
  const keyError = h("div", { class: "notice err" });
  keyError.style.display = "none";
  const keyInput = h("input", {
    type: "password", placeholder: "Optional", autocomplete: "off", spellcheck: "false",
    "aria-label": "Optional Ollama web API key", style: "flex:1 1 auto;min-width:0",
  }) as HTMLInputElement;
  const storeKey = h("button", { text: "Store key" }) as HTMLButtonElement;
  const clearKey = h("button", { text: "Remove key" }) as HTMLButtonElement;

  model.append(h("option", { value: "", text: "Choose a local model" }));
  model.disabled = true;
  clearKey.disabled = !keyPresent;
  keysStatus.textContent = keyCheckError
    ? `Could not check the stored key: ${keyCheckError}`
    : keyPresent
      ? "A web API key is stored securely."
      : "No web API key stored. The key is optional.";

  async function readCapabilities(selected: string) {
    capability.textContent = "";
    capabilityError.style.display = "none";
    if (!selected) return;
    capability.textContent = "Checking model capabilities…";
    try {
      const info = await Bridge.ollamaModelInfo(settings.ollamaUrl, selected);
      const available = [
        info.tools ? "tool use" : "",
        info.vision ? "vision" : "",
        info.thinking ? "thinking" : "",
      ].filter(Boolean);
      capability.textContent = available.length
        ? `Model capabilities · ${available.join(", ")}`
        : "This model does not advertise tool use, vision, or thinking.";
    } catch (error) {
      capability.textContent = "";
      capabilityError.textContent = `Could not read model capabilities: ${errorText(error)}`;
      capabilityError.style.display = "block";
    }
  }

  async function connectToOllama() {
    const server = url.value.trim().replace(/\/+$/, "");
    if (!server) {
      state.textContent = "Enter an Ollama server URL.";
      return;
    }
    connect.disabled = true;
    url.disabled = true;
    model.disabled = true;
    state.textContent = "Connecting…";
    capability.textContent = "";
    capabilityError.style.display = "none";
    try {
      const names = await Bridge.ollamaModels(server);
      const selected = names.includes(settings.ollamaModel) ? settings.ollamaModel : (names[0] ?? "");
      clear(model);
      if (!names.length) model.append(h("option", { value: "", text: "No installed models" }));
      for (const name of names) model.append(h("option", { value: name, text: name }));
      model.value = selected;
      settings.ollamaUrl = server;
      settings.ollamaModel = selected;
      dot.style.background = names.length ? "#22c55e" : "#f5a524";
      state.textContent = names.length
        ? "Connected. Chat uses the selected local model."
        : "Ollama is running but has no models. Run ollama pull <model>, then connect again.";
      connect.textContent = "Refresh";
      model.disabled = names.length === 0;
      await save();
      await readCapabilities(selected);
    } catch (error) {
      dot.style.background = "#f4505e";
      state.textContent = errorText(error);
    } finally {
      connect.disabled = false;
      url.disabled = false;
    }
  }

  connect.addEventListener("click", () => void connectToOllama());
  url.addEventListener("input", () => {
    model.disabled = true;
    dot.style.background = "#f5a524";
    connect.textContent = "Connect";
    state.textContent = "Connect to save this server and load its models.";
    capability.textContent = "";
    capabilityError.style.display = "none";
  });
  model.addEventListener("change", () => {
    settings.ollamaModel = model.value;
    void save();
    void readCapabilities(model.value);
  });

  storeKey.addEventListener("click", async () => {
    const value = keyInput.value.trim();
    if (!value) {
      keyError.textContent = "Enter a key to store it.";
      keyError.style.display = "block";
      return;
    }
    storeKey.disabled = true;
    try {
      await Bridge.secretSet("ollama-web-key", value);
      keyPresent = true;
      keyInput.value = "";
      keysStatus.textContent = "A web API key is stored securely.";
      keyError.style.display = "none";
      clearKey.disabled = false;
    } catch (error) {
      keyError.textContent = `Could not store the web API key: ${errorText(error)}`;
      keyError.style.display = "block";
    } finally {
      storeKey.disabled = false;
    }
  });
  clearKey.addEventListener("click", async () => {
    clearKey.disabled = true;
    try {
      await Bridge.secretClear("ollama-web-key");
      keyPresent = false;
      keysStatus.textContent = "No web API key stored. The key is optional.";
      keyError.style.display = "none";
    } catch (error) {
      keyError.textContent = `Could not remove the web API key: ${errorText(error)}`;
      keyError.style.display = "block";
      clearKey.disabled = false;
    }
  });

  const timeout = h("input", {
    type: "number", min: "30", max: "600", step: "1",
    value: String(settings.chatTimeoutSeconds), style: "width:82px",
    "aria-label": "Chat request timeout in seconds",
  }) as HTMLInputElement;
  timeout.addEventListener("change", () => {
    settings.chatTimeoutSeconds = Math.max(30, Math.min(600, Number(timeout.value) || 120));
    timeout.value = String(settings.chatTimeoutSeconds);
    void save();
  });

  const tools = toggle(settings.toolsEnabled, (value) => {
    settings.toolsEnabled = value;
    void save();
  });
  tools.setAttribute("aria-label", "Tool hooks");
  const webSearch = toggle(settings.webSearchEnabled, (value) => {
    settings.webSearchEnabled = value;
    void save();
  });
  webSearch.setAttribute("aria-label", "Web search");

  const section = h(
    "section",
    {},
    h("h2", {}, dot, h("span", { text: "Ollama" })),
    state,
    h("div", { class: "row" }, h("label", { text: "Server URL" }), url, connect),
    h("div", { class: "row" }, h("label", { text: "Local model" }), model),
    capability,
    capabilityError,
    h("div", { class: "row" }, h("label", { text: "Tool hooks" }), tools),
    h("div", { class: "row" }, h("label", { text: "Web search" }), webSearch),
    h("div", { class: "hint", text: "Web search needs an Ollama API key. Queries and requested URLs go to ollama.com." }),
    h("div", { class: "row" }, h("label", { text: "Web API key" }), keyInput, storeKey, clearKey),
    keysStatus,
    keyError,
    h("div", { class: "row" }, h("label", { text: "Request timeout" }), timeout, h("span", { class: "hint", text: "seconds (30–600)" })),
  );
  void connectToOllama();
  return section;
}

function generalSection(): HTMLElement {
  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005", value: String(settings.soundVolume),
    "aria-label": "Sound volume",
  }) as HTMLInputElement;
  volume.addEventListener("change", () => {
    settings.soundVolume = Number(volume.value);
    void save();
  });

  const autoClose = h("input", {
    type: "number", min: "5", max: "120", step: "1",
    value: String(Math.round(settings.autoCloseInterval)), style: "width:72px",
  }) as HTMLInputElement;
  autoClose.addEventListener("change", () => {
    settings.autoCloseInterval = Math.max(5, Math.min(120, Number(autoClose.value) || 15));
    autoClose.value = String(settings.autoCloseInterval);
    void save();
  });

  const screen = h("select", {}) as HTMLSelectElement;
  screen.append(
    h("option", { value: "primary", text: "Main display" }),
    h("option", { value: "cursor", text: "Display under the cursor" }),
  );
  screen.value = settings.screen;
  screen.addEventListener("change", () => {
    settings.screen = screen.value as Settings["screen"];
    void save();
  });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "General" })),
    h("div", { class: "row" },
      h("label", { text: "Sound" }),
      toggle(settings.soundEnabled, (value) => { settings.soundEnabled = value; void save(); }),
      volume,
    ),
    h("div", { class: "row" },
      h("label", { text: "Auto-close" }),
      autoClose,
      h("span", { class: "hint", text: "seconds after you leave the island" }),
    ),
    h("div", { class: "row" }, h("label", { text: "Island lives on" }), screen),
    h("div", { class: "row" },
      h("label", { text: "Launch at startup" }),
      toggle(settings.autostart, (value) => { settings.autostart = value; void save(); }),
    ),
  );
}

async function main() {
  const boot = await Bridge.boot();
  if (boot) {
    settings = { ...settings, ...boot.settings };
    version = boot.version;
  }

  let keyPresent = false;
  let keyCheckError = "";
  try {
    keyPresent = (await Bridge.secretPresent("ollama-web-key")) ?? false;
  } catch (error) {
    keyCheckError = errorText(error);
  }

  clear(root);
  root.append(
    h("h1", {}, h("span", { text: "Coucou" }), h("span", { class: "version", text: version })),
    saveError,
    ollamaSection(keyPresent, keyCheckError),
    generalSection(),
  );

  void onEvent<Settings>("settings-changed", (next) => {
    settings = { ...settings, ...next };
  });
}

void main();
