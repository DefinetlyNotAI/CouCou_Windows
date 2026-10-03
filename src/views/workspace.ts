import { h } from "./dom";
import { Bridge,IS_TAURI } from "../core/bridge";
import { State } from "../core/state";
import { buildRuns } from "./runs";
import { buildServices } from "./services";
import { buildBackground } from "./background";
export function buildWorkspace(root:HTMLElement,context:HTMLElement,activity:HTMLElement,projectPicker:HTMLElement,pause:(paused:boolean)=>void,stop:()=>void) {
  const contextAnchor=document.createComment("context");context.before(contextAnchor);
  const activityAnchor=document.createComment("activity");activity.before(activityAnchor);
  const pickerAnchor=document.createComment("project");projectPicker.before(pickerAnchor);
  const fileTree=h("div",{class:"workspace-files"});
  const output=h("pre",{class:"workspace-output"});
  const outputFiles=h("div",{class:"workspace-files"});
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
    if(!project && !/^(github|vercel)\./.test(name)) throw new Error("Select a project first");
    const chatId=State.chatId;
    busy=true;notice.textContent=`Running ${name}…`;sync();
    const id=`workspace:${crypto.randomUUID()}`;State.startHandoff({id,name:name.split('.')[0],kind:"tool",color:"#38BDF8"});
    try {
      const result=await Bridge.toolRun({name,input,chatId:State.chatId,projectId:project?.id || ""});
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
  async function openFile(path:string,line=1) {
    if(busy)return;
    if(selectedFile && editor.value!==savedText && !window.confirm("Discard unsaved file changes?"))return;
    try {const result=await tool("filesystem.read",{path});selectedFile=path;editor.value=String(result.content ?? "");savedText=editor.value;fileLabel.textContent=path;editor.readOnly=false;sync();const offset=editor.value.split("\n").slice(0,Math.max(0,line-1)).join("\n").length;editor.focus();editor.setSelectionRange(offset,offset);editor.scrollTop=Math.max(0,line-1)*18;}
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
  const gitFiles=h("textarea",{"aria-label":"Git file paths",placeholder:"Git file paths, one per line"}) as HTMLTextAreaElement;
  const commitMessage=h("input",{"aria-label":"Commit message",placeholder:"Commit message"}) as HTMLInputElement;
  const branchName=h("input",{"aria-label":"Branch name",placeholder:"Branch name"}) as HTMLInputElement;
  function action(label:string,name:string,input:()=>Record<string,unknown>) {
    const button=h("button",{text:label,onclick:async()=> {if(busy)return;try {
      const result=await tool(name,input());output.textContent=typeof result.stdout==="string" ? `${result.stdout}\n${result.stderr || ""}\nExit: ${result.exitCode ?? "unknown"}` : JSON.stringify(result,null,2);
      const references=(Array.isArray(result.results) ? result.results : name==="git.conflicts" ? String(result.stdout||"").split(/\r?\n/).filter(Boolean).map(file=>({file:`${cwd()}\\${file}`,line:1})) : []) as {file:string;line?:number;startLine?:number}[];
      outputFiles.replaceChildren(...references.map(reference=>h("button",{class:"workspace-file",text:`${reference.file}:${reference.line || reference.startLine || 1}`,onclick:()=>void openFile(reference.file,reference.line || reference.startLine || 1)})));
    }catch {}}}) as HTMLButtonElement;
    terminalControls.append(button);return button;
  }
  const cwd=()=>State.settings.projects.find(project=>project.id===State.chatProjectId)?.gitRepo || State.settings.projects.find(project=>project.id===State.chatProjectId)?.folder || "";
  action("Run","powershell.run",()=>({script:script.value,cwd:cwd()}));
  action("Git status","git.status",()=>({cwd:cwd()}));action("Diff","git.diff",()=>({cwd:cwd()}));
  action("Staged diff","git.diff",()=>({cwd:cwd(),staged:true}));
  const files=()=>gitFiles.value.split(/\r?\n/).map(file=>file.trim()).filter(Boolean);
  action("Stage","git.stage",()=>({cwd:cwd(),files:files()}));action("Unstage","git.unstage",()=>({cwd:cwd(),files:files()}));
  action("Commit","git.commit",()=>({cwd:cwd(),message:commitMessage.value}));
  action("Branches","git.branch",()=>({cwd:cwd(),mode:"list"}));action("Create branch","git.branch",()=>({cwd:cwd(),mode:"create",branch:branchName.value}));action("Switch branch","git.branch",()=>({cwd:cwd(),mode:"switch",branch:branchName.value}));
  action("History","git.log",()=>({cwd:cwd()}));action("Conflicts","git.conflicts",()=>({cwd:cwd()}));
  action("Find text","repository.search",()=>({cwd:cwd(),query:search.value}));
  action("Search","project.search",()=>({query:search.value,projectId:State.chatProjectId}));
  action("Tests","coding.test",()=>({...(script.value.trim()?{script:script.value}:{}),cwd:cwd()}));
  action("Lint","coding.lint",()=>({...(script.value.trim()?{script:script.value}:{}),cwd:cwd()}));
  action("Build","coding.build",()=>({...(script.value.trim()?{script:script.value}:{}),cwd:cwd()}));
  const footer=h("section",{class:"workspace-pane workspace-bottom"},h("div",{class:"workspace-editor-header"},fileLabel,save),editor,
    h("h3",{text:"Terminal / Git / search / test logs"}),h("div",{class:"workspace-command-row"},script,search),h("details",{},h("summary",{text:"Git actions"}),h("div",{class:"workspace-command-row"},gitFiles,commitMessage,branchName)),terminalControls,notice,outputFiles,output);
  right.append(runView.el,runStatus,buildServices(tool),buildBackground());
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
