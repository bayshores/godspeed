/**
 * SSR pins — abort-turn-dialog (ESC-abort guard):
 * the confirm popup EVERYWHERE ruling. AbortTurnBody is the pure seam
 * (the DeleteNodeBody pattern); the wrapper owns effects + portal.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AbortTurnBody } from "@/components/abort-turn-dialog";

describe("AbortTurnBody", () => {
	it("turn mode: names the reply, the partial-stays promise, Stop", () => {
		const html = renderToStaticMarkup(
			<AbortTurnBody mode="turn" onClose={() => {}} onConfirm={() => {}} />,
		);
		assert.ok(html.includes('data-testid="abort-turn-dialog"'));
		assert.match(html, /Stop this reply\?/);
		assert.match(html, /What the teacher wrote so far stays in the lesson\./);
		assert.match(html, /Cancel/);
		assert.match(html, /data-testid="abort-turn-confirm"[^>]*>Stop</);
	});

	it("question mode: names the skip, Skip", () => {
		const html = renderToStaticMarkup(
			<AbortTurnBody mode="question" onClose={() => {}} onConfirm={() => {}} />,
		);
		assert.match(html, /Skip this question\?/);
		assert.match(html, /The teacher moves on without it\./);
		assert.match(html, /data-testid="abort-turn-confirm"[^>]*>Skip</);
		// the stop copy must not leak into the skip mode
		assert.ok(!html.includes("Stop this reply"));
	});

	it("a skip during a running reply says the reply stops too", () => {
		const html = renderToStaticMarkup(<AbortTurnBody mode="problem" busy onClose={() => {}} onConfirm={() => {}} />);
		assert.match(html, /Discard this problem\?/);
		assert.match(html, /The teacher&#x27;s reply stops too\./);
	});

	it("the confirm action is the destructive pair, never the cancel", () => {
		const html = renderToStaticMarkup(
			<AbortTurnBody mode="turn" onClose={() => {}} onConfirm={() => {}} />,
		);
		const confirmAt = html.indexOf('data-testid="abort-turn-confirm"');
		const cancelAt = html.indexOf('data-testid="abort-turn-cancel"');
		assert.ok(confirmAt > -1 && cancelAt > -1);
		const confirmBtn = html.slice(confirmAt, html.indexOf("</button>", confirmAt));
		assert.match(confirmBtn, /destructive/);
		const cancelBtn = html.slice(cancelAt, html.indexOf("</button>", cancelAt));
		assert.ok(!cancelBtn.includes("destructive"));
	});
});
