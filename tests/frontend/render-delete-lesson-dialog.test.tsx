import React from "react";
(globalThis as Record<string, unknown>).React = React;

import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DeleteLessonBody, DeleteLessonDialog, TRACES_COPY } from "../../src/frontend/components/lessons/delete-lesson-dialog.tsx";

/** The delete dialog's plain-language copy (the graph-touching option says so). */

describe("Delete lesson dialog", () => {
	it("closed (chat=null) renders nothing", () => {
		const html = renderToStaticMarkup(
			<DeleteLessonDialog chat={null} onClose={() => {}} onDeleted={() => {}} />,
		);
		assert.equal(html, "");
	});

	it("is titled 'Delete lesson?' with the lesson's name under it", () => {
		const html = renderToStaticMarkup(
			<DeleteLessonBody
				chat={{ id: "c1", title: "Orbital mechanics" }}
				traces={false}
				busy={false}
				failure={null}
				onTraces={() => {}}
				onClose={() => {}}
				onRun={() => {}}
			/>,
		);
		assert.match(html, /<h2[^>]*>Delete lesson\?<\/h2>/);
		assert.match(html, /data-testid="delete-lesson-name"[^>]*>Orbital mechanics</);
		assert.ok(html.includes("its messages, background jobs and graph-building history"), "the words the learner already sees");
		assert.ok(!html.includes("extraction"));
	});

	it("one unchecked-by-default checkbox for the graph traces — the graph-touching consequence says so", () => {
		const html = renderToStaticMarkup(
			<DeleteLessonBody
				chat={{ id: "c1", title: "Orbital mechanics" }}
				traces={false}
				busy={false}
				failure={null}
				onTraces={() => {}}
				onClose={() => {}}
				onRun={() => {}}
			/>,
		);
		// unchecked by default (preserve-graph) — React SSR omits the
		// attribute when false, so pin its ABSENCE on the rendered input
		assert.ok(!/"checked"/.test(html), "unchecked by default");
		// plain-language consequences on the checkbox body
		assert.ok(html.includes(TRACES_COPY.title));
		assert.ok(html.includes("leave the graph too"));
		assert.ok(html.includes("survive"));
		// the old two-button design is gone
		assert.ok(!html.includes("delete-option-preserve"));
		assert.ok(!html.includes("delete-option-nodes"));
	});

	it("foot: Cancel and the red Delete", () => {
		const html = renderToStaticMarkup(
			<DeleteLessonBody
				chat={{ id: "c1", title: "Orbital mechanics" }}
				traces={true}
				busy={true}
				failure={null}
				onTraces={() => {}}
				onClose={() => {}}
				onRun={() => {}}
			/>,
		);
		assert.match(html, /data-testid="delete-cancel"[^>]*>Cancel</);
		const del = html.match(/data-testid="delete-confirm"[^>]*>/)?.[0] ?? "";
		assert.match(del, /lh-btn-danger/);
		assert.match(html, /data-testid="delete-confirm"[^>]*>Deleting…</); // busy label on Delete
		// the checkbox survives a busy render (disabled, not unmounted)
		assert.match(html, /data-testid="delete-traces-checkbox"[^>]*disabled=""/);
	});
});