import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { LessonDocument } from "@/shared/core";
import { LoadFailed } from "@/frontend/components/load-failed";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { pageSrc, pieceWidth } from "@/frontend/components/citations/page-piece-model";
import { SteadyImg } from "@/frontend/components/citations/steady-img";
import { useAppearance } from "@/frontend/components/settings/appearance";
import { SELECT, SELECT_ARROW } from "@/frontend/components/ui/field";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { useElementWidth } from "@/frontend/lib/use-element-width";
import { pageAspects, pageAt, scrollTarget, type PageBox, type ProblemPlace } from "./document-model";
import { DockPanel } from "./lesson-dock";

const pct = (n: number) => `${n * 100}%`;
/** Wide enough that a letter page's text reads at about a printed size. */
const DOCUMENT_W = 520;

/**
 * THE DOCUMENT BESIDE A LESSON built on files, in the panel beside its page (DockPanel): the
 * shown file's pages one under another, fit to the panel's width and drawn in the theme's ink as
 * the problem's own piece is. The open problem is boxed on its page, and the view goes to it when
 * the panel opens, when the problem changes and when "Your turn"'s page key asks (`seq`). The
 * header holds the picker when the lesson has several files, the page in view and Close.
 */
export function DocumentPanel({
	choices,
	shown,
	place,
	seq,
	onPick,
	onRetry,
	onClose,
}: {
	/** The picker's files, the lesson's PDFs with the list's file first. */
	choices: readonly LessonDocument[];
	/** The PDF shown. */
	shown: LessonDocument;
	/** Where the open problem is printed, in any of the lesson's files. */
	place: ProblemPlace | null;
	/** Goes up each time the open problem is asked for again. */
	seq: number;
	onPick: (fileId: string) => void;
	/** Reads the lesson's files again, for a PDF that did not open. */
	onRetry: () => void;
	onClose: () => void;
}) {
	const [inView, setInView] = useState(1);
	const pages = shown.pages;
	const count = pages !== undefined && <span className="tabular-nums">{`Page ${Math.min(inView, pages)} of ${pages}`}</span>;
	return (
		<DockPanel
			testId="document-dock"
			label="Document"
			defaultWidth={DOCUMENT_W}
			onClose={onClose}
			header={
				choices.length > 1 ? (
					// The picker keeps room to name the file; the page in view goes under it when both do not fit.
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
						<div className="relative min-w-[min(14rem,100%)] flex-1">
							<select data-testid="document-dock-pick" aria-label="Which document" value={shown.id} onChange={(e) => onPick(e.target.value)} className={SELECT}>
								{choices.map((d) => (
									<option key={d.id} value={d.id}>
										{d.name}
									</option>
								))}
							</select>
							<PixelIcon name="chevron" className={SELECT_ARROW} />
						</div>
						{count && (
							<span data-testid="document-dock-page" className="shrink-0 px-1 text-[15px] text-ink-2">
								{count}
							</span>
						)}
					</div>
				) : (
					<span data-testid="document-dock-page" className="min-w-0 flex-1 truncate px-1 text-[15px] font-medium text-ink">
						{count}
					</span>
				)
			}
		>
			{pages === undefined || shown.aspect === undefined ? (
				<LoadFailed message="Couldn't open this document." onRetry={onRetry} className="px-5 py-4" />
			) : (
				<DocumentPages key={shown.id} fileId={shown.id} pages={pages} aspect={shown.aspect} place={place?.fileId === shown.id ? place : null} seq={seq} onInView={setInView} />
			)}
		</DockPanel>
	);
}

function DocumentPages({ fileId, pages, aspect, place, seq, onInView }: { fileId: string; pages: number; aspect: number; place: ProblemPlace | null; seq: number; onInView: (page: number) => void }) {
	const { bodyInk } = useAppearance();
	const scrollerRef = useRef<HTMLDivElement>(null);
	const [width, stackRef] = useElementWidth<HTMLDivElement>(0);
	// A panel dragged narrower keeps the pictures it has.
	const widest = useRef(0);
	widest.current = Math.max(widest.current, width);
	const asked = widest.current > 0 ? pieceWidth(widest.current, window.devicePixelRatio || 1) : 0;
	const aspects = pageAspects(pages, aspect, place, fileId);
	const [failed, setFailed] = useState<ReadonlySet<number>>(new Set());
	const [tries, setTries] = useState<ReadonlyMap<number, number>>(new Map());

	const tops = useCallback(() => [...(stackRef.current?.children ?? [])].map((el) => (el as HTMLElement).offsetTop), [stackRef]);
	const frame = useRef(0);
	const follow = useCallback(() => {
		cancelAnimationFrame(frame.current);
		frame.current = requestAnimationFrame(() => {
			const scroller = scrollerRef.current;
			if (scroller) onInView(pageAt(tops(), scroller.scrollTop, scroller.clientHeight));
		});
	}, [onInView, tops]);

	// The view stays on the problem while the learner has not scrolled away, through a panel
	// that is resized too. It glides to a new problem and jumps when the panel opens or resizes.
	const held = useRef(true);
	const focusKey = `${place ? JSON.stringify(place) : ""}|${seq}`;
	const scrolledFor = useRef<string | null>(null);
	useLayoutEffect(() => {
		held.current = true;
	}, [focusKey]);
	useLayoutEffect(() => {
		const scroller = scrollerRef.current;
		if (!scroller || width === 0) return;
		const page = place && (stackRef.current?.children[place.page - 1] as HTMLElement | undefined);
		if (page && held.current) {
			const box = place.boxes.find((b) => b.page === place.page) ?? null;
			const top = scrollTarget({ top: page.offsetTop, height: page.firstElementChild?.clientHeight ?? page.clientHeight }, box, scroller.clientHeight, scroller.scrollHeight - scroller.clientHeight);
			const glide = scrolledFor.current !== null && scrolledFor.current !== focusKey && !prefersReducedMotion();
			scroller.scrollTo({ top, behavior: glide ? "smooth" : "auto" });
		}
		scrolledFor.current = focusKey;
		follow();
	}, [focusKey, width, follow, stackRef]);

	return (
		<div
			ref={scrollerRef}
			data-testid="document-pages"
			tabIndex={0}
			role="region"
			aria-label="Pages"
			onScroll={follow}
			onWheel={() => (held.current = false)}
			onTouchStart={() => (held.current = false)}
			onPointerDown={() => (held.current = false)}
			onKeyDown={() => (held.current = false)}
			className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background px-3 pt-3 pb-4"
		>
			<div ref={stackRef} className="flex flex-col gap-3">
				{aspects.map((a, i) => {
					const n = i + 1;
					return (
						<DocumentPage
							key={n}
							n={n}
							aspect={a}
							src={asked > 0 ? pageSrc(fileId, n, asked, bodyInk) : null}
							tries={tries.get(n) ?? 0}
							failed={failed.has(n)}
							boxes={place ? place.boxes.filter((b) => b.page === n) : []}
							holdsProblem={!!place && (place.page === n || place.boxes.some((b) => b.page === n))}
							onFail={() => setFailed((s) => new Set(s).add(n))}
							onRetry={() => {
								setFailed((s) => new Set([...s].filter((p) => p !== n)));
								setTries((m) => new Map(m).set(n, (m.get(n) ?? 0) + 1));
							}}
						/>
					);
				})}
			</div>
		</div>
	);
}

/** One page: a sheet of the page's shape that draws its picture once it nears the view. Its box is
 *  only drawn, so the picture's text says the open problem is on it. */
function DocumentPage({ n, aspect, src, tries, failed, boxes, holdsProblem, onFail, onRetry }: { n: number; aspect: number; src: string | null; tries: number; failed: boolean; boxes: readonly PageBox[]; holdsProblem: boolean; onFail: () => void; onRetry: () => void }) {
	return (
		<div data-testid="document-page" data-page={n} className="lh-sheet">
			<div data-picture="" className="relative w-full" style={{ aspectRatio: aspect }}>
				{failed ? (
					<LoadFailed message={`Couldn't load page ${n}.`} onRetry={onRetry} className="absolute inset-0 justify-center px-4 py-0" />
				) : (
					src && <SteadyImg key={tries} src={src} alt={holdsProblem ? `Page ${n}, the open problem is on this page` : `Page ${n}`} onFail={onFail} />
				)}
				{boxes.map((b, i) => (
					<span key={i} aria-hidden data-testid="document-box" className="lh-doc-box pointer-events-none absolute" style={{ left: pct(b.x), top: pct(b.y), width: pct(b.w), height: pct(b.h) }} />
				))}
			</div>
		</div>
	);
}
