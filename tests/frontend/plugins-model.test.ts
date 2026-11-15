import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pluginFacts, pluginLine } from "../../src/frontend/components/settings/plugins-model.ts";
import type { PluginManifest } from "../../src/frontend/lib/plugins-api.ts";

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
