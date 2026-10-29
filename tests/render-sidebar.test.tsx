/**
 * Lesson-row render tests (redesign 2026-10-27): the braille spinner while
 * a turn is in flight, a 6×6 white square while the lesson waits for the
 * learner's answer, and otherwise just the short age. Pure function of the
 * list item, so SSR of <SessionRow> pins every visible state. Same tsx
 * classic-JSX shim as render-cards.test.tsx.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionRow } from "../src/components/sidebar.tsx";
import { lessonWaiting, longAgo, shortAgo } from "../src/components/sidebar/session-row.tsx";
import type { ChatListItem } from "../src/core/index.ts";

function item(overrides: Partial<ChatListItem>): ChatListItem {
	return {
		id: "c1",
		title: "Test session",
		kind: "teach",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-02T00:00:00.000Z",
		messageCount: 4,
		phase: "probe",
		pendingQuestion: false,
		pendingProblem: false,
		busy: false,
		compacting: false,
		...overrides,
	};
}

function render(chat: ChatListItem, active = false) {
	return renderToStaticMarkup(<SessionRow chat={chat} active={active} onOpen={() => {}} />);
}

describe("SessionRow (redesign 2026-10-27)", () => {
	it("no phase strips, no phase colors — the retired decoration", () => {
		const html = render(item({ phase: "teach" }));
		assert.ok(!html.includes("phase-strip"), "strip removed by design (too busy)");
		assert.ok(!html.includes("bg-phase-"), "phase fills are retired app-wide");
		assert.ok(!html.includes("border-phase-"), "phase rings are retired app-wide");
	});

	it("idle lesson: no dot, no spinner — just the title and how long ago", () => {
		for (const phase of ["probe", "plan", "teach"] as const) {
			const html = render(item({ phase }));
			assert.ok(!html.includes("session-waiting-dot"), "no waiting dot");
			assert.ok(!html.includes("braille-spinner"), "idle never shows the spinner");
		}
	});

	it("a waiting lesson shows the white square dot instead of any 'Your turn' text", () => {
		const html = render(item({ phase: "teach", pendingQuestion: true }));
		assert.match(html, /data-testid="session-waiting-dot"[^>]*class="[^"]*size-1\.5[^"]*bg-ink/, "6×6 white square");
		assert.doesNotMatch(html, /session-waiting-dot[^>]*rounded/, "square, not round");
		assert.ok(!html.includes("braille-spinner"), "motion is reserved for working");
		assert.doesNotMatch(html, /Your turn|Waiting for input/, "the dot replaces the old text");
		assert.ok(html.includes('<span class="sr-only">Waiting for your answer</span>'), "screen readers still hear it");
	});

	it("a practice lesson with a posed problem also waits; a teaching lesson's stale problem flag does not", () => {
		assert.ok(render(item({ kind: "practice", pendingProblem: true })).includes("session-waiting-dot"));
		assert.ok(!render(item({ kind: "teach", pendingProblem: true })).includes("session-waiting-dot"));
	});

	it("a working lesson (turn in flight) shows the braille spinner and no dot", () => {
		const html = render(item({ phase: "plan", busy: true, pendingQuestion: true }));
		assert.ok(html.includes('data-testid="braille-spinner"'), "the spinner");
		assert.ok((html.match(/class="braille-frame"/g) ?? []).length === 10, "all ten frames");
		assert.ok(html.includes("Working…"), "working meta");
		assert.ok(!html.includes("session-waiting-dot"), "working wins over waiting");
	});

	it("compacting has priority over waiting", () => {
		const html = render(item({ compacting: true, pendingQuestion: true }));
		assert.match(html, /Compacting context…/);
		assert.ok(!html.includes("session-waiting-dot"));
	});

	it("the meta line is the short age; the message count stays dropped", () => {
		const idle = render(item({ title: "Partial derivatives", messageCount: 7, updatedAt: "2025-06-02T12:00:00.000Z" }));
		assert.ok(idle.includes("Partial derivatives"));
		assert.ok(!idle.includes("messages"), "no count");
		assert.match(idle, /\d{4}-\d{2}-\d{2}/, "beyond a week: the ISO date");
		const fresh = render(item({ updatedAt: new Date().toISOString() }));
		assert.match(fresh, />now</, "a just-touched lesson reads 'now'");
	});

	it("the active row sits on the tone block in bold", () => {
		const active = render(item({}), true);
		assert.match(active, /data-active="true"/);
		assert.ok(active.includes("bg-tone"), "active background");
		assert.ok(active.includes("font-bold"), "active title is bold");
		assert.ok(active.includes('aria-current="page"'));
		const idle = render(item({}));
		assert.ok(!idle.includes("font-bold"), "inactive titles are regular");
		assert.ok(!idle.includes("data-active"));
	});

	it("no practice badge and no rounded corners on the row", () => {
		const html = render(item({ kind: "practice" }));
		assert.ok(!html.includes("Practice session"), "the dumbbell badge is gone (not in the design)");
		assert.ok(!/rounded/.test(html), "square corners");
	});
});

describe("shortAgo / longAgo — the row meta and its tooltip", () => {
	const now = new Date("2026-01-02T12:00:00.000Z");
	it("short: now / 5m / 3h / 2d, then the ISO date", () => {
		assert.equal(shortAgo("2026-01-02T11:59:30.000Z", now), "now");
		assert.equal(shortAgo("2026-01-02T11:55:00.000Z", now), "5m");
		assert.equal(shortAgo("2026-01-02T09:00:00.000Z", now), "3h");
		assert.equal(shortAgo("2026-01-01T12:00:00.000Z", now), "1d");
		assert.equal(shortAgo("2025-06-02T12:00:00.000Z", now), "2025-06-02");
	});
	it("long: written out for the 'Teacher replied …' tooltip", () => {
		assert.equal(longAgo("2026-01-02T11:59:30.000Z", now), "just now");
		assert.equal(longAgo("2026-01-02T11:59:00.000Z", now), "1 minute ago");
		assert.equal(longAgo("2026-01-02T09:00:00.000Z", now), "3 hours ago");
		assert.equal(longAgo("2026-01-01T12:00:00.000Z", now), "1 day ago");
		assert.equal(longAgo("2025-06-02T12:00:00.000Z", now), "on 2025-06-02");
	});
	it("lessonWaiting covers questions and practice problems", () => {
		assert.equal(lessonWaiting(item({ pendingQuestion: true })), true);
		assert.equal(lessonWaiting(item({ kind: "practice", pendingProblem: true })), true);
		assert.equal(lessonWaiting(item({})), false);
	});
});
