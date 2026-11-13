/**
 * A prep's sheet over linkedom with a fake fetch: the teacher writing it,
 * then what it is like, its sources, the topics weakest first, and what
 * Study, a topic row, Remove and Take a mock send. Today's prep rows link
 * to the sheet.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import type { PrepView } from "../../src/shared/core/index.ts";

const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const { PrepSheet } = await import("../../src/frontend/components/prep/prep-sheet.tsx");
const { PrepLaterRow, PrepTodayRow } = await import("../../src/frontend/components/home-page/today-row.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { SpaceProvider } = await import("../../src/frontend/components/space-context.tsx");

const topic = (id: string, name: string, status: PrepView["topics"][number]["status"], answered = 0, right = 0) => ({
	id,
	name,
	status,
	answered,
	right,
	rate: answered ? right / answered : null,
});

const WRITTEN: PrepView = {
	spaceId: "spc_a",
	name: "Backend phone screen",
	prep: {
		goal: "Phone screen for a backend role",
		about: "Two questions in 45 minutes.",
		sources: [{ title: "The company's guide", url: "https://example.com/guide" }],
		topics: [],
		mock: { questions: 2, minutes: 45 },
		writtenAt: "2026-11-11T10:00:00.000Z",
	},
	topics: [topic("pt_00000001", "Arrays", "strong", 4, 4), topic("pt_00000002", "Hash maps", "weak", 4, 1), topic("pt_00000003", "Graphs", "untested")],
	mocks: [],
	writing: false,
};

const posts: { url: string; body: unknown }[] = [];
const originalFetch = globalThis.fetch;
let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	globalThis.fetch = originalFetch;
	posts.length = 0;
});

async function mount(view: PrepView) {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (init?.method && init.method !== "GET") {
			posts.push({ url, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
			if (url === "/api/chats") return Response.json({ id: "chat_1", title: "Study" });
			if (url.endsWith("/mocks")) return Response.json({ mockId: "mock_0000000a" }, { status: 201 });
			return Response.json({ ok: true });
		}
		if (url === "/api/spaces") return Response.json({ spaces: [{ id: "spc_a", name: view.name, color: 2, prep: {} }] });
		if (url === "/api/spaces/spc_a/prep") return Response.json(view);
		return Response.json({});
	}) as typeof fetch;
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	const connect = () => ({ onEvent() {}, onOpen() {}, close() {} });
	await act(async () => {
		root!.render(
			<MemoryRouter initialEntries={["/space"]}>
				<ServerEventsProvider connect={connect as never}>
					<SpaceProvider initialActive="spc_a">
						<PrepSheet spaceId="spc_a" />
					</SpaceProvider>
				</ServerEventsProvider>
			</MemoryRouter>,
		);
	});
	await act(async () => {
		await new Promise((r) => setTimeout(r, 30));
	});
}

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: HTMLElement | null) => act(async () => el!.dispatchEvent(new dom.window.Event("click", { bubbles: true })));

describe("a prep's sheet", () => {
	it("says the teacher is writing it until it is in", async () => {
		await mount({ ...WRITTEN, prep: { goal: WRITTEN.prep.goal, about: "", sources: [], topics: [] }, topics: [], writing: true });
		assert.ok(q("prep-writing"));
		assert.equal(q("prep-topics"), null);
	});

	it("shows what it is like, its sources and the topics weakest first", async () => {
		await mount(WRITTEN);
		assert.match(q("prep-about")!.textContent ?? "", /Two questions in 45 minutes/);
		assert.equal(q("prep-sources")!.querySelector("a")!.getAttribute("href"), "https://example.com/guide");
		const rows = [...q("prep-topics")!.querySelectorAll("li")].map((li) => li.getAttribute("data-testid"));
		assert.deepEqual(rows, ["prep-topic-pt_00000002", "prep-topic-pt_00000003", "prep-topic-pt_00000001"]);
		assert.match(q("prep-solid")!.textContent ?? "", /1/);
	});

	it("Study starts on the topics that most need work", async () => {
		await mount(WRITTEN);
		await click(q("prep-study"));
		assert.deepEqual(posts.at(-1), { url: "/api/chats", body: { prepTopicIds: [], spaceId: "spc_a" } });
	});

	it("a topic row studies just that topic", async () => {
		await mount(WRITTEN);
		await click(q("prep-topic-pt_00000003")!.querySelector('[data-testid="prep-topic-study"]'));
		assert.deepEqual(posts.at(-1), { url: "/api/chats", body: { prepTopicIds: ["pt_00000003"], spaceId: "spc_a" } });

	});

	it("Remove asks first for every topic, then takes it off, and Take a mock makes one", async () => {
		await mount(WRITTEN);
		const sent = posts.length;
		for (const id of ["pt_00000001", "pt_00000003"]) {
			await click(q(`prep-topic-${id}`)!.querySelector('[data-testid="prep-topic-remove"]'));
			assert.equal(posts.length, sent, `nothing removed yet (${id}, answered or not)`);
			assert.match(q("prep-topic-remove-confirm")!.textContent ?? "", /This can't be undone\./);
			await click(q("prep-topic-remove-confirm-keep"));
			assert.equal(q("prep-topic-remove-confirm"), null, "Cancel keeps it");
		}
		await click(q("prep-topic-pt_00000001")!.querySelector('[data-testid="prep-topic-remove"]'));
		assert.match(q("prep-topic-remove-confirm")!.textContent ?? "", /^Remove Arrays\?/);
		await click(q("prep-topic-remove-confirm-go"));
		assert.deepEqual(posts.at(-1), { url: "/api/spaces/spc_a/prep", body: { action: "remove-topic", topicId: "pt_00000001" } });

		await click(q("prep-take-mock"));
		assert.equal(posts.at(-1)!.url, "/api/spaces/spc_a/mocks");
	});
});

describe("Today's prep rows", () => {
	const prep = { spaceId: "spc_a", name: "Backend phone screen", date: "2026-11-17", color: 2 as const };
	const NOW = new Date(2026, 10, 11, 9, 0).getTime();

	it("under Today: the days left, the name that opens the sheet, and Study", () => {
		const html = renderToStaticMarkup(
			<MemoryRouter initialEntries={["/"]}>
				<PrepTodayRow prep={prep} nowMs={NOW} main busy={false} onOpen={() => {}} onStudy={() => {}} />
			</MemoryRouter>,
		);
		assert.match(html, /data-testid="today-prep-spc_a"/);
		assert.match(html, /<a data-testid="today-prep-open"[^>]*href="\/space"/);
		assert.match(html, /data-testid="today-prep-study"/);
		assert.match(html, />6</);
	});

	it("under Later: the whole row opens the sheet", () => {
		const html = renderToStaticMarkup(
			<MemoryRouter initialEntries={["/"]}>
				<PrepLaterRow prep={prep} nowMs={NOW} onOpen={() => {}} />
			</MemoryRouter>,
		);
		assert.match(html, /data-testid="later-prep-spc_a"/);
		assert.match(html, /href="\/space"/);
	});
});
