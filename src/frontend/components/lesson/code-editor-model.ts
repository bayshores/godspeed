/** The code editor's Vim switch. Pure. */

/** localStorage key (Vim is remembered across lessons and restarts). */
export const VIM_KEY = "lh:code-vim";

/** The stored Vim choice ("1" = on). Off by default. */
export function parseVim(raw: string | null): boolean {
	return raw === "1";
}

/** The label beside the switch for a Vim mode change ("normal",
 *  "insert", "visual", "replace"). */
export function vimModeLabel(mode: string): string {
	return mode === "insert" || mode === "visual" || mode === "replace" ? mode.toUpperCase() : "NORMAL";
}

/** Highlighted languages; any other language is plain text. */
export function highlightsAsCpp(language: string): boolean {
	return language === "c" || language === "cpp";
}

/** The language's name over the editor. */
export function languageLabel(language: string): string {
	return language === "c" ? "C" : language === "cpp" ? "C++" : language;
}
