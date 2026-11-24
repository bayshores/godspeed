import { memo, useLayoutEffect, useMemo, useRef } from "react";
import type { DeskReading } from "@/shared/core";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { cn } from "@/frontend/lib/utils";
import { textPages } from "./page-stage-model";
import { pdfPageUrl, useReadingDoc, type ReadingDoc } from "./use-reading-doc";

/**
 * THE PAPER ON THE DESK: the front file of the desk's stack as sheets of paper, cut by the
 * stack's well (desk-stack.tsx). While the teacher reads it, the view drifts down through all of
 * it once, then settles on the part being read, whose lines the highlighter marks; before that it
 * lies still on its first page (`still`). The paper itself lies still. The step beside it names
 * the file and the place, so the paper carries no label.
 */

/** PDFs longer than this show only their first pages. */
const MAX_PDF_PAGES = 80;

/** A short text file is a US letter page. */
const LETTER = 8.5 / 11;

/** The paper sits under the front sheet's edge, as wide as the edges, and the well cuts it.
 *  It is a picture of the file, so screen readers skip it. */
const INSET = "px-6";

/** A page is never wider than this, so its type keeps the size of a printed page. */
const PAGE = "mx-auto w-full max-w-[560px]";

/** The file the teacher has open: its pages, which drift through the whole file the first time
 *  and then move to each new place it reads. The highlighter waits while the pages drift, so one
 *  thing moves at a time. */
export function PageStage({ reading, still }: { reading: DeskReading; still: boolean }) {
	const doc = useReadingDoc(reading.path);
	const scrollerRef = useRef<HTMLDivElement>(null);
	const stageRef = useRef<HTMLDivElement>(null);
	const sweptRef = useRef(false);
	const from = reading.kind === "text" ? reading.from : null;
	const to = reading.kind === "text" ? (reading.to ?? reading.from) : null;
	const anchor = reading.kind === "text" ? from : reading.page;

	useLayoutEffect(() => {
		const scroller = scrollerRef.current;
		const stage = stageRef.current;
		if (!doc || !scroller || !stage || still) return;
		const target = scroller.querySelector<HTMLElement>("[data-reading-here]");
		const room = Math.max(0, scroller.scrollHeight - stage.clientHeight);
		const goal = target ? Math.min(room, Math.max(0, target.offsetTop - stage.clientHeight / 3)) : 0;
		const at = new DOMMatrix(getComputedStyle(scroller).transform).m42;
		for (const a of scroller.getAnimations()) a.cancel();
		const end = `translateY(${-goal}px)`;
		scroller.style.transform = end;
		if (prefersReducedMotion()) return;
		let drift: Animation;
		if (!sweptRef.current) {
			// First sight of this file: drift down through all of it, then settle.
			sweptRef.current = true;
			drift = scroller.animate(
				[
					{ transform: "translateY(0)", easing: "cubic-bezier(0.45, 0, 0.55, 1)" },
					{ transform: `translateY(${-room}px)`, offset: 0.75, easing: "cubic-bezier(0.33, 0, 0.2, 1)" },
					{ transform: end },
				],
				{ duration: Math.min(9000, Math.max(2600, scroller.childElementCount * 500)) },
			);
		} else {
			drift = scroller.animate([{ transform: `translateY(${at}px)` }, { transform: end }], { duration: 900, easing: "cubic-bezier(0.33, 0, 0.2, 1)" });
		}
		stage.dataset.drifting = "";
		const settle = () => {
			if (!scroller.getAnimations().some((a) => a !== drift && a.playState === "running")) delete stage.dataset.drifting;
		};
		drift.finished.then(settle, settle);
	}, [doc, anchor, still]);

	return (
		// The file is not lesson text, and Find could never scroll into this stage.
		<div ref={stageRef} data-session-find-exclude="" data-still={still || undefined} className="lh-desk-pages absolute inset-0 overflow-hidden">
			<div aria-hidden className={INSET}>
				<div ref={scrollerRef} className={cn("relative flex flex-col gap-4 will-change-transform", PAGE)}>
					{doc?.kind === "text" && <TextPages text={doc.text} from={from} to={to} />}
					{doc?.kind === "pdf" && reading.kind === "pdf" && <PdfPages path={reading.path} doc={doc} page={reading.page} />}
				</div>
			</div>
		</div>
	);
}

/** One printed page of a text file. The lines being read get the highlighter's bar in the
 *  margin, one stroke drawn down beside them, and the lines around them fade. */
function TextPage({ start, lines, from, to }: { start: number; lines: string[]; from: number | null; to: number | null }) {
	const ranged = from !== null && to !== null;
	const row = (line: string, i: number) => {
		const n = start + i;
		return (
			<div key={n} data-reading-here={n === from ? "" : undefined} className="whitespace-pre-wrap break-words">
				{line || " "}
			</div>
		);
	};
	if (!ranged) return <div className="text-[12px] leading-[1.55]">{lines.map(row)}</div>;
	const a = Math.max(0, from - start);
	const b = Math.min(lines.length, to - start + 1);
	const faded = "opacity-40 transition-opacity duration-500";
	return (
		<div className="text-[12px] leading-[1.55]">
			{a > 0 && <div className={faded}>{lines.slice(0, a).map(row)}</div>}
			{b > a && (
				<div className="lh-read-mark -ml-5 pl-5 text-[#111]">
					{lines.slice(a, b).map((line, i) => row(line, a + i))}
				</div>
			)}
			{b < lines.length && <div className={faded}>{lines.slice(Math.max(a, b)).map((line, i) => row(line, Math.max(a, b) + i))}</div>}
		</div>
	);
}

// Memoized: the file can be megabytes, and the pane re-renders on every stream frame and keystroke.
const TextPages = memo(function TextPages({ text, from, to }: { text: string; from: number | null; to: number | null }) {
	const pages = useMemo(() => textPages(text), [text]);
	return pages.map((page) => (
		<div key={page.start} className="lh-sheet lh-paper px-6 py-5" style={{ aspectRatio: LETTER }}>
			<TextPage start={page.start} lines={page.lines} from={from} to={to} />
		</div>
	));
});

function PdfPages({ path, doc, page }: { path: string; doc: Extract<ReadingDoc, { kind: "pdf" }>; page: number | null }) {
	return Array.from({ length: Math.min(doc.pageCount, MAX_PDF_PAGES) }, (_, i) => i + 1).map((n) => (
		<div key={n} data-reading-here={n === page ? "" : undefined} className="lh-sheet lh-paper relative overflow-hidden" style={{ aspectRatio: doc.aspect }}>
			<img src={pdfPageUrl(path, n)} alt={`Page ${n}`} loading={page !== null && Math.abs(n - page) <= 1 ? "eager" : "lazy"} className="size-full object-contain" />
			{n === page && <span className="lh-read-mark absolute top-0 bottom-0 left-0 w-1.5" />}
		</div>
	));
}
