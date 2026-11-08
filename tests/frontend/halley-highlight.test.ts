/**
 * Follow's highlight: lighting the same element again before it ends
 * restarts it and still restores the element's own look.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

(globalThis as Record<string, unknown>).window ??= globalThis;
const { highlight } = await import("../../src/frontend/components/halley/dom.ts");

afterEach(() => mock.timers.reset());

describe("highlight", () => {
	it("lights the element, then restores its own look", () => {
		mock.timers.enable({ apis: ["setTimeout"] });
		const style = { backgroundColor: "red", boxShadow: "" };
		const el = { style } as unknown as HTMLElement;
		highlight(el);
		assert.match(style.boxShadow, /--lh-tint/);
		mock.timers.tick(1000);
		assert.deepEqual(style, { backgroundColor: "red", boxShadow: "" });
	});

	it("a highlight during a highlight restores the original look, not the highlight", () => {
		mock.timers.enable({ apis: ["setTimeout"] });
		const style = { backgroundColor: "red", boxShadow: "" };
		const el = { style } as unknown as HTMLElement;
		highlight(el);
		mock.timers.tick(500);
		highlight(el);
		mock.timers.tick(500);
		assert.match(style.boxShadow, /--lh-tint/, "the second one restarted the moment");
		mock.timers.tick(500);
		assert.deepEqual(style, { backgroundColor: "red", boxShadow: "" });
	});
});
