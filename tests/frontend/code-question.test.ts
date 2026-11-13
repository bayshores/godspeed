/**
 * The write_code question: its input contract, the answer it builds, what
 * the teacher reads back, and the editor's Vim model.
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
} from "../../src/shared/core/code-question.ts";
import { compactAnswerForModel, dismissedAnswer } from "../../src/shared/core/question-core.ts";
import { isQuestionTool, toolQuestionKind } from "../../src/shared/core/pending.ts";
import { parseWriteCodeInput } from "../../src/shared/core/tool-parts.ts";
import { answerForPresentation } from "../../src/shared/core/answer-presentation.ts";
import { highlightsAsCpp, languageLabel, parseVim, vimModeLabel } from "../../src/frontend/components/lesson/code-editor-model.ts";

const task = { question: "Write `int sum(int *a, int n)` that returns the sum of the array.", starter: "int sum(int *a, int n) {\n}\n" };

describe("write_code input", () => {
	it("needs a task; language and starter are optional", () => {
		assert.equal(Value.Check(writeCodeInputSchema, task), true);
		assert.equal(Value.Check(writeCodeInputSchema, { question: "x", language: "c" }), true);
		assert.equal(Value.Check(writeCodeInputSchema, { language: "c" }), false, "no question, no call");
		assert.deepEqual(writeCodeInputProblems(task), []);
		assert.equal(writeCodeInputProblems({ question: "  " }).length, 1, "an empty task is refused");
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
		assert.ok(isQuestionTool("write_code"));
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
