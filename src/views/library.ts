import {h} from "./dom";
import {State,type SavedChat} from "../core/state";
import {reopenChat} from "./chat";
import {Bridge} from "../core/bridge";
function encoded(bytes:Uint8Array){let text="";for(const byte of bytes)text+=String.fromCharCode(byte);return btoa(text);}
function decoded(text:string){return Uint8Array.from(atob(text),value=>value.charCodeAt(0));}
async function key(password:string,salt:Uint8Array){const material=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveKey"]);return crypto.subtle.deriveKey({name:"PBKDF2",salt:salt.buffer as ArrayBuffer,iterations:250000,hash:"SHA-256"},material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);}
export function buildLibrary() {
  const el=h("details",{},h("summary",{text:"Chats and backups"}));const search=h("input",{placeholder:"Search chats, folders and tags","aria-label":"Search all chats"}) as HTMLInputElement;
  const password=h("input",{type:"password",placeholder:"Backup password","aria-label":"Backup password"}) as HTMLInputElement;
  const output=h("div");const notice=h("div",{role:"status"});
  function render() {const query=search.value.toLowerCase();output.replaceChildren(...State.savedChats.filter(chat=>`${chat.title} ${chat.folder||""} ${(chat.tags||[]).join(" ")} ${chat.messages.map(message=>message.content).join(" ")}`.toLowerCase().includes(query)).map(chat=>h("div",{class:"workspace-controls"},h("button",{text:chat.title,onclick:()=>void reopenChat(chat.id)}),h("button",{text:"Folder / tags",onclick:()=> {const folder=prompt("Folder",chat.folder||"");if(folder===null)return;const tags=prompt("Tags, comma separated",(chat.tags||[]).join(", "));if(tags===null)return;chat.folder=folder.trim();chat.tags=tags.split(",").map(tag=>tag.trim()).filter(Boolean);State.persistChats();render();}}))));}
  search.addEventListener("input",render);el.addEventListener("toggle",()=>{if((el as HTMLDetailsElement).open)render();});
  async function exportData(encrypt:boolean) {try {
    State.saveChat();let value:unknown={format:"coucou-backup-1",chats:State.savedChats,settings:State.settings};
    if(encrypt){if(!password.value)throw new Error("Enter a backup password");const salt=crypto.getRandomValues(new Uint8Array(16));const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},await key(password.value,salt),new TextEncoder().encode(JSON.stringify(value)));value={format:"coucou-encrypted-1",salt:encoded(salt),iv:encoded(iv),data:encoded(new Uint8Array(cipher))};}
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}));const a=h("a",{href:url,download:`coucou-${encrypt?"encrypted-backup":"export"}-${new Date().toISOString().slice(0,10)}.json`});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice.textContent="Exported. Service keys are held separately in Windows credentials.";
  }catch(error){notice.textContent=String(error);}}
  const file=h("input",{type:"file",accept:".json","aria-label":"Import chats or backup"}) as HTMLInputElement;
  file.addEventListener("change",async()=> {try {
    if(!file.files?.[0])return;let value=JSON.parse(await file.files[0].text());
    if(value.format==="coucou-encrypted-1"){if(!password.value)throw new Error("Enter the backup password");const plaintext=await crypto.subtle.decrypt({name:"AES-GCM",iv:decoded(value.iv).buffer as ArrayBuffer},await key(password.value,decoded(value.salt)),decoded(value.data).buffer as ArrayBuffer);value=JSON.parse(new TextDecoder().decode(plaintext));}
    if(value.format!=="coucou-backup-1"||!Array.isArray(value.chats)||value.chats.some((chat:SavedChat)=>typeof chat.id!=="string"||typeof chat.title!=="string"||typeof chat.updatedAt!=="number"||!Array.isArray(chat.messages)||chat.messages.some(message=>!["user","assistant"].includes(message.role)||typeof message.content!=="string"||typeof message.id!=="number")))throw new Error("Invalid Coucou backup");
    if(State.chatBusy)throw new Error("Stop generation before importing");
    const chats=new Map(State.savedChats.map(chat=>[chat.id,chat]));for(const chat of value.chats)chats.set(chat.id,chat);State.savedChats=[...chats.values()];State.persistChats();
    if(value.settings && confirm("Also restore settings and agent profiles from this backup?")){const settings={...State.settings,...value.settings};await Bridge.saveSettings(settings);State.settings=settings;}
    State.notify();render();notice.textContent="Imported.";
  }catch(error){notice.textContent=String(error);}finally{file.value="";}});
  el.append(search,h("button",{text:"Temporary chat",onclick:()=>{if(State.chatHistory.length){notice.textContent="Start a new chat first.";return;}State.temporaryChat=!State.temporaryChat;notice.textContent=State.temporaryChat ? "Temporary chat: this conversation will not be saved." : "Chat saving enabled.";}}),output,password,h("div",{class:"workspace-controls"},h("button",{text:"Export",onclick:()=>void exportData(false)}),h("button",{text:"Encrypted backup",onclick:()=>void exportData(true)})),file,notice);return el;
}
