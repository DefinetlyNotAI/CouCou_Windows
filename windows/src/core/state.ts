// App state shared by the island views and the Ollama chat.

import type { BotEmoteName, BotStateName, IslandMode, IslandViewName } from "./layout";
import type { EyeShape } from "../mochi/engine";

export type AgentSource = "ollama";

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
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
}

export type PromptContext =
  | { kind: "window"; appName: string; title: string; url?: string }
  | { kind: "file"; name: string; path?: string };

export interface Settings {
  soundEnabled: boolean;
  soundVolume: number;
  autoCloseInterval: number;
  absenceInterval: number;
  screen: "primary" | "cursor";
  autostart: boolean;
  ollamaUrl: string;
  ollamaModel: string;
  toolsEnabled: boolean;
  webSearchEnabled: boolean;
  chatTimeoutSeconds: number;
}

export const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  soundVolume: 0.12,
  autoCloseInterval: 15,
  absenceInterval: 180,
  screen: "primary",
  autostart: false,
  ollamaUrl: "http://127.0.0.1:11434",
  ollamaModel: "",
  toolsEnabled: true,
  webSearchEnabled: true,
  chatTimeoutSeconds: 120,
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

class AppState {
  mode: IslandMode = "hidden";
  view: IslandViewName = "overview";

  tasks: AgentTask[] = [ollamaTask()];
  focusId: string | null = "integration_ollama";

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
  chatBusy = false;
  chatStatus = "";
  chatRequestId: string | null = null;

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

  get focusTask(): AgentTask | null {
    return this.tasks.find((t) => t.id === this.focusId) ?? this.tasks[0] ?? null;
  }

  get effectiveState(): BotStateName {
    return this.stateOverride ?? this.focusTask?.state ?? "idle";
  }

  setFocus(id: string) {
    if (!this.tasks.some((task) => task.id === id)) return;
    this.focusId = id;
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

  defaultView(): IslandViewName {
    return "overview";
  }
}

export const State = new AppState();
