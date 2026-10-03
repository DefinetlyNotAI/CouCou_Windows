export interface AgentRun {
  id:string;goal:string;model:string;startedAt:number;
  status:"running"|"paused"|"complete"|"stopped"|"error";
  plan:string[];action:string;result:string;
  calls:{name:string;input:Record<string,unknown>;result?:string;error?:string}[];
  permissions:{id:string;tool:string;category:string;decision?:string}[];
}
