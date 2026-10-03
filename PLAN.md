# CouCou implementation plan

Status: stages 1–8 implementation landed; runtime verification remains partial as recorded below. Stage 9 is next. Preserve the full 20-stage scope and one implementation commit per stage. User requested no further test execution; use compilation and diff inspection only for subsequent stages.

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

Stages 9–20 remain pending. Runtime checks listed above remain part of the full-goal verification scope; implementation commits do not claim those checks passed. The existing release installer predates these changes and needs rebuilding before delivery.

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
