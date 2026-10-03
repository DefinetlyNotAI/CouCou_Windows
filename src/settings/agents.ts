import { h } from "../views/dom";
import { newAgent, profiles, selectAgent } from "../core/agents";
import type { Settings } from "../core/state";

export function agentsSection(settings: Settings, save: () => Promise<void>): HTMLElement {
  const section = h("section", {}, h("h2", { text: "Agent profiles" }));
  const picker = h("select", { "aria-label": "Edit agent profile" }) as HTMLSelectElement;
  const editor = h("div", { class: "agent-editor" });
  settings.agentProfiles = profiles(settings);
  let selected = settings.agentProfiles.find(item => item.id === settings.agentProfile) || settings.agentProfiles[0];
  const persist = () => { if (selected.id === settings.agentProfile) selectAgent(settings, selected); void save(); };
  function field(label: string, value: string, change: (value: string) => void, multiline = false) {
    const control = h(multiline ? "textarea" : "input", { "aria-label": label, spellcheck: "false" }) as HTMLInputElement | HTMLTextAreaElement;
    control.value = value;
    control.addEventListener("change", () => { change(control.value); persist(); });
    return h("label", { class: "agent-field" }, h("span", { text: label }), control);
  }
  function render() {
    picker.replaceChildren(...settings.agentProfiles.map(profile => h("option", { value: profile.id, text: profile.name })));
    picker.value = selected.id;
    editor.replaceChildren(
      field("Name", selected.name, value => { selected.name = value.trim() || "Agent"; render(); }),
      field("Model", selected.model, value => selected.model = value.trim()),
      field("System prompt", selected.systemPrompt, value => selected.systemPrompt = value, true),
      ...Object.keys(selected.personality).map(key => field(key.replace(/([A-Z])/g, " $1"), selected.personality[key as keyof typeof selected.personality], value => selected.personality[key as keyof typeof selected.personality] = value)),
      field("Tools (one per line; empty uses available tools)", selected.tools.join("\n"), value => selected.tools = value.split(/\r?\n/).map(item => item.trim()).filter(Boolean), true),
      field("MCP servers (one ID per line)", selected.mcpServers.join("\n"), value => selected.mcpServers = value.split(/\r?\n/).map(item => item.trim()).filter(Boolean), true),
      field("Permissions (JSON)", JSON.stringify(selected.permissions, null, 2), value => {
        try {
          const permissions = JSON.parse(value);
          if (!permissions || Array.isArray(permissions) || typeof permissions !== "object" || Object.values(permissions).some(item => typeof item !== "string")) throw new Error();
          selected.permissions = permissions;
        } catch { window.alert("Permissions must be a JSON object with string values."); }
      }, true),
      field("Context size", String(selected.contextSize), value => { const count = Number(value); if (Number.isFinite(count)) selected.contextSize = Math.max(512, Math.min(131072, Math.round(count))); }),
      field("Temperature", String(selected.temperature), value => { const number = Number(value); if (Number.isFinite(number)) selected.temperature = Math.max(0, Math.min(2, number)); }),
      field("Workspace", selected.workspace, value => selected.workspace = value.trim()),
    );
  }
  picker.addEventListener("change", () => { selected = settings.agentProfiles.find(item => item.id === picker.value)!; render(); });
  section.append(h("div", { class: "row" }, picker,
    h("button", { text: "+", title: "Add agent", onclick: () => { selected = newAgent(); settings.agentProfiles.push(selected); render(); persist(); } }),
    h("button", { text: "Use agent", onclick: () => { selectAgent(settings, selected); persist(); } }),
    h("button", { text: "Delete", onclick: () => {
      if (settings.agentProfiles.length === 1) return;
      const wasActive = selected.id === settings.agentProfile;
      settings.agentProfiles = settings.agentProfiles.filter(item => item.id !== selected.id);
      selected = settings.agentProfiles[0]; if (wasActive) selectAgent(settings, selected); render(); persist();
    } }),
  ), editor);
  render(); return section;
}
