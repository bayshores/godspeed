# MCP 2026-07-28 migration plan

Status: built (steps 1 to 5). The owner's answers: briefing option A only, migrate now, the plugin (connector and waiter) speaks the new version as 0.4.2, keep the old version with no date to drop it, and `^2.4.0` like the other dependencies.

## 1. What changes, and when clients need it

**The spec.** MCP revision `2026-07-28` was released as final on 2026-07-28 ([announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28/)). For godspeed, the parts that matter are these ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)):

- **No more `initialize`.** The opening handshake (`initialize` + `notifications/initialized`) is gone. Instead, every request carries three things in `params._meta`:
  - `io.modelcontextprotocol/protocolVersion` (required)
  - `io.modelcontextprotocol/clientCapabilities` (required)
  - `io.modelcontextprotocol/clientInfo` (the client's name, a SHOULD, so it can be missing)
- **No more `Mcp-Session-Id`.** godspeed is already stateless, so this costs nothing.
- **New `server/discover` method.** Servers MUST answer it. Its result holds the supported versions, the capabilities and the optional `instructions` text ([discover spec](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)). Clients MAY call it, but they don't have to.
- **New HTTP headers.** Every modern POST must send `MCP-Protocol-Version`, `Mcp-Method`, and (for `tools/call`) `Mcp-Name`, matching the body. A missing or wrong header gets HTTP 400 with error `-32020`.
- **Old and new can live side by side.** A "dual-era" server answers `initialize` the old way and modern requests the new way, on the same endpoint ([versioning and compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)). A modern client talking to an old server falls back to `initialize` on its own.

**The SDK.** The TypeScript SDK split into new packages. `@modelcontextprotocol/server` 2.0.0 shipped 2026-07-27 and is stable; the latest is 2.4.0 (2026-10-23) ([npm](https://www.npmjs.com/package/@modelcontextprotocol/server), [repo](https://github.com/modelcontextprotocol/typescript-sdk)). godspeed uses the old package, `@modelcontextprotocol/sdk` 1.32.2. The repo README says v1 keeps getting bug and security fixes for **at least six months after 2026-07-27**, so until about the end of January 2027. Guides: [upgrade to v2](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2), [support 2026-07-28](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28).

**What the clients speak today.** I tested this on 2026-10-30 with a small logging server:

| Client | What it sends first | Era |
| - | - | - |
| Claude Code 2.1.314 (stdio and HTTP) | `server/discover` with the modern `_meta`, and `clientInfo.name: "claude-code"`. If that fails, it falls back to `initialize` with `2025-11-25`. | dual-era |
| Codex CLI 0.163.0 (HTTP) | `initialize` with `2025-06-18`, `clientInfo.name: "codex-mcp-client"` | legacy only |

I also confirmed that Claude Code **shows the `instructions` from `server/discover` to the model**. A test server put a secret word in its discover instructions, and Claude Code (haiku) quoted it back.

**So, when is this needed?** Nothing is broken today. When Claude Code sends `server/discover`, godspeed answers HTTP 400 ("Unsupported protocol version: 2026-07-28"), and Claude Code falls back to `initialize`. The real deadlines are:
1. When v1 of the SDK stops getting security fixes (around end of January 2027 at the earliest).
2. If a client ever ships modern-only (no fallback). None that godspeed supports does that today.

Codex still speaks only the old era, so godspeed must keep answering `initialize` for a long time.

## 2. What in godspeed relies on `initialize`

All of it is in `src/server/mcp.ts`, plus one helper in `src/agent/agent-bridge.ts`.

| Thing | How it works today | What happens with a modern client |
| - | - | - |
| **Agent name** (Settings, Halley labels) | `initializeRequest()` reads `params.clientInfo` from an `initialize` body. `recordCheckIn(name)` saves it. Later requests keep the last name. | No `initialize` is ever sent, so the name is never set. The window would show no agent name. |
| **Briefing** ("Where you left off") | `handleMcpRequest` adds `currentAgentBriefing()` to the instructions only when the body is `initialize`. | The briefing never reaches the agent, because modern clients get instructions from `server/discover` instead. |
| **Seen tracking** (who saw which messages) | `agentIdOf()` reads `godspeed/agent` (Claude Code plugin) or `x-codex-turn-metadata` (Codex) from each tool call's `_meta`. | Not affected, because it never used `initialize`. Only the SDK field moves: `extra._meta` becomes `ctx.mcpReq._meta`. |
| **Session ids** | None. Each request gets a fresh server (`sessionIdGenerator: undefined`). | Not affected. |
| **Plugin connector** (`integrations/claude-code/godspeed/scripts/connect.mjs`) | Forwards every stdio message to `/api/mcp` as a plain POST with no MCP headers. Reads the reply as one JSON body. | Modern requests have no `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` headers, so the v2 SDK refuses them with HTTP 400. Claude Code then falls back to `initialize`, so it keeps working, but it stays on the old era. |
| **Background waiter** (`scripts/wait-for-work.mjs`) | Sends a bare `tools/call` with no `initialize` and no modern `_meta`. Reads the reply as one JSON body. | It stays a legacy request and keeps working, as long as legacy replies stay plain JSON (see the trap below). |

**One trap in the v2 SDK.** The easy entry point, `createMcpHandler(factory)`, serves old-era requests through its own built-in path. That path does not turn on `enableJsonResponse`, so it answers with an SSE stream (`text/event-stream`) instead of one JSON body. `connect.mjs` and `wait-for-work.mjs` only read plain JSON, so they would break with "godspeed sent an unreadable reply". I checked this in the 2.4.0 source (`createLegacyStatelessFallback`). The plan below avoids the trap by keeping today's JSON-mode transport for old-era requests.

## 3. How the briefing reaches modern clients

| Option | How | Good | Bad |
| - | - | - | - |
| **A. Briefing in the `server/discover` instructions** (recommended) | Build the briefing when the request is `initialize` **or** `server/discover`. The SDK puts the same `instructions` in both results. | Smallest change. One code path for both eras. Tested: Claude Code calls discover once when it connects and shows its instructions to the model. Same timing as today ("as of when you connected"). The SDK's default cache hint for discover is `ttlMs: 0`, `cacheScope: "private"`, so clients won't cache an old briefing. | A modern client that skips the optional discover call gets no instructions at all, briefing included. None of today's clients does that. |
| B. A `where_you_left_off` tool | A new read-only tool that returns the briefing. The instructions tell the agent to call it first. | Works with any client, even one that never calls discover. | One more tool definition in every agent's context, one more call per session, and the agent might skip it. Builds for a client that doesn't exist yet. |
| C. An MCP resource | Expose the briefing as a resource. | Fits the spec. | Most agents never read resources unless asked. |
| D. The plugin's SessionStart hook prints it | The Claude Code plugin fetches the briefing and adds it to the session. | Doesn't depend on MCP at all. | Claude Code plugin only, so Codex and other apps are left out. It would also duplicate the instructions path. |

**Recommendation: A.** It keeps the current behavior for both eras, adds no tools, and matches what Claude Code actually does. Revisit B only if a real client turns out to skip `server/discover`.

## 4. Step by step

Each step leaves the app working. Run `npm run check` after each one.

**Step 1. Switch the SDK package (no behavior change).**
- `package.json`: remove `@modelcontextprotocol/sdk` and add `@modelcontextprotocol/server` (2.4.0). It needs zod 4.2 or newer; godspeed has 4.6.7.
- `src/server/mcp.ts`: change the imports to `McpServer`, `WebStandardStreamableHTTPServerTransport`, `createMcpHandler` and `isLegacyRequest`, all from `@modelcontextprotocol/server`.
- In every `registerTool`, wrap the raw `inputSchema: { ... }` in `z.object({ ... })`. Raw shapes still work in v2, but they are deprecated.
- The `wait_for_work` handler reads `ctx.mcpReq._meta` instead of `extra._meta`. Check in a test that the custom keys (`godspeed/agent`, `x-codex-turn-metadata`) are still there, because the SDK strips the reserved `io.modelcontextprotocol/*` keys.
- You can try the codemod (`npx @modelcontextprotocol/codemod@latest v1-to-v2 . --dry-run`), but this is one file, so doing it by hand is just as quick.
- Electron: build the desktop app once and make sure the packaged server loads the new package. The last security commit had to ship an extra `package.json` for onnxruntime, so don't assume this works without checking.

**Step 2. Read the caller from every request, not just `initialize`.**
- `src/server/mcp.ts`: replace `initializeRequest()` with one small function, for example `callerOf(req)`. It reads the body once and returns:
  - `name`: from `params.clientInfo` on `initialize`, or else from `params._meta["io.modelcontextprotocol/clientInfo"]`, passed through `displayAgentName()`.
  - `wantsInstructions`: true when the method is `initialize` or `server/discover`.
- `handleMcpRequest`: call `recordCheckIn({ name: caller.name })` on every POST (this is the same as today, but now modern requests carry the name too). Build the instructions and briefing only when `wantsInstructions` is true (option A).
- `src/agent/agent-bridge.ts`: `recordCheckIn` itself doesn't change. Fix its comment ("comes from the initialize handshake" becomes "comes from the request's client info").

**Step 3. Serve both eras from one endpoint.**
In `handleMcpRequest`, after `refuse(req)`:
```ts
if (await isLegacyRequest(req)) {
  // today's code: fresh McpServer + WebStandardStreamableHTTPServerTransport
  // with sessionIdGenerator: undefined, enableJsonResponse: true
} else {
  return createMcpHandler(() => buildServer(instructions, req.signal), { legacy: "reject", responseMode: "json" }).fetch(req);
}
```
- Old era: unchanged JSON replies, so `connect.mjs`, `wait-for-work.mjs` and Codex keep working.
- Modern era: `responseMode: "json"` keeps godspeed's one-request-one-JSON-reply shape. The SDK checks the headers and the `_meta` envelope, and it answers `server/discover` itself.
- `refuse()` (token, local host, no browser Origin) stays in front of both paths. The v2 handler does not check Host or Origin on its own.
- The route file `src/app/api/mcp/route.ts` stays the same.

**Step 4. Let the Claude Code plugin go modern (optional, separate release).**
- `integrations/claude-code/godspeed/scripts/connect.mjs`: when a message has `params._meta["io.modelcontextprotocol/protocolVersion"]`, send the `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers (the name is `params.name` for `tools/call`). Without this, Claude Code keeps falling back to the old era, which still works.
- While you're in there, fix a small bug: a JSON-RPC error reply currently shows up as "godspeed refused the request (400): [object Object]".
- Bump the plugin version (0.4.1 to 0.4.2) and follow the usual plugin release steps.
- `wait-for-work.mjs` can stay old-era for now (see the open questions).

**Step 5. Docs and cleanup.**
- `docs/architecture.md`, "Agent notes and the briefing": "Every MCP `initialize`" becomes "Every `initialize` or `server/discover`".
- The header comment of `src/server/mcp.ts`: say it serves both eras.
- Delete this plan or move it to `docs/archive/` once it's built.
- The landing site (`godspeed-site`) needs no change, because nothing the user sees changes.

## 5. How to test

**Unit tests** (`tests/agent-bridge.test.ts`, `tests/agent-memory.test.ts`, `tests/agent-actions.test.ts` already post `initialize` to `handleMcpRequest`; keep those and add the modern cases next to them):
1. Old era: `initialize` with `clientInfo.name: "codex-mcp-client"` names the agent "Codex", and `result.instructions` ends with the briefing. The reply is `application/json`.
2. Modern: `server/discover` with the full `_meta` and the three headers. `result.instructions` holds the briefing, `supportedVersions` includes `2026-07-28`, and the agent is named "Claude Code".
3. Modern: a `tools/call` (`list_classes`) with no earlier `initialize` names the agent and works.
4. Modern: the same `tools/call` without the `Mcp-Method` header gets HTTP 400 with `-32020`.
5. The waiter's shape: a bare `tools/call` to `wait_for_work` with only `godspeed/agent` in `_meta` still gets plain JSON, and the seen tracking still uses that id.
6. `tests/claude-code-plugin.test.ts`: `connect.mjs` adds the three headers to modern messages and leaves old ones alone.

**Real clients** (with the desktop app running):
- **Claude Code, modern:** start a session with the plugin and ask it "quote the 'Where you left off' part of the godspeed instructions". Settings → Connection should show "Claude Code".
- **Claude Code, fallback:** run the plugin from before step 4. It should still work through the `initialize` fallback.
- **Codex (old era):** use the `config.toml` snippet from Settings → Connection, run `codex`, and ask it to call `list_classes`. Settings should show "Codex", and the agent should see the briefing.
- **To see what a client sends:** write a tiny stdio server that appends every line it gets to a file and answers like an old server: `initialize` gets a result, `server/discover` gets "method not found". Run `claude -p "say ok" --mcp-config probe.json --strict-mcp-config` against it. The first line in the file tells you the client's era. This is how the table in section 1 was made, and it's worth repeating after big client updates.

## 6. Open questions for the owner

1. **Briefing:** go with option A (instructions on `initialize` and `server/discover`)? Or also add the `where_you_left_off` tool (B) as a backup for clients that skip discover?
2. **Timing:** migrate now, or wait until closer to the end of v1 support (around January 2027)? Nothing breaks today either way.
3. **Plugin:** ship step 4 (the plugin speaks modern) together with the server change, later, or never? Without it, Claude Code stays on the old era through its fallback.
4. **Background waiter:** keep `wait-for-work.mjs` on bare old-era calls, or make it send the modern `_meta` and headers too? If it stays old, godspeed can never drop old-era support while the plugin uses it.
5. **Dropping the old era:** keep it until Codex speaks 2026-07-28? Or never drop it, since it is cheap to keep?
6. **Version pin:** pin `@modelcontextprotocol/server` to an exact version, or use `^2.4.0` like the other dependencies?
