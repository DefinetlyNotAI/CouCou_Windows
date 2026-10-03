import {h} from "./dom";
import {State} from "../core/state";
import {Bridge} from "../core/bridge";
export function buildStats() {
  const el=h("details",{},h("summary",{text:"Statistics"}));const body=h("pre",{class:"workspace-output"});
  el.append(h("button",{text:"Refresh",onclick:async()=> {
    const runs=State.savedChats.flatMap(chat=>chat.runs||[]);const all=new Map(runs.map(run=>[run.id,run]));State.runs.forEach(run=>all.set(run.id,run));const records=[...all.values()];
    const models:Record<string,number>={};records.forEach(run=>models[run.model]=(models[run.model]||0)+1);
    const recent=records.at(-1);let machine:unknown;
    try {machine=await Bridge.systemStats();}catch(error){machine={unavailable:String(error)};}
    body.textContent=JSON.stringify({chats:State.savedChats.length,modelTurns:models,outputTokens:records.reduce((n,run)=>n+(run.outputTokens||0),0),toolCalls:records.reduce((n,run)=>n+run.calls.length,0),toolFailures:records.reduce((n,run)=>n+run.calls.filter(call=>call.error).length,0),latest:recent ? {model:recent.model,contextTokens:recent.promptTokens??"Unavailable",outputTokens:recent.outputTokens??"Unavailable",TPS:recent.tps??"Unavailable",TTFTSeconds:recent.firstTokenAt ? (recent.firstTokenAt-recent.startedAt)/1000 : "Unavailable",generationSeconds:recent.generationSeconds??"Unavailable",turnSeconds:recent.finishedAt ? (recent.finishedAt-recent.startedAt)/1000 : "Running"}:null,machine},null,2);
  }}),body);return el;
}
