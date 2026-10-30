/**
 * Halley's glow: a second glow on the same element before the first ends
 * restarts it and still restores the element's own look.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

(globalThis as Record<string, unknown>).window ??= globalThis;
const { glow } = await import("../src/components/halley/dom.ts");

afterEach(() => mock.timers.reset());

describe("glow", () => {
	it("a glow during a glow restores the original look, not the highlight", () => {
		mock.timers.enable({ apis: ["setTimeout"] });
		const style = { transition: "opacity 1s", backgroundColor: "red", boxShadow: "" };
		const el = { style } as unknown as HTMLElement;
		glow(el, false);
		mock.timers.tick(500);
		glow(el, false);
		mock.timers.tick(1000); // the hold ends, the fade starts
		mock.timers.tick(1000); // the fade ends
		assert.deepEqual(style, { transition: "opacity 1s", backgroundColor: "red", boxShadow: "" });
	});

	it("two glows in the same tick also end on the original look", () => {
		mock.timers.enable({ apis: ["setTimeout"] });
		const style = { transition: "", backgroundColor: "", boxShadow: "" };
		const el = { style } as unknown as HTMLElement;
		glow(el, true);
		glow(el, true);
		mock.timers.tick(1000);
		mock.timers.tick(1000);
		assert.deepEqual(style, { transition: "", backgroundColor: "", boxShadow: "" });
	});
});
