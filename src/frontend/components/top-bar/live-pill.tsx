import { useEffect, useRef, useState } from "react";
import { Countdown } from "@/frontend/components/countdown";
import { usePillMounted } from "@/frontend/components/notice-store";
import { announceDelay } from "@/frontend/components/teacher/follow-status";
import { cn } from "@/frontend/lib/utils";
import { firstWord, noticeCount, shortName, type PillThing } from "./live-pill-model";
import { PILL_CARD_ID } from "./pill-panel";
import { usePill } from "./pill-provider";

/**
 * The pill starts at its shortest (the start of its name, the first word of
 * what happens) and takes free room long before the tabs (which start
 * squeezed) do, up to its whole text. So as the window narrows the unlit
 * tab names give way first, then the pill, then the tabs scroll.
 */
const PILL_FIT = "min-w-auto max-w-max shrink-0 grow-[1000] basis-[min-content]";
/** In a page's own bar the pill gives way, down to its shortest, before the page's title does. */
const OWN_FIT = "min-w-auto shrink-[1000]";

/** The pill's own button, for a thing that waits for the learner. */
const OWN_BUTTON = { answer: "Answer", open: "Open" } as const;

/**
 * THE LIVE PILL, in every top bar: what is happening now, in one line. A
 * click opens its card under it (pill-card.tsx) with a row per live thing.
 * It lights up on the highlighter while something is live, its square
 * breathes while the teacher works, and a thing that waits for the learner
 * brings its button along. `own`: it sits in a page's own bar, where it
 * shows only while it has something to say. `named`: the page has a teacher
 * head, so the pill leaves what that says out.
 */
export function LivePill({ own = false, named = false }: { own?: boolean; named?: boolean }) {
	usePillMounted();
	const pill = usePill();
	const line = pill?.lineAt({ own, named });
	const gone = line?.head === "";
	const open = pill?.open ?? false;
	const close = pill?.close;
	// Its last thing ended while its card was open: the card goes with it.
	useEffect(() => {
		if (gone && open) close?.();
	}, [gone, open, close]);
	if (!pill || !line || gone) return null;
	// Open, the pill keeps its name; the card's row says the rest.
	const thing = open ? null : line.thing;
	const tag = open ? null : line.tag;
	// In a page's own bar the idle words are the count already.
	const waiting = open || (own && line.idle) ? 0 : pill.waiting;
	const spoken = [line.head, line.thing?.detail, line.thing?.count].filter(Boolean).join(" ");
	const words = (
		<>
			{thing?.working && <span aria-hidden className="ob-pulse size-2 shrink-0 bg-current" />}
			<span key={`${line.head}|${thing?.detail ?? ""}`} className="lh-pill-line flex items-center gap-2.5">
				{/* A name may be cut short; a sentence (a notice, the idle words) stays whole. */}
				{line.thing ? <Fit text={line.head} least={shortName(line.head)} className="max-w-[26ch]" /> : <span>{line.head}</span>}
				{thing && (
					<>
						{/* What happens gives way before the name, and goes below 760px. */}
						<Fit text={thing.detail} least={firstWord(thing.detail)} className="max-w-[300px] shrink-[1000] max-[760px]:hidden" />
						{thing.count && <span className="font-count shrink-0">{thing.count}</span>}
						{thing.due && <Countdown due={thing.due} className="font-count text-current! shrink-0" />}
					</>
				)}
			</span>
		</>
	);
	return (
		<div data-live-pill="" className={cn("lh-no-drag flex items-center gap-1 self-center px-1", own ? OWN_FIT : PILL_FIT)}>
			<div className={cn("flex h-8 items-center rounded-[2px] transition-colors duration-(--lh-dur) ease-(--lh-ease-out)", line.lit ? "bg-highlight text-ink" : "text-bar-ink hover:bg-bar-ink/10")}>
				<button type="button" data-testid="live-pill" aria-expanded={open} aria-controls={PILL_CARD_ID} title={spoken} onClick={(e) => pill.toggle(e.currentTarget, { own, named })} className="lh-press flex h-full items-center gap-2.5 px-3 text-[15px] whitespace-nowrap">
					{words}
				</button>
				{thing?.action && (
					<button type="button" data-testid="live-pill-act" onClick={() => pill.act(thing)} className="lh-btn mr-0.5 h-7 shrink-0 px-3 [--lh-key-hover:var(--foreground)] [--lh-key:var(--foreground)] text-background">
						{OWN_BUTTON[thing.action]}
					</button>
				)}
			</div>
			{tag && <Tag thing={tag} />}
			{waiting > 0 && (
				<span data-testid="live-pill-waiting" title={noticeCount(waiting)} className="font-count flex h-8 shrink-0 items-center bg-bar-ink/15 px-2 text-[15px] text-bar-ink">
					<span aria-hidden>{waiting}</span>
					<span className="sr-only">{noticeCount(waiting)}</span>
				</span>
			)}
			{line.thing && <Announce text={spoken} />}
		</div>
	);
}

/** Words on one line that give their room up: cut short with an ellipsis,
 *  never below `least`. */
function Fit({ text, least, className }: { text: string; least: string; className: string }) {
	return (
		<span className={cn("grid", className)}>
			{/* Sizing only: at least `least` wide, at most the whole text. */}
			<span aria-hidden className="invisible [grid-area:1/1]">
				{least}
			</span>
			<span aria-hidden className="invisible h-0 overflow-hidden break-all whitespace-normal [grid-area:1/1]">
				{text}
			</span>
			<span className="w-0 min-w-full truncate [grid-area:1/1]">{text}</span>
		</span>
	);
}

/** A second live thing, after the pill: background work's count, or a
 *  deadline with its countdown. */
function Tag({ thing }: { thing: PillThing }) {
	return (
		<span data-testid="live-pill-tag" className={cn("flex h-8 shrink-[1000] items-center gap-2 bg-bar-ink/15 px-2.5 text-[15px] whitespace-nowrap text-bar-ink max-[1000px]:hidden", !thing.due && "font-count")}>
			<Fit text={thing.tag ?? ""} least={shortName(thing.tag ?? "")} className="max-w-[18ch]" />
			{thing.due && <Countdown due={thing.due} className="font-count shrink-0 text-current!" />}
		</span>
	);
}

/** What a screen reader hears: the newest line, at most every few seconds
 *  (a file read in parts would otherwise speak every part). */
function Announce({ text }: { text: string }) {
	const [said, setSaid] = useState(text);
	const lastAt = useRef<number | null>(null);
	useEffect(() => {
		if (text === said) return;
		const t = setTimeout(
			() => {
				lastAt.current = Date.now();
				setSaid(text);
			},
			announceDelay(lastAt.current, Date.now()),
		);
		return () => clearTimeout(t);
	}, [text, said]);
	return (
		<span aria-live="polite" className="sr-only">
			{said}
		</span>
	);
}
