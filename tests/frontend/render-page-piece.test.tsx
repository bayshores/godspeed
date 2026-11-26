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
	it("draws each part as its own picture, in the theme's ink at the snapped width, top to bottom, with a line of the page above and under", async () => {
		await mounted(<PagePiece piece={PIECE} text={PIECE_TEXT} />, (host) => {
			const imgs = images(host);
			assert.deepEqual(
				imgs.map((i) => i.getAttribute("src")),
				["/api/cited/f_123/page/2?crop=0.1,0.57,0.9,0.95&w=1440&ink=cfcfcf", "/api/cited/f_123/page/3?crop=0.1,0.05,0.9,0.53&w=1440&ink=cfcfcf"],
			);
			for (const img of imgs) {
				assert.equal(img.getAttribute("alt"), "");
				assert.equal(img.getAttribute("loading"), "lazy");
				assert.equal(img.getAttribute("decoding"), "async");
			}
		});
	});

	it("keeps each part's room before its picture arrives, with no frame and no gap: one sheet", async () => {
		await mounted(<PagePiece piece={PIECE} text={PIECE_TEXT} />, (host) => {
			const boxes = images(host).map((i) => i.parentElement!);
			assert.match(boxes[0]!.getAttribute("style") ?? "", /aspect-ratio:\s*1\.5789/);
			assert.doesNotMatch(host.innerHTML, /border|shadow|rounded/);
			assert.doesNotMatch(host.querySelector('[data-testid="page-piece"]')!.className, /gap-/);
		});
	});

	it("bars the problem's own lines in the margin, still, and not the lines around it", async () => {
		await mounted(<PagePiece piece={PIECE} text="" part="b" />, (host) => {
			const bars = [...host.querySelectorAll<HTMLElement>('[data-testid="piece-bar"]')];
			assert.equal(bars.length, 2, "the stem on page 2, and (b) on page 3");
			assert.ok(bars.every((bar) => /lh-read-mark lh-read-mark-still/.test(bar.className)));
			assert.match(bars[1]!.getAttribute("style")!, /top:\s*20\.83/);
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

	it("asks for the page as printed, with no ink, on one sheet of white paper", async () => {
		const sheet = (host: HTMLElement) => host.querySelector('[data-testid="page-piece"]')!.className;
		await mounted(<PagePiece piece={PIECE} text="" printed />, (host) => {
			assert.doesNotMatch(images(host)[0]!.getAttribute("src")!, /ink=/);
			assert.match(sheet(host), /lh-printed/);
			assert.doesNotMatch(host.innerHTML, /bg-white"[^>]*><img/, "no white strip of its own under a part");
		});
		await mounted(<PagePiece piece={PIECE} text="" />, (host) => assert.doesNotMatch(sheet(host), /lh-printed/));
	});

	it("draws the same picture quietly at 60 percent", async () => {
		await mounted(<PagePiece piece={PIECE} text="" quiet />, (host) => {
			assert.match(host.querySelector('[data-testid="page-piece"]')!.className, /opacity-60/);
			assert.match(images(host)[0]!.getAttribute("src")!, /ink=cfcfcf/);
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

	it("keeps its picture while its column changes width, and asks again only once the column is wider than it was", async () => {
		let boxWidth = 600;
		const resized: (() => void)[] = [];
		const { ResizeObserver: before } = globalThis as unknown as { ResizeObserver: unknown };
		Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", { get: () => boxWidth, configurable: true });
		Object.assign(globalThis, {
			ResizeObserver: class {
				constructor(callback: () => void) {
					resized.push(callback);
				}
				observe() {}
				disconnect() {}
			},
		});
		const resize = (w: number) => act(async () => ((boxWidth = w), resized.forEach((r) => r())));
		const sources = (host: HTMLElement) => images(host).map((i) => [i.getAttribute("src")!.replace(/^.*&w=(\d+).*$/, "$1"), i.getAttribute("aria-hidden") === "true" ? "loading" : "shown"]);
		try {
			await mounted(<PagePiece piece={SINGLE_PIECE} text="" />, async (host) => {
				assert.deepEqual(sources(host), [["1440", "shown"]]);
				await resize(300);
				assert.deepEqual(sources(host), [["1440", "shown"]], "narrower: the same picture, asked for once");
				await resize(800);
				assert.deepEqual(sources(host), [["1440", "shown"], ["1920", "loading"]], "wider: the drawn picture stays while a sharper one loads");
				await act(async () => images(host)[1]!.dispatchEvent(new dom.window.Event("load")));
				assert.deepEqual(sources(host), [["1920", "shown"]]);
				await resize(700);
				assert.deepEqual(sources(host), [["1920", "shown"]]);
			});
		} finally {
			Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", { get: () => 600, configurable: true });
			Object.assign(globalThis, { ResizeObserver: before });
		}
	});

	it("marks where a problem starts on a page shown whole", async () => {
		const whole: ProblemPiece = { fileId: "f_5", parts: [{ page: 4, crop: [0, 0, 1, 1], aspect: 0.75 }], mark: { page: 4, x: 0.1, y: 0.2, width: 0.3, height: 0.02 } };
		await mounted(<PagePiece piece={whole} text="" />, (host) => {
			const marks = host.querySelectorAll<HTMLElement>('[data-testid="page-mark"]');
			assert.equal(marks.length, 1);
			assert.match(marks[0]!.getAttribute("style") ?? "", /left:\s*10%;\s*top:\s*20%;\s*width:\s*30%;\s*height:\s*2%/);
		});
	});

	it("as the whole page: each page from its top or to its foot, no fading edge, and it tells where the problem starts", async () => {
		const placed: string[] = [];
		await mounted(<PagePiece piece={PIECE} text="" whole onPlace={(start) => placed.push(start.style.top)} />, (host) => {
			assert.deepEqual(
				images(host).map((i) => i.getAttribute("src")),
				["/api/cited/f_123/page/2?crop=0.1,0,0.9,0.95&w=1440&ink=cfcfcf", "/api/cited/f_123/page/3?crop=0.1,0.05,0.9,1&w=1440&ink=cfcfcf"],
			);
			assert.equal(host.querySelectorAll('[data-testid="piece-edge"]').length, 0);
			assert.equal(host.querySelectorAll('[data-testid="piece-veil"]').length, 2, "the page over the problem and the page under it");
			assert.equal(placed.length, 1);
			assert.match(placed[0]!, /^63\.15/);
		});
	});

	it("veils the parts the learner is not on and tells where the one they are on starts", async () => {
		const placed: string[] = [];
		const onPlace = (start: HTMLElement) => placed.push(start.style.top);
		await mounted(<PagePiece piece={PIECE} text="" part="b" onPlace={onPlace} />, async (host, rerender) => {
			const veilsOf = () => [...host.querySelectorAll<HTMLElement>('[data-testid="piece-veil"]')].map((v) => v.getAttribute("style"));
			assert.equal(veilsOf().length, 4, "the line above, (a) over two parts, and (c) with the line under it");
			assert.match(veilsOf()[0]!, /top:\s*0%/);
			assert.match(veilsOf()[1]!, /top:\s*60\.52/);
			assert.equal(placed.length, 1);
			assert.match(placed[0]!, /^20\.83/);
			assert.equal(host.querySelectorAll("[data-part-current]").length, 1, "where the page under the lesson text rests");
			assert.match(host.querySelector('[data-testid="piece-veil"]')!.className, /opacity-55 bg-\(--lh-sheet\)/);
			await rerender(<PagePiece piece={structuredClone(PIECE)} text="" part="b" onPlace={onPlace} />);
			assert.equal(placed.length, 1, "a rebuilt piece is not placed again");
			await rerender(<PagePiece piece={PIECE} text="" part="a" onPlace={onPlace} />);
			assert.equal(placed.length, 2);
			assert.equal(veilsOf().length, 2, "the line above, and (b) through (c) and the line under it as one veil");
			await rerender(<PagePiece piece={PIECE} text="" part={null} onPlace={onPlace} />);
			assert.equal(veilsOf().length, 2, "only the lines around the problem");
			assert.equal(host.querySelector("[data-part-current]"), null);
		});
	});
});
