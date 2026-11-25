/**
 * The setup card's words: each row from what the server found, the compact card's sentence, and
 * the answer read safely.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readAgentHealth, readAgentUpdate, type AgentHealth } from "../../src/shared/core/index.ts";
import { cantRun, cardRows, compact, ready } from "../../src/frontend/components/agent-setup/agent-card-model.ts";

const CHECKS = ["installed", "node", "upToDate", "loggedIn"] as const;
const LINK = "https://code.claude.com/docs/en/setup";

/** A server answer: every check passed, unless `failed` names the one that failed and why. */
function answer(over: Record<string, unknown> = {}, failed?: { check: string; problem: string; needs?: string; link?: string; reason?: string }): unknown {
	const checks = CHECKS.map((check) => {
		const fails = failed?.check === check;
		const after = failed && CHECKS.indexOf(check) > CHECKS.indexOf(failed.check as (typeof CHECKS)[number]);
		return {
			check,
			state: fails ? "failed" : after ? "unchecked" : "passed",
			fact: check === "installed" && !fails ? "2.1.340" : check === "loggedIn" && !fails && !after ? "Max plan" : null,
			problem: fails ? failed.problem : null,
			reason: fails ? (failed.reason ?? null) : null,
			needs: fails ? (failed.needs ?? null) : null,
			link: fails ? (failed.link ?? null) : null,
		};
	});
	const failing = failed ? { check: failed.check, problem: failed.problem, reason: failed.reason ?? null, needs: failed.needs ?? null, link: failed.link ?? null } : null;
	return { agent: "claude", checking: false, ownCommand: false, checks, failing, login: null, update: null, ...over };
}
const health = (over: Record<string, unknown> = {}, failed?: Parameters<typeof answer>[1]): AgentHealth => readAgentHealth(answer(over, failed))!;
const said = (h: AgentHealth | null, update: Parameters<typeof cardRows>[1] = null) => cardRows(h, update).map((r) => [r.name, r.mark, r.fact, r.keys.map((k) => (k.kind === "cancel" ? "Cancel" : k.kind === "check" ? "Check again" : k.label)).join(", ")]);

describe("the setup card's rows", () => {
	it("before the first answer: blank rows, the spinner on the first", () => {
		assert.deepEqual(said(null), [
			["Version", "busy", null, ""],
			["Account", "none", null, ""],
		]);
	});

	it("both checks passed: the version and the plan, ticked, and the model shows", () => {
		const h = health();
		assert.deepEqual(said(h), [
			["Version", "tick", "2.1.340", ""],
			["Account", "tick", "Max plan", ""],
		]);
		assert.ok(ready(h) && !cantRun(h));
	});

	it("each failed check's words and key", () => {
		assert.deepEqual(said(health({}, { check: "installed", problem: "notInstalled", link: LINK }))[0], ["Version", "need", "Not installed", "Get it"]);
		assert.deepEqual(said(health({}, { check: "upToDate", problem: "tooOld", needs: "2.1.331" }))[0], ["Version", "need", "Too old, needs 2.1.331", "Update"]);
		assert.deepEqual(said(health({}, { check: "node", problem: "noNode", needs: "18", link: "https://nodejs.org/en/download" }))[0], ["Version", "need", "Needs Node.js 18 or newer", "Get Node.js"]);
		assert.deepEqual(said(health({}, { check: "helper", problem: "noHelper", link: "https://learnatgodspeed.com" }))[0], ["Version", "need", "A part of godspeed is missing", "Reinstall godspeed"], "godspeed's own part speaks on the Version row");
		assert.deepEqual(said(health({}, { check: "loggedIn", problem: "signedOut" }))[1], ["Account", "need", null, "Log in"]);
		assert.deepEqual(said(health({}, { check: "loggedIn", problem: "billsByUse" }))[1], ["Account", "need", "Console account, billed by use", "Log in with your plan"]);
		assert.deepEqual(said(health({}, { check: "loggedIn", problem: "freeAccount", link: "https://claude.com/pricing" }))[1], ["Account", "need", "Free account; teaching needs Pro or Max", "See plans"]);
		const broken = cardRows(health({}, { check: "installed", problem: "failed", reason: "claude --version took longer than 15 seconds" }), null)[0]!;
		assert.equal(broken.fact, "Couldn't check");
		assert.equal(broken.tip, "claude --version took longer than 15 seconds", "why, in the tip");
		assert.deepEqual(broken.keys, [{ kind: "check" }]);
	});

	it("the open key takes the server's link", () => {
		const row = cardRows(health({}, { check: "installed", problem: "notInstalled", link: LINK }), null)[0]!;
		assert.deepEqual(row.keys, [{ kind: "open", label: "Get it", href: LINK }]);
	});

	it("an update: Updating, then the check after it; one that failed says so, with the command to run", () => {
		const old = health({}, { check: "upToDate", problem: "tooOld", needs: "2.1.331" });
		assert.deepEqual(said(old, { state: "running", line: "Downloading", command: "claude update" })[0], ["Version", "busy", "Updating", ""]);
		assert.deepEqual(said(old, { state: "done", line: null, command: "claude update" })[0], ["Version", "busy", "Updated", ""], "until the check after it reads the new version");
		const done = cardRows(health(), { state: "done", line: null, command: "claude update" })[0]!;
		assert.equal(done.note, "Updated");
		const failed = cardRows(old, { state: "failed", line: "npm ERR! EACCES", command: "npm install -g @openai/codex@latest" })[0]!;
		assert.equal(failed.fact, "Update didn't finish");
		assert.equal(failed.tip, "npm ERR! EACCES");
		assert.deepEqual(failed.keys, [{ kind: "update", label: "Try again" }]);
		assert.equal(failed.run, "npm install -g @openai/codex@latest");
	});

	it("a sign-in: the breathing square, the code field for Claude Code, Open again and Cancel; one that failed says so", () => {
		const out = { check: "loggedIn", problem: "signedOut" };
		const signing = cardRows(health({ login: { url: "https://claude.ai/oauth", code: true } }, out), null)[1]!;
		assert.equal(signing.mark, "wait");
		assert.equal(signing.fact, "Finish in your browser");
		assert.deepEqual(signing.signing, { code: true, keys: [{ kind: "open", label: "Open again", href: "https://claude.ai/oauth" }, { kind: "cancel" }] });
		assert.equal(cardRows(health({ agent: "codex", login: { url: "https://auth.openai.com/x", code: false } }, out), null)[1]!.signing?.code, false);
		assert.deepEqual(said(health({ login: { failed: "The login took longer than 5 minutes." } }, out))[1], ["Account", "need", "Login didn't finish", "Try again"]);
	});

	it("the learner's own start command: one row, ticked, which takes the version's failures", () => {
		assert.deepEqual(said(health({ ownCommand: true })), [["Own start command", "tick", null, ""]]);
		assert.deepEqual(said(health({ ownCommand: true }, { check: "installed", problem: "notInstalled", link: LINK })), [["Own start command", "need", "Not installed", "Get it"]]);
	});
});

describe("the compact card", () => {
	it("names the agent, since no pick stands beside it, and keeps the failing row's key", () => {
		const sentence = (failed: Parameters<typeof answer>[1], over = {}) => compact(health(over, failed), null)?.sentence;
		assert.equal(sentence({ check: "loggedIn", problem: "signedOut" }), "Claude Code isn't logged in.");
		assert.equal(sentence({ check: "installed", problem: "notInstalled" }, { agent: "codex" }), "Codex isn't installed.");
		assert.equal(sentence({ check: "upToDate", problem: "tooOld", needs: "2.1.331" }), "Claude Code is too old.");
		assert.equal(sentence({ check: "node", problem: "noNode", needs: "18" }), "Claude Code needs Node.js 18 or newer.");
		assert.equal(compact(health({}, { check: "loggedIn", problem: "signedOut" }), null)?.row.id, "account");
		assert.equal(compact(health({}, { check: "upToDate", problem: "tooOld" }), null)?.row.id, "version");
		assert.equal(compact(health(), null), null, "nothing while the agent can run");
	});
});

describe("the answer, read", () => {
	it("keeps only known names, and drops what is not an answer", () => {
		assert.equal(readAgentHealth(null), null);
		assert.equal(readAgentHealth({ agent: "gemini", checks: [] }), null);
		const h = readAgentHealth({ agent: "codex", checks: [{ check: "installed", state: "passed", fact: "0.80.0" }, { check: "teleport", state: "passed" }], failing: { check: "loggedIn", problem: "unknown" } })!;
		assert.deepEqual(h.checks, [{ check: "installed", state: "passed", fact: "0.80.0", failure: null }]);
		assert.equal(h.failing, null, "an unknown problem is no failure");
		assert.deepEqual(readAgentUpdate({ state: "running", line: "", command: "claude update" }), { state: "running", line: null, command: "claude update" });
		assert.equal(readAgentUpdate({ state: "paused", command: "claude update" }), null);
	});
});
