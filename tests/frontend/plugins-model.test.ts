import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addAction, addable, pluginFacts, pluginLine, updateFor } from "../../src/frontend/components/settings/plugins-model.ts";
import type { InstalledPlugin, ListedPlugin, PluginManifest } from "../../src/frontend/lib/plugins-api.ts";

const manifest = (over: Partial<PluginManifest>): PluginManifest => ({
	id: "memes",
	name: "Memes",
	version: "0.1.0",
	description: "Made from your lesson.",
	author: "808arc",
	entry: "index.html",
	settings: [],
	network: [],
	uses: [],
	...over,
});

describe("the facts godspeed writes from a manifest", () => {
	it("names where it shows and what it uses", () => {
		const m = manifest({ lesson: { label: "Memes" }, uses: ["agent"], network: ["api.memegen.link"] });
		assert.equal(pluginFacts(m, "Claude"), "Shows in lessons. Uses Claude and api.memegen.link.");
	});

	it("says spaces, or lessons and spaces", () => {
		assert.equal(pluginFacts(manifest({ space: { label: "Cards" } })), "Shows in spaces.");
		assert.equal(pluginFacts(manifest({ lesson: { label: "A" }, space: { label: "B" } })), "Shows in lessons and spaces.");
	});

	it("falls back to your agent when no agent is connected", () => {
		assert.equal(pluginFacts(manifest({ space: { label: "Cards" }, uses: ["agent", "space"] })), "Shows in spaces. Uses your agent and the space's facts.");
		assert.equal(pluginFacts(manifest({ space: { label: "Cards" }, uses: ["agent"] }), "  "), "Shows in spaces. Uses your agent.");
	});

	it("joins three or more with commas and and", () => {
		const m = manifest({ lesson: { label: "A" }, uses: ["agent", "space"], network: ["a.example.com"] });
		assert.equal(pluginFacts(m, "Claude"), "Shows in lessons. Uses Claude, the space's facts and a.example.com.");
	});

	it("leaves the uses sentence out when it uses nothing", () => {
		assert.equal(pluginFacts(manifest({ lesson: { label: "A" } })), "Shows in lessons.");
	});

	it("puts the author's sentence first, ended with a full stop", () => {
		assert.equal(pluginLine(manifest({ lesson: { label: "A" } })), "Made from your lesson. Shows in lessons.");
		assert.equal(pluginLine(manifest({ description: "Streaks", space: { label: "A" } })), "Streaks. Shows in spaces.");
	});
});

const LISTED: ListedPlugin = { id: "quiz", repo: "ann/quiz", tag: "v1.0.0", name: "Quiz", description: "Five quick questions", space: { label: "Quiz" }, network: [], uses: [] };
const installed = (over: Partial<Extract<InstalledPlugin, { manifest: unknown }>>): InstalledPlugin => ({ id: "quiz", folder: "/p/quiz", enabled: true, values: {}, manifest: manifest({ id: "quiz" }), ...over });

describe("adding from godspeed's list", () => {
	it("offers the listed plugins not installed yet, in the list's order", () => {
		const memes = { ...LISTED, id: "memes", name: "Memes" };
		assert.deepEqual(addable([memes, LISTED], [installed({})]), [memes]);
		assert.deepEqual(addable([LISTED], [{ id: "quiz", folder: "/p/quiz", error: "broken" }]), [], "a broken install still counts as installed");
	});

	it("Add shows the sheet when there is a row, else opens the chooser, which only the desktop app has", () => {
		assert.equal(addAction(1, false), "sheet");
		assert.equal(addAction(2, true), "sheet");
		assert.equal(addAction(0, true), "chooser");
		assert.equal(addAction(0, false), null);
	});

	it("Update shows only for a plugin from the list whose listed repo or tag moved", () => {
		const from = (tag: string, repo = "ann/quiz") => installed({ source: { repo, tag } });
		assert.equal(updateFor(from("v0.9.0"), [LISTED]), LISTED);
		assert.equal(updateFor(from("v1.0.0", "old/quiz"), [LISTED]), LISTED);
		assert.equal(updateFor(from("v1.0.0"), [LISTED]), null);
		assert.equal(updateFor(installed({}), [LISTED]), null, "added from a folder");
		assert.equal(updateFor(from("v0.9.0"), []), null, "no longer listed");
		assert.equal(updateFor({ id: "quiz", folder: "/p/quiz", error: "broken" }, [LISTED]), null);
	});

	it("writes a list entry's line as it writes a manifest's", () => {
		assert.equal(pluginLine(LISTED), "Five quick questions. Shows in spaces.");
	});
});
