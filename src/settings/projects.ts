import { h } from "../views/dom";
import { Bridge } from "../core/bridge";
import { profiles } from "../core/agents";
import type { Settings } from "../core/state";
export function projectsSection(settings: Settings, save: () => Promise<void>): HTMLElement {
  const section = h("section",{},h("h2",{text:"Projects"}));
  const folder = h("input",{"aria-label":"Project folder",placeholder:"C:\\Projects\\MyApp"}) as HTMLInputElement;
  const rows = h("div");
  const status = h("div",{class:"hint"});
  function render() {
    rows.replaceChildren(...settings.projects.map(project => {
      const row = h("details",{},h("summary",{text:project.name}));
      function field(label: string, value: string, update: (value:string) => void, multiline=false) {
        const input = h(multiline ? "textarea" : "input",{"aria-label":`${project.name} ${label}`}) as HTMLInputElement|HTMLTextAreaElement;
        input.value = value; input.addEventListener("change",() => { try { update(input.value); void save(); } catch(error) { status.textContent=String(error); } });
        row.append(h("label",{class:"agent-field"},h("span",{text:label}),input));
      }
      field("Name",project.name,value => { project.name = value.trim() || "Project"; render(); });
      row.append(h("div",{class:"hint",text:project.folder}));
      field("Git repository",project.gitRepo,value => project.gitRepo=value.trim());
      const agent = h("select",{"aria-label":`${project.name} Agent`}) as HTMLSelectElement;
      agent.append(h("option",{value:"",text:"Current agent"}),...profiles(settings).map(profile => h("option",{value:profile.id,text:profile.name})));
      agent.value = project.agentId; agent.addEventListener("change",() => { project.agentId=agent.value; void save(); }); row.append(agent);
      field("Instructions",project.instructions,value => project.instructions=value,true);
      field("Memory",project.memory,value => project.memory=value,true);
      field("MCP servers (one ID per line)",project.mcpServers.join("\n"),value => project.mcpServers=value.split(/\r?\n/).map(id=>id.trim()).filter(Boolean),true);
      field("Tool permissions (JSON)",JSON.stringify(project.permissions,null,2),value => {
        const permissions=JSON.parse(value); if (!permissions || Array.isArray(permissions) || typeof permissions!=="object" || Object.values(permissions).some(value=>typeof value!=="string")) throw new Error("Permissions must be a string-valued JSON object"); project.permissions=permissions;
      },true);
      row.append(h("button",{text:"Remove",onclick:()=> { settings.projects=settings.projects.filter(item=>item.id!==project.id); if(settings.activeProjectId===project.id) settings.activeProjectId=""; render(); void save(); }})); return row;
    }));
  }
  section.append(h("div",{class:"row"},folder,h("button",{text:"Attach folder",onclick:async()=> {
    try {
      const result=await Bridge.projectAttach(folder.value.trim());
      const existing=settings.projects.find(project=>project.folder.toLowerCase()===result.folder.toLowerCase());
      if(existing) { status.textContent="This folder is already attached."; return; }
      settings.projects.push({id:crypto.randomUUID(),name:result.name,folder:result.folder,gitRepo:result.gitRepo,agentId:"",instructions:"",memory:"",mcpServers:[],permissions:{}});
      await save(); folder.value=""; render(); status.textContent="Folder attached. Select the project from Chat quick actions.";
    } catch(error) { status.textContent=String(error); }
  }})),status,rows); render(); return section;
}
