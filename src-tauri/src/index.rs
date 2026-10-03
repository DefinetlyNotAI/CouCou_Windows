use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{collections::{HashMap,hash_map::DefaultHasher},hash::{Hash,Hasher},io::Read,path::{Path,PathBuf},sync::OnceLock};
use tauri::{AppHandle,Manager,Emitter};
#[derive(Clone,Serialize,Deserialize)]
struct Chunk { start:usize, end:usize, text:String, vector:Vec<f32> }
#[derive(Clone,Serialize,Deserialize)]
struct FileIndex { hash:u64, chunks:Vec<Chunk> }
#[derive(Default,Serialize,Deserialize)]
struct Index { model:String, folder:String, files:HashMap<String,FileIndex> }
static INDEX_LOCK:OnceLock<tokio::sync::Mutex<()>>=OnceLock::new();
fn index_path(id:&str)->Result<PathBuf,String> {
    if id.is_empty() || !id.chars().all(|c|c.is_ascii_alphanumeric() || c=='-' || c=='_') { return Err("Invalid project ID".into()); }
    let folder=crate::platform::local_dir().join("indexes"); crate::platform::ensure_private_dir(&folder).map_err(|error|error.to_string())?;
    Ok(folder.join(format!("{id}.json")))
}
fn read_document(path:&Path)->Result<String,String> {
    match path.extension().and_then(|ext|ext.to_str()).unwrap_or_default().to_lowercase().as_str() {
        "pdf" => pdf_extract::extract_text(path).map_err(|error|error.to_string()),
        "docx" => {
            let file=std::fs::File::open(path).map_err(|error|error.to_string())?;
            let mut archive=zip::ZipArchive::new(file).map_err(|error|error.to_string())?;
            let mut xml=String::new(); archive.by_name("word/document.xml").map_err(|error|error.to_string())?.read_to_string(&mut xml).map_err(|error|error.to_string())?;
            Ok(xml.split("</w:p>").map(|paragraph|scraper::Html::parse_fragment(paragraph).root_element().text().collect::<String>()).collect::<Vec<_>>().join("\n"))
        },
        _ => {
            let mut file=std::fs::File::open(path).map_err(|error|error.to_string())?;
            let mut prefix=[0u8;8192];let count=file.read(&mut prefix).map_err(|error|error.to_string())?;
            if prefix[..count].contains(&0) {return Err("Binary file".into());}
            std::fs::read_to_string(path).map_err(|error|error.to_string())
        },
    }
}
fn chunks(text:&str)->Vec<Chunk> {
    let mut chunks=Vec::new(); let mut buffer=String::new(); let mut start=1; let mut end=1;
    for (line_index,line) in text.lines().enumerate() {
        let line_number=line_index+1;
        for part in line.chars().collect::<Vec<_>>().chunks(2000) {
            if !buffer.is_empty() && buffer.chars().count()+part.len()>2000 {
                chunks.push(Chunk{start,end,text:std::mem::take(&mut buffer),vector:Vec::new()}); start=line_number;
            }
            if buffer.is_empty() {start=line_number;}
            buffer.extend(part);buffer.push('\n');end=line_number;
        }
    }
    if !buffer.trim().is_empty() {chunks.push(Chunk{start,end,text:buffer,vector:Vec::new()});} chunks
}
async fn embed(settings:&crate::settings::Settings,input:Vec<String>)->Result<Vec<Vec<f32>>,String> {
    let url=format!("{}/api/embed",settings.ollama_url.trim_end_matches('/'));
    let response=reqwest::Client::builder().timeout(std::time::Duration::from_secs(120)).build().map_err(|error|error.to_string())?.post(url).json(&json!({"model":settings.embedding_model,"input":input,"truncate":false})).send().await.map_err(|error|error.to_string())?.error_for_status().map_err(|error|error.to_string())?;
    let result:Value=response.json().await.map_err(|error|error.to_string())?;
    serde_json::from_value(result["embeddings"].clone()).map_err(|error|format!("Embedding model returned invalid vectors: {error}"))
}
pub async fn run(app:&AppHandle,request:&crate::tools::ToolRequest)->Result<Value,String> {
    let _lock=if request.name=="project.index" {Some(INDEX_LOCK.get_or_init(Default::default).try_lock().map_err(|_|"An index update is already running")?)} else {None};
    let id=request.input["projectId"].as_str().filter(|id|!id.is_empty()).unwrap_or(&request.project_id);
    let settings=app.state::<crate::Shared>().settings.lock().unwrap().clone();
    let project=settings.projects.iter().find(|project|project["id"].as_str()==Some(id)).ok_or("Select a project")?;
    let folder=project["folder"].as_str().ok_or("Project has no folder")?.to_string();
    let path=index_path(id)?;
    let mut index:Index=match crate::storage::read(&path) {Ok(bytes)=>serde_json::from_slice(&bytes).map_err(|error|error.to_string())?,Err(error) if error.kind()==std::io::ErrorKind::NotFound=>Index::default(),Err(error)=>return Err(error.to_string())};
    if request.name=="project.search" {
        if index.files.is_empty() {return Err("Index the project first".into());}
        if index.model!=settings.embedding_model || index.folder!=folder {return Err("Embedding model or folder changed; update the index".into());}
        let query=request.input["query"].as_str().filter(|text|!text.trim().is_empty()).ok_or("Enter a search query")?;
        let vector=embed(&settings,vec![query.into()]).await?.into_iter().next().ok_or("No query vector")?;
        let mut results=Vec::new();
        for (file,entry) in &index.files {for chunk in &entry.chunks {
            if vector.len()!=chunk.vector.len() {return Err("Embedding dimensions changed; rebuild the index".into());}
            let dot:f32=vector.iter().zip(&chunk.vector).map(|(a,b)|a*b).sum();
            let norm=(vector.iter().map(|a|a*a).sum::<f32>()*chunk.vector.iter().map(|a|a*a).sum::<f32>()).sqrt();
            results.push((if norm>0.0 {dot/norm}else{0.0},file,chunk));
        }}
        results.sort_by(|a,b|b.0.total_cmp(&a.0));
        return Ok(json!({"results":results.into_iter().take(8).map(|(score,file,chunk)|json!({"file":file,"startLine":chunk.start,"endLine":chunk.end,"text":chunk.text,"score":score})).collect::<Vec<_>>() }));
    }
    if index.model!=settings.embedding_model || index.folder!=folder { index=Index{model:settings.embedding_model.clone(),folder:folder.clone(),files:HashMap::new()}; }
    let scan_folder=folder.clone();
    let (documents,mut skipped)=tokio::task::spawn_blocking(move|| {
        let mut documents=Vec::new(); let mut skipped=Vec::new();
        let mut overrides=ignore::overrides::OverrideBuilder::new(&scan_folder);
        for pattern in ["!.git/**","!node_modules/**","!target/**","!dist/**"] { let _=overrides.add(pattern); }
        let walker=ignore::WalkBuilder::new(&scan_folder).require_git(false).git_ignore(true).overrides(overrides.build().unwrap()).build();
        for entry in walker {
            let entry=match entry {Ok(entry)=>entry,Err(error)=> {skipped.push(error.to_string());continue}};
            if !entry.file_type().is_some_and(|kind|kind.is_file()) {continue;}
            documents.push(entry.path().to_string_lossy().to_string());
        }
        (documents,skipped)
    }).await.map_err(|error|error.to_string())?;
    let existing:std::collections::HashSet<_>=documents.iter().cloned().collect();
    index.files.retain(|file,_|existing.contains(file));
    let total=documents.len();let mut updated=0;
    for (position,file) in documents.into_iter().enumerate() {
        let file_path=file.clone();
        let document=tokio::task::spawn_blocking(move||read_document(Path::new(&file_path))).await.map_err(|error|error.to_string())?;
        let text=match document {Ok(text)=>text,Err(_)=>{index.files.remove(&file);skipped.push(file);continue}};
        let mut hasher=DefaultHasher::new();text.hash(&mut hasher);let hash=hasher.finish();
        if index.files.get(&file).is_some_and(|entry|entry.hash==hash) {continue;}
        let mut chunks=chunks(&text);
        for batch in chunks.chunks_mut(32) {
            let vectors=embed(&settings,batch.iter().map(|chunk|chunk.text.clone()).collect()).await?;
            if vectors.len()!=batch.len() {return Err("Embedding model returned an incomplete batch".into());}
            for (chunk,vector) in batch.iter_mut().zip(vectors) {chunk.vector=vector;}
        }
        index.files.insert(file,FileIndex{hash,chunks});updated+=1;
        let _=app.emit_to(crate::island::WINDOW_LABEL,"index-progress",json!({"projectId":id,"completed":position+1,"total":total}));
    }
    let bytes=serde_json::to_vec(&index).map_err(|error|error.to_string())?;
    crate::storage::write(&path,&bytes).map_err(|error|error.to_string())?;
    Ok(json!({"files":index.files.len(),"chunks":index.files.values().map(|file|file.chunks.len()).sum::<usize>(),"updated":updated,"bytes":bytes.len(),"skipped":skipped,"documentLineNote":"PDF and DOCX line references refer to extracted text."}))
}
