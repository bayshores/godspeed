# Writing a plugin

How to write a godspeed plugin. [architecture/08.2-plugins.md](../architecture/08.2-plugins.md#82-plugins) says how the app hosts one.

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

Folder `hello/` with four files: the three below and `kit.mjs`, which is copied from [the template](https://github.com/bayshores/godspeed-plugins/tree/main/template) unchanged. `kit.mjs` does the handshake with godspeed, sets its colors and fonts on the page and reports the page's height. The page shows in lessons and prints the lesson's title.

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
				font-family: var(--font-sans);
			}
		</style>
	</head>
	<body>
		<p id="out">Waiting for godspeed.</p>
		<script type="module" src="app.js"></script>
	</body>
</html>
```

`app.js`

```js
import { callTool, connect, whenContextChanges } from "./kit.mjs";

const out = document.getElementById("out");
const say = (text) => (out.textContent = text);

const show = () =>
	callTool("get_context")
		.then((context) => say(context.topic ?? "No lesson is open."))
		.catch((error) => say(error.message));

connect({ name: "hello", version: "1.0.0" })
	.then(() => {
		whenContextChanges(show);
		return show();
	})
	.catch((error) => say(error.message));
```

| `kit.mjs` call | What it does |
|---|---|
| `connect({ name, version })` | Does the handshake first. Resolves with the host context: the plugin's settings, the theme. |
| `callTool(name, args)` | Calls a host tool and resolves with its result. Fails with godspeed's reason, or after a minute without an answer. |
| `whenContextChanges(fn)` | Runs `fn` when what `get_context` gives has changed. |

The manifest has only required fields, the shape of the `bare` case in `crates/services/src/plugins/manifest.rs`. The tools are in [host-tools.md](host-tools.md#host-tools), the manifest's fields in [manifest.md](manifest.md).

## Where the page shows

No title of its own; godspeed shows the label.

| Place | The page's box |
|---|---|
| A lesson | A window hanging from the top bar under the plugin's word, right edges aligned, and clear of the strip. 360 px wide, as tall as the page says, from 48 px up to the room under the top bar less 16 px; a taller page scrolls inside. Before the page says, 120 px tall. The word closes it; so do Escape, opening the cheat sheet and opening the Teacher's window. |
| A space | A tab that fills the space's page under its tabs. |

In a lesson, the page reports its height so the window can fit it; `kit.mjs` does that. Leave `html` and `body` at the height of their content: `height: 100%` measures the window, not the page, and never grows. Without a report the page stays 120 px tall and scrolls. In a space's tab the report does nothing. To send it yourself, see [The handshake and the page's height](host-tools.md#the-handshake-and-the-pages-height).

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

Field lengths are in [the manifest](manifest.md), tool limits in [Host tools](host-tools.md#host-tools), the 10 second handshake under [Trying a plugin](#trying-a-plugin).

| Limit | Value |
|---|---|
| `manifest.json` | 64 KB |
| Files in a plugin | 1000 |
| A plugin's size | 20 MB |
| Names in the folder | Hidden files and folders (leading dot) left out. A link is refused. Nothing may be named `data` (the plugin's storage). |

## The files in this folder

| File | Read when |
|---|---|
| [manifest.md](manifest.md) | You write or change `manifest.json`. |
| [host-tools.md](host-tools.md) | Your page reads the lesson, keeps data, asks the agent or follows the app's look, or sends the messages itself instead of using `kit.mjs`. |
| [getting-listed.md](getting-listed.md) | You want the plugin on the list in Settings, Plugins. |
