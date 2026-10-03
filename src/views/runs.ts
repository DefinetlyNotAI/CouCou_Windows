import { h } from "./dom";
import { State } from "../core/state";
export function buildRuns(pause:(paused:boolean)=>void,stop:()=>void,diff:()=>void) {
  const el=h("section",{class:"run-view"},h("h3",{text:"Agent runs"}));
  const picker=h("select",{"aria-label":"Agent run"}) as HTMLSelectElement;
  const body=h("div");let selected="";let key="";
  picker.addEventListener("change",()=>{selected=picker.value;key="";sync();});el.append(picker,body);
  function sync() {
    const next=JSON.stringify([State.runs,State.chatRequestId]);if(next===key)return;key=next;
    const run=State.runs.find(run=>run.id===selected)||State.runs.at(-1);
    picker.replaceChildren(...[...State.runs].reverse().map(run=>h("option",{value:run.id,text:`${run.status}: ${run.goal.slice(0,45)}`})));picker.value=run?.id||"";
    body.replaceChildren();if(!run)return;
    const active=run.id===State.chatRequestId;
    const controls=h("div",{class:"permission-controls"});
    for(const [label,callback,enabled] of [[run.status==="paused"?"Resume":"Pause before next action",()=>pause(run.status!=="paused"),active && run.action!=="Starting"],["Stop",stop,active],["Inspect diff",diff,!!State.chatProjectId]] as const) {
      const button=h("button",{class:"link-btn",text:label,onclick:callback}) as HTMLButtonElement;button.disabled=!enabled;controls.append(button);
    }
    const detail=(label:string,text:string)=>h("details",{},h("summary",{text:label}),h("pre",{text}));
    const filesRead=run.calls.filter(call=>call.name==="filesystem.read").map(call=>call.input.path);
    const filesChanged=run.calls.filter(call=>call.name==="filesystem.write" && !call.error && call.result).map(call=>call.input.path);
    const commands=run.calls.filter(call=>call.name==="powershell.run" || call.name==="terminal.run" || call.name.startsWith("coding."));
    body.append(h("strong",{text:run.goal}),h("div",{text:`${run.model} · ${run.status}`}),controls,
      detail("Plan",run.plan.length ? run.plan.join("\n") : "No plan recorded yet."),detail("Current action",run.action),
      detail("Files read",filesRead.join("\n")),detail("Files changed",filesChanged.join("\n")),
      detail("Commands",JSON.stringify(commands,null,2)),detail("Tests",JSON.stringify(commands.filter(call=>call.name==="coding.test" || /\b(test|pytest|vitest|jest)\b/i.test(JSON.stringify(call.input))),null,2)),
      detail("Tool calls",JSON.stringify(run.calls,null,2)),detail("Permissions requested",JSON.stringify(run.permissions,null,2)),detail("Result",run.result));
  }
  return {el,sync};
}
