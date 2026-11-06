/**
 * The CodeMirror editor behind the code question. Loaded with import() by
 * code-editor.tsx, so CodeMirror stays out of every page's startup JS.
 */
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, drawSelection, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from "@codemirror/commands";
import { HighlightStyle, bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { cpp } from "@codemirror/lang-cpp";
import { tags as t } from "@lezer/highlight";
import { getCM, vim } from "@replit/codemirror-vim";
import { highlightsAsCpp, vimModeLabel } from "./code-editor-model";

const INDENT = "    ";

/** Tab types four spaces at the cursor; with a selection it indents the
 *  lines. Shift+Tab outdents. */
const tabKeys = keymap.of([
	{
		key: "Tab",
		run: (view) => {
			if (view.state.selection.ranges.some((r) => !r.empty)) return indentMore(view);
			view.dispatch(view.state.update(view.state.replaceSelection(INDENT), { scrollIntoView: true, userEvent: "input" }));
			return true;
		},
		shift: indentLess,
	},
]);

/** The same colors as the app's code blocks (Shiki's github-dark). */
const highlight = HighlightStyle.define([
	{ tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.modifier, t.processingInstruction], color: "#ff7b72" },
	{ tag: [t.string, t.character, t.special(t.string)], color: "#a5d6ff" },
	{ tag: [t.number, t.bool, t.null, t.atom, t.constant(t.name)], color: "#79c0ff" },
	{ tag: [t.typeName, t.standard(t.typeName)], color: "#ffa657" },
	{ tag: [t.function(t.variableName), t.function(t.definition(t.variableName)), t.macroName], color: "#d2a8ff" },
	{ tag: [t.comment, t.lineComment, t.blockComment], color: "#8b949e" },
]);

/** The app's black field: its surface, ink and mono tokens, square edges. */
const theme = EditorView.theme(
	{
		"&": { backgroundColor: "var(--background)", color: "var(--foreground)", fontSize: "13.5px", maxHeight: "360px" },
		"&.cm-focused": { outline: "none" },
		".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6", minHeight: "200px" },
		".cm-content": { caretColor: "var(--lh-ink-max)", padding: "10px 0" },
		".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--lh-ink-max)" },
		".cm-gutters": { backgroundColor: "var(--background)", color: "var(--lh-ink-3)", border: "none" },
		".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 14px" },
		".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
			backgroundColor: "var(--border)",
		},
		".cm-matchingBracket": { backgroundColor: "var(--border)", outline: "none" },
		// Vim's block cursor: ink with the letter in the page color.
		"& .cm-vimCursorLayer .cm-fat-cursor": { background: "var(--lh-ink-max)", color: "var(--background) !important" },
		"&:not(.cm-focused) .cm-vimCursorLayer .cm-fat-cursor": { background: "none", outline: "solid 1px var(--lh-ink-3)" },
		".cm-panels": { backgroundColor: "var(--card)", color: "var(--foreground)" },
		".cm-panels-bottom": { borderTop: "1px solid var(--border)" },
		".cm-vim-panel": { fontFamily: "var(--font-mono)" },
	},
	{ dark: true },
);

export interface CodeEditorHandle {
	setVim(on: boolean): void;
	destroy(): void;
}

export function mountCodeEditor(
	parent: HTMLElement,
	opts: {
		doc: string;
		language: string;
		vim: boolean;
		onChange: (code: string) => void;
		onVimMode: (label: string) => void;
	},
): CodeEditorHandle {
	const vimSlot = new Compartment();
	const view = new EditorView({
		parent,
		state: EditorState.create({
			doc: opts.doc,
			extensions: [
				// Vim goes first so its keys win over the default keymap.
				vimSlot.of(opts.vim ? vim() : []),
				lineNumbers(),
				history(),
				drawSelection(),
				indentOnInput(),
				bracketMatching(),
				indentUnit.of(INDENT),
				EditorState.tabSize.of(4),
				tabKeys,
				keymap.of([...defaultKeymap, ...historyKeymap]),
				highlightsAsCpp(opts.language) ? cpp() : [],
				syntaxHighlighting(highlight),
				theme,
				EditorView.contentAttributes.of({ "aria-label": "Your code", spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
				EditorView.updateListener.of((u) => {
					if (u.docChanged) opts.onChange(u.state.doc.toString());
				}),
			],
		}),
	});
	// Each Vim start makes a new Vim instance: listen to the new one.
	const watchMode = () => {
		getCM(view)?.on("vim-mode-change", (e: { mode: string }) => opts.onVimMode(vimModeLabel(e.mode)));
		opts.onVimMode("NORMAL");
	};
	if (opts.vim) watchMode();
	return {
		setVim(on) {
			view.dispatch({ effects: vimSlot.reconfigure(on ? vim() : []) });
			if (on) watchMode();
			view.focus();
		},
		destroy: () => view.destroy(),
	};
}
