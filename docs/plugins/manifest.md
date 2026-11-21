# The manifest

The fields of a plugin's `manifest.json`. [README.md](README.md) says what a plugin is.

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
