/**
 * The P2 tool-toggle bridge: AgentBuildOptions.toolToggles is
 * first-class — the agent constructors thread it to the factories' enabled?
 * param (an explicit opts.tools registry is never filtered), and the
 * settings write side rejects unknown tool keys against TOGGLEABLE_TOOLS
 * (the definitive adjudicated list — a persisted `quiz: false` would
 * genuinely drop the quiz once the bridge honors the delta).
 *
 * Parser tests are PURE (no fs — parallel-test discipline); the agent
 * construction tests use an in-memory chat fixture like
 * question-tools.test.ts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Type } from "typebox";
import { questionResult } from "../../src/backend/agent/tool-execute.ts";
import { composeInstructions, createPracticeAgent, createProberAgent, createTeacherAgent } from "../../src/backend/agent/teacher-agent.ts";
import { switchedOffToolsNote } from "../../src/shared/core/tool-switches.ts";
import type { ProberToolContext } from "../../src/backend/agent/tools.ts";
import { jobStore } from "../../src/backend/store/jobs.ts";
import { parseAgentSettingsBody } from "../../src/backend/server/settings-body.ts";
import { chatStore } from "../../src/backend/store/chats.ts";
import type { AgentSettings } from "../../src/shared/core/settings.ts";
import { fauxEngine } from "../faux-engine.ts";
// The agent engine loads on first use in the app; agent-building tests load it up front.
await (await import("../../src/backend/agent/engine-load.ts")).loadAgentCore();

describe("AgentBuildOptions.toolToggles (the P2 bridge)", () => {
	const toolNames = (agent: { state: { tools: Array<{ name: string }> } }) =>
		agent.state.tools.map((t) => t.name).sort();

	it("flows into the teacher's registry: a job-tool delta is a no-op on the bare set", () => {
		// No ctx → bare agent: quiz/ask only. A job-tool delta names tools
		// that don't exist there — the bridge must not crash on it.
		const bare = createTeacherAgent(undefined, { engine: fauxEngine(), toolToggles: { research: false } });
		assert.deepEqual(toolNames(bare), ["ask_user_question", "quiz"]);
	});

	it("flows into the prober's registry; probe_done survives everything", () => {
		const chatId = chatStore.createChat("Toggle bridge test").id;
		const ctx: ProberToolContext = { chatId, chatStore, deliver: () => {}, jobStore, spawn: () => {} };
		const prober = createProberAgent(ctx, { engine: fauxEngine(), toolToggles: { ask_user_question: false } });
		const names = toolNames(prober);
		assert.ok(!names.includes("ask_user_question"), "the delta dropped the tool");
		assert.ok(names.includes("probe_done"), "probe_done always-on");
	});

	it("the system prompt names the agent's switched-off tools, and only those", () => {
		const chatId = chatStore.createChat("Toggle note test").id;
		const ctx: ProberToolContext = { chatId, chatStore, deliver: () => {}, jobStore, spawn: () => {} };
		const toolToggles = { research: false, demo: false };
		const prober = createProberAgent(ctx, { engine: fauxEngine(), toolToggles });
		assert.equal(prober.state.systemPrompt, `${composeInstructions("prober")}\n\n---\n\n${switchedOffToolsNote(toolToggles, ["research"])}`);
		assert.ok(!prober.state.systemPrompt.includes("Demos"), "the prober has no demo tool to mention");
		const teacher = createTeacherAgent(undefined, { engine: fauxEngine(), toolToggles });
		assert.ok(teacher.state.systemPrompt.includes("Web research (`research`) and Demos (`demo`)"));
		const allOn = createProberAgent(ctx, { engine: fauxEngine(), toolToggles: { research: true } });
		assert.equal(allOn.state.systemPrompt, composeInstructions("prober"));
	});

	it("practice names only its own switched-off tools", () => {
		const chatId = chatStore.createChat("Practice toggle note test").id;
		const practice = createPracticeAgent({ chatId, chatStore }, { engine: fauxEngine(), toolToggles: { demo: false, visual: false, pdf: false } });
		assert.equal(practice.state.systemPrompt, `${composeInstructions("practice")}\n\n---\n\n${switchedOffToolsNote({ pdf: false }, ["research", "pdf"])}`);
		assert.ok(!practice.state.systemPrompt.includes("Demos"), "practice has no demo tool to mention");
		assert.ok(!practice.state.systemPrompt.includes("Figures"), "practice has no figure tool to mention");
	});

	it("an explicitly injected opts.tools registry is NEVER toggle-filtered", () => {
		const teacher = createTeacherAgent(undefined, {
			engine: fauxEngine(),
			tools: {
				quiz: {
					name: "quiz",
					label: "quiz",
					description: "test",
					parameters: Type.Object({}),
					execute: async () => questionResult(),
				},
			},
			toolToggles: { quiz: false },
		});
		assert.deepEqual(toolNames(teacher), ["quiz"]);
	});
});

describe("parseAgentSettingsBody: tool keys validate at write time", () => {
	const parse = (tools: Record<string, boolean>) =>
		parseAgentSettingsBody({ tools }) as
			| { ok: true; settings: AgentSettings }
			| { ok: false; error: string };

	it("a valid job-tool delta parses", () => {
		const r = parse({ research: false, pdf: false });
		assert.equal(r.ok, true);
		assert.deepEqual(r.ok && r.settings.tools, { research: false, pdf: false });
	});

	it("the quizzing-mechanics key (explain) is writable", () => {
		const r = parse({ explain: true });
		assert.equal(r.ok, true);
		assert.deepEqual(r.ok && r.settings.tools, { explain: true });
	});

	it("unknown keys are rejected with the supported list (the quiz wedge never persists)", () => {
		const r = parse({ quiz: false });
		assert.equal(r.ok, false);
		assert.match(!r.ok && r.error, /unknown tool "quiz" \(supported: research, demo, visual, pdf, explain\)/);
		const typo = parse({ reasearch: false });
		assert.equal(typo.ok, false);
		assert.match(!typo.ok && typo.error, /unknown tool "reasearch"/);
	});

	it("absent tools field is fine (absent = enabled everywhere)", () => {
		const r = parseAgentSettingsBody({}) as { ok: boolean };
		assert.equal(r.ok, true);
	});
});
