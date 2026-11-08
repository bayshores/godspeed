/**
 * Follow's page helpers (browser only): finding a change's element
 * (data-halley-target), lighting it up, and whether a dialog is open.
 */
import type { AgentAction } from "@/shared/core";
import { targetKey } from "./tour";

/** How long a changed item stays lit. */
const HIGHLIGHT_MS = 900;

interface Box {
	left: number;
	top: number;
	width: number;
	height: number;
}

function shown(el: HTMLElement): boolean {
	if (el.closest("[aria-hidden='true']")) return false;
	const r = el.getBoundingClientRect();
	return r.width > 0 && r.height > 0;
}

/** Every shown element tagged for a target, the main area's first. */
export function targetElements(target: AgentAction["target"]): HTMLElement[] {
	if (!target || typeof document === "undefined") return [];
	const key = CSS.escape(targetKey(target));
	const all = [...document.querySelectorAll<HTMLElement>(`[data-halley-target="${key}"]`)].filter(shown);
	const inMain = (el: HTMLElement) => (el.closest("main") ? 0 : 1);
	return all.sort((a, b) => inMain(a) - inMain(b));
}

/** The element to show: the first one that is in view, else the first. */
export function pickTarget(els: readonly HTMLElement[]): HTMLElement | null {
	return els.find((el) => isInView(el)) ?? els[0] ?? null;
}

/** Resolve when the target shows up (an added item renders a moment after
 *  the change), or empty after `timeoutMs`. */
export async function waitForTarget(target: AgentAction["target"], timeoutMs: number, alive: () => boolean): Promise<HTMLElement[]> {
	const end = Date.now() + timeoutMs;
	for (;;) {
		const els = targetElements(target);
		if (els.length || Date.now() >= end || !alive()) return els;
		await sleep(100);
	}
}

/** The part of the window an element can be seen in: the viewport cut by
 *  every scrolling ancestor. */
function visibleRegion(el: HTMLElement): Box {
	let box: Box = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
	for (let p = el.parentElement; p; p = p.parentElement) {
		const style = getComputedStyle(p);
		if (!/(auto|scroll|hidden)/.test(style.overflow + style.overflowY + style.overflowX)) continue;
		const r = p.getBoundingClientRect();
		const left = Math.max(box.left, r.left);
		const top = Math.max(box.top, r.top);
		const right = Math.min(box.left + box.width, r.right);
		const bottom = Math.min(box.top + box.height, r.bottom);
		box = { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
	}
	return box;
}

export function isInView(el: HTMLElement): boolean {
	const r = el.getBoundingClientRect();
	const region = visibleRegion(el);
	const cx = r.left + r.width / 2;
	const cy = r.top + r.height / 2;
	return cx >= region.left && cx <= region.left + region.width && cy >= region.top && cy <= region.top + region.height;
}

/** Elements lit right now: their own inline look and the pending restore. */
const lit = new WeakMap<HTMLElement, { before: { background: string; shadow: string }; timer: number }>();

/** Light an element up for a moment, like a selected row: the accent's
 *  tint and a 2px accent edge, on and off in one step. Inline styles only,
 *  restored afterwards. Lighting it again restarts the moment and keeps the
 *  look saved the first time. */
export function highlight(el: HTMLElement): void {
	const s = el.style;
	const prev = lit.get(el);
	if (prev) window.clearTimeout(prev.timer);
	const before = prev?.before ?? { background: s.backgroundColor, shadow: s.boxShadow };
	s.backgroundColor = "color-mix(in srgb, var(--lh-tint) 16%, var(--background))";
	s.boxShadow = "inset 2px 0 0 var(--lh-tint)";
	const timer = window.setTimeout(() => {
		s.backgroundColor = before.background;
		s.boxShadow = before.shadow;
		lit.delete(el);
	}, HIGHLIGHT_MS);
	lit.set(el, { before, timer });
}

/** A dialog is open. (Typing is noted from input events instead: a text
 *  box that only holds the cursor must not hold Follow back.) */
export function dialogOpen(): boolean {
	if (typeof document === "undefined") return false;
	return !!document.querySelector("[role='dialog'], [role='alertdialog']");
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
