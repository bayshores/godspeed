import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";

const ORIGIN = "http://127.0.0.1:48061";
const SOURCE = readFileSync(new URL("../../crates/shell/src/shim.js", import.meta.url), "utf8");

type Invoked = [string, unknown?][];

interface Options {
	body?: string;
	platform?: string;
	origin?: string;
	stored?: string | null;
	reply?: (cmd: string) => unknown;
}

/** The shim on a page of `body`, with the shell's invoke recorded and its answers set by `reply`. */
function page({ body = "", platform = "darwin", origin = ORIGIN, stored = null, reply = () => undefined }: Options = {}) {
	const { document, Element, Event } = parseHTML(`<!doctype html><html><body>${body}</body></html>`);
	const invoked: Invoked = [];
	const posted: unknown[] = [];
	const pinches: { by: number; x: number; y: number }[] = [];
	const storage = new Map<string, string>();
	if (stored !== null) storage.set("lh-zoom", stored);
	const window: Record<string, unknown> = {
		innerWidth: 1000,
		innerHeight: 800,
		addEventListener: (type: string, listener: EventListener) => document.addEventListener(type, listener),
		dispatchEvent: (e: CustomEvent) => pinches.push(e.detail),
		chrome: { webview: { postMessageWithAdditionalObjects: (message: unknown, objects: unknown[]) => posted.push([message, objects]) } },
		__TAURI_INTERNALS__: {
			invoke: async (cmd: string, args?: unknown) => {
				invoked.push(args === undefined ? [cmd] : [cmd, args]);
				return reply(cmd);
			},
		},
	};
	const location = { origin, href: `${origin}/space/x` };
	const localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value) };
	const source = SOURCE.replace("__APP_ORIGIN__", JSON.stringify(ORIGIN)).replace("__PLATFORM__", JSON.stringify(platform));
	new Function("window", "document", "location", "localStorage", "Element", source)(window, document, location, localStorage, Element);
	/** Dispatches an event with these fields; true when the page called preventDefault. */
	const fire = (type: string, fields: object = {}, target: unknown = document) => {
		const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), fields);
		(target as EventTarget).dispatchEvent(event);
		return event.defaultPrevented;
	};
	const lh = window.lh as Record<string, (...args: unknown[]) => unknown> | undefined;
	return { document, window, lh, invoked, posted, storage, fire, pinches };
}

/** Gives each element on the page its box, as the browser's layout would. */
function lay(document: Document, boxes: Record<string, [number, number, number, number]>) {
	for (const [selector, [left, top, right, bottom]] of Object.entries(boxes)) {
		(document.querySelector(selector) as unknown as { getBoundingClientRect: () => object }).getBoundingClientRect = () => ({ left, top, right, bottom });
	}
}

test("every window.lh member calls its shell command with its arguments", async () => {
	const { lh, invoked } = page({ reply: (cmd) => (cmd === "get_zoom" ? 1.25 : undefined) });
	lh!.showWindow!();
	assert.equal(await lh!.getZoom!(), 1.25);
	await lh!.setZoom!(1.5);
	await lh!.pickFolder!();
	await lh!.showInFolder!("/a/b.pdf");
	await lh!.openPath!("/a");
	await lh!.openInObsidian!("/a/b.md");
	await lh!.openLink!("https://nodejs.org");
	lh!.reportBug!();
	await lh!.listFonts!();
	await lh!.printPdf!("/a/b.pdf");
	await lh!.applyAppIcon!();
	await lh!.getUpdateState!();
	await lh!.checkForUpdates!();
	lh!.installUpdate!();
	assert.deepEqual(invoked, [
		["show_window"],
		["get_zoom"],
		["set_zoom", { factor: 1.5 }],
		["pick_folder"],
		["show_in_folder", { path: "/a/b.pdf" }],
		["open_path", { path: "/a" }],
		["open_in_obsidian", { path: "/a/b.md" }],
		["open_link", { url: "https://nodejs.org" }],
		["report_bug"],
		["list_fonts"],
		["print_pdf", { path: "/a/b.pdf" }],
		["apply_app_icon"],
		["update_state"],
		["update_check"],
		["update_install"],
	]);
});

test("the chat window members call their commands and hear whether it is open", async () => {
	const { lh, invoked, window } = page();
	const chatWindow = lh!.chatWindow as unknown as Record<string, (...args: unknown[]) => unknown>;
	await chatWindow.open!("Ada");
	await chatWindow.focus!();
	await chatWindow.close!();
	assert.deepEqual(invoked, [["chat_window_open", { title: "Ada" }], ["chat_window_focus"], ["chat_window_close"]]);
	const push = window.__lhPush as (channel: string, payload: unknown) => void;
	push("chat-window", { open: true });
	const heard: unknown[] = [];
	chatWindow.onChange!((state: unknown) => heard.push(state));
	push("chat-window", { open: false });
	assert.deepEqual(heard, [{ open: true }, { open: false }], "a push before the first listener is kept for it");
});

test("only the Mac prints through the system sheet and changes its app icon", () => {
	for (const member of ["printPdf", "applyAppIcon"] as const) {
		assert.equal(typeof page({ platform: "darwin" }).lh![member], "function", member);
		assert.equal(page({ platform: "win32" }).lh![member], undefined, member);
		assert.equal(page({ platform: "linux" }).lh![member], undefined, member);
	}
});

test("a page that is not the app gets no window.lh and no listeners", () => {
	const other = page({ origin: "http://127.0.0.1:1" });
	assert.equal(other.lh, undefined);
	assert.equal(other.window.__lhPush, undefined);
	assert.equal(other.fire("contextmenu"), false);
	assert.deepEqual(other.invoked, []);
});

test("a push waits for its first subscriber, then goes to every one, until unsubscribed", () => {
	const { lh, window } = page();
	const push = window.__lhPush as (channel: string, payload: unknown) => void;
	push("open-settings", "agents");
	const first: unknown[] = [];
	const second: unknown[] = [];
	const off = lh!.onOpenSettings!((section: unknown) => first.push(section)) as () => void;
	lh!.onOpenSettings!((section: unknown) => second.push(section));
	assert.deepEqual(first, ["agents"]);
	push("open-settings", "rules");
	assert.deepEqual([first, second], [["agents", "rules"], ["rules"]]);
	off();
	push("open-settings", "files");
	assert.deepEqual([first, second], [["agents", "rules"], ["rules", "files"]]);
	const updates: unknown[] = [];
	push("update", { status: "downloading" });
	lh!.onUpdateStatus!((state: unknown) => updates.push(state));
	assert.deepEqual(updates, [{ status: "downloading" }]);
});

test("the zoom is remembered, and restored before the page draws", () => {
	const fresh = page();
	assert.deepEqual(fresh.invoked, []);
	(fresh.window.__lhPush as (channel: string, payload: unknown) => void)("zoom", 1.5);
	assert.equal(fresh.storage.get("lh-zoom"), "1.5");
	assert.deepEqual(page({ stored: "1.5" }).invoked, [["set_zoom", { factor: 1.5 }]]);
});

test("the zoom keys the menu does not claim step the zoom", () => {
	const { fire, invoked } = page();
	assert.equal(fire("keydown", { key: "+", metaKey: true }), true);
	assert.equal(fire("keydown", { key: "=", ctrlKey: true }), true);
	assert.equal(fire("keydown", { key: "-", metaKey: true }), true);
	assert.equal(fire("keydown", { key: "0", metaKey: true }), true);
	assert.equal(fire("keydown", { key: "+" }), false);
	assert.equal(fire("keydown", { key: "a", metaKey: true }), false);
	assert.deepEqual(invoked, [["zoom_step", { dir: 1 }], ["zoom_step", { dir: 1 }], ["zoom_step", { dir: -1 }], ["zoom_reset"]]);
});

/** A wheel at `at` milliseconds; a pinch is a wheel with Ctrl held. */
const wheel = (at: number, deltaY: number, keys: object = { ctrlKey: true }) => ({ timeStamp: at, deltaY, deltaMode: 0, clientX: 300, clientY: 200, ...keys });
/** How much bigger each pinch the page was sent made it, to two places. */
const sizes = (pinches: { by: number }[]) => pinches.map((p) => Math.round(p.by * 100) / 100);

test("a pinch or a scroll with the key held is sent to the page with where it is, a mouse notch a quarter at most", () => {
	const { fire, invoked, pinches } = page();
	assert.equal(fire("wheel", wheel(1000, -10)), true);
	assert.equal(fire("wheel", wheel(1010, 10)), true);
	assert.equal(fire("wheel", wheel(2000, -120, { metaKey: true })), true);
	assert.equal(fire("wheel", wheel(3000, 3, { ctrlKey: true, deltaMode: 1 })), true);
	assert.deepEqual(sizes(pinches), [1.11, 0.9, 1.25, 0.8]);
	assert.deepEqual([pinches[0]!.x, pinches[0]!.y], [300, 200]);
	assert.deepEqual(invoked, [], "the app's size stays");
});

test("a key pressed while a scroll still coasts does not magnify, and a plain scroll is left alone", () => {
	const { fire, pinches } = page();
	assert.equal(fire("wheel", wheel(1000, 40, {})), false);
	assert.equal(fire("wheel", wheel(1016, 40, { metaKey: true })), false);
	assert.equal(fire("wheel", wheel(1032, 40, { ctrlKey: true })), false);
	assert.deepEqual(pinches, []);
	assert.equal(fire("wheel", wheel(1500, -10, { metaKey: true })), true, "a new scroll with the key held magnifies");
	assert.deepEqual(sizes(pinches), [1.11]);
});

test("the Mac's pinch events are sent by how far the pinch has grown, and its wheels are not counted again", () => {
	const { fire, pinches } = page();
	assert.equal(fire("gesturestart", { scale: 1, clientX: 10, clientY: 20 }), true);
	assert.equal(fire("gesturechange", { scale: 1.1, clientX: 10, clientY: 20 }), true);
	assert.equal(fire("gesturechange", { scale: 1.21, clientX: 10, clientY: 20 }), true);
	assert.equal(fire("wheel", wheel(1000, -60)), true);
	assert.equal(fire("gesturechange", { scale: 1, clientX: 10, clientY: 20 }), true);
	assert.equal(fire("gestureend", { scale: 1 }), true);
	assert.deepEqual(sizes(pinches), [1.1, 1.1, 0.83]);
	assert.deepEqual([pinches[0]!.x, pinches[0]!.y], [10, 20]);
});

test("a view that zooms itself keeps its pinch", () => {
	const ownWheel = readFileSync(new URL("../../src/frontend/lib/own-wheel.ts", import.meta.url), "utf8");
	const mark = /const OWN_ZOOM = "([^"]+)"/.exec(ownWheel)?.[1];
	assert.ok(mark && SOURCE.includes(`const OWN_ZOOM = "${mark}"`), "the page and the shim name the mark the same");
	const { document, fire, pinches } = page({ body: `<div ${mark}><p id="in"></p></div><p id="out"></p>` });
	assert.equal(fire("wheel", wheel(1000, -40), document.querySelector("#in")), false);
	assert.equal(fire("gesturestart", { scale: 1 }, document.querySelector("#in")), false);
	assert.equal(fire("gesturechange", { scale: 2 }, document.querySelector("#in")), false);
	assert.deepEqual(pinches, []);
	assert.equal(fire("wheel", wheel(2000, -10), document.querySelector("#out")), true);
	assert.deepEqual(sizes(pinches), [1.11]);
});

test("the page and the shim name the pinch event the same", () => {
	const model = readFileSync(new URL("../../src/frontend/components/magnifier/magnifier-model.ts", import.meta.url), "utf8");
	const name = /export const PINCH = "([^"]+)"/.exec(model)?.[1];
	assert.ok(name && SOURCE.includes(`const PINCH = "${name}"`));
});

test("the browser's own context menu never shows", () => {
	assert.equal(page().fire("contextmenu"), true);
});

test("a click on a web or mail link opens it in the browser through the shell", () => {
	const { document, invoked, fire } = page({ body: `<a id="web" href="https://example.com/a"><span id="inner">docs</span></a><a id="tab" href="http://example.com" target="_blank">x</a><a id="mail" href="mailto:me@example.com">m</a>` });
	assert.equal(fire("click", {}, document.querySelector("#inner")), true);
	assert.equal(fire("click", {}, document.querySelector("#tab")), true);
	assert.equal(fire("click", {}, document.querySelector("#mail")), true);
	assert.deepEqual(invoked, [
		["open_link", { url: "https://example.com/a" }],
		["open_link", { url: "http://example.com/" }],
		["open_link", { url: "mailto:me@example.com" }],
	]);
});

test("app links, other schemes and links the app handled stay in the page", () => {
	const { document, invoked, fire } = page({
		body: `<a id="app" href="/chat/c1">c</a><a id="abs" href="${ORIGIN}/space/y">y</a><a id="file" href="file:///tmp/a">f</a><a id="blob" href="blob:${ORIGIN}/1" download="a.md">d</a><a id="handled" href="https://example.com">h</a><a id="none">n</a>`,
	});
	document.querySelector("#handled")!.addEventListener("click", (e) => e.preventDefault());
	for (const id of ["#app", "#abs", "#file", "#blob", "#none"]) assert.equal(fire("click", {}, document.querySelector(id)), false, id);
	fire("click", {}, document.querySelector("#handled"));
	assert.deepEqual(invoked, []);
});

test("on the Mac a dropped file's path is found by name from the paths the shell reads at the drop", async () => {
	const { lh, fire, invoked } = page({ reply: (cmd) => (cmd === "drag_paths" ? ["/Users/me/CSE 21", "/Users/me/café"] : undefined) });
	fire("dragenter");
	fire("dragover");
	assert.deepEqual(invoked, []);
	fire("drop");
	assert.deepEqual(invoked, [["drag_paths"]]);
	assert.equal(await lh!.pathForFile!({ name: "CSE 21" }), "/Users/me/CSE 21");
	assert.equal(await lh!.pathForFile!({ name: "cafe\u0301" }), "/Users/me/café");
	assert.equal(await lh!.pathForFile!({ name: "other" }), "");
});

test("on the Mac a drag released where nothing takes it leaves no paths for the next drop", async () => {
	let paths: unknown = ["/Users/me/A/notes"];
	const { lh, fire } = page({ reply: () => paths });
	fire("dragenter");
	fire("dragleave", { clientX: 500, clientY: 400 });
	paths = ["/Users/me/B"];
	fire("dragenter");
	fire("drop");
	assert.equal(await lh!.pathForFile!({ name: "B" }), "/Users/me/B");
	assert.equal(await lh!.pathForFile!({ name: "notes" }), "");
	paths = Promise.reject(new Error("no pasteboard"));
	fire("drop");
	assert.equal(await lh!.pathForFile!({ name: "B" }), "");
});

test("on Windows the file goes to the shell in a message and the path comes back in a push", async () => {
	const { lh, posted, window } = page({ platform: "win32" });
	const file = { name: "CSE 21" };
	const first = lh!.pathForFile!(file) as Promise<string>;
	const second = lh!.pathForFile!(file) as Promise<string>;
	assert.deepEqual(posted, [[JSON.stringify({ lhDrop: 1 }), [file]], [JSON.stringify({ lhDrop: 2 }), [file]]]);
	const push = window.__lhPush as (channel: string, payload: unknown) => void;
	push("drop-path", { n: 2, path: "C:\\Users\\me\\two" });
	push("drop-path", { n: 1, path: "C:\\Users\\me\\one" });
	assert.equal(await first, "C:\\Users\\me\\one");
	assert.equal(await second, "C:\\Users\\me\\two");
});

test("on Windows a drop the shell never answers gives no path after 2 seconds", async () => {
	mock.timers.enable({ apis: ["setTimeout"] });
	try {
		const { lh } = page({ platform: "win32" });
		const answer = lh!.pathForFile!({ name: "x" }) as Promise<string>;
		mock.timers.tick(1999);
		let settled = false;
		void answer.then(() => (settled = true));
		await Promise.resolve();
		assert.equal(settled, false);
		mock.timers.tick(1);
		assert.equal(await answer, "");
	} finally {
		mock.timers.reset();
	}
});

test("on Linux the page gets no path for a dropped file", async () => {
	assert.equal(await page({ platform: "linux" }).lh!.pathForFile!({ name: "x" }), "");
});

const BAR = `<div id="bar" class="lh-drag"><button id="menu" type="button">m</button><span id="free" class="lh-no-drag">f</span></div><div id="page">p</div>`;
const BOXES: Record<string, [number, number, number, number]> = { "#bar": [0, 0, 1000, 40], "#menu": [10, 5, 60, 35], "#free": [100, 5, 160, 35], "#page": [0, 40, 1000, 800] };

function desktopPage(platform = "darwin") {
	const p = page({ body: BAR, platform });
	p.document.documentElement.classList.add("lh-desktop");
	p.document.documentElement.setAttribute("data-lh-platform", platform);
	lay(p.document, BOXES);
	return p;
}

test("a press on the drag strip, but not on a button in it or the page below, drags the window", () => {
	const { fire, invoked } = desktopPage();
	assert.equal(fire("mousedown", { button: 0, clientX: 500, clientY: 20 }), true);
	assert.equal(fire("mousedown", { button: 0, clientX: 30, clientY: 20 }), false);
	assert.equal(fire("mousedown", { button: 0, clientX: 120, clientY: 20 }), false);
	assert.equal(fire("mousedown", { button: 0, clientX: 500, clientY: 100 }), false);
	assert.equal(fire("mousedown", { button: 2, clientX: 500, clientY: 20 }), false);
	assert.equal(fire("mousedown", { button: 0, shiftKey: true, clientX: 500, clientY: 20 }), false);
	assert.deepEqual(invoked, [["start_drag"]]);
});

test("a double click on the drag strip starts no drag on its second press and asks for the title bar's action on its release", () => {
	const { fire, invoked } = desktopPage();
	const at = { button: 0, clientX: 500, clientY: 20 };
	fire("mousedown", { ...at, detail: 1 });
	fire("mouseup", { ...at, detail: 1 });
	assert.equal(fire("mousedown", { ...at, detail: 2 }), true);
	assert.deepEqual(invoked, [["start_drag"]]);
	fire("mouseup", { ...at, detail: 2 });
	assert.deepEqual(invoked, [["start_drag"], ["title_bar_double_click"]]);
});

test("a double click that moves before its release, or lands on a button or the page, does nothing", () => {
	const { fire, invoked } = desktopPage();
	fire("mousedown", { button: 0, detail: 2, clientX: 500, clientY: 20 });
	fire("mouseup", { button: 0, detail: 2, clientX: 520, clientY: 20 });
	for (const [x, y] of [[30, 20], [500, 100]]) {
		fire("mousedown", { button: 0, detail: 2, clientX: x, clientY: y });
		fire("mouseup", { button: 0, detail: 2, clientX: x, clientY: y });
	}
	fire("mouseup", { button: 0, detail: 2, clientX: 500, clientY: 20 });
	assert.deepEqual(invoked, []);
});

test("the drag strip does nothing before the desktop classes are set", () => {
	const { document, fire, invoked } = page({ body: BAR });
	lay(document, BOXES);
	assert.equal(fire("mousedown", { button: 0, clientX: 500, clientY: 20 }), false);
	assert.deepEqual(invoked, []);
});

test("off the Mac a lone Alt press shows the menu bar, and Alt with another key does not", () => {
	const { fire, invoked } = page({ platform: "win32" });
	fire("keydown", { key: "Alt" });
	fire("keyup", { key: "Alt" });
	fire("keydown", { key: "Alt" });
	fire("keydown", { key: "f" });
	fire("keyup", { key: "Alt" });
	assert.deepEqual(invoked, [["toggle_menu"]]);
	const mac = page();
	mac.fire("keydown", { key: "Alt" });
	mac.fire("keyup", { key: "Alt" });
	assert.deepEqual(mac.invoked, []);
});
