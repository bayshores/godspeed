/**
 * The Streamdown code-highlighting plugin, loaded only when the first code
 * block renders. @streamdown/code imports shiki at its top level, so a
 * plain import puts shiki in every lesson's startup JS. This stand-in has
 * the same shape: the first highlight() starts the dynamic import() (the
 * library lazy-load Next documents), returns null ("not ready", which
 * Streamdown already handles by showing the plain code), and hands the
 * tokens to the callback once shiki is ready.
 */
import type { CodeHighlighterPlugin, HighlightOptions, HighlightResult } from "@streamdown/code";

// @streamdown/code's own default themes — getThemes must answer before
// shiki has loaded, and must match what the real plugin would say.
const THEMES: ReturnType<CodeHighlighterPlugin["getThemes"]> = ["github-light", "github-dark"];

let loaded: CodeHighlighterPlugin | null = null;
let loading: Promise<CodeHighlighterPlugin> | null = null;

function load(): Promise<CodeHighlighterPlugin> {
	if (!loading) {
		loading = import("@streamdown/code").then((m) => (loaded = m.code));
		// A failed chunk fetch may retry on the next code block.
		loading.catch(() => {
			loading = null;
		});
	}
	return loading;
}

export const lazyCodePlugin: CodeHighlighterPlugin = {
	name: "shiki",
	type: "code-highlighter",
	getThemes: () => THEMES,
	getSupportedLanguages: () => loaded?.getSupportedLanguages() ?? [],
	supportsLanguage: (language) => loaded?.supportsLanguage(language) ?? false,
	highlight(options: HighlightOptions, callback?: (result: HighlightResult) => void) {
		if (loaded) return loaded.highlight(options, callback);
		load()
			.then((plugin) => {
				const result = plugin.highlight(options, callback);
				// Already cached by an earlier block: the plugin returns it
				// directly instead of calling back, so pass it on here.
				if (result) callback?.(result);
			})
			.catch(() => {
				/* shiki failed to load: the block stays plain text */
			});
		return null;
	},
};
