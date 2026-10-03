import { h } from "./dom";
import { Bridge,IS_TAURI,onEvent,type BackgroundTask } from "../core/bridge";
import { State } from "../core/state";

export function buildBackground() {
  const el=h("details",{},h("summary",{text:"Background tasks"}));
  const kind=h("select",{"aria-label":"Task type"},...[["command","Run command"],["log","Watch logfile"],["port","Wait for port"],["process","Wait for process"],["schedule","Daily command"]].map(([value,text])=>h("option",{value,text}))) as HTMLSelectElement;
  const fields:Record<string,HTMLInputElement>={};
  const form=h("div",{class:"workspace-command-row"},kind);
  for(const [key,label] of [["name","Task name"],["script","PowerShell script"],["cwd","Working directory"],["path","Absolute logfile path"],["port","Port"],["pid","Process ID"],["time","Daily time HH:MM"]]) {fields[key]=h("input",{placeholder:label,"aria-label":label}) as HTMLInputElement;form.append(fields[key]);}
  const output=h("div");const status=h("div",{role:"status"});const tasks=new Map<string,BackgroundTask>();
  function update(task:BackgroundTask) {
    tasks.set(task.id,task);
    const id=`local_${task.id}`;let pill=State.tasks.find(item=>item.id===id);
    if(!pill){pill={id,name:task.name,color:"#38BDF8",state:"idle",stepIndex:0,steps:[],source:"local",isIntegration:false};State.tasks.push(pill);}
    pill.state=task.status==="working" ? "working" : "idle";pill.steps=task.logs.slice(-1);pill.pillBadge=task.status==="error" ? "error" : task.status==="finished" ? "finished" : null;
    output.replaceChildren(...Array.from(tasks.values()).map(item=>h("details",{},h("summary",{text:`${item.name} · ${item.status}`}),h("button",{text:"Stop",disabled:item.status!=="working",onclick:()=>void Bridge.backgroundStop(item.id).catch(error=>status.textContent=String(error))}),h("pre",{class:"workspace-output",text:item.logs.join("\n")}))));State.notify();
  }
  const start=h("button",{text:"Start task",disabled:!IS_TAURI,onclick:async()=> {
    try {const input:Record<string,unknown>={kind:kind.value};for(const [key,field] of Object.entries(fields))if(field.value.trim())input[key]=["port","pid"].includes(key)?Number(field.value):field.value.trim();await Bridge.toolRun({name:"task.start",input,chatId:State.chatId,projectId:State.chatProjectId});status.textContent="Task started";}catch(error){status.textContent=String(error);}
  }});
  void onEvent<BackgroundTask>("background-task",update);
  if(IS_TAURI)void Bridge.backgroundList().then(items=>items.forEach(update)).catch(error=>status.textContent=String(error));
  el.append(form,start,status,output);return el;
}
