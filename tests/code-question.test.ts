/**
 * The write_code question: its input contract, the answer it builds, what
 * the teacher reads back, the markdown export, and the editor's Vim model.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Value } from "typebox/value";
import {
	buildCodeAnswer,
	codeLanguage,
	fencedCode,
	writeCodeInputProblems,
	writeCodeInputSchema,
} from "../src/core/code-question.ts";
import { compactAnswerForModel, dismissedAnswer } from "../src/core/question-core.ts";
import { QUESTION_TOOLS, toolQuestionKind } from "../src/core/pending.ts";
import { parseWriteCodeInput } from "../src/core/tool-parts.ts";
import { answerForPresentation } from "../src/core/answer-presentation.ts";
import { newAnswerResult, type LhMessage } from "../src/core/native-messages.ts";
import { sessionMarkdown } from "../src/core/session-markdown.ts";
import { serializeForSummary } from "../src/core/compaction.ts";
import { highlightsAsCpp, languageLabel, parseVim, vimModeLabel } from "../src/components/lesson/code-editor-model.ts";
import { writeCodeTool } from "../src/agent/tools.ts";

const task = { question: "Write `int sum(int *a, int n)` that returns the sum of the array.", starter: "int sum(int *a, int n) {\n}\n" };

describe("write_code input", () => {
	it("needs a task; language and starter are optional", () => {
		assert.equal(Value.Check(writeCodeInputSchema, task), true);
		assert.equal(Value.Check(writeCodeInputSchema, { question: "x", language: "c" }), true);
		assert.equal(Value.Check(writeCodeInputSchema, { language: "c" }), false, "no question, no call");
		assert.deepEqual(writeCodeInputProblems(task), []);
		assert.equal(writeCodeInputProblems({ question: "  " }).length, 1, "an empty task is refused");
	});

	it("the tool refuses an empty task back to the teacher and poses a real one", async () => {
		const bad = await writeCodeTool.execute("c1", { question: " " });
		assert.equal((bad as { isError?: boolean }).isError, true);
		const good = await writeCodeTool.execute("c2", task);
		assert.equal((good as { terminate?: boolean }).terminate, true, "a posed question ends the turn");
	});

	it("parses for display like the boundary did, and refuses what it refused", () => {
		assert.deepEqual(parseWriteCodeInput({ ...task, nodeId: "x" }), task, "unknown keys are stripped");
		assert.equal(parseWriteCodeInput({ question: "" }), undefined);
		assert.equal(parseWriteCodeInput("nope"), undefined);
	});

	it("reads the language as one lowercase word, C when absent", () => {
		assert.equal(codeLanguage(undefined), "c");
		assert.equal(codeLanguage(" "), "c");
		assert.equal(codeLanguage("C"), "c");
		assert.equal(codeLanguage("C++"), "cpp");
		assert.equal(codeLanguage("Python"), "python");
	});

	it("is a question tool of its own kind", () => {
		assert.ok((QUESTION_TOOLS as readonly string[]).includes("write_code"));
		assert.equal(toolQuestionKind("write_code"), "code");
		assert.equal(dismissedAnswer(toolQuestionKind("write_code"), "q").kind, "code");
	});
});

describe("the code answer", () => {
	it("carries the code (indentation kept, trailing space trimmed), the language and the thinking", () => {
		const a = buildCodeAnswer(task, { code: "int sum(int *a, int n) {\n    return 0;\n}\n\n", dontKnow: false, thinking: " loop it " }, "write_code");
		assert.equal(a.kind, "code");
		assert.equal(a.tool, "write_code");
		assert.equal(a.code, "int sum(int *a, int n) {\n    return 0;\n}");
		assert.equal(a.language, "c");
		assert.equal(a.thinking, "loop it");
		assert.equal(a.questionText, task.question);
	});

	it("'I don't know' sends no code", () => {
		const a = buildCodeAnswer(task, { code: task.starter, dontKnow: true }, "write_code");
		assert.equal(a.dontKnow, true);
		assert.ok(!("code" in a));
		assert.equal(a.thinking, undefined);
	});

	it("the teacher reads kind, code, language and the learner's additions only", () => {
		const a = buildCodeAnswer({ ...task, language: "cpp" }, { code: "x;", dontKnow: false, thinking: "hm" }, "write_code");
		assert.deepEqual(compactAnswerForModel(a), { kind: "code", code: "x;", language: "cpp", thinking: "hm" });
		const idk = buildCodeAnswer(task, { code: "", dontKnow: true }, "write_code");
		assert.deepEqual(compactAnswerForModel(idk), { kind: "code", dontKnow: true, language: "c" });
	});

	it("presents the question from the call", () => {
		const a = buildCodeAnswer(task, { code: "x;", dontKnow: false }, "write_code");
		assert.equal(answerForPresentation({ ...a, questionText: "old" }, task).questionText, task.question);
	});
});

describe("fencedCode", () => {
	it("fences any code, even code with backtick runs", () => {
		assert.equal(fencedCode("int x;", "c"), "```c\nint x;\n```");
		assert.equal(fencedCode("a ```` b", "md"), "`````md\na ```` b\n`````");
	});
});

describe("write_code in the transcript exports", () => {
	const call: LhMessage = {
		id: "a1",
		role: "assistant",
		content: [{ type: "toolCall", id: "c1", name: "write_code", arguments: task }],
		api: "x",
		provider: "x",
		model: "x",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "toolUse",
		timestamp: 0,
	} as unknown as LhMessage;

	it("the markdown shows the question and the code as a block", () => {
		const answer = buildCodeAnswer(task, { code: "int sum(int *a, int n) {\n    return 0;\n}", dontKnow: false, thinking: "base case" }, "write_code");
		const md = sessionMarkdown([call, newAnswerResult("c1", "write_code", answer)], { anchors: false });
		assert.ok(md.includes("### Code"));
		assert.ok(md.includes(`**Q:** ${task.question}`));
		assert.ok(md.includes("The learner wrote:\n\n```c\nint sum(int *a, int n) {\n    return 0;\n}\n```"));
		assert.ok(md.includes("*(his thinking: base case)*"));
		const idk = sessionMarkdown([call, newAnswerResult("c1", "write_code", buildCodeAnswer(task, { code: "", dontKnow: true }, "write_code"))]);
		assert.ok(idk.includes("The learner did not know."));
	});

	it("the compaction summary input carries the code as text", () => {
		const answer = buildCodeAnswer(task, { code: "return 42;", dontKnow: false }, "write_code");
		const text = serializeForSummary([call, newAnswerResult("c1", "write_code", answer)]);
		assert.ok(text.includes("[RESULT for write_code]"));
		assert.ok(text.includes("return 42;"));
	});
});

describe("the code editor's Vim model", () => {
	it("Vim is off unless stored on", () => {
		assert.equal(parseVim(null), false);
		assert.equal(parseVim("0"), false);
		assert.equal(parseVim("true"), false);
		assert.equal(parseVim("1"), true);
	});

	it("labels each Vim mode", () => {
		assert.equal(vimModeLabel("normal"), "NORMAL");
		assert.equal(vimModeLabel("insert"), "INSERT");
		assert.equal(vimModeLabel("visual"), "VISUAL");
		assert.equal(vimModeLabel("replace"), "REPLACE");
		assert.equal(vimModeLabel("anything"), "NORMAL");
	});

	it("highlights C and C++, and names the language", () => {
		assert.equal(highlightsAsCpp("c"), true);
		assert.equal(highlightsAsCpp("cpp"), true);
		assert.equal(highlightsAsCpp("python"), false);
		assert.deepEqual(["c", "cpp", "python"].map(languageLabel), ["C", "C++", "python"]);
	});
});
