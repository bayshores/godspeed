/**
 * The reply being written tells the markdown it is still streaming, so an
 * unclosed code or diagram fence reads as still drawing; a settled reply's
 * fences are complete.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MessageRow } from "../../src/frontend/components/lesson/message-row.tsx";
import type { LhViewMessage } from "../../src/shared/core/index.ts";

function row(streamingLast: boolean, text = "Here:\n\n```js\nconst x = 1;"): string {
	const view: LhViewMessage = { id: "a1", role: "assistant", parts: [{ type: "text", text }] };
	return renderToStaticMarkup(
		<MessageRow message={view} index={0} echo={false} teachSeam={false} streamingLast={streamingLast} hiddenCalls={null} pageMarks={new Map()} arrive={() => undefined} />,
	);
}

describe("the streaming reply's text", () => {
	it("marks an unclosed fence as still being written", () => {
		assert.ok(row(true).includes('data-incomplete="true"'));
	});

	it("a settled reply has no unfinished fence", () => {
		const html = row(false);
		assert.ok(html.includes('data-streamdown="code-block"'), "the fence still renders");
		assert.ok(!html.includes("data-incomplete"));
	});

	it("a settled reply with ** inside code gets no stray ** after its bold", () => {
		const html = row(false, "The function `start(char** args)` **only returns on failure**.");
		assert.ok(html.includes("only returns on failure"), "the bold text renders");
		assert.ok(!html.includes("**.") && !html.endsWith("**"), "nothing is added after the bold");
		assert.equal(html.split("**").length, 2, "the only ** left is the one in the code");
	});
});
