/**
 * A linkedom page for the page pieces: a box 600 px wide on a screen with two pixels to the
 * point, and a resize observer that never fires.
 * Import this before any component.
 */
import { parseHTML } from "linkedom";

export const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", { get: () => 600, configurable: true });
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
