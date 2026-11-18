import { memo, useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { cn } from "@/frontend/lib/utils";
import { textPages, type ReadingTarget } from "./agent-at-work-model";
import type { Arrive } from "./arrivals";
import { pdfPageUrl, useReadingDoc, type ReadingDoc } from "./use-reading-doc";

/**
 * THE PAPER ON THE DESK: the learner's own files as sheets of paper in a well
 * (globals.css .lh-desk-well), cut at its stepped corners. Before the teacher
 * opens a file it is a pile (PaperStack); a file it opens lies on top and the
 * view drifts down through all of it once, then settles on the part being read
 * (PageStage).
 */

/** PDFs longer than this show only their first pages. */
const MAX_PDF_PAGES = 80;

/** Blank paper and a short text file are a US letter page. */
const LETTER = 8.5 / 11;

/** How far each sheet under the top one sticks out, up and to the right. */
const EDGE_STEP = 8;

/** The paper floats about the middle of the well, as tall as its pages are, and the well cuts it.
 *  It is a picture of the file, so screen readers skip it. */
const FLOAT = "px-6 pt-10 [transform-origin:50%_170px]";

function PaperWell({ children }: { children: ReactNode }) {
	return <div className="lh-desk-well lh-sheet relative min-h-0 flex-1 overflow-hidden">{children}</div>;
}

/** The pile before the teacher opens a file: the top sheet (page 1 of `path`, or blank) over
 *  `edges` sheets, which step in from the bottom one up when the desk arrives. A pile on a desk
 *  no agent works at lies still. */
export function PaperStack({ path, edges, still, slot, arrive }: { path: string | null; edges: number; still: boolean; slot: string; arrive: Arrive }) {
	const doc = useReadingDoc(path);
	const first = useMemo(() => (doc?.kind === "text" ? (textPages(doc.text)[0] ?? null) : null), [doc]);
	const under = Array.from({ length: edges }, (_, i) => edges - i);
	const delay = (i: number) => ({ "--lh-block-delay": `${i * 60}ms` }) as CSSProperties;
	return (
		<PaperWell>
			<div aria-hidden className={cn(FLOAT, !still && "lh-float")}>
				<div className={cn("relative mx-auto w-[360px] max-w-[calc(100%-24px)]", !still && "lh-float-2")}>
					{under.map((n, i) => (
						<div
							key={n}
							className={cn("lh-sheet lh-paper absolute inset-0", arrive(`${slot}:sheet:${n}`) && "lh-block-in")}
							style={{ ...delay(i), translate: `${n * EDGE_STEP}px ${-n * EDGE_STEP}px`, "--lh-sheet": `color-mix(in srgb, var(--lh-paper) ${80 - n * 20}%, var(--lh-paper-lip))` } as CSSProperties}
						/>
					))}
					<div
						data-testid="desk-top-sheet"
						className={cn("lh-sheet lh-paper relative overflow-hidden", arrive(`${slot}:sheet:0`) && "lh-block-in", first && "px-6 py-5")}
						style={{ ...delay(edges), aspectRatio: doc?.kind === "pdf" ? doc.aspect : LETTER }}
					>
						{doc?.kind === "pdf" && path && <img src={pdfPageUrl(path, 1)} alt="" className="size-full object-contain" />}
						{first && <TextPage start={first.start} lines={first.lines} from={null} to={null} />}
					</div>
				</div>
			</div>
		</PaperWell>
	);
}

/** The file the teacher has open: its name and place over its pages, which drift through the
 *  whole file the first time and then move to each new place it reads. The pile's float waits
 *  while the pages drift, so one thing moves at a time. */
export function PageStage({ reading, className }: { reading: ReadingTarget; className?: string }) {
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
		if (!doc || !scroller || !stage) return;
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
	}, [doc, anchor]);

	return (
		// The file is not lesson text, and Find could never scroll into this stage.
		<div data-session-find-exclude="" className={cn("flex min-h-0 min-w-0 flex-1 flex-col gap-2", className)}>
			<div className="flex items-baseline gap-3 text-[15px]">
				<span className="truncate text-ink-2" title={reading.name}>
					{reading.name}
				</span>
				<span className="shrink-0 font-count text-ink-2">{whereLabel(reading, doc)}</span>
			</div>
			<PaperWell>
				<div ref={stageRef} className="h-full overflow-hidden">
					<div aria-hidden className={cn("lh-float", FLOAT)}>
						<div className="lh-float-2">
							<div ref={scrollerRef} className="relative flex flex-col gap-4 will-change-transform">
								{doc?.kind === "text" && <TextPages text={doc.text} from={from} to={to} />}
								{doc?.kind === "pdf" && reading.kind === "pdf" && <PdfPages path={reading.path} doc={doc} page={reading.page} />}
							</div>
						</div>
					</div>
				</div>
			</PaperWell>
		</div>
	);
}

function whereLabel(reading: ReadingTarget, doc: ReadingDoc | null): string {
	if (reading.kind === "pdf") {
		const total = doc?.kind === "pdf" ? ` of ${doc.pageCount}` : "";
		return reading.page ? `page ${reading.page}${total}` : "";
	}
	if (reading.from && reading.to) return `lines ${reading.from} to ${reading.to}`;
	return reading.from ? `from line ${reading.from}` : "";
}

/** One printed page of a text file, the lines being read marked in ink. */
function TextPage({ start, lines, from, to }: { start: number; lines: string[]; from: number | null; to: number | null }) {
	return (
		<div className="text-[10.5px] leading-[1.5]">
			{lines.map((line, i) => {
				const n = start + i;
				const lit = from !== null && to !== null && n >= from && n <= to;
				return (
					<div
						key={n}
						data-reading-here={n === from ? "" : undefined}
						className={cn("-ml-2 border-l-2 pl-1.5 whitespace-pre-wrap break-words", lit ? "border-[#1A1A1A] bg-black/[0.07] text-[#111]" : "border-transparent")}
					>
						{line || " "}
					</div>
				);
			})}
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
			{n === page && <span className="absolute top-0 bottom-0 left-0 w-0.5 bg-[#1A1A1A]" />}
		</div>
	));
}
