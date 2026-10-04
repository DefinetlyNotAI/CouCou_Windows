import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Bridge, IS_TAURI } from "../core/bridge";
import { State } from "../core/state";
import { h } from "./dom";

export function buildTerminal() {
  const host=h("div",{class:"workspace-terminal","aria-label":"PowerShell terminal"});
  const status=h("span",{text:IS_TAURI?"PowerShell 7":"Available in the Windows app"});
  let session="";let opening=false;let terminal:Terminal|null=null;let fit:FitAddon|null=null;let pending=Promise.resolve();let project=State.chatProjectId||"";
  const report=(error:unknown)=>{status.textContent=String(error).replace(/^Error:\s*/,"");};
  async function close() {
    const id=session;session="";
    if(id)try{await Bridge.terminalClose(id);}catch(error){report(error);}
    terminal?.dispose();terminal=null;fit=null;status.textContent="Session ended";sync();
  }
  const start=h("button",{text:"Start PowerShell",onclick:async()=>{
    if(session||opening)return;
    opening=true;sync();
    terminal?.dispose();host.replaceChildren();pending=Promise.resolve();
    terminal=new Terminal({fontSize:12,fontFamily:"Consolas, monospace",cursorBlink:true,scrollback:3000,theme:{background:"#141618",foreground:"#e6e8ea"}});
    fit=new FitAddon();terminal.loadAddon(fit);terminal.open(host);fit.fit();
    const id=crypto.randomUUID();session=id;
    terminal.onData(data=>{pending=pending.then(()=>Bridge.terminalInput(id,data)).catch(report);});
    terminal.onResize(({cols,rows})=>{if(!opening && session===id)void Bridge.terminalResize(id,cols,rows).catch(report);});
    const folder=State.settings.projects.find(item=>item.id===project)?.folder||"";
    status.textContent="Waiting for permission…";
    try {
      await Bridge.terminalOpen(id,folder,State.chatId||"",project,terminal.cols,terminal.rows,event=>{
        if(session!==id)return;
        if(event.data)terminal?.write(new Uint8Array(event.data));
        if(event.error)report(event.error);
        if(event.exit){session="";if(terminal)terminal.options.disableStdin=true;status.textContent="Session ended";sync();}
      });
      if(session===id){status.textContent="PowerShell 7 · Ctrl+C cancels commands";terminal?.focus();}
      else await Bridge.terminalClose(id);
    }catch(error){await close();report(error);}
    finally{opening=false;sync();}
  }}) as HTMLButtonElement;
  const end=h("button",{text:"End session",onclick:()=>void close()}) as HTMLButtonElement;
  const el=h("div",{class:"workspace-terminal-panel"},h("div",{class:"workspace-controls"},start,end,status),host);
  new ResizeObserver(()=>{if(host.clientWidth && host.clientHeight)fit?.fit();}).observe(host);
  function sync() {
    if(project!==(State.chatProjectId||"")){project=State.chatProjectId||"";if(session)void close();}
    start.disabled=!IS_TAURI||opening||!!session;end.disabled=opening||!session;
  }
  sync();return {el,sync};
}
