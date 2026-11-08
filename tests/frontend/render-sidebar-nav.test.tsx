/**
 * The sidebar's class tree: Home, the classes with the open one's pages
 * (the current page marked, the Files count and "new"), no class, the
 * archived fold, add class and settings; and the agent line.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClassSummary } from "../../src/shared/core/index.ts";
import { ClassTree, activePageHref } from "../../src/frontend/components/sidebar/class-tree.tsx";
import { ClassProvider } from "../../src/frontend/components/class-context.tsx";
import { ServerEventsProvider } from "../../src/frontend/components/server-events.tsx";
import { footerLabel } from "../../src/frontend/components/agent-status.tsx";
import { hasUnseenFiles } from "../../src/frontend/components/sidebar/files-seen.ts";

const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");

const cls = (id: string, name: string, archived = false): ClassSummary => ({ id, name, description: "", createdAt: "", updatedAt: "", archived, fileCount: 33 });
const CLASSES = [cls("c29", "CSE 29"), cls("c21", "CSE 21"), cls("old", "MATH 18", true)];

function tree(pathname: string, active: string | null = "c29", unseenFiles = false) {
	const router = { push: () => {} } as unknown as React.ContextType<typeof AppRouterContext>;
	const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });
	return renderToStaticMarkup(
		<AppRouterContext.Provider value={router}>
			<ServerEventsProvider connect={quietEvents as never}>
				<ClassProvider initialActive={active} initialClasses={CLASSES}>
					<ClassTree pathname={pathname} fileCount={33} unseenFiles={unseenFiles} />
				</ClassProvider>
			</ServerEventsProvider>
		</AppRouterContext.Provider>,
	);
}

/** The opening tag of the element carrying `testid`. */
function tag(html: string, testid: string): string {
	const m = html.match(new RegExp(`<[^>]*data-testid="${testid}"[^>]*>`));
	assert.ok(m, `expected ${testid}`);
	return m[0];
}

describe("the class tree", () => {
	it("home, the classes in lowercase, no class, the archived fold, add class and settings, in that order", () => {
		const html = tree("/");
		assert.match(tag(html, "nav-home"), /href="\/"/);
		assert.match(tag(html, "nav-home"), /aria-current="page"/);
		assert.match(html, /nav-home[\s\S]*>cse 29<[\s\S]*>cse 21<[\s\S]*class-option-none[\s\S]*>archived \(1\)<[\s\S]*>add class<[\s\S]*>settings</);
	});

	it("the open class lists its pages; the other classes stay closed", () => {
		const html = tree("/graph");
		assert.match(tag(html, "class-option-c29"), /aria-expanded="true"/);
		assert.match(tag(html, "class-option-c21"), /aria-expanded="false"/);
		assert.match(tag(html, "nav-overview"), /href="\/class"/);
		assert.match(tag(html, "nav-graph"), /href="\/graph"/);
		assert.match(tag(html, "nav-graph"), /aria-current="page"/);
		assert.match(tag(html, "nav-files"), /href="\/class\/files"/);
		assert.match(tag(html, "nav-cheat-sheets"), /href="\/class\/cheat-sheets"/);
		assert.doesNotMatch(tag(html, "nav-overview"), /aria-current/);
		assert.equal(html.match(/data-testid="nav-overview"/g)?.length, 1, "only the open class has pages");
	});

	it("matching is exact: /class/files is files, not overview; lessons match nothing", () => {
		assert.equal(activePageHref("/class/files"), "/class/files");
		assert.equal(activePageHref("/class"), "/class");
		assert.equal(activePageHref("/chat/abc"), null);
		assert.equal(activePageHref("/"), null);
	});

	it("files shows the class's file count, and \"new\" while a scan found files not seen yet", () => {
		assert.match(tree("/"), /<span data-testid="nav-files-count" class="[^"]*font-mono[^"]*tabular-nums[^"]*">33<\/span>/);
		assert.ok(!tree("/").includes("nav-files-new"));
		assert.ok(tree("/", "c29", true).includes('data-testid="nav-files-new"'));
		const now = Date.parse("2026-11-01T12:00:00Z");
		assert.equal(hasUnseenFiles("2026-11-01T10:00:00.000Z", null, now), true, "nothing seen yet");
		assert.equal(hasUnseenFiles("2026-11-01T10:00:00.000Z", "2026-10-31T10:00:00.000Z", now), true, "arrived after the last look");
		assert.equal(hasUnseenFiles("2026-11-01T10:00:00.000Z", "2026-11-01T10:00:00.000Z", now), false, "seen");
		assert.equal(hasUnseenFiles("2026-10-25T10:00:00.000Z", null, now), false, "no longer new");
		assert.equal(hasUnseenFiles(undefined, null, now), false);
	});

	it("no class: overview and graph stay, files and cheat sheets are hidden", () => {
		const html = tree("/class", null);
		assert.match(tag(html, "class-option-none"), /aria-expanded="true"/);
		assert.ok(html.includes('data-testid="nav-overview"'));
		assert.ok(html.includes('data-testid="nav-graph"'));
		assert.ok(!html.includes('data-testid="nav-files"'));
		assert.ok(!html.includes('data-testid="nav-cheat-sheets"'));
	});
});

describe("footerLabel — '<agent>, N jobs'", () => {
	const teaching = { connected: true, teaching: true, pendingWork: 0 };
	const off = { connected: false, teaching: false, pendingWork: 0 };
	it("a teaching agent shows its name and the running jobs", () => {
		assert.equal(footerLabel({ ...teaching, name: "Claude Code" }, 1), "Claude Code, 1 job");
		assert.equal(footerLabel({ ...teaching, name: "Claude Code" }, 3), "Claude Code, 3 jobs");
	});
	it("no jobs: just the agent", () => {
		assert.equal(footerLabel({ ...teaching, name: "Codex" }, 0), "Codex");
	});
	it("teaching without a known name reads 'Your agent'", () => {
		assert.equal(footerLabel(teaching, 0), "Your agent");
	});
	it("connected but not running the work loop says so", () => {
		assert.equal(footerLabel({ ...off, connected: true, name: "Claude Code" }, 0), "Claude Code connected, not teaching");
		assert.equal(footerLabel({ ...off, connected: true, pendingWork: 2 }, 1), "Your agent connected, not teaching, 1 job");
	});
	it("nobody connected (or access off, or not loaded yet)", () => {
		assert.equal(footerLabel(off, 2), "No agent connected, 2 jobs");
		assert.equal(footerLabel(off, 0), "No agent connected");
		assert.equal(footerLabel(null, 0), "No agent connected");
	});
	it("work waiting with no agent reads 'Waiting for your agent'", () => {
		assert.equal(footerLabel({ ...off, pendingWork: 1 }, 1), "Waiting for your agent, 1 job");
		assert.equal(footerLabel({ ...off, pendingWork: 2 }, 0), "Waiting for your agent");
		assert.equal(footerLabel({ ...teaching, name: "Codex", pendingWork: 2 }, 0), "Codex", "a teaching agent is taking it");
	});
});
