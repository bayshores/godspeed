/**
 * One lesson row: the title, what the lesson waits on under it, its age,
 * and the More button that opens the lesson menu.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LessonRow } from "../../src/frontend/components/lessons/lesson-row.tsx";
import type { ChatListItem } from "../../src/shared/core/index.ts";

function item(overrides: Partial<ChatListItem>): ChatListItem {
	return {
		id: "c1",
		title: "Test lesson",
		kind: "teach",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-02T00:00:00.000Z",
		messageCount: 4,
		phase: "probe",
		pendingQuestion: false,
		pendingProblem: false,
		busy: false,
		...overrides,
	};
}

const render = (chat: ChatListItem, props: Partial<React.ComponentProps<typeof LessonRow>> = {}) =>
	renderToStaticMarkup(<LessonRow chat={chat} teacher="marco" onOpen={() => {}} {...props} />);

describe("LessonRow", () => {
	it("an idle lesson: just the title and its age", () => {
		const html = render(item({ title: "Partial derivatives", messageCount: 7, updatedAt: new Date().toISOString() }));
		assert.ok(html.includes("Partial derivatives"));
		assert.match(html, />now</);
		assert.ok(!html.includes("data-waiting"));
		assert.ok(!html.includes("is writing"));
		assert.ok(!html.includes("messages"), "no message count");
	});

	it("a lesson waiting for the learner says so, whatever its kind", () => {
		assert.match(render(item({ pendingQuestion: true })), /data-waiting=""[^>]*>.*Waiting for your answer</);
		assert.ok(render(item({ kind: "practice", pendingProblem: true })).includes("data-waiting"));
		assert.ok(render(item({ kind: "study", pendingProblem: true })).includes("data-waiting"));
	});

	it("while the teacher writes, the row names the teacher; writing wins over waiting", () => {
		const html = render(item({ busy: true, pendingQuestion: true }));
		assert.ok(html.includes("marco is writing"));
		assert.ok(!html.includes("data-waiting"));
	});

	it("with no agent teaching, a lesson waiting on a reply says it waits for the agent", () => {
		const html = render(item({ busy: true }), { noAgent: true });
		assert.ok(html.includes("Waiting for your agent"));
		assert.ok(!html.includes("is writing"));
	});

	it("the row is the teacher's highlight target, and the search walk marks its row", () => {
		assert.match(render(item({})), /data-testid="session-row"[^>]*data-teacher-target="lesson:c1"/);
		assert.ok(render(item({}), { kbdSelected: true }).includes('data-testid="session-row-kbd"'));
	});

	it("More opens the lesson menu: shown on hover, and kept while its menu is open", () => {
		const chat = item({ title: "Limits" });
		assert.ok(!render(chat).includes("session-row-menu"), "no menu, no button");
		const button = render(chat, { onMenu: () => {} }).match(/<button[^>]*data-testid="session-row-menu"[^>]*>More</)?.[0] ?? "";
		assert.match(button, /aria-label="More for Limits"/);
		assert.match(button, /aria-haspopup="menu"/);
		assert.match(button, /opacity-0/);
		assert.match(button, /group-hover:opacity-100/);
		const shown = render(chat, { onMenu: () => {}, menuOpen: true }).match(/<button[^>]*data-testid="session-row-menu"[^>]*>/)?.[0] ?? "";
		assert.match(shown, /aria-expanded="true"/);
		assert.doesNotMatch(shown, /opacity-0/);
	});
});
