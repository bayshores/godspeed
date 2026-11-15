/**
 * A shortcut still works on a keyboard layout whose letters are not ASCII: with a modifier held,
 * the key's position stands in for its letter.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actionForBinding, eventBinding } from "../../src/shared/core/keyboard.ts";

function binding(init: { key: string; code: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }) {
	return eventBinding({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init } as KeyboardEvent);
}

describe("shortcuts on a non-Latin layout", () => {
	it("Ctrl on a Russian K key is mod+k, with shift kept", () => {
		assert.equal(binding({ key: "л", code: "KeyK", ctrlKey: true }), "mod+k");
		assert.equal(binding({ key: "Л", code: "KeyK", metaKey: true, shiftKey: true }), "mod+shift+k");
	});

	it("Alt on a non-ASCII key and the comma key fall back to their position", () => {
		assert.equal(binding({ key: "˚", code: "KeyK", altKey: true }), "alt+k");
		assert.equal(binding({ key: "б", code: "Comma", ctrlKey: true }), "mod+,");
		assert.equal(actionForBinding(binding({ key: "б", code: "Comma", metaKey: true })), "open-settings");
	});

	it("ASCII keys keep following the character, and a bare key never uses its position", () => {
		assert.equal(binding({ key: "k", code: "KeyJ", ctrlKey: true }), "mod+k");
		assert.equal(binding({ key: "л", code: "KeyK" }), "л");
		assert.equal(binding({ key: "Tab", code: "Tab", shiftKey: true }), "shift+tab");
	});
});
