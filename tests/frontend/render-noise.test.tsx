/**
 * Noise: the word in a top bar turns brown noise on and off, and the
 * "Sounds" switch owns it.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";

const dom = parseHTML("<html><body></body></html>");
(dom.document as unknown as { oninput: null }).oninput = null;

/** What the sound part asked of the window's audio, in order. */
let asked: string[] = [];
class FakeAudioContext {
	sampleRate = 100;
	currentTime = 0;
	destination = {};
	constructor() {
		asked.push("made");
	}
	createBuffer(ears: number, length: number) {
		asked.push(`buffer ${ears}x${length}`);
		return { getChannelData: () => new Float32Array(length) };
	}
	createBufferSource() {
		return { buffer: null, loop: false, connect: <T,>(to: T) => to, start: () => asked.push("loop started") };
	}
	createGain() {
		const gain = {
			value: 0,
			cancelScheduledValues: () => {},
			setValueAtTime: () => {},
			linearRampToValueAtTime: (to: number, at: number) => asked.push(`fade to ${to} in ${at}`),
		};
		return { gain, connect: <T,>(to: T) => to };
	}
	resume() {
		asked.push("resume");
		return Promise.resolve();
	}
	suspend() {
		asked.push("suspend");
		return Promise.resolve();
	}
	close() {
		asked.push("close");
		return Promise.resolve();
	}
}

Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
	AudioContext: FakeAudioContext,
});

const { createRoot } = await import("react-dom/client");
const { NoiseProvider, NoiseWord } = await import("../../src/frontend/components/noise.tsx");
const { SettingsProvider } = await import("../../src/frontend/components/settings-context.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");

let root: Root | null = null;
const originalFetch = globalThis.fetch;
afterEach(() => {
	act(() => root?.unmount());
	root = null;
	document.body.innerHTML = "";
	globalThis.fetch = originalFetch;
	asked = [];
});

/** The server's events, none of which come. */
const connect = () => ({ onEvent() {}, onOpen() {}, close() {} });

/** Two bars' words under one provider, with Sounds as the page booted with it. */
function draw(sounds: boolean) {
	// The settings read never answers, so the boot values stand.
	globalThis.fetch = () => new Promise(() => {});
	if (!root) {
		const host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
	}
	act(() =>
		root!.render(
			<ServerEventsProvider connect={connect as never}>
				<SettingsProvider boot={{ teacherName: "Quigley", sounds, startupSound: false }}>
					<NoiseProvider>
						<NoiseWord />
						<NoiseWord />
					</NoiseProvider>
				</SettingsProvider>
			</ServerEventsProvider>,
		),
	);
}
const words = () => [...document.querySelectorAll<HTMLElement>("[data-testid=noise-word]")];
const pressed = () => words().map((word) => word.getAttribute("aria-pressed"));
const click = () => act(() => words()[0]!.dispatchEvent(new dom.window.Event("click", { bubbles: true })));

describe("Noise", () => {
	it("is off as the app opens, and makes no sound part before a click", () => {
		draw(true);
		assert.deepEqual(pressed(), ["false", "false"]);
		assert.equal(words()[0]!.textContent, "Noise");
		assert.deepEqual(asked, []);
	});

	it("a click fades it in and lights the word in every bar; the next click fades it out", () => {
		draw(true);
		click();
		assert.deepEqual(pressed(), ["true", "true"]);
		assert.deepEqual(asked, ["made", "buffer 2x800", "loop started", "fade to 0.08 in 0.4", "resume"]);
		click();
		assert.deepEqual(pressed(), ["false", "false"]);
		assert.deepEqual(asked.slice(5), ["fade to 0 in 0.4"]);
		// One sound part for the whole session.
		click();
		assert.equal(asked.filter((line) => line === "made").length, 1);
	});

	it("with Sounds off the word is gone", () => {
		draw(false);
		assert.deepEqual(words(), []);
	});

	it("Sounds switched off stops it at once, and it does not come back with Sounds", () => {
		draw(true);
		click();
		draw(false);
		assert.deepEqual(words(), []);
		assert.equal(asked.at(-1), "fade to 0 in 0.05");
		draw(true);
		assert.deepEqual(pressed(), ["false", "false"]);
		assert.equal(asked.at(-1), "fade to 0 in 0.05");
	});
});
