import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { usePresence } from "@/frontend/components/presence";
import { cn } from "@/frontend/lib/utils";
import { TeacherActivity } from "./teacher-activity";
import { useTeacher } from "./teacher-context";

/** The head's words are in the screen's font; its keys are plain words. */
const TYPE = "font-mono text-[13px]";
const KEY = cn("lh-btn lh-btn-quiet h-8 shrink-0", TYPE);
/** A key held down: Follow while it is on, Activity while its list is open. */
const HELD = "text-ink [--lh-key:var(--lh-key-hover)]";
/** A key that needs the learner: lit like the chip that says so. */
const LIT_KEY = "[--lh-key:var(--lh-highlight)] [--lh-key-hover:color-mix(in_srgb,var(--lh-highlight)_85%,#fff)] text-ink";

/**
 * The panel's one head row: the screen's status (lit while it needs the
 * learner, its words fading from one to the next, a breathing square while
 * the teacher works), then the key to background
 * work's screen while that needs the learner, Follow (held down while the
 * window goes where the teacher works), and Activity, which drops
 * the Activity list over the top of the screen. Background work's screen
 * has its name first, and Back. The pill that opened the panel closes it.
 * Under a name the status takes its own row.
 */
export function PanelHead({
	title,
	status,
	lit,
	working,
	list,
	need,
	back,
}: {
	/** Null on the teacher's screen: the pill above names it. */
	title: string | null;
	status: string | null;
	lit: boolean;
	working: boolean;
	/** The Activity list its key drops; null where there is none. */
	list: { open: boolean; onOpen: (open: boolean) => void } | null;
	/** Background work needs the learner: its key goes to its screen. */
	need: (() => void) | null;
	back: (() => void) | null;
}) {
	const teacher = useTeacher();
	const listKey = useRef<HTMLButtonElement>(null);
	const card = useRef<HTMLDivElement>(null);
	const listId = useId();
	const listOpen = !!list?.open;
	const hang = usePresence(listOpen);
	const needKey = usePresence(!!need);
	// The list hangs into the panel, which clips it: it may reach the panel's
	// bottom and no further, whatever the screen's height.
	const head = useRef<HTMLDivElement>(null);
	const [room, setRoom] = useState<number | null>(null);
	useLayoutEffect(() => {
		const el = head.current;
		const panel = el?.parentElement;
		if (!hang.mounted || !el || !panel) return;
		const read = () => setRoom(panel.clientHeight - el.offsetTop - el.offsetHeight);
		read();
		const observer = new ResizeObserver(read);
		observer.observe(panel);
		observer.observe(el);
		return () => observer.disconnect();
	}, [hang.mounted]);
	// Opened, the keyboard goes into it, as into a menu.
	useEffect(() => {
		if (listOpen) card.current?.focus({ preventScroll: true });
	}, [listOpen]);
	// It closes on a click outside it, or on Esc, which goes no further and
	// gives the keyboard back to its key.
	const onOpen = list?.onOpen;
	useEffect(() => {
		if (!listOpen || !onOpen) return;
		const onDown = (e: PointerEvent) => {
			const t = e.target as Node | null;
			if (!card.current?.contains(t) && !listKey.current?.contains(t)) onOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			onOpen(false);
			listKey.current?.focus();
		};
		document.addEventListener("pointerdown", onDown);
		document.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("pointerdown", onDown);
			document.removeEventListener("keydown", onKey, true);
		};
	}, [listOpen, onOpen]);

	const words = status && (
		<span key={status} data-state="open" className={cn("lh-fade min-w-0", lit ? "whitespace-normal" : "truncate")}>
			{status}
		</span>
	);
	// Plain words; on the highlighter only while the agent needs the learner.
	const chipLook = cn(
		"flex min-w-0 items-center gap-2 text-left leading-5 transition-colors duration-(--lh-dur) ease-(--lh-ease-out)",
		TYPE,
		lit ? "rounded-[10px] bg-highlight px-2.5 py-1 text-ink" : "text-ink-2",
	);
	const statusChip = status && (
		<span data-testid="teacher-panel-agent" title={status} className={chipLook}>
			{working && <span aria-hidden className="ob-pulse size-2 shrink-0 bg-current" />}
			{words}
		</span>
	);

	const inRow = !title;
	return (
		// Over the panel's resize edges while its list is open, so they never cover the list.
		<div ref={head} className={cn("relative flex shrink-0 flex-col gap-2 pt-2.5 pb-1.5 pr-3 pl-[18px]", hang.mounted ? "z-40" : "z-10")}>
			<div className="flex min-h-8 items-center gap-2.5">
				{title && (
					<span data-testid="teacher-panel-name" className={cn("max-w-[40%] shrink-0 truncate font-medium text-ink", TYPE)}>
						{title}
					</span>
				)}
				<div className="flex min-w-0 flex-1 items-center gap-2">{inRow && statusChip}</div>
				{needKey.mounted && (
					<button type="button" data-testid="teacher-panel-need" data-state={needKey.state} onClick={() => need?.()} className={cn("lh-btn h-8 shrink-0 px-3", TYPE, LIT_KEY, "lh-pop")}>
						Background work needs you
					</button>
				)}
				{list && teacher && (
					<button
						type="button"
						data-testid={teacher.follow ? "follow-stop" : "follow-start"}
						aria-pressed={teacher.follow}
						onClick={() => teacher.setFollow(!teacher.follow)}
						className={cn(KEY, teacher.follow && HELD)}
					>
						{teacher.follow ? "Following" : "Follow"}
					</button>
				)}
				{list && (
					<button
						ref={listKey}
						type="button"
						data-testid="teacher-panel-activity"
						aria-expanded={listOpen}
						aria-controls={listOpen ? listId : undefined}
						onClick={() => list.onOpen(!listOpen)}
						className={cn(KEY, listOpen && HELD)}
					>
						Activity
					</button>
				)}
				{back && (
					<button type="button" data-testid="teacher-panel-back" onClick={back} className={KEY}>
						Back
					</button>
				)}
			</div>
			{!inRow && statusChip && <div className="flex min-w-0 items-center gap-2">{statusChip}</div>}
			{hang.mounted && (
				<div data-state={hang.state} className="lh-hang absolute inset-x-0 top-full">
					<div ref={card} id={listId} role="dialog" aria-label="Activity" tabIndex={-1} data-state={hang.state} data-testid="teacher-panel-list" style={room === null ? undefined : { maxHeight: `min(${room}px, (100dvh - var(--lh-bar-h)) * 0.6)` }} className="lh-hang-body flex outline-none max-h-[calc((100dvh-var(--lh-bar-h))*0.6)] flex-col overflow-y-auto bg-bar px-[18px] pt-1 pb-5">
						<TeacherActivity underStatus />
					</div>
				</div>
			)}
		</div>
	);
}
