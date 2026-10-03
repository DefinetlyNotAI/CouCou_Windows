use scraper::{Html, Selector};
use serde_json::{json, Value};
use crate::settings::Settings;

fn selector(value: &str) -> Selector { Selector::parse(value).expect("static CSS selector") }
fn url(value: &str) -> Result<reqwest::Url,String> {
    let url = reqwest::Url::parse(value).map_err(|error| error.to_string())?;
    if !matches!(url.scheme(),"http"|"https") { return Err("Use an HTTP URL".into()); }
    Ok(url)
}
fn client() -> Result<reqwest::Client,String> { reqwest::Client::builder().timeout(std::time::Duration::from_secs(25)).user_agent("Mozilla/5.0 CouCou/0.1.1").build().map_err(|error| error.to_string()) }
async fn browser(settings:&Settings,target:&str)->Result<Value,String>{
    let endpoint=url(&settings.search_url).map_err(|_|"Set the browser provider URL to a local Chromium debugging endpoint, for example http://127.0.0.1:9222. Start Opera GX or another Chromium browser with remote debugging enabled.".to_string())?;
    if endpoint.scheme()!="http" || !matches!(endpoint.host_str(),Some("127.0.0.1"|"localhost"|"[::1]")) {return Err("Browser debugging must use a local HTTP endpoint".into());}
    let result=crate::tools::ps(include_str!("browser-read.ps1"),&json!({"endpoint":endpoint.as_str(),"url":target}),None).await?;
    if result["exitCode"].as_i64()!=Some(0){return Err(format!("Browser retrieval failed: {}",result["stderr"].as_str().unwrap_or_default()));}
    serde_json::from_str(result["stdout"].as_str().unwrap_or_default()).map_err(|error|error.to_string())
}
pub fn schemas() -> Vec<Value> {
    [("web.search","Search the web without an API key","query"),("web.fetch","Read a public web page","url"),("web.extract","Extract page text and links","url"),("web.open","Open a page in the user's browser","url")].into_iter().map(|(name,description,field)| {
        let mut properties = serde_json::Map::new(); properties.insert(field.into(),json!({"type":"string"}));
        json!({"type":"function","function":{"name":name,"description":description,"parameters":{"type":"object","properties":properties,"required":[field]}}})
    }).collect()
}
pub async fn run(settings: &Settings, name: &str, input: &Value) -> Result<Value,String> {
    if name == "web.open" {
        let value = url(input["url"].as_str().ok_or("Missing URL")?)?;
        crate::platform::open_url(value.as_str()); return Ok(json!({"opened":value.as_str()}));
    }
    if name == "web.search" {
        let query = input["query"].as_str().filter(|query| !query.trim().is_empty()).ok_or("Missing query")?;
        if settings.search_provider == "browser" {
            let mut search = url("https://duckduckgo.com/")?; search.query_pairs_mut().append_pair("q",query);
            return browser(settings,search.as_str()).await;
        }
        if matches!(settings.search_provider.as_str(),"searxng"|"custom") {
            let mut search = url(&settings.search_url)?;
            search.query_pairs_mut().append_pair("q",query).append_pair("format","json");
            let response = client()?.get(search).send().await.map_err(|error| error.to_string())?.error_for_status().map_err(|error| error.to_string())?;
            let body: Value = response.json().await.map_err(|error| error.to_string())?;
            let entries = body["results"].as_array().ok_or("Search provider must return a JSON results array")?;
            return Ok(json!({"results":entries.iter().take(8).map(|entry| json!({"title":entry["title"],"url":entry["url"],"content":entry["content"].as_str().unwrap_or_default().chars().take(2000).collect::<String>()})).collect::<Vec<_>>() }));
        }
        let html = client()?.post("https://html.duckduckgo.com/html/").form(&[("q",query)]).send().await.map_err(|error| error.to_string())?.error_for_status().map_err(|error| error.to_string())?.text().await.map_err(|error| error.to_string())?;
        let document = Html::parse_document(&html);
        let anchor_selector = selector(".result__a"); let snippet_selector = selector(".result__snippet");
        let mut results = Vec::new();
        for result in document.select(&selector(".result")) {
            let Some(anchor) = result.select(&anchor_selector).next() else { continue };
            let raw = anchor.value().attr("href").unwrap_or_default();
            let Ok(target) = reqwest::Url::parse("https://duckduckgo.com").unwrap().join(raw) else { continue };
            let target = target.query_pairs().find(|(key,_)| key == "uddg").map(|(_,value)| value.into_owned()).unwrap_or_else(|| target.to_string());
            if url(&target).is_err() { continue; }
            results.push(json!({"title":anchor.text().collect::<String>(),"url":target,"content":result.select(&snippet_selector).next().map(|node| node.text().collect::<String>()).unwrap_or_default()}));
            if results.len() == 8 { break; }
        }
        if results.is_empty() { return Err("Search returned no readable results or requested a browser challenge. Try SearXNG or open browser search.".into()); }
        return Ok(json!({"results":results}));
    }
    let target = url(input["url"].as_str().ok_or("Missing URL")?)?;
    if settings.search_provider=="browser" {return browser(settings,target.as_str()).await;}
    let response = client()?.get(target).send().await.map_err(|error| error.to_string())?.error_for_status().map_err(|error| error.to_string())?;
    let final_url = response.url().clone();
    let html = response.text().await.map_err(|error| error.to_string())?;
    let document = Html::parse_document(&html);
    let title = document.select(&selector("title")).next().map(|node| node.text().collect::<String>()).unwrap_or_default();
    let mut content = String::new();
    for node in document.select(&selector("h1,h2,h3,p,li,pre,td")) {
        let text = node.text().collect::<Vec<_>>().join(" ");
        if !text.trim().is_empty() { content.push_str(text.trim()); content.push('\n'); }
        if content.len() > 32000 { break; }
    }
    let links: Vec<Value> = document.select(&selector("a[href]")).filter_map(|anchor| {
        let target = final_url.join(anchor.value().attr("href")?).ok()?;
        if !matches!(target.scheme(),"http"|"https") { return None; }
        Some(json!({"title":anchor.text().collect::<String>(),"url":target.as_str()}))
    }).take(30).collect();
    Ok(json!({"title":title,"url":final_url.as_str(),"content":content.chars().take(16000).collect::<String>(),"links":links}))
}
