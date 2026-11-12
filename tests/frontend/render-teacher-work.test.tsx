/**
 * The teacher's work on a space, on screen: the strip under a space's
 * head (live, done, unfolded, Close) and Today's strip per space.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { SpaceFile, SpaceFileStatus, SpaceRecord, SpaceSummary } from "../../src/shared/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	CustomEvent: dom.window.CustomEvent,
	// next/link schedules its prefetch with self.requestIdleCallback.
	self: globalThis,
	IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import("react-dom/client");
const { TeacherWork } = await import("../../src/frontend/components/teacher-work/teacher-work.tsx");
const { TodayWork } = await import("../../src/frontend/components/teacher-work/today-work.tsx");
const { SpaceProvider } = await import("../../src/frontend/components/space-context.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");

const summary = (id: string, name: string, over: Partial<SpaceSummary> = {}): SpaceSummary => ({ id, name, description: "", createdAt: "", updatedAt: "", archived: false, fileCount: 3, color: 1, filesLeft: 0, ...over });
const SPACES = [summary("spc_ml", "Machine Learning", { filesLeft: 2, building: true }), summary("spc_bio", "Biology")];

const file = (id: string, status: SpaceFileStatus): SpaceFile => ({ id, origin: "copied", name: `${id}.pdf`, path: `${id}.pdf`, kind: "study", contentFp: "", status, addedAt: "" });
const record = (over: Partial<SpaceRecord>): SpaceRecord => ({ id: "spc_ml", name: "Machine Learning", description: "", createdAt: "", updatedAt: "", archived: false, files: [], color: 1, ...over });

let root: Root | null = null;
const pushed: string[] = [];
const requests: string[] = [];
const originalFetch = globalThis.fetch;
afterEach(() => {
	act(() => root?.unmount());
	root = null;
	document.body.innerHTML = "";
	pushed.length = 0;
	requests.length = 0;
	globalThis.fetch = originalFetch;
});

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 10))));

async function mount(node: React.ReactNode, space: SpaceRecord | null = null) {
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		requests.push(`${init?.method ?? "GET"} ${url}`);
		if (url === "/api/spaces") return Response.json({ spaces: SPACES });
		if (url === "/api/spaces/spc_ml") return Response.json({ space, folder: null });
		if (url.startsWith("/api/progress")) return Response.json({ grouping: false, files: [{ fileId: "a", name: "a.pdf", facts: 9, inLessons: 0, share: 0 }] });
		return Response.json({ ok: true });
	}) as typeof fetch;
	const router = { push: (href: string) => pushed.push(href), prefetch: () => {} } as unknown as React.ContextType<typeof AppRouterContext>;
	const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });
	const host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	await act(async () => {
		root!.render(
			<AppRouterContext.Provider value={router}>
				<ServerEventsProvider connect={quietEvents as never}>
					<SpaceProvider initialActive="spc_ml" initialSpaces={SPACES}>
						{node}
					</SpaceProvider>
				</ServerEventsProvider>
			</AppRouterContext.Provider>,
		);
	});
	await settle();
	return host;
}

const text = (host: HTMLElement, testid: string) => host.querySelector(`[data-testid="${testid}"]`)?.textContent ?? null;
const click = (host: HTMLElement, testid: string) => act(async () => host.querySelector<HTMLElement>(`[data-testid="${testid}"]`)!.click());

describe("The strip under a space's head", () => {
	it("shows nothing when nothing is going on", async () => {
		const host = await mount(<TeacherWork />, record({ files: [file("a", "ready")] }));
		assert.equal(host.querySelector('[data-testid="teacher-work"]'), null);
		assert.ok(!requests.some((r) => r.includes("/api/progress")), "progress is read only when there is work to show");
	});

	it("a space being built: the file read now, unfolded with what it made so far", async () => {
		const files = [file("a", "ready"), file("week2", "extracting"), file("c", "pending")];
		const host = await mount(<TeacherWork />, record({ files, lastWork: { startedAt: "x", fileIds: ["a"], deadlineIds: [] } }));
		assert.equal(text(host, "teacher-work-title"), "Teacher is building this space");
		assert.equal(text(host, "teacher-work-detail"), "Reading week2.pdf now. 1 left.");
		assert.equal(host.querySelector('[data-testid="teacher-work-close"]'), null);
		const made = text(host, "teacher-work-files")!;
		assert.match(made, /week2\.pdfreading now/);
		assert.match(made, /a\.pdf9 facts/);
		assert.match(made, /c\.pdfwaiting/);
		assert.equal(text(host, "teacher-work-fold"), "Hide what it made");
		await click(host, "teacher-work-fold");
		assert.equal(host.querySelector('[data-testid="teacher-work-files"]'), null);
	});

	it("done: a folded summary that unfolds to its files and deadlines, and Close removes it", async () => {
		const files = [file("old", "ready"), file("a", "ready")];
		const deadlines = [{ id: "ddl_1", kind: "exam" as const, name: "Midterm", date: "2026-12-01", fileIds: [], done: false }];
		const lastWork = { startedAt: "x", endedAt: new Date().toISOString(), fileIds: ["a"], deadlineIds: ["ddl_1"] };
		const host = await mount(<TeacherWork />, record({ files, deadlines, lastWork }));
		assert.equal(text(host, "teacher-work-title"), "Teacher read 1 file");
		assert.match(text(host, "teacher-work-detail")!, /^9 facts and 1 deadline added\. Finished at \d\d:\d\d\.$/);
		assert.equal(host.querySelector('[data-testid="teacher-work-files"]'), null, "folded: the space has older files");
		await click(host, "teacher-work-fold");
		assert.match(text(host, "teacher-work-deadlines")!, /MidtermDec 1/);
		await click(host, "teacher-work-close");
		assert.equal(host.querySelector('[data-testid="teacher-work"]'), null);
		assert.ok(requests.includes("DELETE /api/spaces/spc_ml/work"));
	});
});

describe("Today's strip", () => {
	it("one per space the teacher still reads files of; the button opens the space", async () => {
		const host = await mount(<TodayWork spaces={SPACES} />);
		assert.equal(host.querySelectorAll('[data-testid^="today-work-open-"]').length, 1);
		assert.match(text(host, "today-work-spc_ml")!, /^Teacher is building Machine Learning\. 2 left\./);
		await click(host, "today-work-open-spc_ml");
		assert.deepEqual(pushed, ["/space"]);
	});

	it("is not there when no space has files left", async () => {
		const host = await mount(<TodayWork spaces={[SPACES[1]!]} />);
		assert.equal(host.querySelector('[data-testid="today-work"]'), null);
	});
});
