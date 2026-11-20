import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { dom } from "../page-piece-dom.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRoot } from "react-dom/client";
import { PagePiece } from "../../src/frontend/components/citations/page-piece.tsx";
import type { ProblemPiece } from "../../src/shared/core/index.ts";
import { PIECE, PIECE_TEXT, SINGLE_PIECE } from "../piece-fixtures.ts";


/** Mounts a node, runs the checks against it, and cleans up. */
async function mounted(node: React.ReactNode, run: (host: HTMLElement, rerender: (next: React.ReactNode) => Promise<void>) => Promise<void> | void) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	try {
		await act(async () => root.render(node));
		await run(host, (next) => act(async () => root.render(next)));
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
}

const images = (host: HTMLElement) => [...host.querySelectorAll("img")];

describe("PagePiece", () => {
	it("draws each part as its own picture, in the theme's ink at the snapped width, top to bottom", async () => {
		await mounted(<PagePiece piece={PIECE} text={PIECE_TEXT} />, (host) => {
			const imgs = images(host);
			assert.deepEqual(
				imgs.map((i) => i.getAttribute("src")),
				["/api/cited/f_123/page/2?crop=0.1,0.6,0.9,0.95&w=1440&ink=33322c", "/api/cited/f_123/page/3?crop=0.1,0.05,0.9,0.5&w=1440&ink=33322c"],
			);
			for (const img of imgs) {
				assert.equal(img.getAttribute("alt"), "");
				assert.equal(img.getAttribute("loading"), "lazy");
				assert.equal(img.getAttribute("decoding"), "async");
			}
		});
	});

	it("keeps each part's room before its picture arrives, with no frame", async () => {
		await mounted(<PagePiece piece={PIECE} text={PIECE_TEXT} />, (host) => {
			const boxes = images(host).map((i) => i.parentElement!);
			assert.match(boxes[0]!.getAttribute("style") ?? "", /aspect-ratio:\s*1\.7142/);
			assert.doesNotMatch(host.innerHTML, /border|shadow|rounded/);
		});
	});

	it("holds the piece's words once, for screen readers", async () => {
		await mounted(<PagePiece piece={PIECE} text={PIECE_TEXT} />, (host) => {
			const hidden = [...host.querySelectorAll(".sr-only")];
			assert.equal(hidden.length, 1);
			assert.equal(hidden[0]!.textContent, PIECE_TEXT);
			assert.equal(host.textContent, PIECE_TEXT);
		});
	});

	it("asks for the page as printed, on white, with no ink", async () => {
		await mounted(<PagePiece piece={PIECE} text="" printed />, (host) => {
			assert.doesNotMatch(images(host)[0]!.getAttribute("src")!, /ink=/);
			assert.match(images(host)[0]!.parentElement!.className, /bg-white/);
		});
		await mounted(<PagePiece piece={PIECE} text="" />, (host) => assert.doesNotMatch(images(host)[0]!.parentElement!.className, /bg-white/));
	});

	it("draws the same picture quietly at 60 percent", async () => {
		await mounted(<PagePiece piece={PIECE} text="" quiet />, (host) => {
			assert.match(host.querySelector('[data-testid="page-piece"]')!.className, /opacity-60/);
			assert.match(images(host)[0]!.getAttribute("src")!, /ink=33322c/);
		});
	});

	it("shows the words when a picture does not load, and one line when there are none", async () => {
		await mounted(<PagePiece piece={PIECE} text="Show that the sum is even." />, async (host) => {
			await act(async () => images(host)[1]!.dispatchEvent(new dom.window.Event("error")));
			assert.equal(images(host).length, 0);
			assert.match(host.textContent ?? "", /Show that the sum is even\./);
		});
		await mounted(<PagePiece piece={PIECE} text="" />, async (host) => {
			await act(async () => images(host)[0]!.dispatchEvent(new dom.window.Event("error")));
			assert.equal(host.querySelector('[data-testid="page-piece-failed"]')?.textContent, "The page could not be loaded.");
		});
	});

	it("tries again for the next piece after one failed", async () => {
		await mounted(<PagePiece piece={PIECE} text="" />, async (host, rerender) => {
			await act(async () => images(host)[0]!.dispatchEvent(new dom.window.Event("error")));
			assert.equal(images(host).length, 0);
			await rerender(<PagePiece piece={SINGLE_PIECE} text="" />);
			assert.equal(images(host).length, 1);
		});
	});

	it("marks where a problem starts on a page shown whole", async () => {
		const whole: ProblemPiece = { fileId: "f_5", parts: [{ page: 4, crop: [0, 0, 1, 1], aspect: 0.75 }], mark: { page: 4, x: 0.1, y: 0.2, width: 0.3, height: 0.02 } };
		await mounted(<PagePiece piece={whole} text="" />, (host) => {
			const marks = host.querySelectorAll<HTMLElement>('[data-testid="page-mark"]');
			assert.equal(marks.length, 1);
			assert.match(marks[0]!.getAttribute("style") ?? "", /left:\s*10%;\s*top:\s*20%;\s*width:\s*30%;\s*height:\s*2%/);
		});
	});

	it("veils the parts the learner is not on and tells where the one they are on starts", async () => {
		const placed: string[] = [];
		const onPlace = (start: HTMLElement) => placed.push(start.style.top);
		await mounted(<PagePiece piece={PIECE} text="" part="b" onPlace={onPlace} />, async (host, rerender) => {
			const veilsOf = () => [...host.querySelectorAll<HTMLElement>('[data-testid="piece-veil"]')].map((v) => v.getAttribute("style"));
			assert.equal(veilsOf().length, 3, "(a) over two parts and (c)");
			assert.match(veilsOf()[0]!, /top:\s*57\.14/);
			assert.equal(placed.length, 1);
			assert.match(placed[0]!, /^22\.2/);
			assert.equal(host.querySelectorAll("[data-part-current]").length, 1, "where the page under the lesson text rests");
			assert.match(host.querySelector('[data-testid="piece-veil"]')!.className, /opacity-55 bg-\(--lh-sheet\)/);
			await rerender(<PagePiece piece={structuredClone(PIECE)} text="" part="b" onPlace={onPlace} />);
			assert.equal(placed.length, 1, "a rebuilt piece is not placed again");
			await rerender(<PagePiece piece={PIECE} text="" part="a" onPlace={onPlace} />);
			assert.equal(placed.length, 2);
			assert.equal(veilsOf().length, 2, "(b) and (c)");
			await rerender(<PagePiece piece={PIECE} text="" part={null} onPlace={onPlace} />);
			assert.equal(veilsOf().length, 0);
			assert.equal(host.querySelector("[data-part-current]"), null);
		});
	});
});
