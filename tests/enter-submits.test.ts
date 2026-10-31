/**
 * enter-submits + focus-hygiene — the pointer/keyboard Enter split and the
 * transient-control blur.
 *
 * The regression this pins: clicking a transcript control (a thinking
 * toggle) left focus on its <button>; the learner's next Enter re-activated
 * the toggle instead of submitting. The law now: Enter from a
 * POINTER-focused transcript button submits (the window listener also
 * preventDefaults, suppressing the default activation underneath);
 * keyboard-focused buttons and buttons inside open overlays (menus walk
 * focus with arrows, dialogs are their own layer) keep native Enter.
 */
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { describe, it } from "node:test";
import { buttonKeepsNativeEnter } from "../src/components/enter-submits.ts";
import { blurAfterPointerClick, dialogTabTarget, showFocusRingAfterTab } from "../src/components/focus-hygiene.ts";
import { nextField } from "../src/components/field-cycle.ts";

const { document, Event } = parseHTML("<html><body></body></html>");

function buttonIn(attrs: Record<string, string>): HTMLElement {
	const host = document.createElement("div");
	for (const [k, v] of Object.entries(attrs)) host.setAttribute(k, v);
	const b = document.createElement("button");
	b.type = "button";
	host.appendChild(b);
	document.body.appendChild(host);
	return b;
}

describe("buttonKeepsNativeEnter (the pointer/keyboard Enter split)", () => {
	it("a transcript button (pointer-focused) does NOT keep native Enter — Enter submits", () => {
		const b = buttonIn({});
		assert.equal(buttonKeepsNativeEnter(b), false);
	});

	it("a keyboard-focused button keeps native Enter (:focus-visible)", () => {
		const b = buttonIn({});
		// linkedom lacks the pseudo — stub the one call the helper makes.
		(b as unknown as { matches: (sel: string) => boolean }).matches = (sel: string) =>
			sel === ":focus-visible";
		assert.equal(buttonKeepsNativeEnter(b), true);
	});

	it("buttons inside overlays keep native Enter: hand-rolled menu, Radix popper, dialog, menu role", () => {
		assert.equal(buttonKeepsNativeEnter(buttonIn({ "data-lh-menu": "" })), true);
		assert.equal(
			buttonKeepsNativeEnter(buttonIn({ "data-radix-popper-content-wrapper": "" })),
			true,
		);
		assert.equal(buttonKeepsNativeEnter(buttonIn({ role: "dialog" })), true);
		assert.equal(buttonKeepsNativeEnter(buttonIn({ role: "menu" })), true);
	});

	it("a selector engine without :focus-visible degrades to pointer-focus, never throws", () => {
		const b = buttonIn({});
		assert.doesNotThrow(() => buttonKeepsNativeEnter(b));
		assert.equal(buttonKeepsNativeEnter(b), false);
	});
});

describe("blurAfterPointerClick (focus hygiene)", () => {
	it("a POINTER click (detail > 0) blurs the transient control", () => {
		const b = buttonIn({});
		let blurred = false;
		b.blur = () => {
			blurred = true;
		};
		blurAfterPointerClick({ detail: 1, currentTarget: b });
		assert.equal(blurred, true);
	});

	it("a KEYBOARD-activated click (detail 0) keeps focus", () => {
		const b = buttonIn({});
		let blurred = false;
		b.blur = () => {
			blurred = true;
		};
		blurAfterPointerClick({ detail: 0, currentTarget: b });
		assert.equal(blurred, false);
	});
});

describe("dialogTabTarget (Tab stays inside a modal dialog)", () => {
	const [a, b, c] = ["a", "b", "c"];
	const controls = [a, b, c];
	it("Tab past the last control wraps to the first; Shift+Tab before the first wraps to the last", () => {
		assert.equal(dialogTabTarget(controls, c, true, false), a);
		assert.equal(dialogTabTarget(controls, a, true, true), c);
	});
	it("in the middle the browser moves focus as usual", () => {
		assert.equal(dialogTabTarget(controls, a, true, false), null);
		assert.equal(dialogTabTarget(controls, b, true, true), null);
	});
	it("from outside the dialog, Tab lands on its first control (Shift+Tab on its last)", () => {
		assert.equal(dialogTabTarget(controls, "outside", false, false), a);
		assert.equal(dialogTabTarget(controls, null, false, true), c);
	});
	it("a dialog with no controls gives nothing to focus", () => {
		assert.equal(dialogTabTarget([], null, false, false), null);
	});
});

describe("showFocusRingAfterTab (the keyboard focus ring)", () => {
	const press = (type: string, key?: string) => {
		const e = new Event(type);
		if (key) Object.assign(e, { key });
		document.dispatchEvent(e);
	};
	const on = () => document.documentElement.hasAttribute("data-tab-focus");
	it("Tab turns the ring on; other keys don't; a pointer press turns it off", () => {
		const stop = showFocusRingAfterTab(document);
		press("keydown", "ArrowRight");
		assert.equal(on(), false, "a clicked control doesn't light up at the arrow keys");
		press("keydown", "Tab");
		assert.equal(on(), true);
		press("pointerdown");
		assert.equal(on(), false);
		press("keydown", "Tab");
		stop();
		assert.equal(on(), false, "the cleanup removes it");
		press("keydown", "Tab");
		assert.equal(on(), false, "and stops listening");
	});
});

describe("nextField (Tab inside the lesson's text fields)", () => {
	const field = () => {
		const box = document.createElement("div");
		box.appendChild(document.createElement("textarea"));
		document.body.appendChild(box);
		return box as unknown as HTMLElement;
	};
	const [thinking, composer] = [field(), field()];
	const button = buttonIn({});
	it("Tab in a field moves to the next field", () => {
		assert.equal(nextField([thinking, composer], thinking.firstChild), composer);
	});
	it("from the last field, or outside the fields, Tab moves focus as usual", () => {
		assert.equal(nextField([thinking, composer], composer), undefined);
		assert.equal(nextField([thinking, composer], button), undefined);
		assert.equal(nextField([], null), undefined);
	});
});
