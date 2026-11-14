/**
 * Shortcuts: a keypress maps to its action, the action to its event, and
 * a binding to the keys shown for it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actionForBinding, bindingForAction, bindingKeys, formatBinding, IS_MAC, kbdEventForAction, KEYBOARD_ACTIONS, KEY_SCOPES } from "../../src/shared/core/keyboard.ts";

describe("a keypress reaches its action's event", () => {
	it("mod+t is the toggle-user-thinking action", () => {
		assert.equal(actionForBinding("mod+t"), "toggle-user-thinking");
		assert.equal(bindingForAction("toggle-user-thinking"), "mod+t");
		assert.equal(kbdEventForAction("toggle-user-thinking"), "lh:kbd-toggle-user-thinking");
	});
	it("the search shortcut opens Search lessons", () => {
		assert.equal(kbdEventForAction("sessions-search"), "lh:kbd-sessions-search");
	});
});

describe("keys an older version let the learner change", () => {
	it("the default keys work even with old changed keys saved in the browser", () => {
		const saved = JSON.stringify({ "open-settings": "mod+shift+s", "jump-graph": "mod+j" });
		const g = globalThis as { window?: unknown };
		g.window = { localStorage: { getItem: (key: string) => (key === "lh:keymap" ? saved : null) } };
		try {
			assert.equal(actionForBinding("mod+,"), "open-settings");
			assert.equal(actionForBinding("mod+g"), "jump-graph");
			assert.equal(actionForBinding("mod+shift+s") ?? null, null, "the old change is not read");
			assert.equal(actionForBinding("mod+j") ?? null, null);
			assert.equal(bindingForAction("open-settings"), "mod+,", "the shortcut list shows the default");
		} finally {
			delete g.window;
		}
	});
});

describe("keys that bind to nothing", () => {
	it("shift+tab, mod+k and mod+b (there is no sidebar to toggle)", () => {
		assert.equal(actionForBinding("shift+tab") ?? null, null);
		assert.equal(actionForBinding("mod+k") ?? null, null);
		assert.equal(actionForBinding("mod+b") ?? null, null);
		assert.ok(!KEYBOARD_ACTIONS.some((a) => (a.id as string) === "toggle-sidebar"));
	});
	it("the Alt lesson cycle", () => {
		assert.equal(actionForBinding("alt+arrowup") ?? null, null);
		assert.equal(actionForBinding("alt+arrowdown") ?? null, null);
		assert.equal(actionForBinding("alt+enter") ?? null, null);
	});
});

describe("the shortcut groups", () => {
	it("Everywhere, then In a lesson, and every action is in one of them", () => {
		assert.deepEqual(KEY_SCOPES.map((s) => s.label), ["Everywhere", "In a lesson"]);
		const scopes = new Set(KEY_SCOPES.map((s) => s.scope as string));
		for (const a of KEYBOARD_ACTIONS) assert.ok(scopes.has(a.scope), `${a.id} has a group`);
	});
});

describe("formatBinding", () => {
	it("one line per platform", () => {
		assert.equal(formatBinding("shift+tab"), IS_MAC ? "⇧⇥" : "Shift+⇥");
	});
	it("a + key keeps its glyph, with or without modifiers", () => {
		assert.equal(formatBinding("mod+shift++"), IS_MAC ? "⌘⇧+" : "Ctrl+Shift++");
		assert.equal(formatBinding("+"), "+");
	});
	it("a space key reads as Space", () => {
		assert.equal(formatBinding("mod+ "), IS_MAC ? "⌘Space" : "Ctrl+Space");
	});
});

describe("bindingKeys: one keycap per key", () => {
	const mod = IS_MAC ? "⌘" : "Ctrl";
	it("modifiers first, then the key", () => {
		assert.deepEqual(bindingKeys("mod+shift+f"), [mod, "Shift", "F"]);
		assert.deepEqual(bindingKeys("mod+,"), [mod, ","]);
	});
	it("named keys are written out", () => {
		assert.deepEqual(bindingKeys("enter"), [IS_MAC ? "Return" : "Enter"]);
		assert.deepEqual(bindingKeys("tab"), ["Tab"]);
	});
});
