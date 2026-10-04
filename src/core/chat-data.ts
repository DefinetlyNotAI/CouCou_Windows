import type { SavedChat } from "./state";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isSavedChat(value: unknown): value is SavedChat {
  return record(value) && typeof value.id === "string" && typeof value.title === "string" &&
    Number.isFinite(value.updatedAt) && Array.isArray(value.messages) && value.messages.every(message =>
      record(message) && Number.isFinite(message.id) && (message.role === "user" || message.role === "assistant") && typeof message.content === "string" &&
      ["pinned", "inContext", "filePinned", "fileActive"].every(key => message[key] === undefined || typeof message[key] === "boolean") &&
      (message.status === undefined || message.status === "complete" || message.status === "stopped") &&
      (message.file === undefined || record(message.file) && typeof message.file.name === "string" && typeof message.file.path === "string")) &&
    ["folder", "parentId", "projectId"].every(key => value[key] === undefined || typeof value[key] === "string") &&
    (value.branchMessageId === undefined || Number.isFinite(value.branchMessageId)) &&
    (value.tags === undefined || Array.isArray(value.tags) && value.tags.every(tag => typeof tag === "string")) &&
    (value.models === undefined || record(value.models) && typeof value.models.ollama === "string" && typeof value.models.browser === "string") &&
    (value.toolResults === undefined || Array.isArray(value.toolResults) && value.toolResults.every(result =>
      record(result) && typeof result.tool === "string" && typeof result.content === "string")) &&
    (value.runs === undefined || Array.isArray(value.runs) && value.runs.every(run =>
      record(run) && ["id", "goal", "model", "action", "result"].every(key => typeof run[key] === "string") && Number.isFinite(run.startedAt) &&
      typeof run.status === "string" && ["running", "paused", "complete", "stopped", "error"].includes(run.status) &&
      ["firstTokenAt", "finishedAt", "promptTokens", "outputTokens", "generationSeconds", "tps"].every(key => run[key] === undefined || Number.isFinite(run[key])) &&
      Array.isArray(run.plan) && run.plan.every(step => typeof step === "string") &&
      Array.isArray(run.calls) && run.calls.every(call => record(call) && typeof call.name === "string" && record(call.input) &&
        ["result", "error"].every(key => call[key] === undefined || typeof call[key] === "string")) &&
      Array.isArray(run.permissions) && run.permissions.every(permission => record(permission) &&
        ["id", "tool", "category"].every(key => typeof permission[key] === "string") &&
        (permission.decision === undefined || typeof permission.decision === "string"))));
}
