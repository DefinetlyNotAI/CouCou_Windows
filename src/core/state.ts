// App state shared by the island views and the Ollama chat.

import type { BotEmoteName, BotStateName, IslandMode, IslandViewName } from "./layout";
import type { EyeShape } from "../mochi/engine";
import type { AgentProfile } from "./agents";
import type { Project } from "./projects";
import type { AgentRun } from "./runs";
import {Bridge,IS_TAURI} from "./bridge";
import {isSavedChat} from "./chat-data";

export type AgentSource = "ollama" | "n8n" | "local";
export type PillBadge = "finished" | "error";

export interface AgentTask {
  id: string;
  name: string;
  color: string;
  state: BotStateName;
  stepIndex: number;
  steps: string[];
  source: AgentSource;
  isIntegration: boolean;
  emote?: BotEmoteName | null;
  miniEye?: EyeShape | null;
  pillBadge?: PillBadge | null;
}

export interface IntegrationInfo {
  data: Record<string, unknown>;
  error: string | null;
  loaded: boolean;
  configured: boolean;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  file?: { name: string; path: string };
  status?: "complete" | "stopped";
  pinned?: boolean;
  inContext?: boolean;
  filePinned?: boolean;
  fileActive?: boolean;
}

export interface SavedChat {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
  models?: { ollama: string; browser: string };
  parentId?: string;
  branchMessageId?: number;
  projectId?: string;
  toolResults?: { tool:string; content:string }[];
  runs?:AgentRun[];
  folder?:string;tags?:string[];
}

export interface MascotHandoff {
  id: string;
  name: string;
  color: string;
  kind: "tool" | "service" | "mcp" | "agent";
  status: "working" | "returning" | "error" | "cancelled";
}

export const QUICK_PROFILES = [
  { id: "general", name: "General", prompt: "" },
  { id: "coding", name: "Coding", prompt: "Help with programming. Explain concrete changes, preserve existing behavior, and distinguish verified results from suggestions." },
  { id: "research", name: "Research", prompt: "Research questions using available web tools when relevant. Cite sources, distinguish evidence from inference, and state uncertainty." },
];

export type PromptContext =
  | { kind: "window"; appName: string; title: string; url?: string }
  | { kind: "file"; name: string; path?: string };

export interface Settings {
  soundEnabled: boolean;
  soundVolume: number;
  autoCloseInterval: number;
  absenceInterval: number;
  activeIntegrations: string[];
  screen: string;
  islandWidth: number;
  chatHeight: number;
  islandPosition: number;
  autostart: boolean;
  hiddenPrograms: string[];
  ollamaUrl: string;
  ollamaModel: string;
  toolsEnabled: boolean;
  webSearchEnabled: boolean;
  chatTimeoutSeconds: number;
  chatBackend: "ollama" | "browser";
  browserModel: string;
  agentProfile: string;
  agentPrompt: string;
  agentProfiles: AgentProfile[];
  toolPermissions: Record<string, string>;
  searchProvider: string;
  searchUrl: string;
  mcpServers: { id: string; name: string; command: string; url: string; args: string[]; env: Record<string,string>; enabled: boolean; permissions: string }[];
  projects: Project[];
  activeProjectId: string;
  embeddingModel: string;
  modelAliases:Record<string,string>;fallbackModels:string[];modelKeepAlive:string;
  preferenceProfiles:{id:string;name:string;settings:Partial<Settings>}[];
}

export const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  soundVolume: 0.12,
  autoCloseInterval: 15,
  absenceInterval: 180,
  activeIntegrations: [
    "integration_resend", "integration_n8n", "integration_vercel", "integration_github",
  ],
  screen: "primary",
  islandWidth: 640,
  chatHeight: 300,
  islandPosition: 0.5,
  autostart: false,
  hiddenPrograms: [],
  ollamaUrl: "http://127.0.0.1:11434",
  ollamaModel: "",
  toolsEnabled: true,
  webSearchEnabled: true,
  chatTimeoutSeconds: 120,
  chatBackend: "ollama",
  browserModel: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  agentProfile: "general",
  agentPrompt: "",
  agentProfiles: [],
  toolPermissions: {},
  searchProvider: "duckduckgo",
  searchUrl: "",
  mcpServers: [],
  projects: [],
  activeProjectId: "",
  embeddingModel: "embeddinggemma",
  modelAliases:{},fallbackModels:[],modelKeepAlive:"5m",
  preferenceProfiles:[],
};

type Listener = () => void;

const ollamaTask = (): AgentTask => ({
  id: "integration_ollama",
  name: "Ollama",
  color: "#22C55E",
  state: "idle",
  stepIndex: 0,
  steps: [],
  source: "ollama",
  isIntegration: true,
});

const integrationTask = (
  id: string, name: string, color: string,
): AgentTask => ({
  id, name, color, state: "idle", stepIndex: 0, steps: [], source: "n8n", isIntegration: true,
});

export const INTEGRATION_AGENTS: AgentTask[] = [
  integrationTask("integration_resend", "Resend", "#22C55E"),
  integrationTask("integration_n8n", "n8n", "#F29B38"),
  integrationTask("integration_vercel", "Vercel", "#7C5CFF"),
  integrationTask("integration_github", "GitHub", "#F4505E"),
  integrationTask("integration_notion", "Notion", "#8C8C8C"),
  integrationTask("integration_calcom", "Cal.com", "#C9956A"),
  integrationTask("integration_stripe", "Stripe", "#0570DE"),
];

class AppState {
  mode: IslandMode = "hidden";
  fullscreen = false;
  view: IslandViewName = "overview";

  tasks: AgentTask[] = [ollamaTask()];
  focusId: string | null = "integration_ollama";
  integrations: Record<string, IntegrationInfo> = {};

  stateOverride: BotStateName | null = null;

  /** Cursor in logical screen pixels, origin top-left (like AppState.mousePosition). */
  mouse = { x: 0, y: 0 };
  /** Cursor relative to the island's top-left corner. */
  mouseInIsland = { x: 0, y: 0 };

  isPinned = false;
  paused = false;

  uploadProgress = 0;
  uploadDuration = 2.4;
  fileDragOver = false;

  promptContext: PromptContext | null = null;
  droppedFile: { name: string; path: string } | null = null;
  noteMessage: string | null = null;
  chatHistory: ChatMessage[] = [];
  chatId: string = crypto.randomUUID();
  savedChats: SavedChat[] = [];
  temporaryChat=false;
  private chatsLoaded=false;
  private chatWrites:Promise<void>=Promise.resolve();
  chatModels: { ollama: string; browser: string } | null = null;
  chatParentId: string | undefined;
  chatBranchMessageId: number | undefined;
  chatProjectId: string | undefined;
  streamResponses = true;
  chatBusy = false;
  voiceBusy = false;
  promptQueue: { id: string; text: string; file: { name: string; path: string } | null }[] = [];
  toolActivity: { tool: string; phase: string; text: string }[] = [];
  toolResults: { tool:string; content:string }[] = [];
  runs:AgentRun[]=[];
  quickActionsExpanded = false;
  toolActivityExpanded = false;
  chatStatus = "";
  chatRequestId: string | null = null;
  tokensPerSecond: number | null = null;
  handoffs: MascotHandoff[] = [];
  private handoffTimers = new Map<string, number>();

  lastActivity = performance.now();

  settings: Settings = { ...DEFAULT_SETTINGS };

  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Marks the UI dirty; the island re-renders on the next frame. */
  notify() {
    for (const fn of this.listeners) fn();
  }

  async loadChats() {
    if(this.chatsLoaded)return;this.chatsLoaded=true;
    try {
      let data=IS_TAURI ? await Bridge.chatsLoad() : localStorage.getItem("coucou.chats")||"[]";
      const legacy=localStorage.getItem("coucou.chats");
      if(IS_TAURI && data==="[]" && legacy){await Bridge.chatsSave(legacy);data=legacy;}
      if(IS_TAURI)localStorage.removeItem("coucou.chats");
      const value: unknown = JSON.parse(data);
      if (Array.isArray(value)) this.savedChats = value.filter(isSavedChat);
      this.notify();
    } catch(error) { this.chatStatus=`Could not load chats: ${String(error)}`;this.chatsLoaded=false;this.notify(); }
  }

  persistChats() {
    const value=JSON.stringify(this.savedChats);
    if(IS_TAURI)this.chatWrites=this.chatWrites.then(()=>Bridge.chatsSave(value)).catch(error=>{this.chatStatus=`Chat save failed: ${String(error)}`;this.notify();});
    else {try {localStorage.setItem("coucou.chats",value);}catch{this.chatStatus="Chat storage is full.";}}
  }

  saveChat() {
    if (!this.chatHistory.length || this.temporaryChat) return;
    const title = this.chatHistory.find(message => message.role === "user")?.content.slice(0, 80) || "Chat";
    const chat: SavedChat = { id: this.chatId, title, updatedAt: Date.now(), messages: structuredClone(this.chatHistory),
      models: this.chatModels ? { ...this.chatModels } : undefined, parentId: this.chatParentId, branchMessageId: this.chatBranchMessageId, projectId: this.chatProjectId, toolResults: structuredClone(this.toolResults),runs:structuredClone(this.runs),folder:this.savedChats.find(chat=>chat.id===this.chatId)?.folder,tags:this.savedChats.find(chat=>chat.id===this.chatId)?.tags };
    this.savedChats = [chat, ...this.savedChats.filter(item => item.id !== chat.id)];
    this.persistChats();
  }

  branchChat(messageId: number, messages: ChatMessage[]) {
    this.saveChat();
    this.chatParentId = this.chatId;
    this.chatBranchMessageId = messageId;
    this.chatId = crypto.randomUUID();
    this.chatHistory = structuredClone(messages);
    this.promptQueue = [];
    this.toolActivity = [];
    this.toolResults = [];
    this.saveChat();
  }

  startHandoff(handoff: Omit<MascotHandoff, "status">) {
    const timer = this.handoffTimers.get(handoff.id);
    if (timer != null) window.clearTimeout(timer);
    this.handoffTimers.delete(handoff.id);
    this.handoffs = this.handoffs.filter(item => item.id !== handoff.id);
    this.handoffs.push({ ...handoff, status: "working" });
    this.notify();
  }

  finishHandoff(id: string, status: Exclude<MascotHandoff["status"], "working"> = "returning") {
    const item = this.handoffs.find(handoff => handoff.id === id);
    if (!item) return;
    item.status = status;
    const previous = this.handoffTimers.get(id);
    if (previous != null) window.clearTimeout(previous);
    this.handoffTimers.set(id, window.setTimeout(() => {
      this.handoffTimers.delete(id);
      this.handoffs = this.handoffs.filter(handoff => handoff !== item);
      this.notify();
    }, 2400));
    this.notify();
  }

  endHandoffs(requestId: string, cancelled: boolean) {
    for (const item of this.handoffs.filter(handoff => handoff.id.startsWith(`${requestId}:`) && handoff.status === "working")) {
      this.finishHandoff(item.id, cancelled ? "cancelled" : "error");
    }
  }

  get focusTask(): AgentTask | null {
    return this.tasks.find((t) => t.id === this.focusId) ?? this.tasks[0] ?? null;
  }

  get otherTasks(): AgentTask[] {
    return this.tasks.filter((task) => task.id !== this.focusId);
  }

  get effectiveState(): BotStateName {
    return this.stateOverride ?? this.focusTask?.state ?? "idle";
  }

  setFocus(id: string) {
    const task = this.tasks.find((item) => item.id === id);
    if (!task) return;
    this.focusId = id;
    task.pillBadge = null;
    this.notify();
  }

  setPillBadge(id: string, badge: PillBadge | null) {
    const task = this.tasks.find((item) => item.id === id);
    if (!task) return;
    task.pillBadge = badge;
    this.notify();
  }

  updateTask(id: string, state: BotStateName) {
    const task = this.tasks.find((item) => item.id === id);
    if (!task) return;
    task.state = state;
    this.notify();
  }

  appendStep(id: string, step: string) {
    const task = this.tasks.find((item) => item.id === id);
    if (!task) return;
    task.steps.push(step);
    if (task.steps.length > 20) task.steps.shift();
    task.stepIndex = task.steps.length - 1;
    this.notify();
  }

  loadIntegrationTasks() {
    for (const proto of INTEGRATION_AGENTS) {
      const shouldLoad = this.settings.activeIntegrations.includes(proto.id);
      const index = this.tasks.findIndex((task) => task.id === proto.id);
      if (shouldLoad && index < 0) this.tasks.push({ ...proto, steps: [] });
      if (!shouldLoad && index >= 0) this.tasks.splice(index, 1);
    }
    const order = ["integration_ollama", ...INTEGRATION_AGENTS.map((task) => task.id)];
    this.tasks.sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
    if (!this.tasks.some((task) => task.id === this.focusId)) this.focusId = "integration_ollama";
    this.notify();
  }

  toggleIntegration(id: string) {
    const active = this.settings.activeIntegrations;
    if (active.includes(id)) {
      this.settings.activeIntegrations = active.filter((item) => item !== id);
      if (this.focusId === id) this.focusId = "integration_ollama";
    } else {
      if (active.length >= 4) return;
      this.settings.activeIntegrations = [...active, id];
    }
    this.loadIntegrationTasks();
  }

  defaultView(): IslandViewName {
    return "overview";
  }
}

export const State = new AppState();
