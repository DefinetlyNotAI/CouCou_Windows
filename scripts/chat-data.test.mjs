import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "typescript";

const source=readFileSync(new URL("../src/core/chat-data.ts",import.meta.url),"utf8");
const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
const {isSavedChat}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const chat={id:"saved",title:"Example",updatedAt:1,messages:[{id:1,role:"user",content:"hello"}]};

test("chat imports reject malformed metadata before it reaches library and run views",()=>{
  assert.equal(isSavedChat(chat),true);
  for(const metadata of [{tags:{}},{tags:[1]},{folder:[]},{runs:{}},{runs:[{id:"run"}]},{toolResults:[null]},{models:{ollama:1,browser:""}},{messages:[null]}]) {
    assert.equal(isSavedChat({...chat,...metadata}),false,JSON.stringify(metadata));
  }
});

test("chat imports preserve complete exported metadata and older chats",()=>{
  const run={id:"run",goal:"Read a file",model:"local",startedAt:1,status:"complete",plan:["Read"],action:"Done",result:"Ready",calls:[{name:"filesystem.read",input:{path:"example.txt"},result:"text"}],permissions:[{id:"permission",tool:"filesystem.read",category:"read",decision:"once"}],outputTokens:2};
  assert.equal(isSavedChat({...chat,folder:"Work",tags:["coding"],models:{ollama:"local",browser:"browser"},runs:[run],toolResults:[{tool:"filesystem.read",content:"text"}],messages:[{...chat.messages[0],file:{name:"example.txt",path:"C:\\example.txt"},pinned:true,status:"complete"}]}),true);
  assert.equal(isSavedChat({...chat,runs:[{...run,calls:[{name:"filesystem.read",input:null}]}]}),false);
});
