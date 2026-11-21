# Getting listed

How a plugin gets on the list Settings, Plugins shows. [README.md](README.md) says what a plugin is.

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
| The copied fields | Checked by [the manifest's rules](manifest.md). |
| The manifest at the tag | Its `id`, `uses`, `network`, `lesson` and `space` must equal the entry's, else the add or update is refused and nothing is kept, so a tag can't ask for more than was reviewed or show elsewhere. |
| The list | An entry that breaks a rule is left out; of two with one id the first is kept. A list that isn't JSON, has a `version` other than 1 or is over 256 KB reads as empty. |
