import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Countdown } from "@/frontend/components/countdown";
import { keyboardFocus } from "@/frontend/components/focus-hygiene";
import { setNoticesOpen } from "@/frontend/components/notice-store";
import { usePresence } from "@/frontend/components/presence";
import { announceDelay } from "@/frontend/components/teacher/follow-status";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { HELPER_NAME } from "@/frontend/components/work/work-model";
import { cn } from "@/frontend/lib/utils";
import { PEEK_ROWS_ID } from "./peek-sheet";
import { peekKeyboard, stripPointer, stripPressed, tuckPeek, usePeekOut } from "./peek-store";
import { noticeCount, type Square } from "./strip-model";
import { useStrip, type StripState } from "./use-strip";

/** Words set down the strip, read from the top. */
const DOWN = "[writing-mode:vertical-rl] whitespace-nowrap";
/** One row of the peek. */
const ROW = "flex min-h-11 items-center gap-3 px-[18px] py-2 text-left text-[17px]";
/** A row that does something when clicked. */
const ROW_KEY = cn(ROW, "lh-press hover:bg-accent");
/** What waits for the learner, on the highlighter. */
const LIT = "bg-highlight text-ink";

/**
 * THE STRIP down the window's right edge, on every page: the teacher's
 * panel at its narrowest. A square that breathes while the teacher works,
 * the teacher's name, an arrow at the page, and marks only while they have
 * something to say (what waits for the learner on the highlighter, the
 * folded notices' count, a deadline's last-day countdown at its foot). The
 * pointer resting on it slides the peek out (peek-sheet.tsx), which lists
 * what is live with its keys; a click opens the panel beside it, and
 * closes it again. Beside the open panel it is the arrow and the marks
 * alone: the panel's head names the teacher and says what it does.
 */
export function Strip() {
	const strip = useStrip();
	const out = usePeekOut();
	const rows = usePresence(out);
	const button = useRef<HTMLButtonElement>(null);
	const panelOpen = strip?.panelOpen ?? false;
	// Beside the open panel the peek lists only what the panel's head does not say.
	const lists = !!strip && (!panelOpen || strip.view.rows.length > 0 || !!strip.offer || strip.waiting > 0 || !!strip.due);
	const asked = out || !!strip?.noticesOpen;
	useEffect(() => {
		if (out && !lists) tuckPeek();
	}, [out, lists]);
	// What the learner asked to see goes on a click outside it, and on Esc while the keyboard is on it.
	useEffect(() => {
		if (!asked) return;
		const inside = (t: EventTarget | null) => t instanceof Element && !!t.closest("[data-strip], [data-peek]");
		const leave = () => {
			tuckPeek();
			setNoticesOpen(false);
		};
		const onDown = (e: PointerEvent) => {
			if (!inside(e.target)) leave();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || !inside(document.activeElement)) return;
			e.stopPropagation();
			leave();
			button.current?.focus();
		};
		document.addEventListener("pointerdown", onDown);
		document.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("pointerdown", onDown);
			document.removeEventListener("keydown", onKey, true);
		};
	}, [asked]);
	useEffect(() => () => stripPointer(false), []);
	if (!strip) return null;
	const { view, status, name } = strip;
	const host = rows.mounted ? document.getElementById(PEEK_ROWS_ID) : null;
	const flag = view.flag;
	const said = status && (status.working || status.lit) ? status.status : null;
	return (
		<>
			<div
				data-strip=""
				data-open={panelOpen || undefined}
				data-out={out || undefined}
				className="lh-strip bg-bar text-bar-ink"
				onPointerEnter={(e) => e.pointerType === "mouse" && lists && stripPointer(true)}
				onPointerLeave={() => stripPointer(false)}
			>
				<button
					ref={button}
					type="button"
					data-testid="strip"
					aria-label={[name, status?.status, flag].filter(Boolean).join(". ")}
					aria-expanded={panelOpen}
					onClick={() => {
						stripPressed();
						strip.click();
					}}
					onFocus={() => keyboardFocus() && lists && peekKeyboard(true)}
					onBlur={(e) => !(e.relatedTarget instanceof Element && e.relatedTarget.closest("[data-peek]")) && peekKeyboard(false)}
					className="lh-press flex size-full flex-col items-center gap-3 pt-4 pb-3 font-mono text-[13px] hover:bg-bar-ink/10"
				>
					{!panelOpen && (
						<>
							<SquareMark square={view.square} />
							<span className={cn(DOWN, "min-h-0 shrink overflow-hidden text-ellipsis")}>{name}</span>
						</>
					)}
					{/* At the page while the panel is closed, back at the edge while it is open. Still in a lesson. */}
					<span aria-hidden data-beckon={!panelOpen && !strip.inLesson ? "" : undefined} className="lh-strip-arrow flex shrink-0">
						<PixelIcon name="chevron" className={cn("h-[11px]", !panelOpen && "-scale-x-100")} />
					</span>
					<span className="flex-1" />
					{/* The peek says each of these in its rows. */}
					<span className={cn("flex shrink-0 flex-col items-center gap-3", out && "invisible")}>
						{flag && (
							<span data-testid="strip-flag" className={cn(DOWN, LIT, "lh-strip-flag self-stretch px-0 py-2.5 text-center")}>
								{flag}
							</span>
						)}
						{strip.waiting > 0 && (
							<span data-testid="strip-waiting" title={noticeCount(strip.waiting)} className="font-count flex h-5 min-w-5 items-center justify-center bg-bar-ink/20 px-1 text-[13px] leading-none">
								{strip.waiting}
							</span>
						)}
						{strip.due && (
							<span data-testid="strip-due" title={strip.due.name} className={cn(DOWN, "opacity-70")}>
								<Countdown due={strip.due} className="font-count text-current!" />
							</span>
						)}
					</span>
				</button>
			</div>
			{host && createPortal(<PeekRows strip={strip} />, host)}
			{said && <Announce text={`${name}. ${said}`} />}
		</>
	);
}

/** The teacher's square: it breathes while the teacher works, and is hollow while the teacher is off. */
function SquareMark({ square }: { square: Square }) {
	return <span aria-hidden data-square={square} className={cn("size-2 shrink-0", square === "off" ? "border-2 border-current" : "bg-current", square === "working" && "ob-pulse")} />;
}

/** The peek's rows, one per live thing: first the teacher's status, then what waits for the learner, then what works. */
function PeekRows({ strip }: { strip: StripState }) {
	const { view, status } = strip;
	return (
		<>
			{status?.status && (
				<button type="button" data-testid="peek-status" onClick={strip.click} className={cn(ROW, "lh-press gap-2.5", status.lit ? LIT : "hover:bg-accent")}>
					<SquareMark square={view.square} />
					<span className="min-w-0 flex-1">{status.status}</span>
				</button>
			)}
			{view.rows.map((row) =>
				row.kind === "background" ? (
					<button key="background" type="button" data-testid="peek-background" onClick={strip.showHelper} className={cn(ROW, "lh-press", LIT)}>
						{HELPER_NAME} needs you
					</button>
				) : row.kind === "ready" ? (
					<div key={row.lesson.id} data-testid="peek-ready" className={ROW}>
						<span title={row.lesson.title} className="min-w-0 flex-1 truncate">
							{row.lesson.title}
						</span>
						<span className={cn(LIT, "shrink-0 px-1.5 py-0.5")}>your turn</span>
						<button type="button" data-testid="peek-open" onClick={() => strip.openLesson(row.lesson.id)} className="lh-btn shrink-0 text-[15px]">
							Open
						</button>
					</div>
				) : (
					<div key="work" data-testid="peek-work" className={cn(ROW, "text-ink-2")}>
						<span className="min-w-0 flex-1 truncate">{row.work.doing}</span>
						{row.work.count && <span className="font-count shrink-0">{row.work.count}</span>}
					</div>
				),
			)}
			{strip.offer && (
				<div data-testid="peek-offer" className={ROW}>
					<span title={strip.offer.label} className="min-w-0 flex-1 truncate">
						{strip.offer.label}
					</span>
					<button type="button" data-testid="follow-go" onClick={strip.offer.go} className="lh-btn shrink-0 text-[15px]">
						{strip.offer.key}
					</button>
				</div>
			)}
			{strip.waiting > 0 && (
				<button type="button" data-testid="peek-notices" aria-expanded={strip.noticesOpen} onClick={() => setNoticesOpen(!strip.noticesOpen)} className={cn(ROW_KEY, strip.noticesOpen && "bg-accent")}>
					{noticeCount(strip.waiting)}
				</button>
			)}
			{strip.due && <Due strip={strip} />}
		</>
	);
}

/** The deadline in its last day: its name and countdown, which open it. Plain words in that deadline's own lesson. */
function Due({ strip }: { strip: StripState }) {
	const due = strip.due!;
	const inside = (
		<>
			<span title={due.name} className="min-w-0 flex-1 truncate">
				{due.name}
			</span>
			<Countdown due={due} className="font-count shrink-0 text-current!" />
		</>
	);
	return strip.openDue ? (
		<button type="button" data-testid="peek-due" onClick={strip.openDue} className={ROW_KEY}>
			{inside}
		</button>
	) : (
		<div data-testid="peek-due" className={cn(ROW, "text-ink-2")}>
			{inside}
		</div>
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
