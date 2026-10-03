import { h } from "../views/dom";
import type { Settings } from "../core/state";

export function mcpSection(settings: Settings, save: () => Promise<void>): HTMLElement {
  const section = h("section", {}, h("h2", { text: "MCP servers" }));
  const rows = h("div");
  const config = h("textarea", { "aria-label": "Import or export MCP configuration", placeholder: "Paste MCP configuration JSON" }) as HTMLTextAreaElement;
  function render() {
    rows.replaceChildren(...settings.mcpServers.map(server => {
      const row = h("details", {}, h("summary", { text: server.name || "MCP server" }));
      function field(label: string, value: string, update: (value: string) => void, multiline = false) {
        const input = h(multiline ? "textarea" : "input", { "aria-label": `${server.name} ${label}` }) as HTMLInputElement | HTMLTextAreaElement;
        input.value = value;
        input.addEventListener("change", () => {
          try { update(input.value); void save(); }
          catch (error) { window.alert(String(error)); }
        });
        row.append(h("label", { class: "agent-field" }, h("span", { text: label }), input));
      }
      field("Name",server.name,value => { server.name = value; render(); });
      field("Command",server.command,value => server.command = value.trim());
      field("Streamable HTTP URL",server.url,value => server.url = value.trim());
      field("Arguments (JSON array)",JSON.stringify(server.args),value => {
        const args = JSON.parse(value); if (!Array.isArray(args) || args.some(arg => typeof arg !== "string")) throw new Error("Arguments must be an array of strings"); server.args = args;
      });
      field("Environment (JSON object)",JSON.stringify(server.env,null,2),value => {
        const env = JSON.parse(value); if (!env || Array.isArray(env) || typeof env !== "object" || Object.values(env).some(value => typeof value !== "string")) throw new Error("Environment must contain string values"); server.env = env;
      },true);
      const enabled = h("input",{type:"checkbox","aria-label":`${server.name} Enabled`}) as HTMLInputElement;
      enabled.checked = server.enabled; enabled.addEventListener("change",() => { server.enabled = enabled.checked; void save(); });
      const permission = h("select",{"aria-label":`${server.name} Permissions`}) as HTMLSelectElement;
      permission.append(h("option",{value:"ask",text:"Ask before use"}),h("option",{value:"deny",text:"Deny"}));
      permission.value = server.permissions; permission.addEventListener("change",() => { server.permissions = permission.value; void save(); });
      row.append(h("div",{class:"row"},h("label",{text:"Enabled"}),enabled,permission,h("button",{text:"Remove",onclick:() => { settings.mcpServers = settings.mcpServers.filter(item => item.id !== server.id); render(); void save(); }})));
      return row;
    }));
  }
  section.append(h("button",{text:"+ Add server",onclick:() => {
    settings.mcpServers.push({id:crypto.randomUUID(),name:"MCP server",command:"",url:"",args:[],env:{},enabled:false,permissions:"ask"}); render(); void save();
  }}),rows,config,h("div",{class:"row"},
    h("button",{text:"Export",onclick:() => { config.value = JSON.stringify({mcpServers:Object.fromEntries(settings.mcpServers.map(server => [server.name,{...server}]))},null,2); }}),
    h("button",{text:"Import",onclick:() => {
      try {
        const parsed = JSON.parse(config.value); const source = parsed.mcpServers ?? parsed;
        const servers = (Array.isArray(source) ? source : Object.entries(source).map(([name,value]) => ({ ...(value as object), name }))) as Record<string,unknown>[];
        const imported = servers.map(server => {
          if (typeof server.name !== "string" || (!server.command && !server.url)) throw new Error("Each MCP server requires a name and command or URL");
          if (server.args !== undefined && (!Array.isArray(server.args) || server.args.some(arg => typeof arg !== "string"))) throw new Error("Arguments must be strings");
          const env = server.env ?? {};
          if (!env || Array.isArray(env) || typeof env !== "object" || Object.values(env).some(value => typeof value !== "string")) throw new Error("Environment must contain string values");
          return {id:crypto.randomUUID(),name:server.name,command:typeof server.command === "string" ? server.command : "",url:typeof server.url === "string" ? server.url : "",args:(server.args || []) as string[],env:env as Record<string,string>,enabled:false,permissions:"ask"};
        });
        settings.mcpServers.push(...imported); render(); void save();
      } catch (error) { window.alert(`Could not import MCP configuration: ${String(error)}`); }
    }}),
  ));
  render(); return section;
}
