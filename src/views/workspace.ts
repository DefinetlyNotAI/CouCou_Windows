import { h } from "./dom";
import { Bridge,IS_TAURI } from "../core/bridge";
import { State } from "../core/state";
import { buildRuns } from "./runs";
export function buildWorkspace(root:HTMLElement,context:HTMLElement,activity:HTMLElement,projectPicker:HTMLElement,pause:(paused:boolean)=>void,stop:()=>void) {
  const contextAnchor=document.createComment("context");context.before(contextAnchor);
  const activityAnchor=document.createComment("activity");activity.before(activityAnchor);
  const pickerAnchor=document.createComment("project");projectPicker.before(pickerAnchor);
  const fileTree=h("div",{class:"workspace-files"});
  const output=h("pre",{class:"workspace-output"});
  const editor=h("textarea",{class:"workspace-editor","aria-label":"File editor",spellcheck:"false"}) as HTMLTextAreaElement;
  const fileLabel=h("span",{text:"No file open"});
  const notice=h("div",{class:"workspace-notice",role:"status"});
  const runStatus=h("div",{class:"workspace-run"});
  const runView=buildRuns(pause,stop,async()=> {try {const result=await tool("git.diff",{cwd:cwd()});output.textContent=String(result.stdout||"");}catch {}});
  const left=h("aside",{class:"workspace-pane workspace-left"},h("h3",{text:"Project"}),h("div",{class:"workspace-project-picker"}),h("h3",{text:"Files"}),fileTree);
  const right=h("aside",{class:"workspace-pane workspace-right"},h("h3",{text:"Context and tools"}));
  const script=h("textarea",{"aria-label":"PowerShell command",placeholder:"Enter a PowerShell command",spellcheck:"false"}) as HTMLTextAreaElement;
  const search=h("input",{"aria-label":"Search project",placeholder:"Search project semantically"}) as HTMLInputElement;
  let busy=false;let selectedFile="";let savedText="";let activeProject="";let directory="";let previousDirectories:string[]=[];let fullscreen=false;
  projectPicker.addEventListener("change",event=> {
    if(selectedFile && editor.value!==savedText && !window.confirm("Discard unsaved file changes?")) {event.stopImmediatePropagation();(projectPicker as HTMLSelectElement).value=activeProject;}
  },true);
  async function tool(name:string,input:Record<string,unknown>) {
    const project=State.settings.projects.find(project=>project.id===State.chatProjectId);
    if(!project) throw new Error("Select a project first");
    const chatId=State.chatId;
    busy=true;notice.textContent=`Running ${name}…`;sync();
    const id=`workspace:${crypto.randomUUID()}`;State.startHandoff({id,name:name.split('.')[0],kind:"tool",color:"#38BDF8"});
    try {
      const result=await Bridge.toolRun({name,input,chatId:State.chatId,projectId:project.id});
      if(State.chatId===chatId) {State.toolResults.push({tool:name,content:JSON.stringify(result,null,2)});State.toolResults=State.toolResults.slice(-100);State.saveChat();}
      State.finishHandoff(id);notice.textContent="";return result as Record<string,unknown>;
    } catch(error) {State.finishHandoff(id,"error");notice.textContent=String(error);throw error;}
    finally {busy=false;sync();}
  }
  async function list(path:string,push=false) {
    if(busy)return;
    try {
      const result=await tool("filesystem.list",{path});
      if(push && directory) previousDirectories.push(directory);directory=path;
      const entries=(result.entries as {path:string;directory:boolean}[]).sort((a,b)=>Number(b.directory)-Number(a.directory)||a.path.localeCompare(b.path));
      fileTree.replaceChildren(...entries.map(entry=>h("button",{class:"workspace-file",text:`${entry.directory ? "▸ " : ""}${entry.path.split(/[\\/]/).at(-1)}`,title:entry.path,onclick:()=> {
        if(entry.directory) void list(entry.path,true);else void openFile(entry.path);
      }})));
    }catch { /* The operation status displays the error. */ }
  }
  async function openFile(path:string) {
    if(busy)return;
    if(selectedFile && editor.value!==savedText && !window.confirm("Discard unsaved file changes?"))return;
    try {const result=await tool("filesystem.read",{path});selectedFile=path;editor.value=String(result.content ?? "");savedText=editor.value;fileLabel.textContent=path;editor.readOnly=false;sync();}
    catch { /* Keep the previously opened file. */ }
  }
  const save=h("button",{text:"Save file",onclick:async()=> {
    if(!selectedFile || busy)return;
    const content=editor.value;
    try {await tool("filesystem.write",{path:selectedFile,content});savedText=content;notice.textContent="File saved.";}catch { /* Keep unsaved text. */ }
  }}) as HTMLButtonElement;
  const refresh=h("button",{text:"Refresh files",onclick:()=> {
    const project=State.settings.projects.find(project=>project.id===State.chatProjectId);if(project)void list(project.folder);
  }}) as HTMLButtonElement;
  const parent=h("button",{text:"↑",title:"Parent directory",onclick:()=> {if(busy)return;const previous=previousDirectories.pop();if(previous)void list(previous);}}) as HTMLButtonElement;
  left.append(h("div",{class:"workspace-controls"},parent,refresh));
  const terminalControls=h("div",{class:"workspace-controls"});
  function action(label:string,name:string,input:()=>Record<string,unknown>) {
    const button=h("button",{text:label,onclick:async()=> {if(busy)return;try {const result=await tool(name,input());output.textContent=typeof result.stdout==="string" ? `${result.stdout}\n${result.stderr || ""}\nExit: ${result.exitCode ?? "unknown"}` : JSON.stringify(result,null,2);}catch {}}}) as HTMLButtonElement;
    terminalControls.append(button);return button;
  }
  const cwd=()=>State.settings.projects.find(project=>project.id===State.chatProjectId)?.gitRepo || State.settings.projects.find(project=>project.id===State.chatProjectId)?.folder || "";
  action("Run","powershell.run",()=>({script:script.value,cwd:cwd()}));
  action("Git status","git.status",()=>({cwd:cwd()}));action("Diff","git.diff",()=>({cwd:cwd()}));
  action("Search","project.search",()=>({query:search.value,projectId:State.chatProjectId}));
  action("Tests","powershell.run",()=>({script:"npm test",cwd:cwd()}));
  action("Lint","powershell.run",()=>({script:"npm run lint",cwd:cwd()}));
  action("Build","powershell.run",()=>({script:"npm run build",cwd:cwd()}));
  const footer=h("section",{class:"workspace-pane workspace-bottom"},h("div",{class:"workspace-editor-header"},fileLabel,save),editor,
    h("h3",{text:"Terminal / Git / search / test logs"}),h("div",{class:"workspace-command-row"},script,search),terminalControls,notice,output);
  right.append(runView.el,runStatus);
  root.prepend(left);root.append(right,footer);
  function sync() {
    runView.sync();
    const enabled=State.fullscreen;
    projectPicker.dataset.workspaceBusy=String(busy);
    root.classList.toggle("full-workspace",enabled);
    if(fullscreen!==enabled) {
      fullscreen=enabled;
      if(enabled) {right.prepend(context,activity);left.querySelector(".workspace-project-picker")!.append(projectPicker);}
      else {contextAnchor.after(context);activityAnchor.after(activity);pickerAnchor.after(projectPicker);}
    }
    const project=State.settings.projects.find(project=>project.id===State.chatProjectId);
    if(activeProject!==(project?.id||"")) {activeProject=project?.id||"";directory="";previousDirectories=[];selectedFile="";editor.value="";savedText="";fileLabel.textContent="No file open";fileTree.replaceChildren();}
    save.disabled=!IS_TAURI || busy || !selectedFile;refresh.disabled=!IS_TAURI || busy || !project;parent.disabled=busy || !previousDirectories.length;
    for(const button of terminalControls.querySelectorAll<HTMLButtonElement>("button"))button.disabled=!IS_TAURI || busy || !project;
    editor.disabled=busy || !selectedFile;script.disabled=search.disabled=busy || !project;
    const task=State.tasks.find(task=>task.id==="integration_ollama");
    runStatus.replaceChildren(h("h3",{text:"Agent progress"}),h("div",{text:State.chatBusy ? State.chatStatus : task?.state || "Idle"}),...State.toolActivity.slice(-8).map(step=>h("div",{text:step.text})));
  }
  return {sync,openFile};
}
