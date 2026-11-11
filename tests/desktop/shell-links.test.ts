import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";

const ORIGIN = "http://127.0.0.1:48061";
const SHIM = readFileSync(new URL("../../crates/shell/src/shim.js", import.meta.url), "utf8").replace("__APP_ORIGIN__", JSON.stringify(ORIGIN)).replace("__PLATFORM__", JSON.stringify("darwin"));

/** The shim on a page of `body`, with the shell's invoke recorded. */
function page(body: string) {
	const { document, Element, Event } = parseHTML(`<!doctype html><html><body>${body}</body></html>`);
	const invoked: [string, unknown][] = [];
	const window = {
		addEventListener: (type: string, listener: EventListener) => document.addEventListener(type, listener),
		__TAURI_INTERNALS__: { invoke: async (cmd: string, args: unknown) => void invoked.push([cmd, args]) },
	};
	const location = { origin: ORIGIN, href: `${ORIGIN}/class/x` };
	const localStorage = { getItem: () => null, setItem: () => {} };
	new Function("window", "document", "location", "localStorage", "Element", SHIM)(window, document, location, localStorage, Element);
	const click = (selector: string) => {
		const event = new Event("click", { bubbles: true, cancelable: true });
		document.querySelector(selector)!.dispatchEvent(event);
		return event.defaultPrevented;
	};
	return { document, invoked, click };
}

test("a click on a web or mail link opens it in the browser through the shell", () => {
	const { invoked, click } = page(`<a id="web" href="https://example.com/a"><span id="inner">docs</span></a><a id="tab" href="http://example.com" target="_blank">x</a><a id="mail" href="mailto:me@example.com">m</a>`);
	assert.equal(click("#inner"), true);
	assert.equal(click("#tab"), true);
	assert.equal(click("#mail"), true);
	assert.deepEqual(invoked, [
		["open_link", { url: "https://example.com/a" }],
		["open_link", { url: "http://example.com/" }],
		["open_link", { url: "mailto:me@example.com" }],
	]);
});

test("app links, other schemes and links the app handled stay in the page", () => {
	const { document, invoked, click } = page(`<a id="app" href="/chat/c1">c</a><a id="abs" href="${ORIGIN}/class/y">y</a><a id="file" href="file:///tmp/a">f</a><a id="blob" href="blob:${ORIGIN}/1" download="a.md">d</a><a id="handled" href="https://example.com">h</a><a id="none">n</a>`);
	document.querySelector("#handled")!.addEventListener("click", (e) => e.preventDefault());
	for (const id of ["#app", "#abs", "#file", "#blob", "#none"]) assert.equal(click(id), false, id);
	click("#handled");
	assert.deepEqual(invoked, []);
});
