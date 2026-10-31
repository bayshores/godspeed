/**
 * Rules an agent saves on its own: the wording helpers, saving into the
 * learner's lists (every lesson or one class) with a mark, Undo and Edit,
 * the MCP save_rule tool and its notice event, and /api/rules.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-agent-rules-"));
const originalEnv = process.env;
const originalFetch = globalThis.fetch;
process.env = {
	...(originalEnv.NODE_TEST_CONTEXT ? { NODE_TEST_CONTEXT: originalEnv.NODE_TEST_CONTEXT } : {}),
	...(originalEnv.NODE_OPTIONS ? { NODE_OPTIONS: originalEnv.NODE_OPTIONS } : {}),
	NODE_ENV: "test",
	LH_DATA_DIR: path.join(scratch, "data"),
	HOME: path.join(scratch, "home"),
};
fs.mkdirSync(path.join(scratch, "home"), { recursive: true });
globalThis.fetch = async () => {
	throw new Error("CLOSED: unexpected network request");
};
after(() => {
	process.env = originalEnv;
	globalThis.fetch = originalFetch;
	fs.rmSync(scratch, { recursive: true, force: true });
});

const core = await import("../src/core/agent-rules.ts");
const { RULES_MAX } = await import("../src/core/teaching-areas.ts");
const { subscribe } = await import("../src/core/events.ts");
const rules = await import("../src/server/agent-rules.ts");
const { stores } = await import("../src/server/stores.ts");
const mcp = await import("../src/server/mcp.ts");
const { ensureMcpToken } = await import("../src/store/mcp-token.ts");
const route = await import("../src/app/api/rules/route.ts");

const DATA = path.join(scratch, "data");

function areaRules(area: "teaching" | "files"): string[] {
	return stores.settingsStore.readSettings()?.agent?.rules?.[area] ?? [];
}

function events(): { list: unknown[]; stop: () => void } {
	const list: unknown[] = [];
	const stop = subscribe((e) => {
		if (e.type === "rules-changed") list.push(e);
	});
	return { list, stop };
}

async function callTool(name: string, args: Record<string, unknown>) {
	const req = new Request("http://127.0.0.1:3000/api/mcp", {
		method: "POST",
		headers: { host: "127.0.0.1:3000", "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${ensureMcpToken()}` },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
	});
	const res = await (await mcp.handleMcpRequest(req)).json();
	return { error: res.result.isError === true, text: res.result.content[0].text as string };
}

function post(body: unknown) {
	return route.POST(new Request("http://127.0.0.1:3000/api/rules", { method: "POST", body: JSON.stringify(body) }));
}

describe("rule wording", () => {
	it("names where a rule applies", () => {
		assert.equal(core.ruleFor({ area: "teaching" }), "every lesson");
		assert.equal(core.ruleFor({ classId: "cls_a" }, "CSE 21"), "CSE 21");
		assert.equal(core.whereLabel({ area: "files" }), "Every lesson, under Your files and formatting");
		assert.equal(core.whereLabel({ classId: "cls_a" }, "CSE 21"), "Lessons in CSE 21");
	});

	it("reads only well-formed places and records", () => {
		assert.deepEqual(core.parseWhere({ area: "voice" }), { area: "voice" });
		assert.equal(core.parseWhere({ area: "nope" }), null);
		assert.equal(core.parseWhere({ classId: "../etc" }), null);
		const saved = core.parseSavedRules({ rules: [{ where: { area: "voice" }, text: "Be brief.", at: "2026-10-30T00:00:00.000Z" }, { where: {}, text: "x", at: "y" }] });
		assert.equal(saved.length, 1);
		assert.deepEqual(core.savedTimes(saved, { area: "voice" }), { "Be brief.": "2026-10-30T00:00:00.000Z" });
		assert.deepEqual(core.savedTimes(saved, { area: "teaching" }), {});
	});

	it("reads a save_rule result and rejects a refusal", () => {
		const ok = { saved: true, rule: "Use Python.", for: "every lesson", where: { area: "teaching" }, note: "Saved." };
		assert.deepEqual(core.parseSaveRuleResult(ok), ok);
		assert.equal(core.parseSaveRuleResult("That list is full."), null);
	});
});

describe("saving, undoing and editing", () => {
	beforeEach(() => fs.rmSync(DATA, { recursive: true, force: true }));

	it("saves a rule for every lesson, marks it, and announces it only from the terminal", () => {
		const seen = events();
		const lesson = rules.saveRuleByAgent("  Use Python   for code examples. ", { area: "teaching" });
		assert.deepEqual(lesson, { ok: true, rule: "Use Python for code examples.", for: "every lesson", where: "Every lesson, under Teaching" });
		rules.saveRuleByAgent("Shorter answers.", { area: "teaching" }, "Claude Code");
		seen.stop();
		assert.deepEqual(areaRules("teaching"), ["Use Python for code examples.", "Shorter answers."]);
		assert.deepEqual(rules.agentSavedRules().map((r) => r.text), ["Use Python for code examples.", "Shorter answers."]);
		assert.deepEqual(seen.list, [
			{ type: "rules-changed" },
			{ type: "rules-changed", saved: { text: "Shorter answers.", where: { area: "teaching" }, label: "Every lesson, under Teaching", agent: "Claude Code" } },
		]);
	});

	it("doesn't mark a rule the learner already has, and refuses a full list", () => {
		stores.settingsStore.writeSettings({ version: 2, agent: { rules: { files: ["Mine."] } } });
		assert.equal(rules.saveRuleByAgent("Mine.", { area: "files" }).ok, true);
		assert.deepEqual(rules.agentSavedRules(), []);
		stores.settingsStore.writeSettings({ version: 2, agent: { rules: { files: Array.from({ length: RULES_MAX }, (_, i) => `Rule ${i}.`) } } });
		const full = rules.saveRuleByAgent("One more.", { area: "files" });
		assert.equal(full.ok, false);
		assert.match(!full.ok ? full.error : "", /already has 20 rules/);
	});

	it("saves into a class, and refuses a class that doesn't exist", () => {
		const cls = stores.classStore.createClass({ name: "CSE 21" });
		assert.deepEqual(rules.saveRuleByAgent("Use set notation.", { classId: cls.id }), { ok: true, rule: "Use set notation.", for: "CSE 21", where: "Lessons in CSE 21" });
		assert.deepEqual(stores.classStore.getClass(cls.id)?.rules, ["Use set notation."]);
		assert.equal(rules.saveRuleByAgent("x", { classId: "cls_missing" }).ok, false);
	});

	it("undoes and edits; an edited rule is the learner's", () => {
		rules.saveRuleByAgent("Use Python.", { area: "teaching" });
		rules.saveRuleByAgent("Use diagrams.", { area: "teaching" });
		assert.equal(rules.removeRule({ area: "teaching" }, "Use Python."), true);
		assert.equal(rules.removeRule({ area: "teaching" }, "Use Python."), false);
		const edited = rules.editRule({ area: "teaching" }, "Use diagrams.", "Use a diagram first.");
		assert.equal(edited.ok && edited.rule, "Use a diagram first.");
		assert.deepEqual(areaRules("teaching"), ["Use a diagram first."]);
		assert.deepEqual(rules.agentSavedRules(), []);
		assert.equal(rules.editRule({ area: "teaching" }, "Gone.", "x").ok, false);
	});

	it("drops the mark of a rule the learner removed in Settings", () => {
		rules.saveRuleByAgent("Use Python.", { area: "teaching" });
		stores.settingsStore.writeSettings({ version: 2, agent: { rules: {} } });
		assert.deepEqual(rules.agentSavedRules(), []);
		assert.deepEqual(JSON.parse(fs.readFileSync(path.join(DATA, "agent-rules.json"), "utf8")).rules, []);
	});
});

describe("save_rule over MCP and /api/rules", () => {
	beforeEach(() => fs.rmSync(path.join(DATA, "agent-rules.json"), { force: true }));

	it("saves for every lesson by default, or for a class", async () => {
		const saved = await callTool("save_rule", { rule: "Use Python." });
		assert.equal(saved.error, false);
		assert.equal(JSON.parse(saved.text).for, "every lesson");
		const cls = stores.classStore.createClass({ name: "CSE 29" });
		const inClass = await callTool("save_rule", { rule: "Use C.", class_id: cls.id });
		assert.equal(JSON.parse(inClass.text).for, "CSE 29");
		assert.equal((await callTool("save_rule", { rule: "x", class_id: "cls_nope" })).error, true);
	});

	it("lists, undoes and edits through the route", async () => {
		rules.saveRuleByAgent("Use Rust.", { area: "teaching" });
		const listed = (await (await route.GET()).json()) as { rules: { text: string }[] };
		assert.deepEqual(listed.rules.map((r) => r.text), ["Use Rust."]);
		const edit = await post({ action: "edit", where: { area: "teaching" }, text: "Use Rust.", newText: "Use Rust 2024." });
		assert.equal(edit.status, 200);
		assert.equal((await post({ action: "remove", where: { area: "teaching" }, text: "Use Rust 2024." })).status, 200);
		assert.equal((await post({ action: "remove", where: { area: "teaching" }, text: "Use Rust 2024." })).status, 404);
		assert.equal((await post({ action: "remove", where: { area: "bad" }, text: "x" })).status, 400);
	});
});
