import { useEffect, useRef, useState } from "react";
import { Countdown } from "@/frontend/components/countdown";
import { usePillMounted } from "@/frontend/components/notice-store";
import { announceDelay } from "@/frontend/components/teacher/follow-status";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { cn } from "@/frontend/lib/utils";
import { BAR_TAB, BAR_WORD_ON, barTabState } from "./bar-look";
import { Fit } from "./fit";
import { firstWord, noticeCount, shortName, type DueSoon } from "./live-pill-model";
import { NOTICE_STACK_ID } from "./pill-panel";
import { usePill } from "./pill-provider";
import { goLabel } from "./top-bar-model";

/**
 * The pill starts at its shortest (the start of its name, the first word of
 * what happens) and takes free room long before the tabs (which start
 * squeezed) do, up to its whole text. So as the window narrows the unlit
 * tab names give way first, then the pill, then the tabs scroll.
 */
const PILL_FIT = "min-w-auto max-w-max shrink-0 grow-[1000] basis-[min-content]";
/** In a page's own bar the pill gives way, down to its shortest, before the page's title does. */
const OWN_FIT = "min-w-auto shrink-[1000]";

/** The pill with nothing lit: a shade of the bar's ink, so its words, its countdown and its count read as one shape. */
const QUIET = "bg-bar-ink/10 text-bar-ink";
/** A key inside the pill, in the pill's own ink. */
const PILL_KEY = "lh-btn lh-btn-small mr-2 shrink-0";

/**
 * THE LIVE PILL, in every top bar: what is happening now, in one line and
 * one shape. Its words open the teacher's panel on the agent's screen
 * (pill-provider.tsx); while the panel is open the pill is lit as the bar's
 * other words are, and a click closes it. It goes on the highlighter only
 * while something waits for the learner, its square breathes while the
 * teacher works, and a reply waiting in another lesson brings its Open
 * along. Folded notices wait as a count beside the words, which shows
 * them again, and a deadline in its last day ends the pill with its countdown. `own`: it sits in
 * a page's own bar, where it shows only while it has something to say.
 */
export function LivePill({ own = false }: { own?: boolean }) {
	usePillMounted();
	const pill = usePill();
	const teacher = useTeacher();
	const line = pill?.lineAt(own);
	const gone = line?.head === "" && !line.due;
	const notices = pill?.notices ?? false;
	const close = pill?.closeNotices;
	// Its last thing ended while the notices showed: they fold with it.
	useEffect(() => {
		if (gone && notices) close?.();
	}, [gone, notices, close]);
	if (!pill || !line || gone) return null;
	const thing = line.thing;
	const on = pill.on;
	const offer = teacher?.offer ?? null;
	const go = teacher && goLabel({ following: teacher.follow, offer, held: teacher.held });
	// In a page's own bar the idle words are the count already, and the pill itself opens the notices.
	const waiting = own && ((line.idle && !on) || pill.notices) ? 0 : pill.waiting;
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
					</>
				)}
			</span>
		</>
	);
	// The keys and the count take the pill's ink: the page's on the highlighter and on the lit block, the bar's otherwise.
	const bright = on || line.lit;
	return (
		<div data-live-pill="" className={cn("lh-no-drag flex items-center self-stretch", own ? OWN_FIT : PILL_FIT)}>
			<div
				className={cn(
					"flex min-w-0 items-center self-stretch transition-colors duration-(--lh-dur) ease-(--lh-ease-out)",
					on ? (own ? BAR_WORD_ON : barTabState(true)) : line.lit ? "bg-highlight text-ink" : QUIET,
				)}
			>
				{line.head !== "" &&
					(pill.clickable(own) ? (
						<button
							type="button"
							data-testid="live-pill"
							aria-expanded={on || pill.open(own)}
							aria-controls={own && !on && !thing?.needs ? NOTICE_STACK_ID : undefined}
							title={spoken}
							onClick={(e) => pill.click(e.currentTarget, own)}
							className={cn(BAR_TAB, "h-full gap-2.5", !bright && "hover:bg-bar-ink/10")}
						>
							{words}
						</button>
					) : (
						<span data-testid="live-pill" title={spoken} className="flex h-full items-center gap-2.5 px-4 text-[15px] whitespace-nowrap">
							{words}
						</span>
					))}
				{waiting > 0 && (
					<button
						type="button"
						data-testid="live-pill-waiting"
						aria-label={noticeCount(waiting)}
						title={noticeCount(waiting)}
						aria-expanded={pill.notices}
						aria-controls={NOTICE_STACK_ID}
						onClick={(e) => pill.showNotices(e.currentTarget)}
						className="lh-press -ml-1.5 flex shrink-0 items-center self-stretch pr-3"
					>
						<span className={cn("font-count flex h-5 min-w-5 items-center justify-center px-1 text-[13px] leading-none", bright ? "bg-ink/15" : "bg-bar-ink/20")}>{waiting}</span>
					</button>
				)}
				{thing?.action && (
					<button type="button" data-testid="live-pill-act" onClick={() => pill.act(thing)} className={cn(PILL_KEY, "[--lh-key-hover:var(--foreground)] [--lh-key:var(--foreground)] text-background")}>
						Open
					</button>
				)}
				{go && offer && (
					<button type="button" data-testid="follow-go" title={offer.label} onClick={() => teacher.go(offer)} className={cn(PILL_KEY, "lh-btn-bar max-[900px]:hidden")}>
						{go}
					</button>
				)}
				{line.due && <Due due={line.due} onOpen={pill.openDue} />}
			</div>
			{line.thing && <Announce text={spoken} />}
		</div>
	);
}

/** The deadline in its last day, ending the pill in dimmer ink: its name and countdown, which open it. */
function Due({ due, onOpen }: { due: DueSoon; onOpen: (() => void) | null }) {
	const look = "flex min-w-0 shrink-[1000] items-center gap-2 self-stretch pr-4 pl-1 text-[15px] whitespace-nowrap opacity-70 max-[1000px]:hidden";
	const inside = (
		<>
			{/* The name gives all its room up before the tabs are cut; the countdown stays. */}
			<Fit text={due.name} least="" className="max-w-[18ch]" />
			<Countdown due={due} className="font-count shrink-0 text-current!" />
		</>
	);
	return onOpen ? (
		<button type="button" data-testid="live-pill-due" title={due.name} onClick={onOpen} className={cn(look, "lh-press hover:opacity-100")}>
			{inside}
		</button>
	) : (
		<span data-testid="live-pill-due" title={due.name} className={look}>
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
