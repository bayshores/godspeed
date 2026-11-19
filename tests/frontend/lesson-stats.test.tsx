import React, { act } from "react";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { LessonStats, type LessonUsage } from "../../src/frontend/components/lesson/lesson-stats.tsx";
import { lessonSizeLabel } from "../../src/frontend/components/usage-format.ts";
import type { TurnUsage } from "../../src/shared/core/contracts.ts";

(globalThis as Record<string, unknown>).React = React;
const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
	requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0),
	cancelAnimationFrame: (id: number) => clearTimeout(id),
});

const turn = (messageId: string): TurnUsage => ({ id: messageId, messageId, at: "2026-09-09T12:00:00Z", model: "agent:outside-agent", steps: [{ inputTokens: 10_000, outputTokens: 1_000 }] }) as TurnUsage;

describe("lessonSizeLabel", () => {
	it("reads the size against where it gets summarized, in pages", () => {
		assert.equal(lessonSizeLabel(39_600, 40_000), "about 79 of 80 pages");
		assert.equal(lessonSizeLabel(300, 40_000), "about 1 of 80 pages");
	});
	it("names only the size while the summarize point is unknown, and nothing while the size is", () => {
		assert.equal(lessonSizeLabel(39_600, null), "about 79 pages");
		assert.equal(lessonSizeLabel(39_600, 0), "about 79 pages");
		assert.equal(lessonSizeLabel(null, 40_000), null);
		assert.equal(lessonSizeLabel(null, null), null);
	});
});

describe("the Lesson stats pop-up", () => {
	async function shown(usage: LessonUsage) {
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		const anchor = { current: document.createElement("button") };
		host.append(anchor.current);
		await act(async () => root.render(<LessonStats open anchorRef={anchor} usage={usage} />));
		const text = document.querySelector("[data-testid='stats-detail']")!.textContent!;
		await act(async () => root.unmount());
		host.remove();
		return text;
	}

	it("holds the size in pages, the number of replies, the plan and where the summary starts", async () => {
		const text = await shown({ turns: [turn("a"), turn("b")], contextTokens: 39_600, summarizeAt: 40_000, pricing: { unpriced: 0, subscription: 2, subscriptionProviders: ["Your agent"] } });
		assert.equal(text, "Lesson statsLesson sizeabout 79 of 80 pagesReplies2Paid byYour agentPast about 80 pages, the earlier part is summarized.");
		assert.ok(!text.includes("Unpriced"), "no unpriced row");
		assert.ok(!text.includes("#1"), "no per-turn list");
	});

	it("leaves the size out while it is unknown, and names no plan when none is known", async () => {
		const text = await shown({ turns: [], contextTokens: null, summarizeAt: 40_000 });
		assert.ok(!text.includes("Lesson size"));
		assert.match(text, /Replies0Paid by–/);
	});
});
