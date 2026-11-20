# Writing a plugin

How to write a godspeed plugin. [architecture/08.2-plugins.md](architecture/08.2-plugins.md#82-plugins) says how the app hosts one.

godspeed is in alpha, so the plugin format can still change between updates.

## What a plugin is

A plugin is a folder with a `manifest.json` and a web page, shown in a frame in a lesson (a window hanging from the top bar) or in a space (a tab). The page talks to godspeed in the MCP Apps format (protocol `2026-01-26`, JSON-RPC 2.0 over `postMessage`). No build step, no server.

| A plugin can | How |
|---|---|
| Read the open lesson | `get_context`: title, open question, last answered question, teacher's last message. |
| Keep its own data | `storage_get`, `storage_set`: small JSON values in the plugin's folder. |
| Ask the learner's agent for model work | `ask_agent`, only with `"agent"` in `uses`. |
| Read the open space's facts and lesson list | `read_space`, only with `"space"` in `uses`. |
| Reach the internet | Only hosts in `network`, over https. |

| A plugin cannot | Why |
|---|---|
| Read the learner's files | The frame is sandboxed with no same-origin access (no window, cookies or browser storage), and godspeed's API refuses it. |
| Call godspeed's API or the desktop app's commands | The page is served from `localhost`, which the app's permissions do not name. |
| Load code from elsewhere | Scripts come only from the plugin's folder; ship any library there. |
| Open pop-ups or navigate away | On navigation godspeed stops listening and shows that it didn't load. |

godspeed has no model. Model work goes to the learner's agent, one request at a time, at the learner's subscription cost. Ask rarely, keep prompts small.

## A smallest plugin

Folder `hello/` with two files. It shows in lessons and prints the lesson's title.

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

The handshake, first in every plugin:

1. Request `ui/initialize` with your app's name and version and `protocolVersion` `"2026-01-26"`. The answer holds the look and the plugin's settings (see [What godspeed sends by itself](#what-godspeed-sends-by-itself)).
2. Notification `ui/notifications/initialized` (no `id`). No answer; counts the page as loaded.
3. Only now call tools with `tools/call`. Before step 1 the error is "Send ui/initialize first."

Check `event.source === parent`; the page can't name godspeed's origin, so it posts to `"*"`.

The example was checked by hand, not by a test, and is no fixture byte for byte. Its manifest has only required fields, the shape of the `bare` case in `crates/services/src/plugins/manifest.rs`. The folder installed into a debug server, and the page ran in a lesson's window in the debug app, both on scratch data, in the app's colors and as tall as its one line. `tests/fixtures/plugins/layout/` is the same handshake, look and size message without the tool call; `npm run layout` installs it and loads it in the real window.

## The manifest

`manifest.json` is at the top of the folder. Unknown fields are dropped. Text is made one line and cut to length, not refused for length; a missing or empty field is refused.

| Field | Rule |
|---|---|
| `id` | Required text, 1 to 64 lowercase letters, digits, dashes, none at either end, like `meme-cards`. Names the plugin's folder and its files' address. |
| `name` | Required, up to 40 characters. |
| `version` | Required, three numbers with dots, like `1.0.0`. |
| `description` | Required, up to 200 characters. |
| `author` | Required, up to 80 characters. |
| `entry` | Required. The page: a path inside the folder, ending `.html`, written with `/`. No `..`, no part starting with a dot, no drive or root, no `\` or `:`, up to 200 characters, not in `data/`. The file must exist. |
| `lesson` | `{ "label": text }`. A word in the lesson's top bar. `label` up to 24 characters. One of `lesson` and `space` is required. |
| `space` | `{ "label": text }`. A tab after the space's own tabs. `label` up to 24 characters. |
| `settings` | Optional list, up to 20, each with a different `key`. Controls drawn in Settings, Plugins. |
| `network` | Optional list of up to 10 hosts like `api.example.com`: lowercase, at least two parts, no scheme, port, path, wildcard or IP. Repeats dropped. |
| `uses` | Optional list: `"agent"` and `"space"`, nothing else. |

Each setting is an object; the page gets the values at start.

| Setting field | Rule |
|---|---|
| `key` | Required. A letter, then up to 39 letters, digits or `_`, like `fontSize`. |
| `label` | Required, up to 40 characters. |
| `kind` | Required: `toggle`, `choice`, `number` or `text`. |
| `default` | `toggle`: required, `true` or `false`. `choice`: required, one of `options`. `number`: required, inside `min` and `max`. `text`: optional, up to 500 characters, empty when left out. |
| `options` | `choice` only. Required, 2 to 12 different one-line names of up to 40 characters. |
| `min`, `max` | `number` only. Optional numbers. |
| `hint` | Optional, up to 200 characters. |

A choice of up to 4 options is drawn side by side, a longer one as a list. A stored value that no longer fits (an update removed the option) reads as the default.

A failing manifest is refused whole, with a message naming the field, for example `manifest.json: version must be like 1.0.0` or `manifest.json needs lesson or space, so the plugin shows somewhere`.

## Host tools

Request `tools/call` with `{ name, arguments }`. The answer is a tool result or an error.

A tool result is `{ content: [{ type: "text", text }], structuredContent }`: `text` is the same JSON as text, `structuredContent` the object to read. When the server refuses the work (a bad storage key, an ask the agent can't take), the result has `isError: true` and `content[0].text` holds the message.

A request godspeed won't take at all returns a JSON-RPC `error` with a code and message.

| Code | When |
|---|---|
| `-32600` | A tool call before `ui/initialize`. |
| `-32601` | A method not handled. Only `ping`, `ui/initialize`, `ui/open-link` and `tools/call` are. |
| `-32602` | Unknown tool, tool whose `uses` entry is missing, or an argument of the wrong type (`key must be text.`). |
| `-32000` | godspeed couldn't do it. |

| Tool | Needs in `uses` | Arguments | Result |
|---|---|---|---|
| `get_context` | none | none | `{ space, topic, question, lastAnswered, teacherMessage }` |
| `storage_get` | none | `key` | `{ value }`, null when nothing is stored |
| `storage_set` | none | `key`, `value` | `{}` |
| `ask_agent` | `agent` | `prompt`, `schema` | `{ answer }` |
| `read_space` | `space` | none | `{ facts, lessons }` |

### get_context

Read only. In a space's tab only `space` is set, the rest null.

| Field | Value |
|---|---|
| `space` | `{ id, name }` of the lesson's space, or null in a lesson with no space. |
| `topic` | The lesson's title. |
| `question` | The open question: `{ id, text, options }`, `options` the choices' labels (empty for a question answered in words). Never holds its answer. Null when none is open. The `id` is stable while it is open. |
| `lastAnswered` | The last question answered or skipped: the same three fields, plus `answer` when the card shows one (a quiz's marked options joined with " and ", or an explain question's committed answer) and `correct` only for an answered graded quiz (never a prediction, "I don't know" or skip). |
| `teacherMessage` | The teacher's last message as text, or null. |

Example in a lesson (made-up ids):

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

One JSON file per key under `data/` in the plugin's folder. Reinstalling keeps it, removing the plugin deletes it. The page has no `localStorage` or cookies, so keep everything here.

| Rule | Value |
|---|---|
| Key | 1 to 64 letters, digits, `_` or `-`, else "A key is 1 to 64 letters, digits, _ or -." |
| Value | Any JSON value; over 1 MB written out gives "A stored value can be at most 1 MB." |
| `storage_set` without `value` | A `-32602` error, "Send { key, value }." |

### ask_agent

One request to the learner's agent, as a work item labelled "<name> asked for…". `prompt` is the request, `schema` a JSON Schema for the answer (`{}` when left out, accepts anything). The agent must answer to fit the schema; godspeed returns `{ answer }`.

| Rule | Value |
|---|---|
| Needs | `"agent"` in `uses`, and the plugin switched on. |
| Prompt | Not empty, up to 4096 bytes. |
| Schema | A JSON object, up to 4096 characters written out. |
| At a time | One per plugin. A second while one runs is refused with "The teacher is still on this plugin's last request." |
| Waiting | No time limit. If the request had `_meta.progressToken`, godspeed sends `notifications/progress` every 20 seconds, so a client library that gives up after a silent minute keeps waiting. |

A running request shows under the plugin's name like a deadline request: a row in the teacher's Activity list, and the strip's peek when it is the only work. The agent is told the request comes from a plugin and to answer it and do nothing else. Put nothing in a prompt you wouldn't show the learner. A failed ask is a tool error whose text says why.

### read_space

Read only: `{ facts: [{ name, statement }], lessons: [{ id, title, kind, updatedAt }] }`, for the space `get_context` names. With no space open it is a tool error, "No space is open."

### Opening a link

`ui/open-link` with `{ url }` opens an `http` or `https` link in the learner's browser, only while the plugin's page has focus. Otherwise `-32000`, "godspeed opens a link only after a click in the plugin."

## What godspeed sends by itself

| Message | When | What the page does |
|---|---|---|
| The result of `ui/initialize` | The page's first request. | Read look and setting values; never resent. |
| `ui/notifications/host-context-changed`, empty `params` | In a lesson, about 0.5 s after something `get_context` gives changed and held still, only after `initialized`. A streaming reply is one notice. | Call `get_context` again. |
| `notifications/progress` | While an `ask_agent` with a `progressToken` waits. | Nothing, unless the page times out its own requests. |

The result of `ui/initialize` holds:

| Field | Value |
|---|---|
| `protocolVersion` | `"2026-01-26"`. |
| `hostInfo` | `{ name: "godspeed", version }`. |
| `hostCapabilities` | `{ openLinks: {}, serverTools: {} }`. |
| `hostContext.theme` | `"light"` or `"dark"`, as the app at page start. Always `"dark"` in a lesson's window (made of the top bar). |
| `hostContext.styles.variables` | The CSS variables below, as text. |
| `hostContext.styles.css.fonts` | `@font-face` rules for the fonts in `--font-sans`. |
| `hostContext.settings` | Setting values by `key`, such as `{ "emphasis": true }`. |
| `hostContext.displayMode`, `availableDisplayModes` | `"inline"`, `["inline"]`. |
| `hostContext.platform`, `locale`, `timeZone` | `"desktop"`, browser language, learner's time zone. |

A setting changed while the page is open reaches it the next time it opens; the page can't ask sooner.

## The look

The page gets the app's colors, fonts and corner size under MCP Apps variable names. Set them on `:root` at start and use them in your CSS. A variable with no app value is left out.

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
| `--color-background-primary` | The page's ground: the top bar's color in a lesson's window, the sheet in a space's tab. Use it so page and box are one surface. |
| `--color-background-secondary`, `--color-background-tertiary` | A field or card on the ground; a hovered or chosen row, or a chip. |
| `--color-background-inverse` | The ground's opposite: the top bar's text color in a lesson's window, its color in a space's tab. |
| `--color-text-primary`, `--color-text-secondary`, `--color-text-tertiary` | Text on the ground, quieter, quietest. |
| `--color-text-inverse` | Text on the inverse background. |
| `--color-text-danger`, `--color-text-success` | A wrong or failed state, a right state. |
| `--color-border-primary` | The border color. See the rules below before drawing a line. |
| `--color-ring-primary` | The focus ring. |
| `--font-sans`, `--font-mono` | Font lists. Add `hostContext.styles.css.fonts` as above and `--font-sans` text uses the app's font. |
| `--border-radius-xs`, `-sm`, `-md`, `-lg` | One corner size for all four. |

Variables hold the colors from page start. A theme switch sends no new ones, so a page must be reopened to follow.

Follow the app's look (unchecked, but breaking it stands out):

- Flat fills. No shadows, gradients or blur.
- No thin outlines or 1 px divider lines. Separate with a different shade, with space, or with a thick bottom edge on a button.
- Small corners, from the corner variables.
- Text color follows background: `--color-text-primary` on the ground, `--color-text-inverse` on the inverse background.
- Short words: a label is one or two words, no sentence explaining a control.

## Where the page shows

No title of its own; godspeed shows the label.

| Place | The page's box |
|---|---|
| A lesson | A window hanging from the top bar under the plugin's word, right edges aligned, and clear of the strip. 360 px wide, as tall as the page says, from 48 px up to the room under the top bar less 16 px; a taller page scrolls inside. Before the page says, 120 px tall. The word closes it; so do Escape, opening the cheat sheet and opening the Teacher's window. |
| A space | A tab that fills the space's page under its tabs. |

In a lesson, report the page's height:

1. Leave `html` and `body` at the height of their content. `height: 100%` measures the window, not the page, and never grows.
2. After `initialized`, watch `document.documentElement` with a `ResizeObserver`.
3. Each time it fires, send the notification `ui/notifications/size-changed` with `{ width, height }` in px, `height` from `document.documentElement.getBoundingClientRect()`. godspeed takes the height and keeps the width at 360.

Without it the page stays 120 px tall and scrolls. In a space's tab the message does nothing.

## Trying a plugin

1. Open Settings, then Plugins.
2. Click Add. When the list has plugins you haven't added, a sheet shows them with Add beside each, and the last row, From a folder, has Choose. Otherwise Add opens the folder chooser itself (desktop app only). godspeed copies the folder. A red message says what is wrong, for example `manifest.json: id must be lowercase letters, digits and dashes, like meme-cards`.
3. The new plugin is picked in the list; its sheet shows the switch, its settings, Show folder and Remove. A plugin that is off shows nowhere, its files are not served, and `ask_agent` is refused.
4. Open it. A lesson plugin is a word in the top bar, left of the cheat sheet: click opens the page in a window over the lesson, click again closes. A space plugin is a tab after the space's own tabs, in a real space only.
5. After changing a file, click Add (then Choose if the sheet shows) and pick the same folder again. godspeed replaces the copy and keeps stored JSON and settings. Open the page again.

A plugin added from the list shows Update beside Remove when the list moves its entry to another tag. Update installs that tag and keeps the switch, settings and stored JSON. Nothing updates by itself; a plugin added from a folder never shows Update.

A plugin whose folder can no longer load stays in the list with its error and Remove.

The frame shows "<name> didn't load." with Try again when the handshake did not finish within 10 seconds, or the page navigated away from its entry page (a link, a form or `location` change). To see why, open View, Toggle Developer Tools. They exist only in a debug build or one made with the `devtools` feature, not in a released app. The console shows script errors and blocked requests.

Every file is served with a policy limiting the page. If a request is blocked, check:

| Policy | Effect |
|---|---|
| Scripts and styles | Only from your folder, plus inline ones. No `eval`. |
| Images, fonts, audio and video | Your folder, `data:` and `blob:`, and the `network` hosts. Fonts also from the app's font files that `hostContext.styles.css.fonts` names. |
| `fetch` and other requests | Only the `network` hosts, over https. With none, no requests at all. |
| Frames, forms and a changed base address | Not allowed. |

## Limits

Field lengths are in [the manifest](#the-manifest), tool limits in [Host tools](#host-tools), the 10 second handshake under [Trying a plugin](#trying-a-plugin).

| Limit | Value |
|---|---|
| `manifest.json` | 64 KB |
| Files in a plugin | 1000 |
| A plugin's size | 20 MB |
| Names in the folder | Hidden files and folders (leading dot) left out. A link is refused. Nothing may be named `data` (the plugin's storage). |

## Getting listed

The reviewed list is `plugins.json` in <https://github.com/bayshores/godspeed-plugins>. Settings, Plugins reads it each time the tab opens and shows its plugins under Add, so a new plugin or tag shows without a restart. When it can't be read, the last list read since startup shows.

Each entry names a GitHub repository and one tag, and godspeed downloads exactly that tag. A plugin changes for a learner only when its entry moves to another tag and the learner clicks Update. The code at that tag is read before the listing pull request is merged. Two ways in:

1. Your own repository. Tag a version, then open a pull request that adds your entry to `plugins.json`. `manifest.json` sits at the top of your repository.
2. A folder in the list repository. Open a pull request adding your plugin as a folder of godspeed-plugins next to `plugins.json`, and its entry with `path` set to that folder. The folder gets a tag of the list repository when merged.

An entry is the repository, the tag, `path` for a plugin in a folder, and these fields copied as they are from `manifest.json` at that tag: `id`, `name`, `description`, `lesson` and `space` (whichever it has), `uses` and `network`. The Add sheet shows the name, description, where the plugin shows and what it uses before any download.

```json
{
	"version": 1,
	"plugins": [
		{
			"repo": "808arc/meme-plugin",
			"tag": "v0.2.0",
			"id": "memes",
			"name": "Memes",
			"description": "Turns the question into a meme.",
			"lesson": { "label": "Memes" },
			"uses": ["agent"],
			"network": ["api.memegen.link"]
		},
		{
			"repo": "bayshores/godspeed-plugins",
			"tag": "word-count-v1.0.0",
			"path": "word-count",
			"id": "word-count",
			"name": "Word count",
			"description": "Counts the words in your last answer.",
			"lesson": { "label": "Words" },
			"uses": [],
			"network": []
		}
	]
}
```

| Rule | Value |
|---|---|
| `repo` | `owner/name`, as on GitHub. |
| `tag` | One tag of letters, digits, `.`, `_`, `+` and `-`, like `v0.2.0`. |
| `path` | Optional. One top-level folder: 1 to 64 lowercase letters, digits and `-`, no `/` or `.`. Only that folder is taken from the tag; the tag is refused when the folder or its `manifest.json` is missing. Without it, the whole repository is the plugin. |
| The tag's zip | A single wrapping folder (as GitHub's zips have) is removed, and hidden files such as `.github` are left out. A name landing outside the plugin's folder refuses the whole tag. |
| The copied fields | Checked by the manifest's rules above. |
| The manifest at the tag | Its `id`, `uses`, `network`, `lesson` and `space` must equal the entry's, else the add or update is refused and nothing is kept, so a tag can't ask for more than was reviewed or show elsewhere. |
| The list | An entry that breaks a rule is left out; of two with one id the first is kept. A list that isn't JSON, has a `version` other than 1 or is over 256 KB reads as empty. |
