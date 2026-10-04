# CouCou implementation plan

Status: implementation commits landed for all 20 stages. Runtime verification remains partial as recorded below; do not infer runtime completion from compilation. The user subsequently authorized tests; current evidence is recorded below.

Latest permission/headpat acceptance repairs (7117768, 3eb7843): explicit RunAs requests in executable arguments now use the separate admin permission rather than inheriting a normal run grant. The regression failed before the repair and all four permission tests passed afterward; concurrent approval test listeners now ignore unrelated requests. Every headpat heart burst waits three continuous seconds and checks the current mascot hit region before emitting. All four existing JavaScript checks passed. npm run pack passed frontend production compilation, optimized Windows compilation and NSIS packaging; both installer aliases include these changes. Native approval interaction, headpat timing on the installed application and the remaining service/voice journeys are not claimed verified.

Latest island/workspace repairs (dcb3b8d, 0ff4fd8): drag/drop coordinates are checked against the visible rounded island; the upload border has a fixed compact height; mini chat hides quick actions/context/tool details and constrains overflow. Fullscreen has project creation, styled selectors and a persistent PowerShell 7 ConPTY terminal. Settings have preference disclosure groups and personality dropdowns. Petting tracks the moving mascot, resets on leaving, starts hearts after three continuous seconds and continues while hovered. Ollama context grows for history/tool schemas within model metadata limits and retries a reported context underestimate once. Boundary tests passed (3), context/stream tests passed (8), and a real pwsh session passed variable persistence, resizing and Ctrl+C cancellation checks. Native drag/drop and full terminal permission/UI interaction remain unverified.

Attachment/context acceptance repair (c293c5b; stages 5/11/12): large text attachments no longer enter model context in full. A 16,000-character preview identifies omitted content and supplies the permission-controlled document.read tool for further character pages. The complete file remains available without a 200 KB upload cap. Shared extraction now reads plain and DPAPI-encrypted PDF/DOCX attachments; indexing retains early binary rejection. The native suite passed 19 tests with 3 optional live checks ignored. Targeted document checks subsequently passed encrypted PDF/DOCX extraction, Unicode page boundaries, invalid range rejection and binary rejection. Separate live journeys passed real embedding-based indexing/search with incremental edits/deletions and Qwen3.5 tool calling. npm run pack passed frontend production compilation, optimized Windows compilation and NSIS packaging after the final source changes; both installer aliases include c293c5b and the island/workspace repairs. Remaining native/browser/service acceptance gaps below are not claimed complete.

MCP acceptance repair (stage 9): tool discovery immediately before execution was unbounded. Discovery now uses the same 30-second timeout as initial schema discovery. A real local stdio protocol fixture passed initialization, tool discovery, argument/environment forwarding and tool execution; a deliberately nonresponsive second tools/list request returned the expected timeout error after 30 seconds. HTTP transport, external MCP servers and the full permission-to-model journey remain unverified. npm run pack subsequently passed production compilation, optimized Windows compilation and NSIS packaging; both release installer aliases now include commit a9c7f33.

Filesystem acceptance repair (stages 5/13): saving an empty editor previously failed with "Missing content". The filesystem writer now accepts empty strings while rejecting missing, null and numeric content. A targeted native regression check reproduced the failure before the repair and passed afterward, verifying an existing file is cleared to zero bytes. npm run pack passed production compilation, optimized Windows compilation and NSIS packaging; both release installer aliases include this repair. Broader native/service acceptance remains incomplete.

UI redesign: the user explicitly authorized implementation without another approval stop. Settings now have sidebar categories and focused forms; fullscreen chat has separate inspector tabs and Editor/Terminal/Git/Search/Checks panels. Browser preview verified settings navigation, workspace layout, Git/service tab switching, keyboard navigation and compact layout restoration. All three existing JavaScript tests passed. npm run pack passed TypeScript/Vite compilation, optimized Windows compilation and NSIS packaging after the final UI changes; both release installer aliases now include this redesign. Existing native/service acceptance gaps below remain separate from this UI change.

Fork synchronization audit: GitHub public API reports PR #1 closed and merged. A fresh git fetch origin main places the fork main tip at 0b3224f (the PR #1 merge). At local commit b16a222, HEAD is 32 commits ahead and 0 behind origin/main, so all current fork changes are included locally and no merge is required. Latest work remains unpublished because the active developer instruction prohibits pushing. GitHub CLI authentication is unavailable; this PR check used the public API and does not prove CouCou integration-key execution.

Release refresh after acceptance repairs: npm run pack passed TypeScript/Vite production build, optimized Windows native build and NSIS packaging after commit 1e3bd7d. Both release installer aliases now include the project authorization scope fix and latest source. Installer remains CouCou Shahm Edition v0.1.1-ollama (8.74 MiB). The proposed UI redesign is not included; installation and remaining native/service acceptance are not claimed.

Document extraction acceptance follow-up: the native document reader passed PDF text extraction and compressed DOCX paragraph/entity decoding checks using isolated temporary fixtures. Temporary files were removed after path confinement verification. This verifies these text-document parsing paths; scanned-document OCR and arbitrary document layouts are not claimed. The full native suite passed 15 tests with 3 optional live tests ignored.

Index acceptance follow-up: installed the default local embeddinggemma model through Ollama and passed a live isolated-project journey using the native index executor and real embeddings. Verified gitignore exclusion, encrypted persisted index, semantic result text with valid line references and finite scores, unchanged files skipped, one edited file incrementally re-embedded, and deleted files removed. Temporary fixture files/index were cleaned up. Visible project UI remains a separate acceptance gap. UI redesign was subsequently authorized and implemented as recorded above.

Project authorization repair: project.index/project.search now reject a nonempty argument projectId that differs from the request project approval scope, including an empty approval scope. This closes the path where another project could be indexed/searched under the current project grant. Backend coverage verifies mismatched/missing scopes reject before approval and matching or implicit targets continue through the permission policy. Indexing/embedding and document extraction acceptance remains unverified.

Git acceptance follow-up: the same Git dispatcher used by native tools passed a real isolated temporary-repository journey for working/staged diffs, stage/unstage, commit, branch create/switch, history, status, conflict-file detection after an actual failed merge, and empty-file-selection rejection. The temporary repository was removed after verifying its resolved path remained under the temporary directory. This verifies Git execution, not fullscreen UI or model-to-Git approval journeys.

Permission acceptance follow-up: native backend tests using the Tauri test runtime passed for exact request arguments/category in approval events, chat grants isolated across chats, project grants shared across chats, explicit settings denial overriding grants, unknown-tool rejection, one-time approvals prompting again, and cancellation expiring the pending decision. The full native suite passed 12 tests with 2 optional live checks ignored. No requested filesystem operations were executed; no user preferences were written. Visible approval-panel interaction, persisted Always allow/deny decisions and execution after approval remain separate acceptance gaps.

Native acceptance follow-up: launched the packaged release binary and observed the compact Mochi/GitHub/Vercel top bar. Windows accessibility exposes the Ollama ready state and model qwen3.5:4b. Native click automation failed twice with a target-window mismatch against the underlying ChatGPT window, including after target activation; expansion and native permission interaction are not verified. The Computer Use guidance also forbids acting on in-app security/privacy permission requests, so native approval clicks require human interaction or a non-UI test path.

Web acceptance follow-up: direct keyless web.fetch retrieved Example Domain title/content and web.search returned nonempty DuckDuckGo results with valid HTTP URLs. An ignored live regression check preserves this provider journey without requiring internet in the default suite. This proves the web executor endpoints, not native approval UI, browser-backed retrieval or model-to-web integration. Phi4-mini reproduced its tool-call failure: it returned a function schema as plain response text rather than a structured tool_calls event; the test now includes that response in its failure.

Authorized verification follow-up: existing JavaScript tests passed (3), native tests passed (10; 1 live test ignored in the default suite), and separate live Ollama checks passed for Gemma greeting/streaming and Qwen3.5 tool calling. Phi4-mini returned text without the requested tool call, failing that model-specific assertion. The native test executable now links the Windows common-controls manifest; attachment tests verify encrypted storage in an isolated temporary inbox. Browser preview checks confirmed temporary-chat status and command palette bounds after layout repairs. Full native UI and service acceptance remains unverified.

Stage 17 follow-up: stopping background commands now terminates their Windows process tree, and inherited output pipes cannot delay completion indefinitely. Process watchers report Windows access/query errors instead of falsely reporting completion. Source inspection only; tests skipped as requested.

Stage 20: Ctrl+K command palette, slash commands, shortcuts, temporary chats, folder/tag organization, full chat search, merge import/export, password-encrypted AES-GCM backups, preference profiles, DPAPI-encrypted native preferences/chats/indexes/schedules/attachments, legacy chat migration and portable data directory. Browser-backed search now reads a new tab through the user's configured local Chromium debugging endpoint. Frontend production build and native compilation passed; no tests or browser/service journeys executed. DPAPI data remains tied to its Windows account; portable transfers use password-encrypted backups. Browser-only development storage is not DPAPI protected.

Release packaging: `npm run pack` completed successfully after stage 20, including TypeScript/Vite production compilation, optimized native compilation and NSIS packaging. Updated `release/CouCou-Shahm-Edition-v0.1.1-ollama-setup.exe` and its unversioned alias (8.74 MiB). Installer execution and runtime acceptance remain unverified; no tests executed as requested.

Stage 19: model manager lists installed sizes and loaded VRAM, downloads/deletes models, displays model metadata/capabilities/context, loads/unloads models, persists keep-alive/idle-unload preferences, aliases and fallback selection before generation. Multi-step runs now allow 64 tool calls in both backends. Download, delete and inference journeys remain unverified; no tests executed.

Stage 18: statistics view aggregates saved model turns and tool outcomes, captures Ollama token/context counts and generation durations, TPS, frontend-observed first-token latency and turn duration; native refresh reads Windows RAM/GPU counters, Ollama loaded-model VRAM data, local disk and index bytes. Unsupported counters are unavailable rather than invented. No tests executed.

Stage 17: permission-gated background PowerShell commands, logfile watches, process/port completion watches, daily local schedules restored on launch, cancellation, completion notifications, logs, and task status in island pills. No tests executed; runtime behavior remains unverified at the user's request.

Stage 1 changes implemented so far: sanitized Markdown, scroll-position preservation during generation, removable attachments, uploads without chat reset, attachment context on later turns, removal of the 200 KB text cap, compact service mascots, chat-only TPS, 0–100% audio volume, exact island bounds for drag entry, native file picker, running-app picker, mascot hover-animation wake-up, and locally saved chats that reopen from recent activity with conversation text restored to either backend.

Additional user request: helper mascots animate tool/service handoffs, messages, successful results, failures, and cancellation. Existing tool progress and service notifications drive them. The event contract accepts MCP/subagent actors; actual MCP servers and subagent execution remain part of later stages. Expanded/compact layouts were inspected using the development-only animation preview, which explicitly does not call services or spawn agents.

Verification so far: production frontend build passes; native tests pass (10 passed, 1 ignored), including restored-chat context isolation, instruction-role rejection, Windows speech capability detection, and cancellation before/during a voice operation; island visibility and concurrent helper lifecycle tests pass (3). Browser checks confirmed Markdown headings/lists/tables/code, removal of unsafe script tags, manual scrolling, attachment removal, Settings mascot hiding, and chat-only TPS. Native file picker/running-app selector, reopened-chat journeys, and Windows drag behavior still need runtime verification. The mascot timer fix is implemented; visible heart particles have not yet been captured.

Fullscreen and placement: implemented a native Windows fullscreen toggle, Escape exit, compact minimize, fullscreen hide/restore when another app triggers the visibility rule, and persisted monitor selection, horizontal position, island width, and chat height. Browser inspection confirmed fullscreen fills the viewport, keeps the chat view, exits with Escape, and minimizes to the top bar. Native window/monitor transitions still need runtime verification; native compilation/tests pass. Older settings default the new placement fields.

Voice: implemented native Windows dictation, read-aloud, and a listen/send/speak call loop using installed System.Speech engines. Text is passed as JSON over standard input to a fixed script. Recognition/playback have cancellation and timeouts; leaving chat/minimizing ends voice; playback respects mute/volume. This PC has en-US/en-GB recognizers and David/Hazel/Zira voices. Live microphone transcription, speaker playback, and the complete voice-to-model call journey remain unverified. Browser previews show these controls disabled rather than simulating native audio.

Stage 2: added in-island model refresh/selection, initial General/Coding/Research profile selection that updates the system prompt in both backends, recent-chat selection, queued prompts with removal/retry and ordered processing, multiline input, browser web search, native screen capture, clipboard text/image paste, reply copy, current service tasks, and expandable tool activity. Existing upload, stop, Settings, and fullscreen controls remain directly accessible. Quick actions and tool activity open one at a time; the composer stays visible; the island grows when conversation or expanded controls need space. Full stored agent profiles remain stage 4 scope.

Stage 2 verification: frontend production build and existing native/JavaScript tests pass. The native streamed HTTP journey verifies profile instructions reach the model. Browser checks verified profile selection, busy-state queuing, queued-message retention after backend failure, expandable tool activity, and composer bounds. Native desktop script syntax was checked without accessing the clipboard or screen. Actual screenshot/clipboard operations, installed-model switching in the native UI, and successful multi-message queue delivery remain unverified.

Stage 3: live/completed rendering, stopped partial replies retained, continue reply, editable queues, regeneration with the selected model, branching from any message, edits preserved as branches with parent/message references, and stored per-chat backend model choices. Frontend build and native compilation passed; no tests executed. Live model journeys remain unverified.

Stage 4: stored editable agent profiles, personality controls, model selection, system instructions, tool allowlists, MCP server IDs, permission configuration, context size, temperature and workspace. Both model backends apply prompts, tool selections and generation parameters. Permission enforcement and MCP execution follow in stages 6 and 9. Frontend/native compilation passed; no tests executed.

Stage 5: shared structured request/schema/category/executor for filesystem, executable/PowerShell commands, processes, clipboard, screenshots, notifications, browser, HTTP, Git, and authenticated GitHub/Vercel requests. No arbitrary hooks executable exposed. Executor is internal until stage 6 adds approval routing; model access follows in stage 7. Native compilation passed; no tests executed.

Stage 6: approval requests with exact arguments, allow once/chat/project/always/deny, scoped session grants, persisted per-tool allow/deny and reset controls. Categories separate read/write/run/admin/network/browser/screen/clipboard/desktop. Profile denials and unknown-tool rejection apply; approval requests expire and cancellation drops pending receivers. Frontend/native compilation passed; no tests executed. Native interaction remains unverified.

Stage 7: native Ollama advertises supported Coucou tools and calls the shared permission/execution route; browser function-calling models use the same route. Disabled/profile-filtered calls are rejected. Tools feed the existing mascot handoff events. Frontend/native compilation passed; no tests executed.

Stage 8: permission-gated keyless web.search/fetch/open/extract, DuckDuckGo HTML result parsing, SearXNG/custom JSON endpoints and browser search opening. Results return titles/URLs/text, page extraction and links. Search challenges report errors. Browser mode opens results but cannot yet return browser DOM to the model; complete browser-backed retrieval remains a gap. Frontend/native compilation passed; no tests executed.

Stage 9: editable MCP command/HTTP servers, args/env/enabled/permissions, import/export configurations, official Rust SDK stdio and Streamable HTTP clients, real tools/list/tools/call, scoped connection/tool approvals and model tool discovery. Enabled server/agent restrictions apply. Frontend/native compilation passed; no tests executed. Server runtime journeys remain unverified.

Stage 10: attach a Windows folder once, stored projects with chats/folder/Git/agent/instructions/memory/MCP/permissions, project selection in chat quick actions, project prompt context in both backends and project permission/MCP restrictions. Native validates/canonicalizes folders and detects Git repositories. Frontend/native compilation passed; no tests executed.

Stage 11: context inspector for system/agent/project instructions, memory, messages, files and tool result history; estimated visible-text tokens explicitly labeled; pin/exclude messages, pin/select files, model-generated summary branches, and clear model context without deleting visible history. Restored native/browser context reattaches selected files. Tool-result history is displayed separately from restored message context. Frontend/native compilation passed; no tests executed; live model journeys remain unverified.

Stage 12: local Ollama embeddings, gitignore-aware folder traversal, per-project persisted indexes, content-hash incremental updates/deletion, bounded line chunks, semantic search with file/line excerpts, PDF/DOCX text extraction and skipped-file reporting. Index/search exposed as permission-gated tools and quick actions; configured embedding model must be installed. Large files are chunked rather than dumped into chat context. Frontend/native compilation passed; no tests or embedding runtime requests executed.

Stage 13: fullscreen file browser/editor with save and unsaved-change protection, terminal, Git status/diffs, semantic project search, test/lint/build command buttons/logs, tool/context sidebars and agent progress. Same permission-gated executor throughout. Mochi moves to the fullscreen header; island layout remains compact. Frontend/native compilation passed; no tests executed. UI/runtime journeys remain unverified; rich Agent Run controls follow in stage 14.

Stage 14: stored Agent Run history with goal/model/plan/current action/files/commands/tests/tools/permission decisions/result; pause/resume at action boundaries, stop, diff inspection and existing approve/deny controls. Native/browser pause waits exclude paused time from application deadlines. Structured agent.plan and isolated no-tool local helpers; actual delegation triggers helper mascot communication. Frontend/native compilation passed; no tests executed. Runtime journeys remain unverified.

Stage 15: Git status/working/staged diffs, stage/unstage, commits, branch list/create/switch, history and conflict-file links; literal repository search and file/line links; structured test/lint/build actions with configurable PowerShell commands; model file references open in the fullscreen editor. Commands remain permission gated. Frontend/native compilation passed; no tests executed; Git mutation/runtime journeys remain unverified.

Stage 16: structured and fullscreen GitHub issues/PRs/Actions/releases/repository search/draft PR creation/change review; Vercel deployments/build logs/domains/env/preview links/status/rollback. Existing secure keys and permission routing used; API failures propagate to tool errors. Frontend/native compilation passed. No external service reads or mutations executed during verification.

All 20 stages have implementation commits. Runtime checks listed above remain part of the full-goal verification scope; implementation commits do not claim those checks passed.

---

(1 commit per step/stage)

### 1. Fix the core island UX
- Proper Markdown rendering
- Keep recent activity inside bounds
- Click recent activity to reopen chats
- Allow scrolling during generation
- Allow removing uploaded files/images
- Allow uploads at any point in a chat
- Remove the 200 KB input/upload limit
- Restore service pills/mascots in minimized mode
- Hide TPS outside active chats
- Improve audio volume range
- Add proper maximize/fullscreen toggle
- Fix drag-and-drop so minimized Coucou only expands after the dragged file touches it
- Improve edge-hide app picker using currently running apps
- Remember window position, size and monitor
- Feature: Add microphone, call chat, and TTS features as well (if model supports etc)

### 2. Make the island useful without opening fullscreen
Keep common actions directly accessible from the island:

- Chat/input
- File/image upload
- Model switcher
- Agent/profile switcher
- Tool status
- Stop generation
- Queue another message
- Quick web search
- Quick screenshot/clipboard actions
- Recent chats
- Notifications/tasks
- Small expandable tool activity
- Settings shortcut
- Fullscreen button

The island should stay compact until something actually needs more room.

### 3. Improve generation controls
Add:

- Stream response live or render after completion
- Stop generation
- Continue generation
- Queue prompts
- Edit queued prompts
- Regenerate
- Regenerate with another model
- Branch from any message
- Edit messages without destroying old versions
- Per-chat model switching

### 4. Add proper agent profiles
Each agent should store:

```text
Name
Model
System prompt
Personality
Tools
MCP servers
Permissions
Context size
Temperature
Workspace
```

Personality controls:

- Base style
- Warmth
- Enthusiasm
- Directness
- Response length
- Headers
- Lists
- Emoji
- Technical depth

### 5. Build the tool system properly
Create one internal Coucou tool protocol.

Example:

```text
Model
↓
Coucou tool system
↓
Permission engine
↓
coucou-hooks.exe / MCP / internal tools
↓
Windows + filesystem + web + apps
```

Start with:

- Filesystem read/write
- Terminal
- PowerShell
- Processes
- Clipboard
- Notifications
- Browser/web
- Local HTTP requests
- Screenshots
- Git
- GitHub
- Vercel

### 6. Add a permissions system
Per tool:

```text
Allow once
Allow this chat
Allow this project
Always allow
Deny
```

Separate permissions for:

- Read files
- Write files
- Run commands
- Admin commands
- Network
- Browser
- Screen capture
- Clipboard
- Desktop control

### 7. Let Ollama use Coucou tools
Ollama models should be able to call the exact same tools as other models.

Do not expose `coucou-hooks.exe` as arbitrary shell access.

Expose structured tools such as:

```text
filesystem.read
filesystem.write
system.process.list
system.process.kill
system.clipboard.read
system.notification.send
browser.open
web.search
git.status
```

### 8. Add local web search without API keys
Provide:

```text
web.search
web.fetch
web.open
web.extract
```

Support:

- DuckDuckGo/browser search
- SearXNG
- Optional custom provider
- Browser-backed search

No API key should be required for basic local-model web access.

### 9. Add MCP support
Settings page:

```text
MCP Servers

+ Add server

Server name
Command / URL
Arguments
Environment
Enabled
Permissions
```

Also allow importing/exporting MCP configurations.

### 10. Add project workspaces
A project should contain:

```text
Chats
Files/folders
Git repo
Agent
Instructions
Memory
MCP servers
Tool permissions
```

Users should be able to attach a folder once instead of uploading files repeatedly.

### 11. Add context management
Expose a context inspector showing:

```text
System prompt
Agent instructions
Messages
Files
Memory
Tool results
Token usage
```

Allow:

- Pin message
- Remove from context
- Summarize older context
- Pin files
- Select active files
- Clear context

### 12. Add local file indexing
For larger projects:

- Local embeddings
- Folder indexing
- Gitignore support
- Incremental indexing
- Semantic search
- File + line references
- PDF/document indexing
- Per-project indexes

Do not dump entire large files into the model context.

### 13. Build the fullscreen workspace
Fullscreen should be the heavy-duty mode.

Suggested layout:

```text
┌─────────────────────────────────────────────┐
│ Project / Agent / Model / Run controls      │
├────────────┬───────────────────┬────────────┤
│ Files      │                   │ Context    │
│ Git        │       Chat        │ Tools      │
│ Search     │                   │ Activity   │
│ Tasks      │                   │ Changes    │
├────────────┴───────────────────┴────────────┤
│ Terminal / Logs / Tests                    │
└─────────────────────────────────────────────┘
```

Fullscreen features:

- File tree
- File editor
- Diffs
- Terminal
- Git
- Search
- Agent runs
- Tests
- Logs
- Tool history
- Context inspector
- Multi-step task progress

### 14. Add a proper Agent Run view
For large tasks show:

```text
Goal

Plan

Current action

Files read

Files changed

Commands run

Tests

Tool calls

Permissions requested

Result
```

Allow:

- Pause
- Stop
- Resume
- Approve action
- Reject action
- Inspect diff

### 15. Add Git + coding tools
Start with:

- `git status`
- Diff viewer
- Stage/unstage
- Commit
- Branches
- History
- Conflict viewer
- Search repository
- Run tests
- Run lint
- Run build
- Open file referenced by model

### 16. Expand GitHub + Vercel integration
GitHub:

- Issues
- PRs
- Actions
- Releases
- Repository search
- Create PR
- Review changes

Vercel:

- Deployments
- Logs
- Domains
- Environment variables
- Preview URLs
- Rollbacks
- Deployment status

### 17. Add background/local tasks
Support tasks like:

```text
Watch this build
Tell me when tests finish
Watch this logfile
Notify me when port 3000 opens
Run this every morning
```

Show active tasks from the island.

### 18. Build the stats page
Track:

- Tokens
- TPS
- TTFT
- Generation time
- Model usage
- Context usage
- Tool calls
- Tool failures
- VRAM
- RAM
- GPU usage
- Chat count
- Disk usage
- Index size

### 19. Add model management
For Ollama:

- Installed models
- Download models
- Delete models
- Model size
- Context size
- Tool support
- Vision support
- VRAM estimate
- Keep model loaded
- Auto unload idle models
- Model aliases
- Fallback models

### 20. Final polish
Then add:

- `Ctrl+K` command palette
- Slash commands
- Keyboard shortcuts
- Temporary chats
- Chat folders/tags
- Search all chats
- Export/import
- Encrypted local storage
- Backups
- Multiple profiles
- Portable mode

The main rule to follow is:

```text
Island = quick access, chat, files, simple tools, status

Fullscreen = projects, coding, terminal, diffs, Git, context,
             long-running agents and complex workflows
```

That keeps Coucou from turning the dynamic island into a cramped IDE while still making almost every everyday action reachable from it.
