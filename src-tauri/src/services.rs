use serde_json::{json,Value};
use crate::tools::ToolRequest;
pub fn schemas()->Vec<Value> {
    let mut tools=Vec::new();
    for name in ["github.issues","github.pulls","github.actions","github.releases","github.search","github.create_pr","github.review","vercel.deployments","vercel.logs","vercel.domains","vercel.env","vercel.preview","vercel.rollback","vercel.status"] {
        tools.push(json!({"type":"function","function":{"name":name,"description":format!("{} using the configured integration key",name.replace('.'," ")),"parameters":{"type":"object","properties":{"repo":{"type":"string"},"pull":{"type":"integer"},"query":{"type":"string"},"project":{"type":"string"},"deployment":{"type":"string"},"team":{"type":"string"},"title":{"type":"string"},"head":{"type":"string"},"base":{"type":"string"},"body":{"type":"string"},"draft":{"type":"boolean"}}}}}));
    }
    tools
}
fn value<'a>(input:&'a Value,key:&str)->Result<&'a str,String> {input[key].as_str().filter(|value|!value.trim().is_empty()).ok_or_else(||format!("Missing {key}"))}
fn segment(value:&str)->Result<String,String> {if !value.chars().all(|c|c.is_ascii_alphanumeric() || matches!(c,'_'|'-'|'.')) || value.is_empty() || value=="." || value==".." {return Err("Invalid API identifier".into());}Ok(value.into())}
pub fn normalize(request:&ToolRequest)->Result<Option<ToolRequest>,String> {
    let input=&request.input;
    let mut method="GET";let mut body=None;
    let name=request.name.as_str();
    if matches!(name,"github.request"|"vercel.request") || (!name.starts_with("github.") && !name.starts_with("vercel.")) {return Ok(None);}
    let github=name.starts_with("github.");
    let mut path=if github {
        if name=="github.search" {let mut url=reqwest::Url::parse("https://api.github.com/search/repositories").unwrap();url.query_pairs_mut().append_pair("q",value(input,"query")?);format!("{}?{}",url.path(),url.query().unwrap_or_default())}
        else {
            let repo=value(input,"repo")?.split('/').map(segment).collect::<Result<Vec<_>,_>>()?;
            if repo.len()!=2 {return Err("Use owner/repository".into());}let base=format!("/repos/{}/{}",repo[0],repo[1]);
            match name {
                "github.issues"=>format!("{base}/issues"),"github.pulls"=>format!("{base}/pulls"),"github.actions"=>format!("{base}/actions/runs"),"github.releases"=>format!("{base}/releases"),
                "github.review"=>format!("{base}/pulls/{}/files",input["pull"].as_u64().filter(|pull|*pull>0).ok_or("Provide a pull request number")?),
                "github.create_pr"=> {method="POST";body=Some(json!({"title":value(input,"title")?,"head":value(input,"head")?,"base":value(input,"base")?,"body":input["body"].as_str().unwrap_or_default(),"draft":input["draft"].as_bool().unwrap_or(true)}));format!("{base}/pulls")},
                _=>return Err("Unknown GitHub action".into()),
            }
        }
    } else {
        match name {
            "vercel.deployments"=> {let mut url=reqwest::Url::parse("https://api.vercel.com/v6/deployments").unwrap();if let Some(project)=input["project"].as_str().filter(|project|!project.is_empty()) {url.query_pairs_mut().append_pair("projectId",project);}format!("{}{}",url.path(),url.query().map(|query|format!("?{query}")).unwrap_or_default())},
            "vercel.logs"=>format!("/v3/deployments/{}/events?follow=0&limit=100",segment(value(input,"deployment")?)?),
            "vercel.domains"=>format!("/v9/projects/{}/domains",segment(value(input,"project")?)?),
            "vercel.env"=>format!("/v9/projects/{}/env",segment(value(input,"project")?)?),
            "vercel.status"|"vercel.preview"=>format!("/v13/deployments/{}",segment(value(input,"deployment")?)?),
            "vercel.rollback"=> {method="POST";body=Some(json!({}));format!("/v9/projects/{}/rollback/{}",segment(value(input,"project")?)?,segment(value(input,"deployment")?)?)},
            _=>return Err("Unknown Vercel action".into()),
        }
    };
    if !github {if let Some(team)=input["team"].as_str().filter(|team|!team.is_empty()) {path.push(if path.contains('?'){'&'}else{'?'});path.push_str("teamId=");path.push_str(&segment(team)?);}}
    let mut mapped=request.clone();mapped.name=if github{"github.request"}else{"vercel.request"}.into();mapped.input=json!({"path":path,"method":method});
    if let Some(body)=body {mapped.input["body"]=body;}Ok(Some(mapped))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rollback_includes_required_json_body_and_team_scope() {
        let request=ToolRequest {name:"vercel.rollback".into(),input:json!({"project":"prj_example","deployment":"dpl_example","team":"team_example"}),chat_id:"rollback-test".into(),project_id:String::new()};
        let mapped=normalize(&request).unwrap().unwrap();
        assert_eq!(mapped.name,"vercel.request");
        assert_eq!(mapped.input["method"],"POST");
        assert_eq!(mapped.input["path"],"/v9/projects/prj_example/rollback/dpl_example?teamId=team_example");
        assert_eq!(mapped.input["body"],json!({}));
    }
}
