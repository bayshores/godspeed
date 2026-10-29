import { useLayoutEffect, useRef } from "react";
import { CheckIcon } from "lucide-react";
import { BrailleSpinner } from "@/components/braille-spinner";
import { prefersReducedMotion } from "@/components/presence";
import { cn } from "@/lib/utils";
import { textPages, type AgentWork, type ReadingTarget } from "./agent-at-work-model";
import { pdfPageUrl, useReadingDoc, type ReadingDoc } from "./use-reading-doc";

/**
 * THE AGENT AT WORK: while the teacher works on a reply, its plan and steps
 * on the left and the file it is reading on the right, as paper pages that
 * drift through the whole document once, settle on the part being read,
 * and float.
 */
export function AgentAtWork({ work, agentName }: { work: AgentWork; agentName: string }) {
	return (
		<div data-testid="agent-at-work" className="flex gap-7 py-2 font-ui">
			<div className="flex w-[260px] shrink-0 flex-col gap-4">
				<div className="text-[13px] text-ink-3">{agentName}</div>
				{work.plan ? <PlanList plan={work.plan} steps={work.steps} /> : <Steps steps={work.steps} working />}
			</div>
			{work.reading && <PageStage reading={work.reading} />}
		</div>
	);
}

function PlanList({ plan, steps }: { plan: NonNullable<AgentWork["plan"]>; steps: string[] }) {
	return (
		<div className="flex flex-col gap-3">
			<div className="text-[15px] text-ink">Plan</div>
			<ol className="flex flex-col gap-3">
				{plan.items.map((item, i) => {
					const state = i < plan.done ? "done" : i === plan.done ? "now" : "next";
					return (
						<li key={`${i}:${item}`} className="flex gap-2.5">
							<span className="flex h-5 w-4 shrink-0 items-center justify-center">
								{state === "done" && <CheckIcon className="size-3.5 text-ink-3" />}
								{state === "now" && <BrailleSpinner label="Working" />}
								{state === "next" && <span className="size-1 bg-tone-2" />}
							</span>
							<div className="flex min-w-0 flex-col gap-2">
								<span className={cn("text-[14.5px] leading-5", state === "now" ? "text-ink" : state === "done" ? "text-ink-3" : "text-ink-3/60")}>{item}</span>
								{state === "now" && <Steps steps={steps} />}
							</div>
						</li>
					);
				})}
			</ol>
		</div>
	);
}

function Steps({ steps, working }: { steps: string[]; working?: boolean }) {
	if (steps.length === 0) return null;
	return (
		<ul className="flex flex-col gap-1.5 font-mono text-[12px] leading-4">
			{steps.map((step, i) => {
				const last = i === steps.length - 1;
				return (
					<li key={`${i}:${step}`} className={cn("lh-step-in flex gap-2 break-words", last ? "text-ink-2" : "text-ink-3")}>
						{working && last && <BrailleSpinner label="Working" />}
						{step}
					</li>
				);
			})}
		</ul>
	);
}

/** PDFs longer than this show only their first pages. */
const MAX_PDF_PAGES = 80;

function PageStage({ reading }: { reading: ReadingTarget }) {
	const doc = useReadingDoc(reading.path);
	const scrollerRef = useRef<HTMLDivElement>(null);
	const stageRef = useRef<HTMLDivElement>(null);
	const sweptRef = useRef<string | null>(null);
	const anchor = reading.kind === "text" ? reading.from : reading.page;

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
		if (sweptRef.current !== reading.path) {
			// First sight of this file: drift down through all of it, then settle.
			sweptRef.current = reading.path;
			const pages = scroller.childElementCount;
			scroller.animate(
				[
					{ transform: "translateY(0)", easing: "cubic-bezier(0.45, 0, 0.55, 1)" },
					{ transform: `translateY(${-room}px)`, offset: 0.75, easing: "cubic-bezier(0.33, 0, 0.2, 1)" },
					{ transform: end },
				],
				{ duration: Math.min(9000, Math.max(2600, pages * 500)) },
			);
		} else {
			scroller.animate([{ transform: `translateY(${at}px)` }, { transform: end }], { duration: 900, easing: "cubic-bezier(0.33, 0, 0.2, 1)" });
		}
	}, [doc, reading.path, anchor]);

	return (
		<div className="flex min-w-0 flex-1 flex-col gap-2">
			<div className="flex items-baseline gap-3 text-[13px]">
				<span className="truncate text-ink-2">{reading.name}</span>
				<span className="shrink-0 font-mono text-[11.5px] text-ink-3">{whereLabel(reading, doc)}</span>
			</div>
			<div ref={stageRef} className="relative h-[340px] overflow-hidden">
				<div className="lh-float h-full px-4 pt-10">
					<div className="lh-float-2 h-full">
						<div ref={scrollerRef} className="relative flex flex-col gap-4 will-change-transform">
							{doc?.kind === "text" && <TextPages text={doc.text} reading={reading} />}
							{doc?.kind === "pdf" && reading.kind === "pdf" && <PdfPages path={reading.path} doc={doc} page={reading.page} />}
						</div>
					</div>
				</div>
				<div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-background to-transparent" />
				<div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-background to-transparent" />
			</div>
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

const PAPER = "bg-[#E9E9E7] text-[#2B2B2B] shadow-[0_18px_40px_rgba(0,0,0,0.75)]";

function TextPages({ text, reading }: { text: string; reading: ReadingTarget }) {
	const from = reading.kind === "text" ? reading.from : null;
	const to = reading.kind === "text" ? (reading.to ?? reading.from) : null;
	return textPages(text).map((page) => (
		<div key={page.start} className={cn(PAPER, "px-6 py-5 font-title text-[10.5px] leading-[1.5]")}>
			{page.lines.map((line, i) => {
				const n = page.start + i;
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
	));
}

function PdfPages({ path, doc, page }: { path: string; doc: Extract<ReadingDoc, { kind: "pdf" }>; page: number | null }) {
	return Array.from({ length: Math.min(doc.pageCount, MAX_PDF_PAGES) }, (_, i) => i + 1).map((n) => (
		<div key={n} data-reading-here={n === page ? "" : undefined} className={cn(PAPER, "relative")} style={{ aspectRatio: doc.aspect }}>
			{/* eslint-disable-next-line @next/next/no-img-element -- a page rendered by our own API, not a static asset */}
			<img src={pdfPageUrl(path, n)} alt={`Page ${n}`} loading={page !== null && Math.abs(n - page) <= 1 ? "eager" : "lazy"} className="size-full object-contain" />
			{n === page && <span className="absolute top-0 bottom-0 left-0 w-0.5 bg-[#1A1A1A]" />}
		</div>
	));
}
