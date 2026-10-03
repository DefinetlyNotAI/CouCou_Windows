// Settings for the Ollama connection and general island behavior.

import "./settings.css";
import { Bridge, onEvent } from "../core/bridge";
import { DEFAULT_SETTINGS, type Settings } from "../core/state";
import { h, clear } from "../views/dom";
import { agentsSection } from "./agents";
import { mcpSection } from "./mcp";
import { projectsSection } from "./projects";

let settings: Settings = { ...DEFAULT_SETTINGS };
let version = "";

const BROWSER_MODELS = [
  "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  "Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC",
] as const;

interface IntegrationDef {
  id: string;
  name: string;
  color: string;
  fields: { key: string; label: string; placeholder: string; secret: boolean }[];
}

const INTEGRATIONS: IntegrationDef[] = [
  { id: "integration_stripe", name: "Stripe", color: "#0570DE",
    fields: [{ key: "stripe-api-key", label: "Secret key", placeholder: "sk_live_…", secret: true }] },
  { id: "integration_github", name: "GitHub", color: "#F4505E",
    fields: [{ key: "github-token", label: "Token", placeholder: "ghp_…", secret: true }] },
  { id: "integration_vercel", name: "Vercel", color: "#7C5CFF",
    fields: [{ key: "vercel-token", label: "Token", placeholder: "…", secret: true }] },
  { id: "integration_n8n", name: "n8n", color: "#F29B38",
    fields: [
      { key: "n8n-url", label: "Instance URL", placeholder: "https://n8n.example.com", secret: false },
      { key: "n8n-api-key", label: "API key", placeholder: "…", secret: true },
    ] },
  { id: "integration_resend", name: "Resend", color: "#22C55E",
    fields: [{ key: "resend-api-key", label: "API key", placeholder: "re_…", secret: true }] },
  { id: "integration_notion", name: "Notion", color: "#8C8C8C",
    fields: [{ key: "notion-api-key", label: "Integration token", placeholder: "ntn_…", secret: true }] },
  { id: "integration_calcom", name: "Cal.com", color: "#C9956A",
    fields: [{ key: "calcom-api-key", label: "API key", placeholder: "cal_…", secret: true }] },
];

const MAX_ACTIVE_INTEGRATIONS = 4;

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

function ollamaSection(): HTMLElement {
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

  model.append(h("option", { value: "", text: "Choose a local model" }));
  model.disabled = true;

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

  const section = h(
    "section",
    {},
    h("h2", {}, dot, h("span", { text: "Ollama" })),
    state,
    h("div", { class: "row" }, h("label", { text: "Server URL" }), url, connect),
    h("div", { class: "row" }, h("label", { text: "Local model" }), model),
    capability,
    capabilityError,
  );
  void connectToOllama();
  return section;
}

function browserModelSection(): HTMLElement {
  const model = h("select", { "aria-label": "Browser model", style: "flex:1 1 auto;min-width:0" }) as HTMLSelectElement;
  for (const name of BROWSER_MODELS) model.append(h("option", { value: name, text: name }));
  if (!BROWSER_MODELS.includes(settings.browserModel as (typeof BROWSER_MODELS)[number])) {
    settings.browserModel = BROWSER_MODELS[0];
  }
  model.value = settings.browserModel;
  model.addEventListener("change", () => {
    settings.browserModel = model.value;
    void save();
  });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Browser (WebGPU)" })),
    h("div", { class: "row" }, h("label", { text: "Model" }), model),
    h("div", {
      class: "hint",
      text: "Runs in CouCou Shahm Edition’s WebView2 runtime. The selected model downloads once on first use and requires a compatible GPU; the Hermes 8B model is about 5 GB.",
    }),
  );
}

function providerSettings(): [HTMLElement, HTMLElement] {
  const provider = h("select", { "aria-label": "Chat provider" }) as HTMLSelectElement;
  provider.append(
    h("option", { value: "ollama", text: "Ollama" }),
    h("option", { value: "browser", text: "Browser (WebGPU)" }),
  );
  provider.value = settings.chatBackend;
  const details = h("div", {});
  const renderDetails = () => {
    clear(details);
    details.append(settings.chatBackend === "browser"
      ? browserModelSection()
      : ollamaSection());
  };
  provider.addEventListener("change", () => {
    settings.chatBackend = provider.value as Settings["chatBackend"];
    void save();
    renderDetails();
  });

  renderDetails();
  return [
    h("section", {},
      h("h2", {}, h("span", { text: "Chat provider" })),
      h("div", { class: "row" }, h("label", { text: "Provider" }), provider),
    ),
    details,
  ];
}

function webSearchKeyControls(initialPresent: boolean, checkError: string): HTMLElement {
  let keyPresent = initialPresent;
  const keyInput = h("input", {
    type: "password", placeholder: "Optional", autocomplete: "off", spellcheck: "false",
    "aria-label": "Web search API key", style: "flex:1 1 auto;min-width:0",
  }) as HTMLInputElement;
  const storeKey = h("button", { text: "Store key" }) as HTMLButtonElement;
  const clearKey = h("button", { text: "Remove key" }) as HTMLButtonElement;
  const keysStatus = h("div", { class: "hint" });
  const keyError = h("div", { class: "notice err" });
  keyError.style.display = "none";
  clearKey.disabled = !keyPresent;

  const updateStatus = () => {
    keysStatus.textContent = checkError
      ? `Could not check the stored key: ${checkError}`
      : keyPresent
        ? "A web API key is stored securely."
        : "No web API key stored. The key is optional.";
  };
  updateStatus();

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
      keyError.style.display = "none";
      clearKey.disabled = false;
      updateStatus();
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
      keyError.style.display = "none";
      updateStatus();
    } catch (error) {
      keyError.textContent = `Could not remove the web API key: ${errorText(error)}`;
      keyError.style.display = "block";
      clearKey.disabled = false;
    }
  });

  return h("div", { style: "display:flex;flex-direction:column;gap:8px" },
    h("div", { class: "row" }, h("label", { text: "Web API key" }), keyInput, storeKey, clearKey),
    keysStatus,
    h("div", { class: "hint", text: "Web search sends queries and requested URLs to ollama.com." }),
    keyError,
  );
}

function chatOptionsSection(keyPresent: boolean, keyCheckError: string): HTMLElement {
  const provider = h("select", { "aria-label": "Search provider" }) as HTMLSelectElement;
  for (const [value,label] of [["duckduckgo","DuckDuckGo"],["searxng","SearXNG"],["custom","Custom JSON provider"],["browser","Open browser search"]]) provider.append(h("option",{value,text:label}));
  provider.value = settings.searchProvider;
  provider.addEventListener("change",() => { settings.searchProvider = provider.value; void save(); });
  const searchUrl = h("input",{value:settings.searchUrl,"aria-label":"Search provider URL",placeholder:"http://localhost:8080/search"}) as HTMLInputElement;
  searchUrl.addEventListener("change",() => { settings.searchUrl = searchUrl.value.trim(); void save(); });
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
  tools.setAttribute("aria-label", "Tool calling");
  const webSearch = toggle(settings.webSearchEnabled, (value) => {
    settings.webSearchEnabled = value;
    void save();
  });
  webSearch.setAttribute("aria-label", "Web search");

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Chat behavior" })),
    h("div", { class: "row" }, h("label", { text: "Tool calling" }), tools),
    h("div", { class: "row" }, h("label", { text: "Web search" }), webSearch),
    h("div", { class: "row" }, h("label", { text: "Search provider" }), provider),
    h("div", { class: "row" }, h("label", { text: "SearXNG / custom URL" }), searchUrl),
    h("div", { class: "row" }, h("label", { text: "Request timeout" }), timeout, h("span", { class: "hint", text: "seconds (30–600)" })),
    webSearchKeyControls(keyPresent, keyCheckError),
  );
}

function integrationsSection(present: Record<string, boolean>): HTMLElement {
  const note = h("div", { class: "hint" });
  const list = h("div", { style: "display:flex;flex-direction:column;gap:14px" });
  const switches: { sync: () => void }[] = [];

  function updateNote() {
    note.textContent = `Choose up to ${MAX_ACTIVE_INTEGRATIONS} service pills — ${settings.activeIntegrations.length}/${MAX_ACTIVE_INTEGRATIONS} selected. Credentials stay in the operating system’s secure store.`;
  }

  for (const def of INTEGRATIONS) {
    const sw = h("button", { class: "switch" }) as HTMLButtonElement;
    const syncSwitch = () => {
      const active = settings.activeIntegrations.includes(def.id);
      sw.classList.toggle("on", active);
      sw.setAttribute("aria-pressed", String(active));
      sw.disabled = !active && settings.activeIntegrations.length >= MAX_ACTIVE_INTEGRATIONS;
    };
    sw.addEventListener("click", () => {
      const active = settings.activeIntegrations.includes(def.id);
      if (active) {
        settings.activeIntegrations = settings.activeIntegrations.filter((id) => id !== def.id);
      } else {
        if (settings.activeIntegrations.length >= MAX_ACTIVE_INTEGRATIONS) return;
        settings.activeIntegrations = [...settings.activeIntegrations, def.id];
      }
      for (const item of switches) item.sync();
      updateNote();
      void save();
    });
    const rows = h("div", { style: "display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-width:0" });
    for (const field of def.fields) {
      const input = h("input", {
        type: field.secret ? "password" : "text",
        placeholder: present[field.key] ? "••••••••  (stored)" : field.placeholder,
        autocomplete: "off",
        spellcheck: "false",
        style: "flex:1 1 auto;min-width:0",
        "aria-label": `${def.name} ${field.label}`,
      }) as HTMLInputElement;
      const saveBtn = h("button", { text: "Save" }) as HTMLButtonElement;
      const dotEl = statusDot(present[field.key] ?? false);
      const error = h("span", { class: "hint" });
      saveBtn.addEventListener("click", async () => {
        const value = input.value.trim();
        saveBtn.disabled = true;
        error.textContent = "";
        try {
          await Bridge.secretSet(field.key, value);
          present[field.key] = value.length > 0;
          input.value = "";
          input.placeholder = value ? "••••••••  (stored)" : field.placeholder;
          dotEl.style.background = value ? "#22c55e" : "#f4505e";
          await save();
        } catch (reason) {
          error.textContent = `Could not store ${field.label.toLowerCase()}: ${errorText(reason)}`;
        } finally {
          saveBtn.disabled = false;
        }
      });
      rows.append(
        h("div", { class: "row" },
          h("label", { style: "min-width:104px", text: field.label }),
          input, saveBtn, dotEl,
        ),
        error,
      );
    }

    const toggleLabel = h("div", { style: "display:flex;align-items:center;gap:8px;min-width:132px;padding-top:4px" },
      sw,
      h("i", { class: "dot", style: `background:${def.color}` }),
      h("span", { style: "font-size:12.5px", text: def.name }),
    );
    list.append(h("div", { style: "display:flex;gap:12px;align-items:flex-start" }, toggleLabel, rows));
    switches.push({ sync: syncSwitch });
    syncSwitch();
  }

  updateNote();
  return h("section", {}, h("h2", {}, h("span", { text: "Integrations" })), note, list);
}

function generalSection(): HTMLElement {
  const volume = h("input", {
    type: "range", min: "0", max: "1", step: "0.01", value: String(settings.soundVolume),
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

  const screen = h("select", { "aria-label": "Island display" }) as HTMLSelectElement;
  screen.append(
    h("option", { value: "primary", text: "Main display" }),
    h("option", { value: "cursor", text: "Display under the cursor" }),
  );
  screen.value = settings.screen;
  void Bridge.monitors().then(monitors => {
    for (const [id, name] of monitors) screen.append(h("option", { value: id, text: name }));
    screen.value = settings.screen;
    if (!screen.value) screen.value = "primary";
  }).catch(() => {});
  screen.addEventListener("change", () => {
    settings.screen = screen.value as Settings["screen"];
    void save();
  });

  const hiddenPrograms = h("textarea", {
    rows: "4",
    spellcheck: "false",
    style: "width:100%;min-height:84px;resize:vertical",
    "aria-label": "Programs that keep Coucou hidden at the top of the screen",
  }) as HTMLTextAreaElement;
  hiddenPrograms.value = settings.hiddenPrograms.join("\n");
  hiddenPrograms.addEventListener("change", () => {
    settings.hiddenPrograms = [...new Set(hiddenPrograms.value
      .split(/\r?\n/)
      .map((entry) => entry.trim().split(/[\\/]/).pop()?.trim().toLowerCase() ?? "")
      .filter(Boolean))];
    hiddenPrograms.value = settings.hiddenPrograms.join("\n");
    void save();
  });

  function placementControl(label: string, key: "islandWidth" | "chatHeight" | "islandPosition", min: number, max: number, step: number) {
    const input = h("input", { type: "range", min: String(min), max: String(max), step: String(step),
      value: String(settings[key]), "aria-label": label }) as HTMLInputElement;
    const value = h("span", { class: "hint" });
    const update = () => { value.textContent = key === "islandPosition" ? `${Math.round(Number(input.value) * 100)}%` : `${input.value}px`; };
    update();
    input.addEventListener("input", update);
    input.addEventListener("change", () => { settings[key] = Number(input.value); void save(); });
    return h("div", { class: "row" }, h("label", { text: label }), input, value);
  }

  const runningApps = h("select", { "aria-label": "Currently running applications" }) as HTMLSelectElement;
  const pickerStatus = h("span", { class: "hint" });
  async function refreshRunningApps() {
    try {
      const apps = await Bridge.runningApps();
      runningApps.replaceChildren(h("option", { value: "", text: "Choose a running app…" }), ...apps.map(app =>
        h("option", { value: app.executable, text: `${app.executable} — ${app.title}` })));
      pickerStatus.textContent = apps.length ? "" : "No running applications found.";
    } catch (error) { pickerStatus.textContent = String(error).replace(/^Error:\s*/, ""); }
  }
  runningApps.addEventListener("change", () => {
    if (!runningApps.value) return;
    settings.hiddenPrograms = [...new Set([...settings.hiddenPrograms, runningApps.value.toLowerCase()])];
    hiddenPrograms.value = settings.hiddenPrograms.join("\n");
    void save();
    runningApps.value = "";
  });
  void refreshRunningApps();

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
    placementControl("Island width", "islandWidth", 640, 1200, 20),
    placementControl("Chat height", "chatHeight", 240, 800, 20),
    placementControl("Horizontal position", "islandPosition", 0, 1, 0.01),
    h("div", { class: "row" },
      h("label", { text: "Launch at startup" }),
      toggle(settings.autostart, (value) => { settings.autostart = value; void save(); }),
    ),
    h("div", { style: "display:flex;flex-direction:column;gap:6px" },
      h("label", { text: "Hide at the screen edge for these programs" }),
      h("div", { class: "row" }, runningApps, h("button", { text: "Refresh", onclick: () => void refreshRunningApps() })),
      pickerStatus,
      hiddenPrograms,
      h("div", { class: "hint", text: "Enter executable names, one per line. Names match case-insensitively." }),
    ),
  );
}

async function main() {
  const boot = await Bridge.boot();
  if (boot) {
    settings = { ...settings, ...boot.settings };
    version = boot.version.startsWith("v") ? boot.version : `v${boot.version}`;
  }

  let keyPresent = false;
  let keyCheckError = "";
  try {
    keyPresent = (await Bridge.secretPresent("ollama-web-key")) ?? false;
  } catch (error) {
    keyCheckError = errorText(error);
  }

  const serviceKeys = [
    "stripe-api-key", "github-token", "vercel-token",
    "n8n-url", "n8n-api-key", "resend-api-key", "notion-api-key", "calcom-api-key",
  ];
  const present: Record<string, boolean> = {};
  for (const key of serviceKeys) present[key] = (await Bridge.secretPresent(key)) ?? false;

  const [provider, providerDetails] = providerSettings();
  clear(root);
  root.append(
    h("h1", {}, h("span", { text: "CouCou Shahm Edition" }), h("span", { class: "version", text: version })),
    saveError,
    provider,
    providerDetails,
    chatOptionsSection(keyPresent, keyCheckError),
    agentsSection(settings, save),
    permissionsSection(),
    mcpSection(settings,save),
    projectsSection(settings,save),
    integrationsSection(present),
    generalSection(),
  );

  void onEvent<Settings>("settings-changed", (next) => {
    settings = { ...settings, ...next };
  });
}

void main();

function permissionsSection(): HTMLElement {
  const section = h("section", {}, h("h2", { text: "Tool permissions" }));
  const rows = h("div");
  function render() {
    rows.replaceChildren(...Object.entries(settings.toolPermissions).map(([key, permission]) => h("div", { class: "row" },
      h("span", { text: `${key}: ${permission}` }), h("button", { text: "Reset", onclick: () => { delete settings.toolPermissions[key]; void save(); render(); } }),
    )));
  }
  render(); section.append(h("div", { class: "hint", text: "Tools ask before first use. Chat and project approvals last for this app session." }), rows);
  void onEvent<Settings>("settings-changed", next => { settings.toolPermissions = next.toolPermissions; render(); });
  return section;
}
