/**
 * CLASSES WAVE PINS (2026-10-26), Phase 5 — static renders of the class
 * surfaces: the lesson's class card, a class file row, and the switcher's
 * closed state outside a provider (reads as "No class").
 */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, it } from "node:test";
import { ClassContextCard } from "../components/graph-context-card.tsx";
import { ClassFileRow } from "../components/class-dialog.tsx";
import { classQuery, className } from "../components/class-context.tsx";

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

	it("a file row shows kind, status, and Remove only for copied files", () => {
		const base = { id: "f_1", name: "notes.md", path: "f_1/notes.md", kind: "study" as const, contentFp: "", addedAt: "" };
		const copied = renderToStaticMarkup(<ClassFileRow classId="cls_a" file={{ ...base, origin: "copied", status: "failed", error: "boom" }} onChanged={() => {}} onError={() => {}} />);
		assert.ok(copied.includes("Failed"));
		assert.ok(copied.includes("Retry"));
		assert.ok(copied.includes("Remove"));
		const linked = renderToStaticMarkup(<ClassFileRow classId="cls_a" file={{ ...base, origin: "linked", status: "ready" }} onChanged={() => {}} onError={() => {}} />);
		assert.ok(linked.includes("Ready"));
		assert.ok(linked.includes("Folder"));
		assert.ok(!linked.includes("Remove"));
	});

	it("class query and name helpers", () => {
		assert.equal(classQuery(null), "?class=none");
		assert.equal(classQuery("cls_x", "&"), "&class=cls_x");
		assert.equal(className([], null), "No class");
		assert.equal(className([{ id: "cls_x", name: "PHYS" } as never], "cls_x"), "PHYS");
	});
});
