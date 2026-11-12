/**
 * SPACES PINS — static renders of the space
 * surfaces: the lesson's space card, a Files-page row, and the switcher's
 * closed state outside a provider (reads as "No space").
 */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, it } from "node:test";
import { SpaceContextCard } from "../../src/frontend/components/graph-context-card.tsx";
import { FileRow } from "../../src/frontend/components/files/file-row.tsx";
import { spaceQuery, spaceName } from "../../src/frontend/components/space-context.tsx";

(globalThis as { React?: typeof React }).React = React;

describe("space surfaces", () => {
	it("the space card is collapsed scaffolding naming the space and file count", () => {
		const html = renderToStaticMarkup(
			<SpaceContextCard data={{ spaceId: "cls_a", name: "MATH 20C", description: "Calc III", files: [{ name: "syllabus.pdf", kind: "info", path: "/x" }] }} />,
		);
		assert.ok(html.includes('data-testid="space-context-card"'));
		assert.ok(html.includes("Space context"));
		assert.ok(html.includes("MATH 20C, 1 file"));
		assert.ok(!html.includes("space-context-body"), "collapsed by default");
	});

	it("a file row says Study or Info, shows Failed + Retry and its studied facts, and always has the More menu", () => {
		const base = { id: "f_1", name: "notes.md", path: "f_1/notes.md", kind: "study" as const, contentFp: "", addedAt: "" };
		const actions = { onKind: () => {}, onRetry: () => {}, onRemove: () => {} };
		const copied = renderToStaticMarkup(<FileRow file={{ ...base, origin: "copied", status: "failed", error: "boom" }} coverage={undefined} agentTeaching actions={actions} />);
		assert.ok(copied.includes("Failed"));
		assert.ok(copied.includes('data-testid="space-file-retry-f_1"'));
		assert.match(copied, /data-testid="space-file-kind-f_1"[^>]*>Study</);
		assert.ok(!copied.includes("draggable"), "rows are not dragged between kinds any more");
		const linked = renderToStaticMarkup(
			<FileRow file={{ ...base, origin: "linked", status: "ready" }} coverage={{ fileId: "f_1", name: "notes.md", facts: 31, inLessons: 12, share: 12 / 31 }} agentTeaching actions={actions} />,
		);
		assert.ok(!linked.includes("Failed"));
		assert.match(linked, /12 of 31 facts studied/);
		assert.ok(linked.includes('data-testid="space-file-menu-f_1"'), "Move to Space info is always in the More menu");
	});

	it("space query and name helpers", () => {
		assert.equal(spaceQuery(null), "?space=none");
		assert.equal(spaceQuery("cls_x", "&"), "&space=cls_x");
		assert.equal(spaceName([], null), "No space");
		assert.equal(spaceName([{ id: "cls_x", name: "PHYS" } as never], "cls_x"), "PHYS");
	});
});
