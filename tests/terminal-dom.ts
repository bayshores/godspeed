/**
 * A linkedom page that xterm can draw in, and a stand-in for the shell's
 * window.lh.terminals that records what the page asks of it. Import this
 * before any component.
 */
import { registerHooks } from "node:module";
import { parseHTML } from "linkedom";
import type { TerminalRecord } from "../src/frontend/components/terminal/terminal-model.ts";

// The bundler's view of xterm: its ES module build, and no stylesheet.
const ES_BUILDS: Record<string, string> = { "@xterm/xterm": "@xterm/xterm/lib/xterm.mjs", "@xterm/addon-web-links": "@xterm/addon-web-links/lib/addon-web-links.mjs" };
registerHooks({
	resolve: (specifier, context, next) => next(ES_BUILDS[specifier] ?? specifier, context),
	load: (url, context, next) => (url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : next(url, context)),
});

export const dom = parseHTML("<!doctype html><html><body></body></html>");
const frame = (cb: () => void) => setTimeout(cb, 0);
Object.assign(dom.document, { hasFocus: () => true });
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

type Lh = NonNullable<NonNullable<Window["lh"]>["terminals"]>;

/** What the page asked the shell for, in order ("write <data>", "answer trust", ...). */
interface FakeShell {
	calls: string[];
	/** A state push, as the shell sends one on every change. */
	push: (state: Pick<TerminalRecord, "id" | "ended" | "prompt" | "url">) => void;
	remove: () => void;
}

/** Installs window.lh with terminals that start out as `list`. */
export function fakeShell(list: TerminalRecord[] = []): FakeShell {
	const calls: string[] = [];
	const states = new Set<(s: Pick<TerminalRecord, "id" | "ended" | "prompt" | "url">) => void>();
	const call = (what: string) => {
		calls.push(what);
		return Promise.resolve();
	};
	const terminals: Lh = {
		start: (role, agent) => (calls.push(`start ${role} ${agent}`), Promise.resolve({ id: `${role}-new` })),
		attach: (id) => call(`attach ${id}`),
		detach: (id) => call(`detach ${id}`),
		write: (_id, data) => call(`write ${data}`),
		answer: (_id, kind) => call(`answer ${kind}`),
		paste: () => call("paste"),
		stop: (id) => call(`stop ${id}`),
		list: () => Promise.resolve(list),
		onOutput: () => () => {},
		onState: (cb) => {
			states.add(cb);
			return () => states.delete(cb);
		},
	};
	Object.assign(dom.window, { lh: { platform: "linux", terminals, openLink: (url: string) => call(`open ${url}`) } });
	return {
		calls,
		push: (s) => {
			for (const cb of states) cb(s);
		},
		remove: () => delete (dom.window as { lh?: unknown }).lh,
	};
}

/** A dispatched keydown, as a keyboard sends it. */
export function press(target: EventTarget, key: string, keyCode: number, ctrlKey = false): KeyboardEvent {
	const e = new dom.window.Event("keydown", { bubbles: true, cancelable: true }) as unknown as KeyboardEvent;
	for (const [name, value] of Object.entries({ key, keyCode, which: keyCode, ctrlKey, metaKey: false, altKey: false, shiftKey: false })) Object.defineProperty(e, name, { value });
	target.dispatchEvent(e);
	return e;
}
