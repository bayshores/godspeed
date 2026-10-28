/**
 * CLASSES WAVE PINS (2026-10-26), Phase 5 — static renders of the class
 * surfaces: the lesson's class card, a Files-page row, and the switcher's
 * closed state outside a provider (reads as "No class").
 */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, it } from "node:test";
import { ClassContextCard } from "../src/components/graph-context-card.tsx";
import { FileRow } from "../src/components/files/file-row.tsx";
import { classQuery, className } from "../src/components/class-context.tsx";

(globalThis as { React?: typeof React }).React = React;

describe("class surfaces", () => {
	it("the class card is collapsed scaffolding naming the class and file count", () => {
		const html = renderToStaticMarkup(
			<ClassContextCard data={{ classId: "cls_a", name: "MATH 20C", description: "Calc III", files: [{ name: "syllabus.pdf", kind: "info", path: "/x" }] }} />,
		);
		assert.ok(html.includes('data-testid="class-context-card"'));
		assert.ok(html.includes("Class context"));
		assert.ok(html.includes("MATH 20C · 1 file"));
		assert.ok(!html.includes("class-context-body"), "collapsed by default");
	});

	it("a file row is draggable, shows Failed + Retry and its studied facts, and always has the ⋯ menu", () => {
		const base = { id: "f_1", name: "notes.md", path: "f_1/notes.md", kind: "study" as const, contentFp: "", addedAt: "" };
		const actions = { onKind: () => {}, onRetry: () => {}, onRemove: () => {} };
		const copied = renderToStaticMarkup(<FileRow file={{ ...base, origin: "copied", status: "failed", error: "boom" }} coverage={undefined} actions={actions} />);
		assert.ok(copied.includes("Failed"));
		assert.ok(copied.includes('data-testid="class-file-retry-f_1"'));
		assert.ok(copied.includes('draggable="true"'));
		assert.ok(!copied.includes("class-file-kind-"), "no Study/Info toggle on the row");
		const linked = renderToStaticMarkup(
			<FileRow file={{ ...base, origin: "linked", status: "ready" }} coverage={{ fileId: "f_1", name: "notes.md", facts: 31, inLessons: 12, share: 12 / 31 }} actions={actions} />,
		);
		assert.ok(!linked.includes("Failed"));
		assert.match(linked, /12\/31.*facts studied/);
		assert.ok(linked.includes('data-testid="class-file-menu-f_1"'), "Move to Course info is always in the ⋯ menu");
	});

	it("class query and name helpers", () => {
		assert.equal(classQuery(null), "?class=none");
		assert.equal(classQuery("cls_x", "&"), "&class=cls_x");
		assert.equal(className([], null), "No class");
		assert.equal(className([{ id: "cls_x", name: "PHYS" } as never], "cls_x"), "PHYS");
	});
});
