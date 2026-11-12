/**
 * SSR pins — abort-turn-dialog (ESC-abort guard):
 * the confirm popup EVERYWHERE ruling. AbortTurnBody is the pure seam
 * (the DeleteNodeBody pattern); the wrapper owns effects + portal.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AbortTurnBody } from "@/frontend/components/abort-turn-dialog";

describe("AbortTurnBody", () => {
	it("turn mode: names the reply, the partial-stays promise, Stop reply", () => {
		const html = renderToStaticMarkup(
			<AbortTurnBody mode="turn" onClose={() => {}} onConfirm={() => {}} />,
		);
		assert.ok(html.includes('data-testid="abort-turn-dialog"'));
		assert.match(html, /Stop this reply\?/);
		assert.match(html, /What Teacher wrote so far stays in the lesson\./);
		assert.match(html, /Cancel/);
		assert.match(html, /data-testid="abort-turn-confirm"[^>]*>Stop reply</);
	});

	it("question mode: names the skip, Skip", () => {
		const html = renderToStaticMarkup(
			<AbortTurnBody mode="question" onClose={() => {}} onConfirm={() => {}} />,
		);
		assert.match(html, /Skip this question\?/);
		assert.match(html, /Teacher moves on without it\./);
		assert.match(html, /data-testid="abort-turn-confirm"[^>]*>Skip question</);
		// the stop copy must not leak into the skip mode
		assert.ok(!html.includes("Stop this reply"));
	});

	it("a skip during a running reply says the reply stops too", () => {
		const html = renderToStaticMarkup(<AbortTurnBody mode="problem" busy onClose={() => {}} onConfirm={() => {}} />);
		assert.match(html, /Discard this problem\?/);
		assert.match(html, /Teacher&#x27;s reply stops too\./);
	});

	it("only Discard problem is red; Stop reply and Skip question are the filled main button", () => {
		const confirmOf = (mode: "turn" | "question" | "problem") => {
			const html = renderToStaticMarkup(<AbortTurnBody mode={mode} onClose={() => {}} onConfirm={() => {}} />);
			const at = html.indexOf('data-testid="abort-turn-confirm"');
			return html.slice(at, html.indexOf("</button>", at));
		};
		assert.match(confirmOf("problem"), /lh-btn-danger/);
		assert.match(confirmOf("problem"), />Discard problem$/);
		assert.match(confirmOf("turn"), /lh-btn-main/);
		assert.match(confirmOf("question"), /lh-btn-main/);
		const html = renderToStaticMarkup(<AbortTurnBody mode="turn" onClose={() => {}} onConfirm={() => {}} />);
		const cancelAt = html.indexOf('data-testid="abort-turn-cancel"');
		assert.ok(!html.slice(cancelAt, html.indexOf("</button>", cancelAt)).includes("lh-btn-"));
	});
});
