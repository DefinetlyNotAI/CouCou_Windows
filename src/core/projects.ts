export interface Project {
  id: string;
  name: string;
  folder: string;
  gitRepo: string;
  agentId: string;
  instructions: string;
  memory: string;
  mcpServers: string[];
  permissions: Record<string,string>;
}
