import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

/** "Delete fact?" for one fact or many: its words and buttons. */

import { DeleteNodeBody, DeleteNodeDialog } from "../../src/frontend/components/delete-node-dialog.tsx";

/** The body — pure, so SSR pins everything the live dialog shows. */
function bodyAt(nodes: { id: string; name: string }[], extra?: { failure?: string | null; busy?: boolean }) {
	return renderToStaticMarkup(
		createElement(DeleteNodeBody, {
			nodes,
			busy: extra?.busy ?? false,
			failure: extra?.failure ?? null,
			onClose: () => {},
			onRun: () => {},
		}),
	);
}

describe("DeleteNodeDialog (thin SSR)", () => {
	it("null and empty nodes both render nothing — closed either way", () => {
		for (const nodes of [null, []] as ({ id: string; name: string }[] | null)[]) {
			const html = renderToStaticMarkup(
				createElement(DeleteNodeDialog, { nodes, onClose: () => {}, onDeleted: () => {} }),
			);
			assert.equal(html, "");
		}
	});
});

describe("DeleteNodeBody — the minimal screen", () => {
	it("single: 'Delete fact?' title with Close, the name, the one permanence line, Cancel and a red Delete", () => {
		const html = bodyAt([{ id: "kepler", name: "Kepler's three laws" }]);
		assert.match(html, /data-testid="delete-node-dialog"/);
		assert.match(html, /<h2[^>]*>Delete fact\?</);
		assert.match(html, /data-testid="delete-node-dialog-close"[\s\S]*?Close</);
		assert.match(html, /data-testid="node-name-code"[^>]*font-count[^>]*>Kepler&#x27;s three laws</);
		assert.match(html, /data-testid="node-permanence-line"[^>]*>This permanently deletes the fact\. This cannot be undone\./);
		assert.match(html, /data-testid="node-delete-cancel"[^>]*class="lh-btn text-\[15px\]"/);
		assert.match(html, /data-testid="node-delete-confirm"[^>]*lh-btn-danger/);
	});

	it("NO impact facts, NO loading line, NO sessions join — the pre-flight read is dead", () => {
		const html = bodyAt([{ id: "kepler", name: "Kepler's three laws" }]);
		assert.ok(!html.includes("node-impact-facts"), "no facts list");
		assert.ok(!html.includes("node-impact-loading"), "no loading line");
		assert.ok(!html.includes("Reading what this would remove"), "no fetch copy");
		assert.ok(!html.includes("Referenced by"), "no sessions join");
		assert.ok(!html.includes("links to other topics"), "no edge count — it is obvious");
	});

	it("multi: 'Delete N facts?', names capped at 8 + and-K-more", () => {
		const three = bodyAt([
			{ id: "kepler", name: "Kepler's three laws" },
			{ id: "newton", name: "Newton's second law" },
			{ id: "hook", name: "Hooke's law" },
		]);
		assert.match(three, /Delete 3 facts\?/);
		assert.match(three, /data-testid="node-names-code"/);
		assert.match(three, /Kepler&#x27;s three laws, Newton&#x27;s second law, Hooke&#x27;s law/);
		assert.ok(!three.includes('data-testid="node-name-code"'), "the single-name testid is gone in multi");
		assert.match(three, /This permanently deletes all 3 facts\. This cannot be undone\./);
		assert.ok(!three.includes("proposition"), "the old word is gone from the dialog");

		// the cap: 10 names render 8 + ", and 2 more"
		const ten = bodyAt(Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, name: `Prop ${i}` })));
		assert.match(ten, /Delete 10 facts\?/);
		assert.match(ten, /Prop 7/); // the 8th name still listed
		assert.doesNotMatch(ten, /Prop 8</); // the 9th is not
		assert.match(ten, /, and 2 more/);
	});

	it("failure: the server's sentence with a Try-again", () => {
		const line = "Godspeed is still adding to your graph. Try again when nothing is left under Running in the background in the teacher's Activity.";
		const conflict = bodyAt([{ id: "kepler", name: "Kepler's three laws" }], {
			failure: line,
		});
		assert.match(conflict, /data-testid="node-delete-failure"/);
		assert.ok(conflict.includes("Godspeed is still adding to your graph. Try again when nothing is left under Running in the background in the teacher&#x27;s Activity."));
		assert.ok(!conflict.includes("activity dock"));
		assert.match(conflict, /data-testid="node-delete-retry"/);

		const plain = bodyAt([{ id: "kepler", name: "Kepler's three laws" }], {
			failure: "No such node",
		});
		assert.match(plain, /No such node/); // honest raw line otherwise
	});

	it("busy: the confirm reads 'Deleting…' and both buttons disable", () => {
		const html = bodyAt([{ id: "kepler", name: "Kepler's three laws" }], { busy: true });
		assert.match(html, /Deleting…</);
		assert.match(html, /data-testid="node-delete-cancel"[^>]*disabled/);
		assert.match(html, /data-testid="node-delete-confirm"[^>]*disabled/);
	});
});
