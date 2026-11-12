/**
 * The CodeMirror editor behind the writing boxes. Loaded with import() by
 * math-box.tsx, so CodeMirror stays out of every page's startup JS.
 *
 * The document is the plain text with $...$ LaTeX. Each $...$ piece shows
 * as KaTeX; clicking one swaps in a MathLive field (loaded on first use)
 * to edit it, and leaving the field writes its LaTeX back.
 */
import { Annotation, Compartment, EditorState, Prec, StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, placeholder, tooltips, type DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, insertNewline } from "@codemirror/commands";
import { autocompletion, closeCompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import katex from "katex";
import type { MathfieldElement } from "mathlive";
import { formatBeforeBreak, hasSlots, isMathBreak, mathSpans, suggestMath, symbolSwap } from "@/shared/core";
import { calculator, fieldCalculator } from "./math-box-calculator";

/** The math piece being edited, by its range in the document. */
type Editing = { from: number; to: number } | null;

const setEditing = StateEffect.define<Editing>();

/** Marks a text set from outside, which isn't echoed back as a change. */
const fromOutside = Annotation.define<boolean>();

const editingField = StateField.define<Editing>({
	create: () => null,
	update(value, tr) {
		for (const e of tr.effects) if (e.is(setEditing)) return e.value;
		if (value && tr.docChanged) return { from: tr.changes.mapPos(value.from, 1), to: tr.changes.mapPos(value.to, -1) };
		return value;
	},
});

let mathLive: Promise<typeof MathfieldElement> | null = null;

/** MathLive, set up once: no sounds of its own (the app has a mute
 *  switch), no font downloads (the page already has KaTeX's fonts). */
function loadMathLive(): Promise<typeof MathfieldElement> {
	mathLive ??= import("mathlive").then(({ MathfieldElement }) => {
		MathfieldElement.soundsDirectory = null;
		MathfieldElement.fontsDirectory = null;
		MathfieldElement.keypressSound = null;
		MathfieldElement.plonkSound = null;
		return MathfieldElement;
	});
	return mathLive;
}

/** KaTeX of a piece; an empty slot shows as a box. */
function renderMath(latex: string): string {
	return katex.renderToString(latex.replaceAll("\\placeholder{}", "\\square"), { throwOnError: false, strict: "ignore", output: "html" });
}

/** Ends the edit: the field's LaTeX goes back into the text (an empty
 *  field removes the piece) and the caret lands before or after it. */
function finishEdit(view: EditorView, latex: string, caret: "before" | "after"): void {
	const editing = view.state.field(editingField);
	if (!editing) return;
	const insert = latex.trim() ? `$${latex.trim()}$` : "";
	view.dispatch({
		changes: { from: editing.from, to: editing.to, insert },
		selection: { anchor: caret === "before" ? editing.from : editing.from + insert.length },
		effects: setEditing.of(null),
		userEvent: "input",
	});
	view.focus();
}

/** A math piece at rest: KaTeX. A press opens it for editing. */
class MathWidget extends WidgetType {
	constructor(readonly latex: string) {
		super();
	}
	eq(other: MathWidget) {
		return other.latex === this.latex;
	}
	toDOM(view: EditorView) {
		const el = document.createElement("span");
		el.className = "cm-math";
		el.innerHTML = renderMath(this.latex);
		el.addEventListener("mousedown", (e) => {
			e.preventDefault();
			const pos = view.posAtDOM(el);
			const span = mathSpans(view.state.doc.toString()).find((s) => s.from === pos);
			if (span) view.dispatch({ effects: setEditing.of({ from: span.from, to: span.to }) });
		});
		return el;
	}
}

/** The piece being edited: a MathLive field with the caret in it, then
 *  the calculator's answer when the piece ends in "=". */
class EditWidget extends WidgetType {
	constructor(
		readonly latex: string,
		readonly from: number,
		readonly onEnter: () => boolean,
	) {
		super();
	}
	eq(other: EditWidget) {
		return other.latex === this.latex;
	}
	toDOM(view: EditorView) {
		const outer = document.createElement("span");
		const host = document.createElement("span");
		host.className = "cm-math cm-math-editing";
		host.innerHTML = renderMath(this.latex);
		outer.append(host);
		void loadMathLive().then((Field) => {
			if (!host.isConnected) return;
			const field = new Field();
			// Its options need the field on the page.
			host.replaceChildren(field);
			fieldCalculator(view, field, outer, this.from);
			field.mathVirtualKeyboardPolicy = "manual";
			field.popoverPolicy = "off";
			field.menuItems = [];
			field.value = this.latex;
			let done = false;
			const finish = (caret: "before" | "after") => {
				if (done) return;
				done = true;
				finishEdit(view, field.getValue("latex-without-placeholders"), caret);
			};
			field.addEventListener("focusout", () => finish("after"));
			field.addEventListener("move-out", (e) => {
				e.preventDefault();
				finish(e.detail.direction === "backward" ? "before" : "after");
			});
			field.addEventListener(
				"keydown",
				(e) => {
					if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
						e.preventDefault();
						finish("after");
						if (e.key === "Enter") this.onEnter();
					}
				},
				{ capture: true },
			);
			field.focus();
			if (hasSlots(this.latex)) {
				field.position = 0;
				field.executeCommand("moveToNextPlaceholder");
			}
		});
		return outer;
	}
}

function decorations(state: EditorState, onEnter: () => boolean): DecorationSet {
	const editing = state.field(editingField);
	const ranges: Range<Decoration>[] = mathSpans(state.doc.toString()).map((s) =>
		Decoration.replace({
			widget: editing?.from === s.from ? new EditWidget(s.latex, s.from, onEnter) : new MathWidget(s.latex),
		}).range(s.from, s.to),
	);
	return Decoration.set(ranges);
}

/** The math pieces as widgets; the caret steps over a piece whole. */
function mathPieces(onEnter: () => boolean) {
	return StateField.define<DecorationSet>({
		create: (state) => decorations(state, onEnter),
		update: (set, tr) => (tr.docChanged || tr.effects.some((e) => e.is(setEditing)) ? decorations(tr.state, onEnter) : set),
		provide: (field) => [EditorView.decorations.from(field), EditorView.atomicRanges.of((view) => view.state.field(field))],
	});
}

/** Puts a suggested piece in place of the typed word; one with slots
 *  opens for editing with the caret in the first slot. */
function insertSuggestion(view: EditorView, from: number, to: number, latex: string): void {
	const insert = `$${latex}$`;
	view.dispatch({
		changes: { from, to, insert },
		selection: { anchor: from + insert.length },
		effects: hasSlots(latex) ? setEditing.of({ from, to: from + insert.length }) : [],
		userEvent: "input.complete",
	});
}

function suggestions(ctx: CompletionContext): CompletionResult | null {
	if (ctx.state.field(editingField)) return null;
	const word = ctx.matchBefore(/[A-Za-z]+/);
	if (!word) return null;
	const doc = ctx.state.doc.toString();
	if (doc[word.from - 1] === "\\" || mathSpans(doc).some((s) => s.from < ctx.pos && s.to > word.from)) return null;
	const options = suggestMath(word.text).map((m) => ({
		label: m.shown,
		detail: m.name,
		apply: (view: EditorView, _c: unknown, from: number, to: number) => insertSuggestion(view, from, to, m.latex),
	}));
	return options.length ? { from: word.from, options, filter: false } : null;
}

/** Typing a break after a finished piece formats it; >=, <= and != swap. */
const typingRules = EditorView.inputHandler.of((view, from, to, text) => {
	if (from !== to || text.length !== 1 || view.state.field(editingField)) return false;
	const doc = view.state.doc.toString();
	const swap = symbolSwap(doc, from, text);
	if (swap) {
		view.dispatch({ changes: swap, selection: { anchor: swap.from + swap.insert.length }, userEvent: "input.type" });
		return true;
	}
	const piece = isMathBreak(text) ? formatBeforeBreak(doc, from) : null;
	if (!piece) return false;
	view.dispatch({
		changes: [piece, { from, insert: text }],
		selection: { anchor: piece.from + piece.insert.length + text.length },
		userEvent: "input.type",
	});
	return true;
});

/** The app's writing field: prose font, square edges, quiet list. */
const theme = EditorView.theme(
	{
		"&": { height: "100%", backgroundColor: "var(--background)", color: "var(--foreground)" },
		"&.cm-focused": { outline: "none" },
		".cm-scroller": { fontFamily: "var(--font-prose)", fontSize: "16px", lineHeight: "24px", overflow: "auto" },
		".cm-content": { padding: "12px 14px", caretColor: "var(--lh-ink-max)" },
		".cm-line": { padding: "0" },
		".cm-placeholder": { color: "var(--lh-ink-3)" },
		".cm-cursor": { borderLeftColor: "var(--lh-ink-max)" },
		".cm-math": { cursor: "pointer", padding: "0 1px" },
		// KaTeX's own 1.21em makes inline math taller than the 24px line;
		// at 1.1em a plain formula sits inside the line like a word.
		".cm-math .katex": { fontSize: "1.1em" },
		".cm-math:hover": { backgroundColor: "var(--accent)" },
		".cm-math-editing": { cursor: "text", outline: "1px solid var(--lh-ink-3)", outlineOffset: "1px" },
		"& math-field": { display: "inline-block", minWidth: "24px", padding: "0", border: "none", background: "transparent", color: "inherit", fontSize: "17.6px", lineHeight: "24px", "--caret-color": "var(--lh-ink-max)", "--selection-background-color": "var(--border)", "--contains-highlight-background-color": "transparent", "--placeholder-color": "var(--lh-ink-3)" },
		"& math-field::part(menu-toggle), & math-field::part(virtual-keyboard-toggle)": { display: "none" },
		"& math-field::part(content)": { padding: "0" },
		".cm-tooltip.cm-tooltip-autocomplete": { backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "0" },
		".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-ui)", maxHeight: "220px" },
		".cm-tooltip.cm-tooltip-autocomplete > ul > li": { display: "flex", alignItems: "baseline", gap: "12px", padding: "6px 12px", color: "var(--foreground)", cursor: "pointer" },
		".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--border)", color: "var(--foreground)" },
		".cm-completionLabel": { fontFamily: "var(--font-prose)", fontSize: "16px", minWidth: "28px" },
		".cm-completionDetail": { fontStyle: "normal", fontSize: "13px", color: "var(--lh-ink-3)", marginLeft: "0" },
	},
	{ dark: true },
);

export interface MathBoxHandle {
	focus(): void;
	setValue(text: string): void;
	/** The words in the empty box and its name, which follow what it is for. */
	setLabels(placeholderText: string, ariaLabel: string): void;
	destroy(): void;
}

const labelsOf = (placeholderText: string, ariaLabel: string) => [placeholder(placeholderText), EditorView.contentAttributes.of({ "aria-label": ariaLabel, "aria-multiline": "true" })];

export function mountMathBox(
	parent: HTMLElement,
	opts: {
		doc: string;
		placeholder: string;
		ariaLabel: string;
		/** Enter's action (send, open the check); false when Enter has none
		 *  right now, so it makes a newline. */
		onEnter: () => boolean;
		onChange: (text: string) => void;
	},
): MathBoxHandle {
	const labels = new Compartment();
	const view = new EditorView({
		parent,
		state: EditorState.create({
			doc: opts.doc,
			extensions: [
				Prec.high(
					keymap.of([
						{ key: "Enter", run: (v) => opts.onEnter() || insertNewline(v), shift: insertNewline },
						{
							key: "Mod-Enter",
							run: (v) => {
								if (!opts.onEnter()) v.contentDOM.blur();
								return true;
							},
						},
						{ key: "Escape", run: (v) => (closeCompletion(v), true) },
					]),
				),
				history(),
				keymap.of([...defaultKeymap, ...historyKeymap]),
				editingField,
				mathPieces(opts.onEnter),
				calculator((state) => state.field(editingField) !== null),
				typingRules,
				// Pasted or dropped files are attachments (the form takes them), not text.
				EditorView.domEventHandlers({
					paste: (e) => (e.clipboardData?.files.length ?? 0) > 0,
					drop: (e) => (e.dataTransfer?.files.length ?? 0) > 0,
				}),
				autocompletion({ override: [suggestions], icons: false, defaultKeymap: false }),
				// In the box the list would be clipped (the panel's rise animation
				// is a transform, which makes CodeMirror position it inside us).
				tooltips({ parent: parent.ownerDocument.body }),
				EditorView.lineWrapping,
				labels.of(labelsOf(opts.placeholder, opts.ariaLabel)),
				theme,
				EditorView.updateListener.of((u) => {
					if (u.docChanged && !u.transactions.some((tr) => tr.annotation(fromOutside))) opts.onChange(u.state.doc.toString());
				}),
			],
		}),
	});
	return {
		focus: () => view.focus(),
		setValue(text) {
			if (text === view.state.doc.toString()) return;
			view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, effects: setEditing.of(null), annotations: fromOutside.of(true) });
		},
		setLabels: (placeholderText, ariaLabel) => view.dispatch({ effects: labels.reconfigure(labelsOf(placeholderText, ariaLabel)) }),
		destroy: () => view.destroy(),
	};
}
