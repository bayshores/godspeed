# Talking to godspeed

What the page and godspeed say to each other, and the app's look. [README.md](README.md) says what a plugin is.

## The handshake and the page's height

`kit.mjs` in [the template](https://github.com/bayshores/godspeed-plugins/tree/main/template) does all of this. A page that does not use it sends these messages itself.

The handshake, first in every plugin:

1. Request `ui/initialize` with your app's name and version and `protocolVersion` `"2026-01-26"`. The answer holds the look and the plugin's settings (see [What godspeed sends by itself](#what-godspeed-sends-by-itself)).
2. Notification `ui/notifications/initialized` (no `id`). No answer; counts the page as loaded.
3. Only now call tools with `tools/call`. Before step 1 the error is "Send ui/initialize first."

Check `event.source === parent`; the page can't name godspeed's origin, so it posts to `"*"`.

In a lesson, tell godspeed the page's height, so its window can be as tall as the page:

1. After `initialized`, watch `document.documentElement` with a `ResizeObserver`.
2. Each time it fires, send the notification `ui/notifications/size-changed` with `{ width, height }` in px, `height` from `document.documentElement.getBoundingClientRect()`. godspeed takes the height and keeps the width at 360.

`tests/fixtures/plugins/layout/` is this handshake written out by hand, with the look and the size message and without the tool call; `npm run layout` installs it and loads it in the real window.

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

One request to the learner's agent, as a background job labelled "<name> asked for…" ([5.4](../architecture/05.4-background-jobs.md)). Nobody watches it, so its agent's own permission questions are denied. `prompt` is the request, `schema` a JSON Schema for the answer (`{}` when left out, accepts anything). The agent must answer to fit the schema; godspeed returns `{ answer }`.

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

The page gets the app's colors, fonts and corner size under MCP Apps variable names. `kit.mjs` sets them for you. Without it, set them on `:root` at start and use them in your CSS. A variable with no app value is left out.

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
