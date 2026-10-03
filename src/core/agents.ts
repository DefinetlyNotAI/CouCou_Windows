import { QUICK_PROFILES, type Settings } from "./state";

export interface AgentProfile {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  personality: Record<"baseStyle" | "warmth" | "enthusiasm" | "directness" | "responseLength" | "headers" | "lists" | "emoji" | "technicalDepth", string>;
  tools: string[];
  mcpServers: string[];
  permissions: Record<string, string>;
  contextSize: number;
  temperature: number;
  workspace: string;
}
export function newAgent(name = "Agent"): AgentProfile {
  return { id: crypto.randomUUID(), name, model: "", systemPrompt: "", personality: {
    baseStyle: "Clear", warmth: "Balanced", enthusiasm: "Balanced", directness: "Direct", responseLength: "Adaptive", headers: "When useful", lists: "When useful", emoji: "Rare", technicalDepth: "Adaptive",
  }, tools: [], mcpServers: [], permissions: {}, contextSize: 4096, temperature: 0.7, workspace: "" };
}
export function profiles(settings: Settings): AgentProfile[] {
  return settings.agentProfiles.length ? settings.agentProfiles : QUICK_PROFILES.map(profile => ({ ...newAgent(profile.name), id: profile.id, systemPrompt: profile.prompt }));
}
export function selectAgent(settings: Settings, profile: AgentProfile) {
  settings.agentProfile = profile.id;
  settings.agentPrompt = [profile.systemPrompt, "Response style:", ...Object.entries(profile.personality).map(([key, value]) => `${key}: ${value}`)].join("\n");
}
