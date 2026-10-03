// Local chat through Ollama. File bytes and conversation history stay in Rust.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::Mutex;

const MAX_INLINE_TEXT: u64 = 200_000;
const SYSTEM_PROMPT: &str = "You are Mochi, a personal AI assistant living at the top of the user's screen. \
Respond in the user's language. Use plain text with line breaks. \
You run through a local model and have no web search access. Do not claim to browse or execute tools.";

#[derive(Default)]
pub struct Chat {
    messages: Mutex<Vec<Value>>,
}

impl Chat {
    pub async fn reset(&self) {
        self.messages.lock().await.clear();
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChatContext {
    File { name: String, path: String },
    Window { app_name: String, title: String, url: Option<String> },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatReply {
    pub text: String,
}

fn endpoint(url: &str, path: &str) -> Result<String, String> {
    let base = url.trim().trim_end_matches('/');
    let parsed = reqwest::Url::parse(base).map_err(|_| "Enter a valid Ollama server URL.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("Ollama server URL must use http:// or https://.".into());
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("Ollama server URL cannot include a query or fragment.".into());
    }
    Ok(format!("{base}/api/{path}"))
}

fn client(timeout: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout))
        .build()
        .map_err(|e| e.to_string())
}

async fn response_json(response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    let body: Value = response.json().await.map_err(|e| format!("Bad Ollama response: {e}"))?;
    if !status.is_success() || body.get("error").is_some() {
        let detail = body.get("error").and_then(Value::as_str).unwrap_or("Request failed");
        return Err(format!("Ollama {status}: {detail}"));
    }
    Ok(body)
}

pub async fn models(url: &str) -> Result<Vec<String>, String> {
    let response = client(10)?
        .get(endpoint(url, "tags")?)
        .send()
        .await
        .map_err(|e| format!("Cannot reach Ollama. Start Ollama and check the server URL: {e}"))?;
    let body = response_json(response).await?;
    let entries = body.get("models").and_then(Value::as_array)
        .ok_or("Unexpected Ollama model list.")?;
    let mut names: Vec<String> = entries.iter()
        .filter_map(|entry| entry.get("name").and_then(Value::as_str).map(str::to_string))
        .collect();
    names.sort();
    names.dedup();
    Ok(names)
}

pub async fn send(
    chat: &Chat,
    url: &str,
    model: &str,
    query: String,
    context: Option<ChatContext>,
) -> Result<ChatReply, String> {
    let model = model.trim();
    if model.is_empty() {
        return Err("Choose a local model in Settings → Ollama first.".into());
    }
    // Serialize turns and resets; only successful exchanges enter the history.
    let mut history = chat.messages.lock().await;
    let mut message = json!({ "role": "user", "content": query });
    if history.is_empty() {
        match context {
            Some(ChatContext::File { name, path }) => {
                attach_file(&mut message, &name, &path)?;
            }
            Some(ChatContext::Window { app_name, title, url }) => {
                let query = message["content"].as_str().unwrap_or_default();
                message["content"] = json!(format!(
                    "Context — App: {app_name}, Window: {title}, URL: {}\n\n{query}",
                    url.unwrap_or_default()
                ));
            }
            None => {}
        }
    }
    let mut messages = vec![json!({ "role": "system", "content": SYSTEM_PROMPT })];
    messages.extend(history.iter().cloned());
    messages.push(message.clone());
    let response = client(300)?
        .post(endpoint(url, "chat")?)
        .json(&json!({ "model": model, "messages": messages, "stream": false }))
        .send()
        .await
        .map_err(|e| format!("Cannot complete Ollama chat. Check that Ollama is running: {e}"))?;
    let body = response_json(response).await?;
    let text = reply_text(&body)?;
    history.push(message);
    history.push(json!({ "role": "assistant", "content": text }));
    Ok(ChatReply { text })
}

fn reply_text(body: &Value) -> Result<String, String> {
    let text = body.get("message").and_then(|m| m.get("content"))
        .and_then(Value::as_str).unwrap_or_default().trim();
    if text.is_empty() {
        return Err("Ollama returned no response text.".into());
    }
    Ok(text.to_string())
}

fn attach_file(message: &mut Value, name: &str, path: &str) -> Result<(), String> {
    let ext = std::path::Path::new(path).extension().and_then(|e| e.to_str())
        .unwrap_or_default().to_lowercase();
    let query = message["content"].as_str().unwrap_or_default().to_string();
    if matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif") {
        let bytes = std::fs::read(path).map_err(|e| format!("Cannot read image: {e}"))?;
        message["images"] = json!([base64_for(&bytes)]);
        message["content"] = json!(format!("File: {name}\n\n{query}"));
        return Ok(());
    }
    if ext == "pdf" {
        return Err("PDFs need text extraction before local chat. Drop a text file instead.".into());
    }
    let len = std::fs::metadata(path).map_err(|e| format!("Cannot read file: {e}"))?.len();
    if len > MAX_INLINE_TEXT {
        return Err("Text files must be smaller than 200 KB for local chat.".into());
    }
    let text = std::fs::read_to_string(path)
        .map_err(|_| "Local chat supports UTF-8 text files and images with a vision model.".to_string())?;
    message["content"] = json!(format!("File: {name}\nFile contents:\n{text}\n\n{query}"));
    Ok(())
}

// Also used for Stripe's basic auth.
pub(crate) fn base64_for(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_rfc4648_vectors() {
        assert_eq!(base64_for(b""), "");
        assert_eq!(base64_for(b"f"), "Zg==");
        assert_eq!(base64_for(b"fo"), "Zm8=");
        assert_eq!(base64_for(b"foo"), "Zm9v");
        assert_eq!(base64_for(b"foob"), "Zm9vYg==");
        assert_eq!(base64_for(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_for(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn local_chat_reply_uses_ollama_message_content() {
        let reply = reply_text(&json!({
            "message": { "role": "assistant", "content": "Hello from Mochi" },
            "done": true
        })).unwrap();
        assert_eq!(reply, "Hello from Mochi");
        assert!(reply_text(&json!({"message": {"content": " "}})).is_err());
    }

    #[test]
    fn local_http_chat_keeps_successful_turns_and_can_retry() {
        use std::io::{BufRead, BufReader, Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            for turn in 0..5 {
                let (mut socket, _) = listener.accept().unwrap();
                socket.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
                let mut reader = BufReader::new(&mut socket);
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                assert!(line.starts_with(if turn == 0 { "GET /api/tags " } else { "POST /api/chat " }));
                let mut length = 0;
                loop {
                    line.clear();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" { break; }
                    if let Some(value) = line.to_lowercase().strip_prefix("content-length:") {
                        length = value.trim().parse::<usize>().unwrap();
                    }
                }
                let mut bytes = vec![0; length];
                reader.read_exact(&mut bytes).unwrap();
                if turn > 0 {
                    let request: Value = serde_json::from_slice(&bytes).unwrap();
                    assert_eq!(request["model"], "local:test");
                    assert_eq!(request["stream"], false);
                    assert!(request.get("tools").is_none());
                    let messages = request["messages"].as_array().unwrap();
                    assert_eq!(messages.len(), if turn == 1 || turn == 4 { 2 } else { 4 });
                    assert_eq!(messages[0]["role"], "system");
                    if turn == 3 {
                        assert_eq!(messages[2]["content"], "Hello from Mochi");
                        assert_eq!(messages[3]["content"], "retry");
                    }
                }
                let (status, body) = if turn == 0 {
                    ("200 OK", json!({"models": [{"name": "local:test"}]}))
                } else if turn == 2 {
                    ("404 Not Found", json!({"error": "model is missing"}))
                } else {
                    ("200 OK", json!({"message": {"role": "assistant", "content": "Hello from Mochi"}}))
                };
                let body = body.to_string();
                write!(socket, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
        });
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
            assert_eq!(models(&url).await.unwrap(), vec!["local:test"]);
            let chat = Chat::default();
            assert_eq!(send(&chat, &url, "local:test", "hello".into(), None).await.unwrap().text, "Hello from Mochi");
            let err = send(&chat, &url, "local:test", "failed".into(), None).await.err().unwrap();
            assert!(err.contains("model is missing"));
            send(&chat, &url, "local:test", "retry".into(), None).await.unwrap();
            chat.reset().await;
            send(&chat, &url, "local:test", "new chat".into(), None).await.unwrap();
        });
        server.join().unwrap();
    }
}
