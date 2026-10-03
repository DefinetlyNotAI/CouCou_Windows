// Thin wrapper over the Tauri commands/events. Every call is a no-op when the
// page is opened in a plain browser, so the island can be iterated on with
// `npm run dev` alone.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { Settings } from "./state";

export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!IS_TAURI) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    console.error(`[coucou] ${cmd} failed`, err);
    return null;
  }
}

export interface BootInfo {
  settings: Settings;
  /** Logical screen rect of the monitor the island lives on. */
  screen: { x: number; y: number; width: number; height: number; scale: number };
  version: string;
  /** Whether the native app supplies global cursor events. */
  cursorPoll: boolean;
}

export const Bridge = {
  runningApps: () => callOrThrow<{ executable: string; title: string }[]>("running_apps"),
  monitors: () => callOrThrow<[string, string][]>("monitors"),
  chooseFile: () => callOrThrow<DroppedFile | null>("choose_file"),
  desktopAction: (mode: "screenshot" | "clipboard" | "copy", text = "") => callOrThrow<{ text: string; file: DroppedFile | null }>("desktop_action", { mode, text }),
  boot: () => call<BootInfo>("boot"),

  saveSettings: (settings: Settings) => callOrThrow<void>("save_settings", { settings }),

  /** Shrink the window down to the invisible wake strip (hidden) or back to full. */
  setCollapsed: (collapsed: boolean) => call<void>("set_collapsed", { collapsed }),

  /**
   * Pushes the island shape in window coordinates. Rust flips click-through from
   * its own cursor poll, so the flag is never a frame behind a click.
   */
  setIslandRect: (x: number, y: number, width: number, height: number) =>
    call<void>("set_island_rect", { x, y, width, height }),

  /** Give the window keyboard focus (chat field) and take it away again. */
  focusWindow: (focused: boolean) => call<void>("focus_window", { focused }),

  reposition: () => call<void>("reposition"),
  setFullscreen: (enabled: boolean) => callOrThrow<void>("set_fullscreen", { enabled }),

  openUrl: (url: string) => call<void>("open_url", { url }),

  quit: () => call<void>("quit_app"),

  openSettingsWindow: () => call<void>("open_settings_window"),

  /** Writes to %LOCALAPPDATA%\Coucou\coucou.log, next to the Rust lines. */
  log: (message: string) => call<void>("log_line", { message }),

  // ── Chat, files, secrets ──────────────────────────────────────────────────
  /** One local chat turn. File bytes stay on the Rust side. */
  chatSend: (requestId: string, query: string, context: ChatContext | null, model?: string, chatId?: string, projectId?: string) =>
    callOrThrow<{ text: string; sources: ChatSource[] }>("chat_send", { requestId, query, context, model, chatId, projectId }),
  chatCancel: (requestId: string) => call<void>("chat_cancel", { requestId }),
  toolRun: (request: { name: string; input: Record<string, unknown>; chatId: string; projectId?: string }) => callOrThrow<unknown>("tool_run", { request }),
  toolDecision: (id: string, decision: string) => callOrThrow<void>("tool_decision", { id, decision }),
  projectAttach: (folder: string) => callOrThrow<{ folder:string; name:string; gitRepo:string }>("project_attach",{folder}),
  toolSchemas: (chatId?: string, projectId?: string) => callOrThrow<unknown[]>("tool_schemas", { chatId, projectId }),
  voiceRun: (requestId: string, mode: "capabilities" | "listen" | "speak", text = "", volume = 100) =>
    callOrThrow<{ text?: string; voices?: string[]; languages?: string[] }>("voice_run", { requestId, mode, text, volume }),
  voiceCancel: (requestId: string) => call<void>("voice_cancel", { requestId }),
  ollamaModels: (url: string) => callOrThrow<string[]>("ollama_models", { url }),
  ollamaModelInfo: (url: string, model: string) => callOrThrow<{ tools: boolean; vision: boolean; thinking: boolean }>("ollama_model_info", { url, model }),
  browserTools: () => callOrThrow<unknown[]>("browser_tools"),
  browserTool: (name: string, input: Record<string, unknown>) =>
    callOrThrow<{ content: string; sources: ChatSource[] }>("browser_tool", { name, arguments: input }),
  browserContext: (context: ChatContext) => callOrThrow<string>("browser_context", { context }),
  chatReset: () => call<void>("chat_reset"),
  chatRestore: (messages: { role: string; content: string }[]) => callOrThrow<void>("chat_restore", { messages }),
  /** Copies a dropped file into the inbox. */
  ingestFile: (path: string) => callOrThrow<DroppedFile>("ingest_file", { path }),
  /** Only ever tells you whether a key exists — never its value. */
  secretPresent: (key: string) => call<boolean>("secret_present", { key }),
  secretSet: (key: string, value: string) => callOrThrow<void>("secret_set", { key, value }),
  secretClear: (key: string) => callOrThrow<void>("secret_clear", { key }),
  refreshIntegration: (id: string) => call<void>("refresh_integration", { id }),
  openN8n: () => call<void>("open_n8n"),
  setPaused: (paused: boolean) => call<void>("set_paused", { paused }),
};

export type ChatContext =
  | { kind: "file"; name: string; path: string }
  | { kind: "window"; appName: string; title: string; url?: string };

export interface DroppedFile {
  name: string;
  path: string;
  size: number;
}

/** Same as `call`, but surfaces the error so the UI can show what went wrong. */
async function callOrThrow<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI) throw new Error("not running inside Coucou");
  return invoke<T>(cmd, args);
}

export type BridgeEvent =
  | { name: "cursor"; payload: { x: number; y: number } }
  | { name: "tray"; payload: string }
  | { name: "chat-progress"; payload: ChatProgress }
  | { name: "integration"; payload: IntegrationUpdate }
  | { name: "visibility-blocked"; payload: boolean }
  | { name: "screen-changed"; payload: null };

export interface DragDropPayload {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
}

/** Files dragged onto the island. Only reaches us when the window takes the mouse. */
export async function onDragDrop(handler: (e: DragDropPayload) => void) {
  if (!IS_TAURI) return () => {};
  return getCurrentWebview().onDragDropEvent((event) => {
    handler(event.payload as DragDropPayload);
  });
}

export async function onEvent<T>(name: string, handler: (payload: T) => void) {
  if (!IS_TAURI) return () => {};
  return listen<T>(name, (e) => handler(e.payload));
}

export interface ChatSource { title: string; url: string; }
export interface ChatProgress {
  requestId: string; phase: string; text: string; tool: string | null;
  callId?: string;
  actor?: { name: string; kind: "tool" | "service" | "mcp" | "agent"; color?: string };
}
export interface IntegrationUpdate {
  id: string;
  data: Record<string, unknown>;
  error: string | null;
  event: { success: boolean; label: string; detail: string | null } | null;
}
