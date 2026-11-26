/**
 * A linkedom page for the teacher's panel and the setup card, and a stand-in for the shell's
 * window.lh.chatWindow that records what the page asks of it. Import this before any component.
 */
import { parseHTML } from "linkedom";

export const dom = parseHTML("<!doctype html><html><body></body></html>");
const frame = (cb: () => void) => setTimeout(cb, 0);
Object.assign(dom.document, { hasFocus: () => true });
// linkedom lays nothing out: a box has no room until a test gives it some.
for (const side of ["clientWidth", "clientHeight"]) Object.defineProperty(dom.window.HTMLElement.prototype, side, { get: () => 0, configurable: true });
Object.assign(dom.window, {
	matchMedia: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
	requestAnimationFrame: frame,
	cancelAnimationFrame: clearTimeout,
});
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
	requestAnimationFrame: frame,
	cancelAnimationFrame: clearTimeout,
	ResizeObserver: class {
		observe() {}
		disconnect() {}
	},
	getComputedStyle: () => ({ getPropertyValue: (name: string) => (name === "--lh-bar" ? "#24231f" : name.startsWith("--lh") || name === "--border" ? "#d7d5cb" : "") }),
	fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ folder: "/home/ada/godspeed", short: "~/godspeed" }) }),
});

/** What the page asked the shell's chat window for, in order ("window open <title>", "window close", "window focus"). */
interface FakeShell {
	calls: string[];
	/** The shell telling the main page whether the chat's window is open. */
	windowOpen: (open: boolean, back?: boolean) => void;
	remove: () => void;
}

/** Installs window.lh with the chat window's calls. */
export function fakeShell(): FakeShell {
	const calls: string[] = [];
	const call = (what: string) => {
		calls.push(what);
		return Promise.resolve();
	};
	const changes = new Set<(state: { open: boolean; back?: boolean }) => void>();
	const chatWindow = {
		open: (title: string) => call(`window open ${title}`),
		close: () => call("window close"),
		focus: () => call("window focus"),
		onChange: (cb: (state: { open: boolean; back?: boolean }) => void) => {
			changes.add(cb);
			return () => changes.delete(cb);
		},
	};
	Object.assign(dom.window, { lh: { platform: "linux", chatWindow } });
	return {
		calls,
		windowOpen: (open, back) => {
			for (const cb of changes) cb({ open, ...(back && { back }) });
		},
		remove: () => delete (dom.window as { lh?: unknown }).lh,
	};
}
