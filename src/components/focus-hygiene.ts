/**
 * FOCUS HYGIENE — transient transcript controls don't keep focus. A
 * pointer click on a thinking toggle, a copy button or a plan chip would
 * leave focus on that button, and the learner's next Enter would
 * re-activate it instead of submitting (enter-submits.ts is the other
 * half). After pointer activation focus falls back to the body: Enter
 * submits, arrows cycle the question rows, nothing re-toggles.
 * Deliberately NOT a focus-into-a-text-field: a focused field would own
 * the arrows as caret moves.
 *
 * Keyboard-activated clicks are untouched: e.detail === 0 marks the
 * synthesized click of Enter/Space on a keyboard-focused button — the
 * keyboard user keeps their focus.
 */

/** Attach as (or compose into) a transient control's onClick: blurs the
 *  control after POINTER clicks (keyboard clicks keep focus). Node-safe
 *  duck-typing — no HTMLElement global needed (the test harness runs
 *  bare node with linkedom). */
export function blurAfterPointerClick(e: {
	detail: number;
	currentTarget: EventTarget | null;
}): void {
	if (e.detail === 0) return;
	const el = e.currentTarget as { blur?: unknown } | null;
	if (el && typeof el.blur === "function") (el.blur as () => void).call(el);
}
