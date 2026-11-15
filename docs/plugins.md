# Writing a plugin

How to write a godspeed plugin. [architecture.md](architecture.md#82-plugins) says how the app hosts one.

godspeed is in alpha, so the plugin format can still change between updates.

## What a plugin is

A plugin is a folder with a `manifest.json` and a web page. godspeed shows the page in a frame in a lesson (a window hanging from the lesson's top bar) or in a space (a tab). The page talks to godspeed with messages in the MCP Apps format (protocol `2026-01-26`, JSON-RPC 2.0 over `postMessage`). A plugin needs no build step and no server.

| A plugin can | How |
|---|---|
| Read the open lesson | `get_context`: the lesson's title, the open question, the last answered question and the teacher's last message. |
| Keep its own data | `storage_get` and `storage_set`: small JSON values, kept in the plugin's own folder. |
| Ask the learner's agent for model work | `ask_agent`, only if the manifest says `"agent"` in `uses`. |
| Read the open space's facts and lesson list | `read_space`, only if the manifest says `"space"` in `uses`. |
| Reach the internet | Only the hosts the manifest lists in `network`, over https. |

| A plugin cannot | Why |
|---|---|
| Read the learner's files | The frame is sandboxed with no same-origin access, so it has no window, no cookies and no browser storage, and godspeed's own API refuses it. |
| Call godspeed's API or the desktop app's commands | The page is served from `localhost`, a host the app's permissions do not name. |
| Load code from anywhere else | Scripts come only from the plugin's own folder. A page that needs a library ships it in its folder. |
| Open pop-ups or navigate away | If the page navigates, godspeed stops listening and shows that it didn't load. |

godspeed has no model of its own. Model work goes to the learner's own agent as one request at a time, and it costs the learner their subscription usage. Ask rarely and keep prompts small.

## A smallest plugin

Make a folder `hello/` with these two files. It shows in lessons and prints the lesson's title.

`manifest.json`

```json
{
	"id": "hello",
	"name": "Hello",
	"version": "1.0.0",
	"description": "Shows the title of the lesson you are in.",
	"author": "you",
	"entry": "index.html",
	"lesson": { "label": "Hello" }
}
```

`index.html`

```html
<!doctype html>
<html>
	<head>
		<meta charset="utf-8" />
		<title>Hello</title>
		<style>
			body {
				margin: 0;
				padding: 16px;
				background: var(--color-background-primary);
				color: var(--color-text-primary);
			}
		</style>
	</head>
	<body>
		<p id="out">Waiting for godspeed.</p>
		<script>
			const send = (message) => parent.postMessage({ jsonrpc: "2.0", ...message }, "*");
			const waiting = new Map();
			let nextId = 1;

			// Answers from godspeed come back with the id of the request they answer.
			addEventListener("message", (event) => {
				if (event.source !== parent) return;
				waiting.get(event.data?.id)?.(event.data);
			});

			function request(method, params) {
				return new Promise((done) => {
					const id = nextId++;
					waiting.set(id, done);
					send({ id, method, params });
				});
			}

			async function start() {
				const init = await request("ui/initialize", { appInfo: { name: "hello", version: "1.0.0" }, appCapabilities: {}, protocolVersion: "2026-01-26" });
				for (const [name, value] of Object.entries(init.result.hostContext.styles?.variables ?? {})) document.documentElement.style.setProperty(name, value);
				send({ method: "ui/notifications/initialized" });
				// The lesson's window is as tall as the page says.
				const root = document.documentElement;
				new ResizeObserver(() => send({ method: "ui/notifications/size-changed", params: { width: root.clientWidth, height: Math.ceil(root.getBoundingClientRect().height) } })).observe(root);
				const reply = await request("tools/call", { name: "get_context", arguments: {} });
				document.getElementById("out").textContent = reply.error ? reply.error.message : (reply.result.structuredContent.topic ?? "No lesson is open.");
			}
			start();
		</script>
	</body>
</html>
```

The page does the handshake in three steps. Every plugin does these first:

1. Send the request `ui/initialize` with your app's name and version and `protocolVersion` `"2026-01-26"`. godspeed answers with the look and the plugin's settings (see [What godspeed sends by itself](#what-godspeed-sends-by-itself)).
2. Send the notification `ui/notifications/initialized` (a message with no `id`). godspeed answers nothing to it, and counts the page as loaded.
3. Only now call tools with `tools/call`. A call before step 1 gets the error "Send ui/initialize first."

Always check `event.source === parent`. The page can't name godspeed's origin, so it posts to `"*"`.

This example is not one of the fixture folders byte for byte, and no automated test runs it. It was checked by hand.

- The manifest has only the required fields, the shape the `bare` case in `crates/services/src/plugins/manifest.rs` tests. The whole folder also installed into a debug server on scratch data.
- The page ran in a lesson's window in the debug app on scratch data, in the app's colors and as tall as its one line.
- `tests/fixtures/plugins/layout/` is the same handshake, look and size message without the tool call. `npm run layout` installs it and loads it in the real app window.

## The manifest

`manifest.json` is at the top of the plugin's folder. Fields godspeed doesn't know are dropped. Text fields are made one line and cut to their length, not refused for being long, but a field that is missing or empty is refused.

| Field | Type | Required | Rule |
|---|---|---|---|
| `id` | text | yes | 1 to 64 lowercase letters, digits and dashes, not starting or ending with a dash, like `meme-cards`. Names the plugin's folder and its files' address. |
| `name` | text | yes | Up to 40 characters. |
| `version` | text | yes | Three numbers with dots, like `1.0.0`. |
| `description` | text | yes | Up to 200 characters. |
| `author` | text | yes | Up to 80 characters. |
| `entry` | text | yes | The page to show: a path inside the folder, ending in `.html`, written with `/`. No `..`, no part starting with a dot, no drive or root, no `\` or `:`, up to 200 characters, and not in `data/`. The file must exist. |
| `lesson` | `{ "label": text }` | one of `lesson` and `space` | The plugin shows in lessons, as a word in the lesson's top bar. `label` is up to 24 characters. |
| `space` | `{ "label": text }` | one of `lesson` and `space` | The plugin shows in a space, as a tab after the space's own tabs. `label` is up to 24 characters. |
| `settings` | list | no | Up to 20 settings, each with a different `key`. godspeed draws their controls in Settings, Plugins. See below. |
| `network` | list of text | no | Up to 10 host names like `api.example.com`: lowercase, at least two parts, no scheme, port, path, wildcard or IP address. Repeats are dropped. |
| `uses` | list of text | no | `"agent"` and `"space"`, nothing else. |

Each setting is an object. The page gets the values when it starts (see below).

| Setting field | Applies to | Rule |
|---|---|---|
| `key` | all | Required. A letter, then up to 39 letters, digits or `_`, like `fontSize`. |
| `label` | all | Required. Up to 40 characters. |
| `kind` | all | Required. `toggle`, `choice`, `number` or `text`. |
| `default` | all | `toggle`: required, `true` or `false`. `choice`: required, one of `options`. `number`: required, a number inside `min` and `max`. `text`: optional, up to 500 characters, empty when left out. |
| `options` | `choice` | Required. 2 to 12 different one-line names of up to 40 characters. |
| `min`, `max` | `number` | Optional numbers. |
| `hint` | all | Optional. Up to 200 characters. |

A choice of up to 4 options is drawn side by side, a longer one as a list. A value that no longer fits the manifest (for example after an update removes an option) reads as the setting's default.

A manifest that fails is refused whole, and the message names the field, for example `manifest.json: version must be like 1.0.0` or `manifest.json needs lesson or space, so the plugin shows somewhere`.

## Host tools

Call a tool with the request `tools/call` and `{ name, arguments }`. The answer is either a tool result or an error.

A tool result is `{ content: [{ type: "text", text }], structuredContent }`. The `text` is the same JSON as text, and `structuredContent` is the object to read. When godspeed's server refuses the work, the result has `isError: true` and `content[0].text` holds the message. This happens for example for a bad storage key or an ask the agent can't take.

A request godspeed won't take at all comes back as a JSON-RPC `error` with a code and a message.

| Code | When |
|---|---|
| `-32600` | A tool call before `ui/initialize`. |
| `-32601` | A method godspeed doesn't handle. godspeed answers `ping`, `ui/initialize`, `ui/open-link` and `tools/call` only. |
| `-32602` | A tool name godspeed doesn't have, a tool whose `uses` entry is missing from the manifest, or an argument of the wrong type (`key must be text.`). |
| `-32000` | godspeed couldn't do it. |

| Tool | Needs in `uses` | Arguments | Result |
|---|---|---|---|
| `get_context` | nothing | none | `{ space, topic, question, lastAnswered, teacherMessage }` |
| `storage_get` | nothing | `key` | `{ value }`, with `value` null when nothing is stored |
| `storage_set` | nothing | `key`, `value` | `{}` |
| `ask_agent` | `agent` | `prompt`, `schema` | `{ answer }` |
| `read_space` | `space` | none | `{ facts, lessons }` |

### get_context

What the page can read, never changing the lesson. In a space's tab only `space` is set, and the rest is null.

| Field | Value |
|---|---|
| `space` | `{ id, name }` of the lesson's space, or null in a lesson with no space. |
| `topic` | The lesson's title. |
| `question` | The open question on screen: `{ id, text, options }`, with `options` the choices' labels (empty for a question the learner answers in words). Never holds its answer. Null when no question is open, and while a question still waits behind "Check your understanding". The `id` stays the same for as long as the question is open. |
| `lastAnswered` | The last question the learner answered or skipped: the same three fields, plus `answer` when the answered card shows one (a quiz's marked options joined with " and ", or an explain question's committed answer) and `correct` only for a graded quiz the learner answered (never a prediction, an "I don't know" or a skip). |
| `teacherMessage` | The teacher's last message as text, or null. |

A real answer in a lesson (the ids are made up here):

```json
{
	"space": { "id": "cse-21", "name": "CSE 21" },
	"topic": "Linear equations",
	"question": { "id": "call-4", "text": "What is x when 2x + 3 = 11?", "options": ["3", "4", "5"] },
	"lastAnswered": {
		"id": "call-3",
		"text": "What is the slope of y = 3x + 1?",
		"options": ["1", "3", "x"],
		"answer": "3",
		"correct": true
	},
	"teacherMessage": "Try this one."
}
```

### storage_get and storage_set

One JSON file per key, in the plugin's own folder under `data/`. Reinstalling a plugin keeps it, and removing the plugin deletes it. The page can't use `localStorage` or cookies, so this is where it keeps anything.

| Rule | Value |
|---|---|
| Key | 1 to 64 letters, digits, `_` or `-`. Anything else is refused with "A key is 1 to 64 letters, digits, _ or -." |
| Value | Any JSON value. Over 1 MB written out is refused with "A stored value can be at most 1 MB." |
| `storage_set` without `value` | A `-32602` error, "Send { key, value }." |

### ask_agent

Sends one request to the learner's own agent, as a work item labelled "<name> asked for…". `prompt` is the request. `schema` is a JSON Schema for the answer (`{}` when left out, which accepts anything). The agent has to send an answer that fits the schema, and godspeed hands the result back as `{ answer }`.

| Rule | Value |
|---|---|
| Needs | `"agent"` in `uses`, and the plugin switched on. |
| Prompt | Not empty, up to 4096 bytes. |
| Schema | A JSON object, up to 4096 characters written out. |
| At a time | One request per plugin. A second one while the first runs is refused with "Your agent is still on this plugin's last request." |
| Waiting | godspeed sets no time limit. While the page waits, it sends `notifications/progress` every 20 seconds if the request had `_meta.progressToken`, so a client library that gives up after a silent minute keeps waiting. |

While a request runs, godspeed shows it under the plugin's name, as it shows a deadline request: a row in the teacher's Activity list, and the top bar's pill when it is the only work.

The agent is told the request comes from a plugin and to answer it and do nothing else. Don't put anything in a prompt you wouldn't show the learner. A failed ask comes back as a tool error whose text says why.

### read_space

The open space's facts and lessons, read only: `{ facts: [{ name, statement }], lessons: [{ id, title, kind, updatedAt }] }`. It reads the space `get_context` names, so with no space open it is a tool error, "No space is open."

### Opening a link

`ui/open-link` with `{ url }` opens an `http` or `https` link in the learner's browser. It works only while the learner is working in the plugin's page (it has focus). Otherwise godspeed answers `-32000`, "godspeed opens a link only after a click in the plugin."

## What godspeed sends by itself

| Message | When | What the page does |
|---|---|---|
| The result of `ui/initialize` | The page's first request. | Read the look and the setting values from it. Nothing sends them again. |
| `ui/notifications/host-context-changed`, with empty `params` | In a lesson, about half a second after something `get_context` gives changed and then held still, and only after the page said `initialized`. A streaming reply is one notice, not one for each word. | Call `get_context` again. The notice carries nothing to read. |
| `notifications/progress` | While an `ask_agent` that sent a `progressToken` waits. | Nothing, unless the page times out its own requests. |

The result of `ui/initialize` holds these.

| Field | Value |
|---|---|
| `protocolVersion` | `"2026-01-26"`. |
| `hostInfo` | `{ name: "godspeed", version }`. |
| `hostCapabilities` | `{ openLinks: {}, serverTools: {} }`. |
| `hostContext.theme` | `"light"` or `"dark"`, as the app is when the page starts. Always `"dark"` in a lesson's window, which is made of the top bar. |
| `hostContext.styles.variables` | The CSS variables below, as text values. |
| `hostContext.styles.css.fonts` | The `@font-face` rules for the fonts in `--font-sans`. |
| `hostContext.settings` | The plugin's setting values by `key`, such as `{ "emphasis": true }`. |
| `hostContext.displayMode`, `availableDisplayModes` | `"inline"` and `["inline"]`. |
| `hostContext.platform`, `locale`, `timeZone` | `"desktop"`, the browser's language, the learner's time zone. |

A setting the learner changes while the page is open reaches the page the next time it opens. A page that needs the new value sooner has no way to ask for it.

## The look

The page gets godspeed's colors, fonts and corner size under MCP Apps variable names. Set them on `:root` when the page starts and use them in your CSS. A variable is left out when the app has no value for it.

```js
const result = await request("ui/initialize", { ... });
const styles = result.result.hostContext.styles ?? {};
for (const [name, value] of Object.entries(styles.variables ?? {})) {
	document.documentElement.style.setProperty(name, value);
}
// The app's fonts (what ext-apps' applyHostFonts does).
const fonts = document.createElement("style");
fonts.textContent = styles.css?.fonts ?? "";
document.head.append(fonts);
```

| Variable | What it is |
|---|---|
| `--color-background-primary` | What the page sits on: the top bar's color in a lesson's window, the sheet in a space's tab. Use it as the page's ground, so the page and its box are one surface. |
| `--color-background-secondary` | A field or card on that ground. |
| `--color-background-tertiary` | A hovered or chosen row, or a chip. |
| `--color-background-inverse` | The ground's opposite: the top bar's text color in a lesson's window, the top bar's color in a space's tab. |
| `--color-text-primary` | Text on the ground. |
| `--color-text-secondary` | Quieter text. |
| `--color-text-tertiary` | The quietest text. |
| `--color-text-inverse` | Text on the inverse background. |
| `--color-text-danger` | A wrong or failed state. |
| `--color-text-success` | A right state. |
| `--color-border-primary` | The app's border color. See the rules below before drawing a line with it. |
| `--color-ring-primary` | The focus ring. |
| `--font-sans`, `--font-mono` | The app's font lists. Add `hostContext.styles.css.fonts` to the page, as above, and text in `--font-sans` uses the app's font. |
| `--border-radius-xs`, `-sm`, `-md`, `-lg` | The app's one corner size, the same for all four. |

The variables hold the app's colors as they were when the page started. godspeed does not send the new ones when the learner switches the theme, so a page that wants to follow a theme switch has to be opened again.

Follow the app's look so the plugin reads as part of it. godspeed does not check these, but a plugin that breaks them stands out.

- Flat fills. No shadows, no gradients, no blur.
- No thin outlines or 1 px divider lines. Separate things with a different shade, with space, or with a thick bottom edge on a button.
- Small corners, from the corner variables.
- Text color follows its background: pair `--color-text-primary` with the ground and `--color-text-inverse` with the inverse background.
- Short words. A label is one or two words, and there is no sentence to explain a control.

## Where the page shows

The page gets no title of its own, since godspeed shows its label already.

| Place | The page's box |
|---|---|
| A lesson | A window that hangs from the lesson's top bar and lies over the lesson's sheet, its right edge on the sheet's, so it never covers "Your turn" beside it. In a narrow window, where "Your turn" sits under the lesson, it hangs under the plugin's word instead. It is 360 px wide and as tall as the page says it is, from 48 px up to the room under the top bar less 16 px. A taller page scrolls inside it. Before the page says, it is 120 px tall. The word closes it again, and so do Escape, opening the cheat sheet and opening the Teacher's window. |
| A space | A tab that fills the space's page under its tabs. |

In a lesson, tell godspeed the page's height:

1. Leave `html` and `body` at the height of what they hold. A page set to `height: 100%` measures the window, not itself, and never grows.
2. After `initialized`, watch `document.documentElement` with a `ResizeObserver`.
3. Each time it fires, send the notification `ui/notifications/size-changed` with `{ width, height }` in px, `height` from `document.documentElement.getBoundingClientRect()`. godspeed takes the height and keeps the width at 360.

A page that never sends it stays 120 px tall and scrolls inside that. In a space's tab the message changes nothing.

## Trying a plugin

1. Open Settings, then Plugins.
2. Click Add and pick your plugin's folder. Add is in the desktop app only. godspeed copies the folder. If something is wrong, a red message under Add says what, for example `manifest.json: id must be lowercase letters, digits and dashes, like meme-cards`.
3. The new plugin is picked in the list, and its sheet shows the switch, its settings, Show folder and Remove. A plugin that is off is not shown anywhere, its files are not served, and `ask_agent` is refused.
4. Open it. A lesson plugin is a word in the lesson's top bar, left of the cheat sheet. Click it to open the page in a window over the lesson, and click it again to close it. A space plugin is a tab after the space's own tabs, and shows only in a real space.
5. After changing a file, click Add and pick the same folder again. godspeed replaces the copy and keeps the plugin's stored JSON and settings. Open the page again to see the change.

A plugin whose folder can no longer load shows in the list with its error and a Remove button.

When the frame shows "<name> didn't load." with Try again, the page did not finish the handshake within 10 seconds, or it navigated away from its entry page (a link, a form or `location` changes). To see why, open the app's developer tools: View, Toggle Developer Tools. They exist in a debug build or a build made with the `devtools` feature, not in a released app. The console shows the page's script errors and blocked requests.

Every file is served with a policy that limits the page. If a request is blocked, check these.

| Policy | Effect |
|---|---|
| Scripts and styles | Only from your folder, plus inline ones. No `eval`. |
| Images, fonts, audio and video | Your folder, `data:` and `blob:` addresses, and the `network` hosts. Fonts also from the app's own font files, the ones `hostContext.styles.css.fonts` names. |
| `fetch` and other requests | Only the `network` hosts, over https. With none, no requests at all. |
| Frames, forms and a changed base address | Not allowed. |

## Limits

Field lengths are in [the manifest](#the-manifest) and tool limits in [Host tools](#host-tools). The rest:

| Limit | Value |
|---|---|
| `manifest.json` | 64 KB |
| Files in a plugin | 1000 |
| A plugin's size | 20 MB |
| Names in the folder | Hidden files and folders (starting with a dot) are left out. A link is refused. Nothing may be named `data`, which is the plugin's storage. |
| Time to finish the handshake | 10 seconds |
| A stored value | 1 MB |
| An `ask_agent` request | One at a time per plugin |

## Getting listed

The reviewed list of plugins is the repository <https://github.com/bayshores/godspeed-plugins>. Its README says:

- Each entry in `plugins.json` names a GitHub repository and one tag. godspeed will download exactly that tag, so a plugin changes for a learner only when its entry moves to a newer tag.
- To add a plugin, open a pull request that adds your repository and tag to `plugins.json`. The code at that tag is read before the pull request is merged.
- The list is empty for now, and the app doesn't read it yet.

The server can already install one tag of a GitHub repository from the zip GitHub makes for it (`POST /api/plugins` with `{ "from": "github", "owner", "repo", "tag" }`), but no screen uses it yet. For that zip, `manifest.json` must sit at the top of the repository. A single folder around everything, as GitHub's zips have, is removed, and hidden files such as `.github` are left out.
