/**
 * The writing box's calculator: a moment after the learner types a
 * calculation ending in "=" (or "solve" and an equation), its answer shows
 * in grey after it. Tab or a click keeps it; Esc or typing on drops it.
 * Inside a math piece being edited the same happens in the MathLive field.
 * The finding is in shared/core/calculator.ts, the working out in a worker.
 */
import { Prec, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type ViewUpdate } from "@codemirror/view";
import katex from "katex";
import type { MathfieldElement } from "mathlive";
import { answerEdit, findCalculation, pieceCalculation, type CalcAnswer, type Calculation } from "@/shared/core";
import { workOut } from "@/frontend/lib/calculator-client";

/** The pause after typing before the answer is worked out. */
const DELAY_MS = 120;

type Ghost = { calc: Calculation; answer: CalcAnswer } | null;

const setGhost = StateEffect.define<Ghost>();

const ghostField = StateField.define<Ghost>({
	create: () => null,
	update(ghost, tr) {
		for (const e of tr.effects) if (e.is(setGhost)) return e.value;
		return tr.docChanged || tr.selection ? null : ghost;
	},
	provide: (field) =>
		EditorView.decorations.from(field, (ghost) =>
			ghost
				? Decoration.set([
						// After the piece when the answer joins one (the piece is drawn whole).
						Decoration.widget({ widget: new GhostWidget(ghost), side: 1 }).range(ghost.calc.inPiece ? ghost.calc.at + 1 : ghost.calc.at),
					])
				: Decoration.none,
		),
});

/** The answer in grey; a press keeps it. */
function ghostElement(answer: CalcAnswer, solve: boolean, keep: () => void): HTMLElement {
	const el = document.createElement("span");
	el.className = "cm-calc-ghost";
	el.title = "Keep the answer";
	el.innerHTML = katex.renderToString(`${solve ? "\\to " : ""}${answer.latex}`, { throwOnError: false, strict: "ignore", output: "html" });
	el.addEventListener("mousedown", (e) => {
		e.preventDefault();
		keep();
	});
	return el;
}

class GhostWidget extends WidgetType {
	constructor(readonly ghost: NonNullable<Ghost>) {
		super();
	}
	eq(other: GhostWidget) {
		return other.ghost.answer.latex === this.ghost.answer.latex && other.ghost.calc.at === this.ghost.calc.at;
	}
	toDOM(view: EditorView) {
		return ghostElement(this.ghost.answer, this.ghost.calc.kind === "solve", () => keepAnswer(view));
	}
}

/** Puts the shown answer into the text, the caret after it. */
function keepAnswer(view: EditorView): boolean {
	const ghost = view.state.field(ghostField);
	if (!ghost) return false;
	const { from, insert } = answerEdit(view.state.doc.toString(), ghost.calc, ghost.answer);
	view.dispatch({
		changes: { from, insert },
		selection: { anchor: from + insert.length + (ghost.calc.inPiece ? 1 : 0) },
		effects: setGhost.of(null),
		userEvent: "input.complete",
	});
	view.focus();
	return true;
}

function dropAnswer(view: EditorView): boolean {
	if (!view.state.field(ghostField)) return false;
	view.dispatch({ effects: setGhost.of(null) });
	return true;
}

/** The box's calculator. isEditing: a math piece is open in MathLive
 *  (its field has a calculator of its own, fieldCalculator). */
export function calculator(isEditing: (state: EditorState) => boolean): Extension {
	const asker = ViewPlugin.fromClass(
		class {
			timer = 0;
			version = 0;
			constructor(readonly view: EditorView) {}
			update(u: ViewUpdate) {
				if (!u.docChanged && !u.selectionSet) return;
				clearTimeout(this.timer);
				const version = ++this.version;
				this.timer = window.setTimeout(() => this.ask(version), DELAY_MS);
			}
			ask(version: number) {
				const { state } = this.view;
				const caret = state.selection.main;
				if (!this.view.hasFocus || !caret.empty || isEditing(state)) return;
				const calc = findCalculation(state.doc.toString(), caret.head);
				if (!calc) return;
				void workOut(calc).then((answer) => {
					if (answer && version === this.version) this.view.dispatch({ effects: setGhost.of({ calc, answer }) });
				});
			}
			destroy() {
				clearTimeout(this.timer);
				this.version++;
			}
		},
	);
	return [
		ghostField,
		asker,
		Prec.highest(
			keymap.of([
				{ key: "Tab", run: keepAnswer },
				{ key: "Escape", run: dropAnswer },
			]),
		),
		EditorView.baseTheme({
			".cm-calc-ghost": { color: "var(--lh-ink-3)", cursor: "pointer", paddingLeft: "0.5ch" },
			".cm-calc-ghost:hover": { color: "var(--muted-foreground)" },
			".cm-calc-ghost .katex": { fontSize: "1.1em" },
		}),
	];
}

/** The calculator inside a math piece being edited: the answer shows after
 *  the field, and Tab or a click puts it into the field. */
export function fieldCalculator(view: EditorView, field: MathfieldElement, host: HTMLElement, pieceFrom: number): void {
	let shown: { el: HTMLElement; latex: string } | null = null;
	let version = 0;
	let timer = 0;
	const drop = () => {
		shown?.el.remove();
		shown = null;
	};
	const keep = () => {
		if (!shown) return;
		const { latex } = shown;
		drop();
		field.executeCommand(["insert", latex]);
		field.focus();
	};
	field.addEventListener("input", () => {
		drop();
		const mine = ++version;
		clearTimeout(timer);
		timer = window.setTimeout(() => {
			const calc = pieceCalculation(view.state.doc.toString(), pieceFrom, field.getValue("latex-without-placeholders"));
			if (!calc) return;
			void workOut(calc).then((answer) => {
				if (!answer || mine !== version || !host.isConnected) return;
				const el = ghostElement(answer, false, keep);
				host.append(el);
				shown = { el, latex: answer.latex };
			});
		}, DELAY_MS);
	});
	field.addEventListener(
		"keydown",
		(e) => {
			if (e.key !== "Tab" || !shown) return;
			e.preventDefault();
			e.stopPropagation();
			keep();
		},
		{ capture: true },
	);
}
