import { useEffect, useRef, useState } from "react";
import { Countdown } from "@/frontend/components/countdown";
import { usePillMounted } from "@/frontend/components/notice-store";
import { announceDelay } from "@/frontend/components/teacher/follow-status";
import { FollowButton } from "@/frontend/components/teacher/follow-button";
import { cn } from "@/frontend/lib/utils";
import { BAR_TAB, BAR_WORD_ON, barTabState } from "./bar-look";
import { firstWord, noticeCount, shortName, type PillThing } from "./live-pill-model";
import { NOTICE_STACK_ID } from "./pill-panel";
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

/**
 * THE LIVE PILL, in every top bar: what is happening now, in one line. A
 * click opens the teacher's panel on the agent's screen (pill-provider.tsx);
 * while the panel is open the pill is lit as the bar's other words are, and
 * a click closes it. It is the bar's button, as Menu is. It lights up on the highlighter while something is live, its square
 * breathes while the teacher works, and a reply waiting in another lesson
 * brings its Open along. Folded notices wait as a count that shows them
 * again. Follow sits beside it while the teacher works. `own`: it sits in a page's own bar, where it shows only while it
 * has something to say. `named`: the page has a teacher head, so the pill
 * leaves what that says out.
 */
export function LivePill({ own = false, named = false }: { own?: boolean; named?: boolean }) {
	usePillMounted();
	const pill = usePill();
	const line = pill?.lineAt({ own, named });
	const gone = line?.head === "";
	const notices = pill?.notices ?? false;
	const close = pill?.closeNotices;
	// Its last thing ended while the notices showed: they fold with it.
	useEffect(() => {
		if (gone && notices) close?.();
	}, [gone, notices, close]);
	if (!pill || !line || gone) return null;
	const thing = line.thing;
	const tag = line.tag;
	const on = pill.on;
	// In a page's own bar the idle words are the count already.
	const waiting = own && line.idle && !on ? 0 : pill.waiting;
	const place = { own, named };
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
						{thing.detail && <Fit text={thing.detail} least={firstWord(thing.detail)} className="max-w-[300px] shrink-[1000] max-[760px]:hidden" />}
						{thing.count && <span className="font-count shrink-0">{thing.count}</span>}
						{thing.due && <Countdown due={thing.due} className="font-count text-current! shrink-0" />}
					</>
				)}
			</span>
		</>
	);
	return (
		<div data-live-pill="" className={cn("lh-no-drag flex items-center gap-1 self-stretch", own ? OWN_FIT : PILL_FIT)}>
			<div className={cn("flex items-center self-stretch transition-colors duration-(--lh-dur) ease-(--lh-ease-out)", on ? (own ? BAR_WORD_ON : barTabState(true)) : line.lit ? "bg-highlight text-ink" : barTabState(false))}>
				{pill.clickable(place) ? (
					<button
						type="button"
						data-testid="live-pill"
						aria-expanded={on || pill.open(place)}
						aria-controls={own && !on && !thing?.needs ? NOTICE_STACK_ID : undefined}
						title={spoken}
						onClick={(e) => pill.click(e.currentTarget, place)}
						className={cn(BAR_TAB, "h-full gap-2.5")}
					>
						{words}
					</button>
				) : (
					<span data-testid="live-pill" title={spoken} className="flex h-full items-center gap-2.5 px-4 text-[15px] whitespace-nowrap">
						{words}
					</span>
				)}
				{thing?.action && (
					<button type="button" data-testid="live-pill-act" onClick={() => pill.act(thing)} className="lh-btn lh-btn-small mr-2 shrink-0 [--lh-key-hover:var(--foreground)] [--lh-key:var(--foreground)] text-background">
						Open
					</button>
				)}
			</div>
			<FollowButton />
			{tag && <Tag thing={tag} onOpen={tag.action ? () => pill.act(tag) : null} />}
			{waiting > 0 && (
				<button
					type="button"
					data-testid="live-pill-waiting"
					aria-expanded={pill.notices}
					aria-controls={NOTICE_STACK_ID}
					title={noticeCount(waiting)}
					onClick={(e) => pill.showNotices(e.currentTarget)}
					className="lh-press font-count flex self-stretch shrink-0 items-center bg-bar-ink/15 px-2 text-[15px] text-bar-ink hover:bg-bar-ink/25"
				>
					<span aria-hidden>{waiting}</span>
					<span className="sr-only">{noticeCount(waiting)}</span>
				</button>
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
 *  deadline with its countdown, which opens the deadline. */
function Tag({ thing, onOpen }: { thing: PillThing; onOpen: (() => void) | null }) {
	const look = cn("flex self-stretch shrink-[1000] items-center gap-2 bg-bar-ink/15 px-2.5 text-[15px] whitespace-nowrap text-bar-ink max-[1000px]:hidden", !thing.due && "font-count");
	const inside = (
		<>
			<Fit text={thing.tag ?? ""} least={shortName(thing.tag ?? "")} className="max-w-[18ch]" />
			{thing.due && <Countdown due={thing.due} className="font-count shrink-0 text-current!" />}
		</>
	);
	return onOpen ? (
		<button type="button" data-testid="live-pill-tag" onClick={onOpen} className={cn(look, "lh-press hover:bg-bar-ink/25")}>
			{inside}
		</button>
	) : (
		<span data-testid="live-pill-tag" className={look}>
			{inside}
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
