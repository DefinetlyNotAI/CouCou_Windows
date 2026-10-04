use rmcp::{service::RunningService, RoleClient, ServiceExt, transport::{TokioChildProcess, StreamableHttpClientTransport}};
use serde::{Deserialize, Serialize};
use serde_json::{json,Value};
use std::{collections::HashMap,sync::{Arc,OnceLock}};
use tauri::{AppHandle,Manager};
use tokio::sync::Mutex;

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Server {
    pub id: String,
    pub name: String,
    #[serde(default)] pub command: String,
    #[serde(default)] pub url: String,
    #[serde(default)] pub args: Vec<String>,
    #[serde(default)] pub env: HashMap<String,String>,
    #[serde(default)] pub enabled: bool,
    #[serde(default="ask")] pub permissions: String,
}
fn ask() -> String { "ask".into() }
type Client = RunningService<RoleClient,()>;
type Sessions = HashMap<String,(String,Arc<Client>)>;
static SESSIONS: OnceLock<Mutex<Sessions>> = OnceLock::new();
fn sessions() -> &'static Mutex<Sessions> { SESSIONS.get_or_init(Default::default) }

async fn connect(app: &AppHandle, server: &Server, chat_id: &str, project_id: &str) -> Result<Arc<Client>,String> {
    if !server.enabled || server.permissions == "deny" { return Err("MCP server is disabled or denied".into()); }
    crate::permissions::authorize(app,&crate::tools::ToolRequest {
        name: format!("mcp.connect.{}.{}",if server.url.is_empty() { "stdio" } else { "http" },server.id),
        input: json!({"server":server.name,"command":server.command,"url":server.url,"args":server.args,"environmentVariables":server.env.keys().collect::<Vec<_>>() }),
        chat_id:chat_id.into(),project_id:project_id.into(),
    }).await?;
    let fingerprint = serde_json::to_string(server).map_err(|error| error.to_string())?;
    let mut sessions = sessions().lock().await;
    if let Some((config,client)) = sessions.get(&server.id) { if config == &fingerprint && !client.is_closed() { return Ok(client.clone()); } }
    sessions.remove(&server.id);
    let client = Arc::new(create_client(server).await?); sessions.insert(server.id.clone(),(fingerprint,client.clone())); Ok(client)
}

async fn create_client(server: &Server) -> Result<Client,String> {
    if server.url.is_empty() {
        use std::os::windows::process::CommandExt;
        let mut command = tokio::process::Command::new(&server.command);
        command.args(&server.args).envs(&server.env).kill_on_drop(true);
        command.as_std_mut().creation_flags(0x08000000);
        let transport = TokioChildProcess::new(command).map_err(|error| error.to_string())?;
        tokio::time::timeout(std::time::Duration::from_secs(30),().serve(transport)).await.map_err(|_| "MCP initialization timed out")?.map_err(|error| error.to_string())
    } else {
        let url = reqwest::Url::parse(&server.url).map_err(|error| error.to_string())?;
        if !matches!(url.scheme(),"http"|"https") { return Err("MCP URL must use HTTP".into()); }
        let transport = StreamableHttpClientTransport::from_uri(server.url.clone());
        tokio::time::timeout(std::time::Duration::from_secs(30),().serve(transport)).await.map_err(|_| "MCP initialization timed out")?.map_err(|error| error.to_string())
    }
}

async fn available_tools(client: &Client) -> Result<Vec<rmcp::model::Tool>,String> {
    tokio::time::timeout(std::time::Duration::from_secs(30),client.peer().list_all_tools()).await.map_err(|_| "MCP tools/list timed out")?.map_err(|error| error.to_string())
}

pub async fn schemas(app: &AppHandle, settings: &crate::settings::Settings, chat_id: &str, project_id: &str) -> Result<Vec<Value>,String> {
    let mut tools = Vec::new();
    let allowed = settings.active_agent().and_then(|profile| profile["mcpServers"].as_array());
    let project_servers = settings.projects.iter().find(|project| project["id"].as_str()==Some(project_id)).and_then(|project| project["mcpServers"].as_array());
    for server in &settings.mcp_servers {
        if !server.enabled || server.permissions == "deny" || allowed.is_some_and(|ids| !ids.is_empty() && !ids.iter().any(|id| id.as_str() == Some(&server.id))) { continue; }
        if project_servers.is_some_and(|ids| !ids.is_empty() && !ids.iter().any(|id| id.as_str()==Some(&server.id))) { continue; }
        let client = connect(app,server,chat_id,project_id).await?;
        let list = available_tools(&client).await?;
        for tool in list {
            tools.push(json!({"type":"function","function":{"name":format!("mcp.{}.{}",server.id,tool.name),"description":format!("{}: {}",server.name,tool.description.as_deref().unwrap_or("MCP tool")),"parameters":tool.input_schema}}));
        }
    }
    Ok(settings.agent_tools(tools))
}

pub async fn call(app: &AppHandle, request: &crate::tools::ToolRequest) -> Result<Value,String> {
    let mut parts = request.name.splitn(3,'.'); parts.next();
    let server_id = parts.next().ok_or("Missing MCP server")?;
    let tool = parts.next().ok_or("Missing MCP tool")?;
    let settings = app.state::<crate::Shared>().settings.lock().unwrap().for_project(&request.project_id);
    if settings.active_agent().and_then(|profile| profile["mcpServers"].as_array()).is_some_and(|ids| !ids.is_empty() && !ids.iter().any(|id| id.as_str() == Some(server_id))) { return Err("MCP server disabled for this agent".into()); }
    if settings.projects.iter().find(|project|project["id"].as_str()==Some(request.project_id.as_str())).and_then(|project|project["mcpServers"].as_array()).is_some_and(|ids|!ids.is_empty()&&!ids.iter().any(|id|id.as_str()==Some(server_id))) { return Err("MCP server disabled for this project".into()); }
    let server = settings.mcp_servers.iter().find(|server| server.id == server_id).ok_or("Unknown MCP server")?;
    let client = connect(app,server,&request.chat_id,&request.project_id).await?;
    let available = available_tools(&client).await?;
    if !available.iter().any(|candidate| candidate.name == tool) { return Err("Unknown MCP tool".into()); }
    let params = serde_json::from_value(json!({"name":tool,"arguments":request.input})).map_err(|error| error.to_string())?;
    let result = tokio::time::timeout(std::time::Duration::from_secs(120),client.call_tool(params)).await.map_err(|_| "MCP tool timed out")?.map_err(|error| error.to_string())?;
    serde_json::to_value(result).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_transport_initializes_lists_and_calls_tools() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            use tokio::io::{AsyncBufReadExt, BufReader};
            use std::os::windows::process::CommandExt;
            let script = r#"
const http=require('node:http');
const server=http.createServer(async (req,res)=>{
  if(req.method!=='POST'){res.writeHead(405).end();return;}
  let text='';for await(const chunk of req)text+=chunk;
  const request=JSON.parse(text);
  if(request.id===undefined){res.writeHead(202).end();return;}
  let result;
  if(request.method==='initialize')result={protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'coucou-http-test',version:'1'}};
  else if(request.method==='tools/list')result={tools:[{name:'echo',description:'Echo input',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value']}}]};
  else if(request.method==='tools/call')result={content:[{type:'text',text:request.params.arguments.value}],isError:false};
  else {res.writeHead(400).end();return;}
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));
});
server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port+'/mcp'));
"#;
            let mut command=tokio::process::Command::new("node");
            command.args(["-e",script]).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).kill_on_drop(true);
            command.as_std_mut().creation_flags(0x08000000);
            let mut child=command.spawn().unwrap();
            let mut lines=BufReader::new(child.stdout.take().unwrap()).lines();
            let url=tokio::time::timeout(std::time::Duration::from_secs(10),lines.next_line()).await.unwrap().unwrap().unwrap();
            let server=Server {id:"http-test".into(),name:"HTTP fixture".into(),command:String::new(),url,args:vec![],env:HashMap::new(),enabled:true,permissions:"ask".into()};
            let client=create_client(&server).await.unwrap();
            let tools=available_tools(&client).await.unwrap();
            assert_eq!(tools.len(),1);
            assert_eq!(tools[0].name,"echo");
            let params=serde_json::from_value(json!({"name":"echo","arguments":{"value":"hello over HTTP"}})).unwrap();
            let response=tokio::time::timeout(std::time::Duration::from_secs(10),client.call_tool(params)).await.unwrap().unwrap();
            let response=serde_json::to_value(response).unwrap();
            client.cancel().await.unwrap();
            child.kill().await.unwrap();
            assert_eq!(response["content"][0]["text"],"hello over HTTP");
            assert_eq!(response["isError"],false);
        });
    }

    #[test]
    fn stdio_transport_initializes_lists_and_calls_tools() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let script = r#"
const lines = require('node:readline').createInterface({input:process.stdin});
let listed = false;
lines.on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  if (request.method === 'initialize') result = {protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'coucou-test',version:'1'}};
  else if (request.method === 'tools/list') {if(listed)return;listed=true;result = {tools:[{name:'echo',description:'Echo input',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value']}}]};}
  else if (request.method === 'tools/call') result = {content:[{type:'text',text:request.params.arguments.value+':'+process.env.COUCOU_MCP_TEST}],isError:false};
  else {process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32601,message:'Unknown method'}})+'\n');return;}
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
});
"#;
            let server = Server { id:"stdio-test".into(),name:"Local fixture".into(),command:"node".into(),url:String::new(),args:vec!["-e".into(),script.into()],env:HashMap::from([("COUCOU_MCP_TEST".into(),"fixture".into())]),enabled:true,permissions:"ask".into() };
            let client = create_client(&server).await.unwrap();
            let tools = available_tools(&client).await.unwrap();
            assert_eq!(tools.len(),1);
            assert_eq!(tools[0].name,"echo");
            assert_eq!(tools[0].input_schema["required"],json!(["value"]));
            let params = serde_json::from_value(json!({"name":"echo","arguments":{"value":"hello"}})).unwrap();
            let response = tokio::time::timeout(std::time::Duration::from_secs(10),client.call_tool(params)).await.unwrap().unwrap();
            let response = serde_json::to_value(response).unwrap();
            let stalled = tokio::time::timeout(std::time::Duration::from_secs(35),available_tools(&client)).await.unwrap();
            client.cancel().await.unwrap();
            assert_eq!(stalled.unwrap_err(),"MCP tools/list timed out");
            assert_eq!(response["content"][0]["text"],"hello:fixture");
            assert_eq!(response["isError"],false);
        });
    }
}
