/**
 * A linkedom page for the page pieces: a box 600 px wide on a screen with two pixels to the
 * point, a resize observer that never fires, and a record of what was scrolled into view.
 * Import this before any component.
 */
import { parseHTML } from "linkedom";

export const dom = parseHTML("<!doctype html><html><body></body></html>");
/** The tops of the zero-height anchors scrolled into view, in order. */
export const scrolled: string[] = [];

Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", { get: () => 600, configurable: true });
Object.assign(dom.window.HTMLElement.prototype, {
	scrollIntoView(this: HTMLElement) {
		scrolled.push(this.style.top);
	},
});
Object.assign(dom.window, { devicePixelRatio: 2, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		disconnect() {}
	},
});
