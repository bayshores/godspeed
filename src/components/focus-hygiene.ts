/**
 * FOCUS HYGIENE — transient transcript controls don't keep focus, the
 * focus ring shows only after Tab (showFocusRingAfterTab), and Tab stays
 * inside an open modal dialog (trapTabInDialog, below).
 *
 * Transient controls: a
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

/** Turns the keyboard focus ring on at Tab and off at the next pointer
 *  press (globals.css draws it under html[data-tab-focus]). :focus-visible
 *  alone isn't enough: Chromium also lights it on a clicked control once
 *  any key is pressed. Returns the cleanup. */
export function showFocusRingAfterTab(doc: Document): () => void {
	const root = doc.documentElement;
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Tab") root.setAttribute("data-tab-focus", "");
	};
	const onPointer = () => root.removeAttribute("data-tab-focus");
	doc.addEventListener("keydown", onKey, true);
	doc.addEventListener("pointerdown", onPointer, true);
	return () => {
		doc.removeEventListener("keydown", onKey, true);
		doc.removeEventListener("pointerdown", onPointer, true);
		root.removeAttribute("data-tab-focus");
	};
}

/** What Tab can reach inside a dialog. */
const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Where Tab sends focus inside a modal dialog. Null lets the browser move
 *  it as usual; an element is where it wraps to: past the last control
 *  back to the first (Shift+Tab the other way), and from outside the
 *  dialog onto its edge. Pure — exported for tests. */
export function dialogTabTarget<T>(controls: readonly T[], active: T | null, inside: boolean, back: boolean): T | null {
	const first = controls[0];
	const last = controls[controls.length - 1];
	if (first === undefined || last === undefined) return null;
	if (!inside) return back ? last : first;
	if (!back && active === last) return first;
	if (back && active === first) return last;
	return null;
}

/** Keeps Tab inside the topmost open modal dialog (any element with
 *  aria-modal="true" outside an inert, closing layer). Run it in the
 *  capture phase so no surface's own Tab handling sees a wrapped key. */
export function trapTabInDialog(e: KeyboardEvent): void {
	if (e.key !== "Tab" || e.metaKey || e.ctrlKey || e.altKey) return;
	const dialog = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].filter((d) => !d.closest("[inert]")).at(-1);
	if (!dialog) return;
	// A control with no box (display: none) can't take focus.
	const controls = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[inert]") && el.getClientRects().length > 0);
	const active = document.activeElement as HTMLElement | null;
	const inside = !!active && dialog.contains(active);
	const target = controls.length === 0 ? dialog : dialogTabTarget(controls, active, inside, e.shiftKey);
	if (!target) return;
	e.preventDefault();
	e.stopPropagation();
	if (target !== dialog) target.focus();
}
