/**
 * The last hour's countdown shows hundredths, so it ticks every animation
 * frame (which the window pauses while hidden), and each tick re-renders
 * only the countdown, not what holds it (the sidebar).
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { Countdown } from "../../src/frontend/components/countdown.tsx";

const dom = parseHTML("<!doctype html><html><body></body></html>");
let frames: FrameRequestCallback[] = [];
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
	requestAnimationFrame: (fn: FrameRequestCallback) => frames.push(fn),
	cancelAnimationFrame: () => {
		frames = [];
	},
});

describe("Countdown in the last hour", () => {
	it("ticks on animation frames and re-renders only the digits", async () => {
		mock.timers.enable({ apis: ["Date"], now: new Date(2026, 10, 1, 12, 0, 0).getTime() });
		let holderRenders = 0;
		function Holder() {
			holderRenders++;
			return <Countdown due={{ date: "2026-11-01", time: "12:30" }} />;
		}
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		try {
			await act(async () => root.render(<Holder />));
			assert.equal(host.textContent, "30:00.00");
			assert.equal(frames.length, 1, "the next tick waits for an animation frame");
			mock.timers.tick(1234);
			await act(async () => frames.shift()!(0));
			assert.equal(host.textContent, "29:58.76");
			assert.equal(frames.length, 1, "and asks for the next one");
			assert.equal(holderRenders, 1, "the holder does not re-render");
		} finally {
			await act(async () => root.unmount());
			host.remove();
			mock.timers.reset();
			frames = [];
		}
	});
});
