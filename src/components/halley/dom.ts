/**
 * Halley's page helpers (browser only): finding a change's element
 * (data-halley-target), the glow, the fade of a removed item, and whether
 * the learner is typing or has a dialog open.
 */
import type { AgentAction } from "@/core";
import type { Box } from "./geometry";
import { targetKey } from "./tour";

/** Glow: tone fill and a 2px white left edge, then a fade. */
const GLOW_HOLD_MS = 900;
const GLOW_FADE_MS = 600;
/** A removed item's fade after the visit. */
export const REMOVE_FADE_MS = 400;

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

/** The element Halley flies to: the first one that is in view, else the first. */
export function pickTarget(els: readonly HTMLElement[]): HTMLElement | null {
	return els.find((el) => isInView(el)) ?? els[0] ?? null;
}

/** Resolve when the target shows up (an added item renders a moment after
 *  the change), or null after `timeoutMs`. */
export async function waitForTarget(target: AgentAction["target"], timeoutMs: number, alive: () => boolean): Promise<HTMLElement[]> {
	const end = Date.now() + timeoutMs;
	for (;;) {
		const els = targetElements(target);
		if (els.length || Date.now() >= end || !alive()) return els;
		await sleep(100);
	}
}

export function boxOf(r: DOMRect | Box): Box {
	return { left: r.left, top: r.top, width: r.width, height: r.height };
}

export function viewportBox(): Box {
	return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

/** The part of the window an element can be seen in: the viewport cut by
 *  every scrolling ancestor. */
export function visibleRegion(el: HTMLElement): Box {
	let box = viewportBox();
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

/** Elements mid-glow: their own inline look and the pending restore. */
const glowing = new WeakMap<HTMLElement, { before: { transition: string; background: string; shadow: string }; timer: number }>();

/** Light an element up for a moment, then let it fade back. Inline styles
 *  only, restored afterwards, so the element's own look is untouched. A
 *  glow that starts before the last one ended restarts it and keeps the
 *  look saved by the first, never the glow itself. */
export function glow(el: HTMLElement, reduce: boolean): void {
	const s = el.style;
	const prev = glowing.get(el);
	if (prev) window.clearTimeout(prev.timer);
	const before = prev?.before ?? { transition: s.transition, background: s.backgroundColor, shadow: s.boxShadow };
	const entry = { before, timer: 0 };
	glowing.set(el, entry);
	s.transition = "none";
	s.backgroundColor = "color-mix(in srgb, var(--foreground) 14%, var(--background))";
	s.boxShadow = "inset 2px 0 0 var(--lh-ink-max)";
	entry.timer = window.setTimeout(() => {
		s.transition = reduce ? "none" : `background-color ${GLOW_FADE_MS}ms ease, box-shadow ${GLOW_FADE_MS}ms ease`;
		s.backgroundColor = before.background;
		s.boxShadow = before.shadow;
		entry.timer = window.setTimeout(() => {
			s.transition = before.transition;
			glowing.delete(el);
		}, reduce ? 0 : GLOW_FADE_MS);
	}, GLOW_HOLD_MS);
}

/** A still copy of an element, kept where it was, so a removed item can be
 *  visited and faded out after the page already dropped it. */
export interface Ghost {
	rect: Box;
	node: HTMLElement;
}

export function snapshot(el: HTMLElement): Ghost {
	const node = el.cloneNode(true) as HTMLElement;
	node.removeAttribute("id");
	node.removeAttribute("data-halley-target");
	for (const child of node.querySelectorAll("[id]")) child.removeAttribute("id");
	const r = el.getBoundingClientRect();
	const cs = getComputedStyle(el);
	node.style.backgroundColor = cs.backgroundColor === "rgba(0, 0, 0, 0)" ? "var(--background)" : cs.backgroundColor;
	node.style.color = cs.color;
	node.style.font = cs.font;
	return { rect: boxOf(r), node };
}

/** Show a ghost at its old place (fixed), for the visit. */
export function placeGhost(g: Ghost): HTMLElement {
	const n = g.node;
	Object.assign(n.style, {
		position: "fixed",
		left: `${g.rect.left}px`,
		top: `${g.rect.top}px`,
		width: `${g.rect.width}px`,
		height: `${g.rect.height}px`,
		margin: "0",
		pointerEvents: "none",
		zIndex: "39",
		boxSizing: "border-box",
	});
	n.setAttribute("aria-hidden", "true");
	document.body.appendChild(n);
	return n;
}

/** Fade an element out (a removed item after the visit). */
export function fadeOut(el: HTMLElement, reduce: boolean, then?: () => void): void {
	el.style.transition = reduce ? "none" : `opacity ${REMOVE_FADE_MS}ms ease`;
	el.style.opacity = "0";
	window.setTimeout(() => then?.(), reduce ? 0 : REMOVE_FADE_MS);
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
