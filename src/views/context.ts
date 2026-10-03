import { h } from "./dom";
import { State } from "../core/state";
import { profiles,selectAgent } from "../core/agents";
import { SYSTEM_PROMPT } from "../core/browser-ai";

export function buildContext(changed: () => void, summarize: () => void, clearContext: () => void, isUpdating: () => boolean) {
  const body=h("div",{class:"context-body"});
  const summary=h("summary",{text:"Context"});
  const el=h("details",{class:"chat-context"},summary,body);
  let key="";
  function sync() {
    const next=JSON.stringify([State.chatHistory,State.toolResults,State.settings.agentPrompt,State.chatProjectId,State.settings.projects,State.chatBusy,State.voiceBusy,isUpdating()]);
    if(key===next) return; key=next;
    const settings={...State.settings};
    const project=settings.projects.find(project=>project.id===State.chatProjectId);
    const agent=profiles(settings).find(agent=>agent.id===(project?.agentId || settings.agentProfile));
    if(agent) selectAgent(settings,agent);
    const active=State.chatHistory.filter(message=>message.inContext!==false);
    const text=[SYSTEM_PROMPT,settings.agentPrompt,project?.instructions,project?.memory,...active.map(message=>message.content)].filter(Boolean).join("\n");
    summary.textContent=`Context · ~${Math.ceil(text.length/4)} text tokens`;
    function inspect(label:string,text:string) { return h("details",{},h("summary",{text:label}),h("pre",{text})); }
    const sections=[inspect("System prompt",SYSTEM_PROMPT),inspect("Agent instructions",settings.agentPrompt),inspect("Memory",project?.memory||""),inspect("Project instructions",project?.instructions||"")];
    const messages=h("div");
    for(const message of State.chatHistory) {
      const row=h("div",{class:"context-message"},inspect(`${message.role} · ${message.id}`,message.content));
      const pin=h("button",{class:"link-btn",text:message.pinned ? "Unpin" : "Pin",onclick:()=> { message.pinned=!message.pinned; if(message.pinned) message.inContext=true; changed(); }}) as HTMLButtonElement;
      const exclude=h("button",{class:"link-btn",text:message.inContext===false ? "Include" : "Exclude",onclick:()=> { message.inContext=message.inContext===false; if(!message.inContext) message.pinned=false; changed(); }}) as HTMLButtonElement;
      pin.disabled=exclude.disabled=State.chatBusy || State.voiceBusy || isUpdating();
      row.append(pin,exclude);
      if(message.file) {
        const file=h("input",{type:"checkbox","aria-label":`Use ${message.file.name} in context`}) as HTMLInputElement;
        file.checked=message.fileActive!==false; file.disabled=State.chatBusy || State.voiceBusy || isUpdating();
        file.addEventListener("change",()=> { message.fileActive=file.checked; if(!file.checked) message.filePinned=false; changed(); });
        const pinFile=h("button",{class:"link-btn",text:message.filePinned ? "Unpin file" : "Pin file",onclick:()=> { message.filePinned=!message.filePinned; if(message.filePinned) { message.fileActive=true; message.inContext=true; } changed(); }}) as HTMLButtonElement;
        pinFile.disabled=State.chatBusy || State.voiceBusy || isUpdating();
        row.append(h("label",{},file,message.file.name),pinFile);
      }
      messages.append(row);
    }
    const summarizeButton=h("button",{class:"link-btn",text:"Summarize older context",onclick:summarize}) as HTMLButtonElement;
    const clearButton=h("button",{class:"link-btn",text:"Clear context",onclick:clearContext}) as HTMLButtonElement;
    summarizeButton.disabled=State.chatBusy || State.voiceBusy || isUpdating() || active.length<6;
    clearButton.disabled=State.chatBusy || State.voiceBusy || isUpdating() || !active.length;
    body.replaceChildren(...sections,inspect("Token usage","Approximation for visible text: 1 token per 4 characters. Files, tool schemas/results and model tokenization are not included."),messages,
      inspect("Tool result history",State.toolResults.map(result=>`${result.tool}\n${result.content}`).join("\n\n")),h("div",{class:"permission-controls"},summarizeButton,clearButton));
  }
  return {el,sync};
}
