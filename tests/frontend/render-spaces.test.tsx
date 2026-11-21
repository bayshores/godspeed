/**
 * SPACES PINS — static renders of the space
 * surfaces: a Files-page row (its state, its pick, its problem blocks) and
 * the switcher's closed state outside a provider (reads as "No space").
 */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { MemoryRouter } from "react-router";
import { describe, it } from "node:test";
import type { FileWork } from "../../src/shared/core/index.ts";
import { FileRow, type RowPick } from "../../src/frontend/components/files/file-row.tsx";
import { FULL_LINE } from "../../src/frontend/components/files/files-pick-model.ts";
import { spaceQuery, spaceName } from "../../src/frontend/components/space-context.tsx";

(globalThis as { React?: typeof React }).React = React;

describe("space surfaces", () => {
	it("a file row says Study or Info, shows Failed + Retry and its studied facts, and always has the More menu", () => {
		const base = { id: "f_1", name: "notes.md", path: "f_1/notes.md", kind: "study" as const, contentFp: "", addedAt: "" };
		const actions = { onKind: () => {}, onRetry: () => {}, onRemove: () => {} };
		const copied = renderToStaticMarkup(<FileRow file={{ ...base, origin: "copied", status: "failed", error: "boom" }} coverage={undefined} work={undefined} pick="free" onPick={() => {}} boxes={false} teacher="Ada" actions={actions} />);
		assert.ok(copied.includes("Failed"));
		assert.ok(copied.includes('data-testid="space-file-retry-f_1"'));
		assert.match(copied, /data-testid="space-file-kind-f_1"[^>]*>Study</);
		assert.ok(!copied.includes("draggable"), "rows are not dragged between kinds any more");
		const linked = renderToStaticMarkup(
			<FileRow file={{ ...base, origin: "linked", status: "ready" }} coverage={{ fileId: "f_1", name: "notes.md", displayName: "notes", facts: 31, inLessons: 12, share: 12 / 31 }} work={undefined} pick="free" onPick={() => {}} boxes={false} teacher="Ada" actions={actions} />,
		);
		assert.ok(!linked.includes("Failed"));
		assert.match(linked, /12 of 31 facts studied/);
		assert.ok(linked.includes('data-testid="space-file-menu-f_1"'), "Move to Space info is always in the More menu");
	});

	const midterm = { id: "f_mid", origin: "copied" as const, name: "Midterm 2022.pdf", path: "f_mid/Midterm 2022.pdf", kind: "study" as const, contentFp: "", addedAt: "", status: "ready" as const };
	const row = (pick: RowPick, work?: FileWork, boxes = false) =>
		renderToStaticMarkup(
			<MemoryRouter>
				<FileRow file={midterm} coverage={undefined} work={work} pick={pick} onPick={() => {}} boxes={boxes} teacher="Ada" actions={{ onKind: () => {}, onRetry: () => {}, onRemove: () => {} }} />
			</MemoryRouter>,
		);

	it("a file row is one pick button: pressed when picked, held back at the limit", () => {
		const free = row("free");
		assert.match(free, /<button type="button" data-testid="space-file-pick-f_mid" aria-pressed="false" aria-describedby="([^"]+)"/);
		const described = /aria-describedby="([^"]+)"/.exec(free)![1];
		assert.match(free, new RegExp(`id="${described}" hidden="">Study material\\. Turned into facts for the graph\\.<`), "the kind's tip words describe the button");
		assert.match(free, />PDF</, "an unpicked tile shows the file's type");
		assert.match(free, /space-file-pick-f_mid[^]*Midterm 2022\.pdf[^]*>Study<\/span>[^]*<\/button>/, "the name and the kind word are inside the button");
		assert.match(free, /<\/button>[^]*space-file-menu-f_mid/, "More sits beside it");
		assert.ok(!free.includes("data-picked"));
		assert.ok(!free.includes("border-2 border-ink"), "no tick box unless the page is picking");
		const picked = row("picked", undefined, true);
		assert.match(picked, /aria-pressed="true"/);
		assert.ok(picked.includes('data-picked="true"'));
		assert.match(picked, />PDF</, "the tile keeps the file's type");
		assert.match(picked, /<span aria-hidden="true" class="[^"]*bg-tint[^"]*"><svg/, "the tick box is ticked");
		assert.match(row("free", undefined, true), /<span aria-hidden="true" class="[^"]*border-ink[^"]*"><\/span>/, "an unpicked row's box is empty");
		const held = row("held");
		assert.match(held, /data-testid="space-file-pick-f_mid" aria-pressed="false" aria-disabled="true"/, "past the limit a row no longer picks");
		assert.match(held, /opacity-50/, "and looks held back");
		assert.ok(held.includes(`Turned into facts for the graph. ${FULL_LINE}</span>`), "its description says why");
		assert.ok(!free.includes(FULL_LINE), "a free row's does not");
	});

	it("a file's problems take its state's place: blocks, then the words, a link to its lesson when it has one", () => {
		const linked = row("free", { fileId: "f_mid", problems: { done: 5, total: 12 }, lessonId: "chat_7" });
		assert.match(linked, /<\/button>[^]*<a data-testid="space-file-status-f_mid" aria-label="Midterm 2022.pdf, 5 of 12 problems done"[^>]*href="\/chat\/chat_7"/, "the link sits beside the button");
		assert.match(linked, /space-file-blocks-f_mid[^]*5 of 12 problems done<\/span><\/a>/, "blocks, then the words");
		assert.equal((linked.match(/class="size-3 shrink-0 bg-ink"/g) ?? []).length, 5, "done ones inked");
		const alone = row("free", { fileId: "f_mid", problems: { done: 5, total: 12 } });
		assert.ok(!alone.includes("<a"), "with no lesson they are no link");
		assert.match(alone, /space-file-status-f_mid[^]*5 of 12 problems done[^]*<\/button>/, "and sit inside the button");
		const failed = renderToStaticMarkup(
			<MemoryRouter>
				<FileRow file={{ ...midterm, status: "failed" }} coverage={undefined} work={{ fileId: "f_mid", problems: { done: 1, total: 2 } }} pick="free" onPick={() => {}} boxes={false} teacher="Ada" actions={{ onKind: () => {}, onRetry: () => {}, onRemove: () => {} }} />
			</MemoryRouter>,
		);
		assert.match(failed, /<\/button>[^]*space-file-blocks-f_mid[^]*>Failed<[^]*space-file-retry-f_mid/, "a failed file keeps Failed and Retry, after the blocks, beside the button");
	});

	it("space query and name helpers", () => {
		assert.equal(spaceQuery(null), "?space=none");
		assert.equal(spaceQuery("cls_x", "&"), "&space=cls_x");
		assert.equal(spaceName([], null), "No space");
		assert.equal(spaceName([{ id: "cls_x", name: "PHYS" } as never], "cls_x"), "PHYS");
	});
});
