/** The screens' route table: every address the UI links to has a page, and
 *  a page whose data is gone (or a Talk chat) answers 404 into NotFound. */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createMemoryRouter, isRouteErrorResponse, matchRoutes, type DataRouter } from "react-router";
import { routes } from "../../src/frontend/routes/router.tsx";
import { PageError } from "../../src/frontend/routes/not-found.tsx";
import { spaceTabs } from "../../src/frontend/components/space-page/space-head-model.ts";
import { safePage } from "../../src/frontend/components/teacher/follow.ts";
import viteConfig from "../../vite.config.ts";
import pkg from "../../package.json" with { type: "json" };

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

/** Answers each /api path from `answers` (status, body); anything else is a 404. */
function serve(answers: Record<string, [number, unknown]>) {
	const asked: string[] = [];
	globalThis.fetch = (async (input: string | URL | Request) => {
		const path = String(input);
		asked.push(path);
		const [status, body] = answers[path] ?? [404, { error: "not found" }];
		return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
	}) as typeof fetch;
	return asked;
}

/** The page at `path` once its loader is done. */
async function open(path: string): Promise<DataRouter> {
	const router = createMemoryRouter(routes, { initialEntries: [path] });
	if (!router.state.initialized) {
		await new Promise<void>((resolve) => {
			const stop = router.subscribe((state) => { if (state.initialized) { stop(); resolve(); } });
		});
	}
	return router;
}

function gone(router: DataRouter) {
	const errors = Object.values(router.state.errors ?? {});
	assert.equal(errors.length, 1);
	assert.ok(isRouteErrorResponse(errors[0]) && errors[0].status === 404, String(errors[0]));
	const failed = router.state.matches.at(-1)!.route;
	assert.equal((failed.errorElement as React.ReactElement).type, PageError, "shown as NotFound in the app frame");
}

const chat = (over: Record<string, unknown>) => ({ id: "chat_1", title: "A lesson", messages: [], turnInFlight: false, ...over });

describe("the route table", () => {
	it("every address the UI links to has its own page", () => {
		const tabs = (["space", "none"] as const).flatMap((kind) => spaceTabs(kind, [{ id: "memes", label: "Memes" }]).map((t) => t.href));
		const follow = ["/", "/space", "/space/files", "/space/deadlines", "/space/deadline/ddl_1", "/space/deadline/ddl_1/cheat-sheet", "/graph", "/chat/chat_abc"].filter((p) => safePage(p) === p);
		const links = ["/", "/new", "/settings", "/space/deadlines", "/chat/chat_1", "/space/deadline/ddl_1", "/space/deadline/ddl_1/cheat-sheet", "/space/mock/spc_1/mock_1", "/space/plugin/memes"];
		assert.equal(follow.length, 8);
		for (const path of [...tabs, ...follow, ...links]) {
			const page = matchRoutes(routes, path)?.at(-1)?.route;
			assert.ok(page && page.path !== "*", `${path} has a page`);
		}
		assert.equal(matchRoutes(routes, "/class/files")?.at(-1)?.route.path, "*", "an old address is not found");
		for (const gone of ["/prep", "/space/mocks", "/space/lessons"]) assert.equal(matchRoutes(routes, gone)?.at(-1)?.route.path, "*", `${gone} is gone`);
	});

	it("a lesson is read first with its jobs, what the teacher does in it, its plugins and its question from earlier, and a lesson with a problem list reads it and its documents too", async () => {
		const problems = { problems: [] };
		const documents = { documents: [{ id: "f_test", name: "Test", pdf: true, pages: 2, aspect: 0.77 }], listFileId: "f_test" };
		const jobs = [{ id: "job_1", status: "running" }];
		const question = { of: { chatId: "chat_0", toolCallId: "q1" } };
		const plugins = [{ id: "flashcards", enabled: true }];
		const work = { live: true, cause: "first", taken: true, plan: null, steps: [], files: [] };
		const asked = serve({
			"/api/chats/chat_1": [200, chat({ kind: "homework", spaceId: "spc_1", deadlineId: "ddl 1" })],
			"/api/chats/chat_1/problems": [200, { problems }],
			"/api/chats/chat_1/documents": [200, documents],
			"/api/jobs?chatId=chat_1": [200, { jobs }],
			"/api/chats/chat_1/work": [200, work],
			"/api/chats/chat_1/review": [200, { question }],
			"/api/plugins": [200, { plugins }],
			"/api/chats/chat_2": [200, chat({ id: "chat_2", kind: "study", spaceId: "spc_1", fileIds: ["f_test"] })],
			"/api/chats/chat_2/problems": [200, { problems }],
			"/api/chats/chat_2/documents": [200, documents],
			"/api/chats/chat_3": [200, chat({ id: "chat_3", kind: "study", spaceId: "spc_1" })],
		});
		const router = await open("/chat/chat_1?prompt=Begin");
		assert.equal(router.state.errors, null);
		const data = Object.values(router.state.loaderData)[0] as { chat: { id: string }; jobs: unknown; work: unknown; review: unknown; plugins: unknown; problemList: unknown; documents: unknown; prompt?: string };
		assert.equal(data.chat.id, "chat_1");
		assert.deepEqual(data.problemList, problems);
		assert.deepEqual(data.documents, documents);
		assert.equal(data.prompt, "Begin");
		assert.deepEqual(data.jobs, jobs, "its job cards open as they stand");
		assert.deepEqual(data.work, work, "a lesson opened mid-wait shows its desk as it stands");
		assert.deepEqual(data.review, question, "a question from earlier is in the first drawing");
		assert.deepEqual(data.plugins, plugins, "a plugin's key is in the bar as the lesson opens");
		await open("/chat/chat_2");
		const plain = await open("/chat/chat_3");
		assert.deepEqual(Object.values(plain.state.loaderData)[0], { chat: chat({ id: "chat_3", kind: "study", spaceId: "spc_1" }), jobs: null, work: null, review: null, plugins, problemList: undefined, documents: undefined, prompt: undefined }, "a failed jobs or work read is left to the page, a failed ask shows no question");
		const first = (id: string) => [`/api/chats/${id}`, `/api/jobs?chatId=${id}`, `/api/chats/${id}/work`, `/api/chats/${id}/review`, "/api/plugins"];
		assert.deepEqual(asked, [...first("chat_1"), "/api/chats/chat_1/problems", "/api/chats/chat_1/documents", ...first("chat_2"), "/api/chats/chat_2/problems", "/api/chats/chat_2/documents", ...first("chat_3")], "a lesson on no files has none");
	});

	it("the Talk chat, a removed lesson, a removed deadline and a removed mock are not found", async () => {
		serve({ "/api/chats/talk_1": [200, chat({ id: "talk_1", kind: "talk" })] });
		gone(await open("/chat/talk_1"));
		gone(await open("/chat/chat_gone"));
		gone(await open("/space/deadline/ddl_gone"));
		gone(await open("/space/deadline/ddl_gone/cheat-sheet"));
		gone(await open("/space/mock/spc_1/mock_gone"));
	});

	it("a deadline and a mock are read before their page shows", async () => {
		const deadline = { id: "ddl_1", name: "Final", kind: "exam", date: "2026-12-01", aboutFileId: "f_1" };
		const mocks = { mocks: [{ id: "mock_2", n: 2 }] };
		const asked = serve({
			"/api/deadlines/ddl_1": [200, { spaceId: "spc_1", deadline }],
			"/api/spaces/spc_1/mocks?deadline=ddl_1": [200, mocks],
			"/api/spaces/spc_1/deadlines/ddl_1/about": [200, { text: "Two hours, no notes." }],
			"/api/spaces/spc_1/mocks/mock_1": [200, { mock: { id: "mock_1", n: 1 } }],
		});
		const page = await open("/space/deadline/ddl_1");
		assert.deepEqual(Object.values(page.state.loaderData)[0], { spaceId: "spc_1", deadline, mocks, about: "Two hours, no notes." }, "its mocks and what it's like are drawn as it opens");
		const sheet = await open("/space/deadline/ddl_1/cheat-sheet");
		assert.deepEqual(Object.values(sheet.state.loaderData)[0], { spaceId: "spc_1", deadline }, "the cheat sheet reads only the deadline");
		const mock = await open("/space/mock/spc_1/mock_1");
		assert.deepEqual(Object.values(mock.state.loaderData)[0], { spaceId: "spc_1", mockId: "mock_1", view: { mock: { id: "mock_1", n: 1 } } });
		const homework = { id: "ddl_2", name: "Homework 1", kind: "homework", date: "2026-12-01" };
		serve({ "/api/deadlines/ddl_2": [200, { spaceId: "spc_1", deadline: homework }] });
		const plain = await open("/space/deadline/ddl_2");
		assert.deepEqual(Object.values(plain.state.loaderData)[0], { spaceId: "spc_1", deadline: homework, mocks: null, about: null }, "a homework has no mocks and no about to read");
		assert.equal(asked.filter((u) => u.includes("/mocks?")).length, 1);
	});

	it("the build gives the UI the app's version and homepage", () => {
		const define = (viteConfig as { define: Record<string, string> }).define;
		assert.deepEqual(define, { "process.env.LH_VERSION": JSON.stringify(pkg.version), "process.env.LH_HOMEPAGE": JSON.stringify(pkg.homepage) });
	});
});
