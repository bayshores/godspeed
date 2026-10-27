/**
 * LESSON STREAMING PERF (redesign Phase 7, lesson part). Not part of
 * `npm test` (it lives outside the tests/*.test.* glob): run it by hand,
 *
 *   NODE_ENV=test npx tsx tests/perf/lesson-stream.perf.tsx
 *
 * It renders the real <Chat> over linkedom with a 100-message lesson
 * (50 learner + 50 teacher messages, markdown + math), then streams one
 * teacher reply through the real session model: 240 token updates,
 * delivered 4 per animation frame (~240 tokens/s at 60fps). A React
 * <Profiler> counts commits and sums their time. Numbers are dev-build
 * React on linkedom — compare runs against each other, not against a
 * browser.
 */
import React, { act, Profiler } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";

(globalThis as Record<string, unknown>).React = React;
const dom = parseHTML("<!doctype html><html><body></body></html>");
const w = dom.window as unknown as Record<string, unknown>;

// ── browser stubs linkedom lacks ──
class RO {
	observe() {}
	unobserve() {}
	disconnect() {}
}
const frameQueue: Array<(t: number) => void> = [];
let frameId = 0;
const raf = (cb: (t: number) => void) => {
	frameQueue.push(cb);
	return ++frameId;
};
const caf = () => {};
const getComputedStyle = () => new Proxy({ getPropertyValue: () => "" } as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : "") });
const location = new URL("http://localhost/chat/perf");
const matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
Object.assign(w, { getComputedStyle, location, ResizeObserver: RO, requestAnimationFrame: raf, cancelAnimationFrame: caf, matchMedia, innerWidth: 1440, innerHeight: 900 });
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	CustomEvent: dom.window.CustomEvent,
	getComputedStyle,
	ResizeObserver: RO,
	requestAnimationFrame: raf,
	cancelAnimationFrame: caf,
	matchMedia,
	IS_REACT_ACT_ENVIRONMENT: true,
});
for (const k of ["getAnimations", "scrollIntoView", "animate"] as const) {
	const proto = (dom.window as unknown as { Element: { prototype: Record<string, unknown> } }).Element.prototype;
	if (!proto[k]) proto[k] = k === "getAnimations" ? () => [] : () => ({ cancel() {}, finished: Promise.resolve() });
}

async function flushFrame() {
	const cbs = frameQueue.splice(0);
	for (const cb of cbs) cb(performance.now());
}

// ── the lesson ──
const usage = { input: 0, output: 0, total: 0, cacheReads: 0, cacheWrites: 0 };
const PARA =
	"Freeze the current parameters $\\mathbf{x}$. The full gradient is $\\nabla f(\\mathbf{x}) = \\frac{1}{N}\\sum_i \\nabla \\ell_i(\\mathbf{x})$. " +
	"Choose one example **uniformly** and use its gradient as the estimate; on *average* it is right.";
function lesson(n: number) {
	const out: unknown[] = [];
	for (let i = 0; i < n / 2; i++) {
		out.push({ id: `u${i}`, role: "user", content: `Question ${i}: why does the minibatch average stay unbiased?`, timestamp: i });
		out.push({
			id: `a${i}`,
			role: "assistant",
			content: [{ type: "text", text: `## Step ${i}\n\n${PARA}\n\n${PARA}` }],
			stopReason: "stop",
			usage,
			provider: "fixture",
			model: "fixture",
			timestamp: i,
		});
	}
	return out;
}

const TOKENS = 240;
const PER_FRAME = 4;

async function main() {
	const { Chat } = await import("../../components/chat.tsx");
	const { ServerEventsProvider } = await import("../../components/server-events.tsx");

	// The stream body we push SSE frames into.
	let push: (s: string) => void = () => {};
	let close: () => void = () => {};
	const enc = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		start(c) {
			push = (s) => c.enqueue(enc.encode(s));
			close = () => c.close();
		},
	});
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.endsWith("/stream")) return new Response(body, { status: 200 });
		if (url.startsWith("/api/jobs")) return Response.json({ jobs: [] });
		if (url.startsWith("/api/chats/")) return Response.json({ messages: undefined, turns: [] });
		if (url.startsWith("/api/models")) return Response.json({ models: [], providers: [], defaults: null, slots: {}, rolePins: {} });
		if (url.startsWith("/api/settings")) return Response.json({ settings: { models: {} } });
		return Response.json({});
	}) as typeof fetch;

	const connect = () => ({ onEvent() {}, onOpen() {}, close() {} });
	let commits = 0;
	let commitMs = 0;
	let measuring = false;
	const phasesSeen: Record<string, number> = {};
	const onRender: React.ProfilerOnRenderCallback = (_id, phase, actual) => {
		if (!measuring) return;
		phasesSeen[phase] = (phasesSeen[phase] ?? 0) + 1;
		commits++;
		commitMs += actual;
	};

	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const t0 = performance.now();
	await act(async () => {
		root.render(
			<ServerEventsProvider connect={connect as never}>
				<Profiler id="chat" onRender={onRender}>
					<Chat chatId="perf" title="Gradient descent" initialMessages={lesson(100) as never} initiallyInFlight initialConfigured />
				</Profiler>
			</ServerEventsProvider>,
		);
	});
	const mountMs = performance.now() - t0;

	// Streaming runs OUTSIDE act(): each SSE chunk arrives in its own task
	// (as from the network), so React commits whenever the app asks it to
	// — act() would batch everything and hide the difference.
	(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = false;
	const tick = () => new Promise<void>((r) => setImmediate(r));
	const settle = async () => {
		for (let i = 0; i < 6; i++) await tick();
	};
	const frame = async (events: unknown[]) => {
		for (const e of events) {
			push(`data: ${JSON.stringify(e)}\n\n`);
			await settle();
		}
		await flushFrame();
		await settle();
	};

	const partial = (k: number) => ({ role: "assistant", content: [{ type: "text", text: "word ".repeat(k) }], stopReason: "stop", usage, provider: "fixture", model: "fixture", timestamp: 999 });
	measuring = true;
	const s0 = performance.now();
	await frame([{ type: "agent_start" }, { type: "message_start", message: partial(0) }]);
	for (let k = 1; k <= TOKENS; k += PER_FRAME) {
		const batch = [];
		for (let j = k; j < k + PER_FRAME && j <= TOKENS; j++) batch.push({ type: "message_update", message: partial(j) });
		await frame(batch);
	}
	await frame([{ type: "message_end", message: partial(TOKENS) }]);
	push("data: [DONE]\n\n");
	close();
	await settle();
	await flushFrame();
	await settle();
	await new Promise((r) => setTimeout(r, 150));
	const wallMs = performance.now() - s0;
	measuring = false;

	const passages = host.querySelectorAll(".lh-source-passage").length;
	const streamed = (host.textContent ?? "").includes("word word word");
	if (process.env.PERF_DEBUG) console.log(phasesSeen, frameId);
	console.log(JSON.stringify({ passages, streamed, mountMs: Math.round(mountMs), tokens: TOKENS, perFrame: PER_FRAME, commits, commitMs: Math.round(commitMs), avgCommitMs: +(commitMs / Math.max(1, commits)).toFixed(2), wallMs: Math.round(wallMs) }));
	root.unmount();
	process.exit(0);
}

void main().catch((err) => {
	console.error(err);
	process.exit(1);
});
