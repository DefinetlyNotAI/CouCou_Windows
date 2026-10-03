import {h} from "../views/dom";
import {Bridge} from "../core/bridge";
import type {Settings} from "../core/state";
export function modelsSection(settings:Settings,save:()=>Promise<void>) {
  const el=h("section",{},h("h2",{text:"Model management"}));const output=h("pre");
  const model=h("input",{placeholder:"Model name or tag","aria-label":"Model name"}) as HTMLInputElement;
  const keep=h("input",{value:settings.modelKeepAlive,placeholder:"Keep alive: 5m, 0, or -1","aria-label":"Model keep alive"}) as HTMLInputElement;
  const aliases=h("textarea",{"aria-label":"Model aliases",placeholder:'Aliases JSON: {"coding":"qwen3:8b"}',value:JSON.stringify(settings.modelAliases,null,2)}) as HTMLTextAreaElement;
  const fallback=h("input",{value:settings.fallbackModels.join(", "),placeholder:"Fallback model names, comma separated","aria-label":"Fallback models"}) as HTMLInputElement;
  let busy=false;const controls=h("div",{class:"row"});
  for(const [label,action] of [["Installed","list"],["Loaded / VRAM","loaded"],["Details / capabilities / context","show"],["Download","pull"],["Delete","delete"],["Keep loaded","load"],["Unload","unload"]])controls.append(h("button",{text:label,onclick:async()=> {
    if(busy)return;if(action==="delete" && !confirm(`Delete ${model.value}?`))return;busy=true;output.textContent=action==="pull" ? "Downloading; large models can take several minutes…" : "Loading…";
    try {const result=await Bridge.modelManage(settings.ollamaUrl,action,model.value.trim(),action==="load" ? "-1" : keep.value);output.textContent=JSON.stringify(result,null,2);if(action==="list") {const models=result.models as {name:string;size:number}[];output.textContent=models.map(item=>`${item.name} · ${(item.size/1e9).toFixed(2)} GB weights (minimum VRAM estimate; context adds memory)`).join("\n");}}
    catch(error){output.textContent=String(error);}finally{busy=false;}
  }}));
  el.append(model,controls,keep,aliases,fallback,h("button",{text:"Save model preferences",onclick:async()=> {try {const parsed=JSON.parse(aliases.value);if(!parsed || Array.isArray(parsed)||typeof parsed!=="object"||Object.values(parsed).some(value=>typeof value!=="string"))throw new Error("Aliases must map names to model names");settings.modelAliases=parsed;settings.fallbackModels=fallback.value.split(",").map(value=>value.trim()).filter(Boolean);settings.modelKeepAlive=keep.value.trim()||"5m";await save();output.textContent="Saved. Fallback selection happens before generation; 0 unloads after each reply.";}catch(error){output.textContent=String(error);}}}),output);return el;
}
