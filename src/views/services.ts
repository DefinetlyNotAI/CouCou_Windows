import { h } from "./dom";
import { Bridge } from "../core/bridge";
export function buildServices(run:(name:string,input:Record<string,unknown>)=>Promise<Record<string,unknown>>) {
  const el=h("details",{class:"workspace-services"},h("summary",{text:"GitHub / Vercel"}));
  const output=h("pre",{class:"workspace-output"});const links=h("div");
  const fields:Record<string,HTMLInputElement|HTMLTextAreaElement>={};
  function field(key:string,label:string,multiline=false) {const input=h(multiline ? "textarea" : "input",{"aria-label":label,placeholder:label}) as HTMLInputElement|HTMLTextAreaElement;fields[key]=input;return input;}
  const gh=h("div",{class:"workspace-command-row"},field("repo","GitHub owner/repository"),field("query","Repository search"),field("pull","Pull request number"));
  const pr=h("div",{class:"workspace-command-row"},field("title","PR title"),field("head","Head branch"),field("base","Base branch"),field("body","PR description",true));
  const vercel=h("div",{class:"workspace-command-row"},field("project","Vercel project ID"),field("deployment","Deployment ID or hostname"),field("team","Vercel team ID (optional)"));
  let busy=false;
  function actions(items:[string,string][]) {
    return h("div",{class:"workspace-controls"},...items.map(([label,name])=>h("button",{text:label,onclick:async()=> {
      if(busy)return;busy=true;output.textContent=`Loading ${label}…`;
      try {
        const input:Record<string,unknown>=Object.fromEntries(Object.entries(fields).filter(([,field])=>field.value.trim()).map(([key,field])=>[key,key==="pull" ? Number(field.value) : field.value.trim()]));
        if(name==="github.create_pr")input.draft=true;
        const result=await run(name,input);let body:unknown=result;
        if(typeof result.body==="string") {try {body=JSON.parse(result.body);}catch {body=result.body;}}
        output.textContent=typeof body==="string" ? body : JSON.stringify(body,null,2);
        const urls=new Set<string>();
        function collect(value:unknown) {if(Array.isArray(value)){for(const item of value)collect(item);}else if(value && typeof value==="object"){for(const [key,item] of Object.entries(value)){if((key==="html_url"||key==="url") && typeof item==="string"){if(/^https?:\/\//.test(item)&&!item.includes("api.github.com"))urls.add(item);else if(item.endsWith(".vercel.app"))urls.add(`https://${item}`);}else if(key!=="env")collect(item);}}}
        collect(body);links.replaceChildren(...[...urls].slice(0,20).map(url=>h("button",{class:"link-btn",text:url,onclick:()=>void Bridge.openUrl(url)})));
      }catch(error){output.textContent=String(error);}finally{busy=false;}
    }})));
  }
  el.append(h("h3",{text:"GitHub"}),gh,actions([["Issues","github.issues"],["PRs","github.pulls"],["Actions","github.actions"],["Releases","github.releases"],["Find repositories","github.search"],["Review changes","github.review"]]),h("details",{},h("summary",{text:"Create draft PR"}),pr,actions([["Create draft PR","github.create_pr"]])),
    h("h3",{text:"Vercel"}),vercel,actions([["Deployments","vercel.deployments"],["Logs","vercel.logs"],["Domains","vercel.domains"],["Environment","vercel.env"],["Preview URL","vercel.preview"],["Status","vercel.status"],["Rollback","vercel.rollback"]]),links,output);
  return el;
}
