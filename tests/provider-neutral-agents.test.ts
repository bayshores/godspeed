/**
 * Raw-stream credential regression: the Sept 26 Agent getApiKey-hook tests
 * do not exercise these two hand-rolled loops. All credentials here are
 * synthetic; fetch is CLOSED (never delegates). Faux engines stand in for
 * the providers: no request may carry a credential override.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import {
	createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall,
	type JsonObject, type TranscriptContext, type Usage,
} from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";
import { runVisualMaker } from "../src/agent/subagents/visual-maker.ts";
import { runPdfReaderAgent } from "../src/agent/subagents/pdf-reader.ts";
import type { HeadlessApi } from "../src/agent/subagents/headless.ts";
import { providerEventsDir } from "../src/agent/provider-events.ts";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><rect width="20" height="20" fill="white"/></svg>';
const FIXTURE = path.join(import.meta.dirname, "fixtures", "sample-3page.pdf");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==", "base64");
const FINAL = "Verified offline output (p. 1). Pages consulted: 1";
const LOOPS = ["visual", "pdf"] as const;
type Loop = typeof LOOPS[number];
type Call = { name: string; args: JsonObject };

// Replacing rather than extending env also isolates secondary tokens (including
// ANTHROPIC_AUTH_TOKEN/OAUTH_TOKEN and CLAUDE_CODE_OAUTH_TOKEN), SDK base-URL
// overrides, cloud credentials and profiles. No .env loads.
async function isolated<T>(env: Record<string, string>, run: () => Promise<T>): Promise<T> {
	const previous = process.env;
	const fetch = globalThis.fetch;
	const previousEventsDir = providerEventsDir.current;
	const eventsDir = mkdtempSync(path.join(tmpdir(), "lh-provider-neutral-"));
	providerEventsDir.current = eventsDir;
	globalThis.fetch = async () => { throw new Error("CLOSED: unexpected fetch"); };
	process.env = { NODE_ENV: "test", HOME: "/nonexistent/provider-neutral-test-home", ...env };
	try {
		return await run();
	} finally {
		process.env = previous;
		globalThis.fetch = fetch;
		providerEventsDir.current = previousEventsDir;
		rmSync(eventsDir, { recursive: true, force: true });
	}
}

function callsFor(loop: Loop, round: number): Call[] {
	if (round === 2) return [];
	if (loop === "visual") return round === 0
		? [{ name: "write_svg", args: { svg: SVG } }]
		: [{ name: "render_svg", args: {} }];
	return round === 0
		? [{ name: "pdf_info", args: {} }]
		: [{ name: "pdf_extract", args: { pages: "1" } }, { name: "pdf_render", args: { pages: "1", dpi: 100 } }];
}

function fakeHeadless(renders: string[]): HeadlessApi {
	return {
		available: () => true,
		unavailableReason: () => null,
		runDemo: async () => { throw new Error("unexpected demo"); },
		renderSvg: async (svg) => {
			assert.equal(svg, SVG);
			renders.push("svg");
			return PNG;
		},
		renderPdfPages: async (file, pages, opts) => {
			assert.equal(file, FIXTURE);
			assert.deepEqual(pages, [1]);
			assert.equal(opts?.dpi, 100);
			renders.push("pdf:1");
			return [{ page: 1, png: PNG }];
		},
	};
}

async function runLoop(loop: Loop, engine: PiEngine, signal = new AbortController().signal) {
	const renders: string[] = [];
	const activities: string[] = [];
	const usages: Usage[] = [];
	const opts = {
		engine, headless: fakeHeadless(renders), abortSignal: signal,
		onActivity: (line: string) => activities.push(line),
		onUsage: (usage: Usage) => usages.push(usage),
		// Direct recording cases enable the observer into an isolated temp dir.
		chatId: "provider-neutral-offline",
	};
	const result = loop === "visual"
		? await runVisualMaker({ brief: "A white square, no external resources" }, opts)
		: await runPdfReaderAgent({ path: FIXTURE, question: "Read page 1" }, opts);
	return { result, renders, activities, usages };
}

function assertSuccess(loop: Loop, run: Awaited<ReturnType<typeof runLoop>>) {
	if ("svg" in run.result) {
		assert.equal(run.result.svg, SVG, JSON.stringify(run.result));
		assert.equal(run.result.notes, FINAL);
	} else {
		assert.equal(run.result.brief, FINAL);
		assert.equal(run.result.path, FIXTURE);
		assert.deepEqual(run.result.pagesRead, [1]);
		assert.deepEqual(run.result.pagesConsulted, [1]);
	}
	assert.deepEqual(run.renders, [loop === "visual" ? "svg" : "pdf:1"]);
	assert.equal(run.usages.length, 3, "one usage callback per successful stream round");
	assert.ok(run.activities.some((line) => line.startsWith(loop === "visual" ? "write_svg:" : "pdf_info:")));
	assert.ok(run.activities.some((line) => line.startsWith(loop === "visual" ? "render_svg:" : "pdf_render:")));
}

// All global/env cases in this file are deliberately serial.
describe("provider-neutral raw agent loops", { concurrency: false }, () => {
	for (const loop of LOOPS) {
		it(`${loop}: every actual stream request has NO credential override (recording faux engine)`, async () => {
			await isolated({ LH_PROVIDER_EVENTS: "1" }, async () => {
				const faux = createFauxCore({ tokenSize: { min: 64, max: 64 } });
				faux.setResponses([0, 1, 2, 0, 1, 2].map((round) => {
					const calls = callsFor(loop, round);
					return fauxAssistantMessage(calls.length
						? calls.map((c, i) => fauxToolCall(c.name, c.args, { id: `call_${round}_${i}` }))
						: [fauxText(FINAL)], { stopReason: calls.length ? "toolUse" : "stop" });
				}));
				const requests: { context: TranscriptContext; options: Record<string, unknown> }[] = [];
				const signal = new AbortController().signal;
				const engine: PiEngine = {
					model: faux.getModel(), level: "medium",
					streamFn: (model, context, options) => {
						requests.push({ context, options: { ...options } });
						return faux.streamSimple(model, context, options);
					},
				};
				const run = await runLoop(loop, engine, signal);
				assertSuccess(loop, run);
				assert.equal(requests.length, 3);
				const sessionId = requests[0]!.options.sessionId;
				assert.match(String(sessionId), /^[0-9a-f-]{36}$/);
				assert.notEqual(sessionId, "provider-neutral-offline");
				for (const { options } of requests) {
					assert.equal(options.sessionId, sessionId);
					for (const key of ["apiKey", "getApiKey", "auth", "headers"]) {
						assert.ok(!Object.hasOwn(options, key), `${loop} stream must not supply ${key}`);
					}
					assert.equal(options.reasoning, "medium");
					assert.equal(options.signal, signal);
					assert.equal(typeof options.onProviderStreamEvent, "function");
				}
				assert.match(JSON.stringify(requests[2]!.context), /image\/png/);
				assert.match(JSON.stringify(requests[2]!.context), /toolResult/);
				const second = await runLoop(loop, engine, signal);
				assertSuccess(loop, second);
				assert.equal(requests.length, 6);
				const secondId = requests[3]!.options.sessionId;
				assert.notEqual(secondId, sessionId, "a separate unsaved operation must not reuse a conversation");
				for (const request of requests.slice(3)) assert.equal(request.options.sessionId, secondId);
			});
		});

		it(`${loop}: abort still reaches the stream and retains the loop's failure semantics`, async () => {
			await isolated({}, async () => {
				const faux = createFauxCore({});
				faux.setResponses([fauxAssistantMessage([fauxText("must not be delivered")])]);
				const controller = new AbortController();
				controller.abort();
				const run = await runLoop(loop, { model: faux.getModel(), streamFn: faux.streamSimple }, controller.signal);
				const failure = "svg" in run.result ? run.result.notes : run.result.brief;
				assert.match(failure ?? "", /crashed — aborted/);
				assert.deepEqual(run.renders, []);
				assert.equal(run.usages.length, 0);
			});
		});
	}
});
