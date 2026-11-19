import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createResource, reloads, type ResourceState } from "../../src/frontend/components/server-resource-model.ts";

type Answer = { error: string | null; body: string | null };

/** A server the test answers by hand, one read at a time. */
function server() {
	const pending: { url: string; answer: (a: Answer) => void }[] = [];
	const read = (url: string) => new Promise<Answer>((answer) => pending.push({ url, answer }));
	return { pending, read };
}

function setup(start: ResourceState<string> = { url: null, value: null, error: null }) {
	const srv = server();
	const seen: ResourceState<string>[] = [];
	const resource = createResource<string>(srv.read, (s) => seen.push(s), start);
	const last = () => seen.at(-1);
	return { srv, resource, seen, last };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createResource", () => {
	it("reads on show, and shows what came back", async () => {
		const { srv, resource, last } = setup();
		resource.show("/a");
		assert.deepEqual(last(), { url: "/a", value: null, error: null });
		assert.equal(srv.pending.length, 1);
		srv.pending[0]!.answer({ error: null, body: "A" });
		await tick();
		assert.deepEqual(last(), { url: "/a", value: "A", error: null });
	});

	it("showing the same address again reads nothing; null reads nothing", () => {
		const { srv, resource } = setup({ url: "/a", value: "from the loader", error: null });
		resource.show("/a");
		assert.equal(srv.pending.length, 0, "the loader's value stands");
		resource.show(null);
		void resource.load();
		assert.equal(srv.pending.length, 0);
	});

	it("a failed read keeps the last value and says why; the next good one clears it", async () => {
		const { srv, resource, last } = setup();
		resource.show("/a");
		srv.pending[0]!.answer({ error: null, body: "A" });
		await tick();
		void resource.load();
		srv.pending[1]!.answer({ error: "Network error. Try again.", body: null });
		await tick();
		assert.deepEqual(last(), { url: "/a", value: "A", error: "Network error. Try again." });
		void resource.load();
		srv.pending[2]!.answer({ error: null, body: "A2" });
		await tick();
		assert.deepEqual(last(), { url: "/a", value: "A2", error: null });
	});

	it("the newest read wins over an older one that answers later", async () => {
		const { srv, resource, last } = setup();
		resource.show("/a");
		void resource.load();
		srv.pending[1]!.answer({ error: null, body: "new" });
		await tick();
		srv.pending[0]!.answer({ error: null, body: "old" });
		await tick();
		assert.equal(last()!.value, "new");
	});

	it("another address drops the old value at once, and a late answer for the old one is ignored", async () => {
		const { srv, resource, last } = setup();
		resource.show("/a");
		srv.pending[0]!.answer({ error: null, body: "A" });
		await tick();
		void resource.load();
		resource.show("/b");
		assert.deepEqual(last(), { url: "/b", value: null, error: null });
		srv.pending[1]!.answer({ error: null, body: "A again" });
		await tick();
		assert.deepEqual(last(), { url: "/b", value: null, error: null });
		assert.equal(srv.pending[2]!.url, "/b");
	});

	it("update puts in a known value, and a read still out is dropped as older", async () => {
		const { srv, resource, last } = setup();
		resource.show("/a");
		srv.pending[0]!.answer({ error: null, body: "A" });
		await tick();
		void resource.load();
		resource.update((value) => `${value} renamed`);
		assert.deepEqual(last(), { url: "/a", value: "A renamed", error: null });
		srv.pending[1]!.answer({ error: null, body: "A before the rename" });
		await tick();
		assert.equal(last()!.value, "A renamed");
	});

	it("an update that changes nothing leaves a read still out to land", async () => {
		const { srv, resource, last } = setup();
		resource.show("/a");
		resource.update((value) => value);
		srv.pending[0]!.answer({ error: null, body: "A" });
		await tick();
		assert.equal(last()!.value, "A");
	});
});

describe("reloads", () => {
	it("true takes every event of that type; a test looks at the payload; other types never", () => {
		const on = { "spaces-changed": true as const, "mocks-changed": (e: { spaceId: string }) => e.spaceId === "s1" };
		assert.equal(reloads(on, "spaces-changed", {}), true);
		assert.equal(reloads(on, "mocks-changed", { spaceId: "s1" }), true);
		assert.equal(reloads(on, "mocks-changed", { spaceId: "s2" }), false);
		assert.equal(reloads(on, "chats-changed", {}), false);
	});
});
