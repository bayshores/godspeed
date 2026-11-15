import { useEffect, useId, useRef } from "react";
import { usePresence } from "@/frontend/components/presence";
import { cn } from "@/frontend/lib/utils";
import { FollowButton } from "./follow-button";
import { TeacherActivity } from "./teacher-activity";

/** The head's words are in the screen's font; its keys are plain words. */
const TYPE = "font-mono text-[13px]";
const KEY = cn("lh-btn lh-btn-quiet h-8 shrink-0", TYPE);
/** A key that needs the learner: lit like the chip that says so. */
const LIT_KEY = "[--lh-key:var(--lh-highlight)] [--lh-key-hover:color-mix(in_srgb,var(--lh-highlight)_85%,#fff)] text-ink";

/**
 * The panel's one head row: the screen's status (lit while it needs the
 * learner, its words fading from one to the next, a breathing square while
 * the teacher works) with Follow beside it, then the key to background
 * work's screen while that needs the learner, and Activity, which drops
 * the Activity list over the top of the screen. Background work's screen
 * has its name first, and Back. The pill that opened the panel closes it.
 * Under a name in the narrow panel the status takes its own row.
 */
export function PanelHead({
	title,
	status,
	lit,
	working,
	list,
	follow,
	need,
	back,
	wide,
}: {
	/** Null on the teacher's screen: the pill above names it. */
	title: string | null;
	status: string | null;
	lit: boolean;
	working: boolean;
	/** The Activity list its key drops; null where there is none. */
	list: { open: boolean; onOpen: (open: boolean) => void } | null;
	/** Follow and Go to show beside the chip while they can act. */
	follow: boolean;
	/** Background work needs the learner: its key goes to its screen. */
	need: (() => void) | null;
	back: (() => void) | null;
	wide: boolean;
}) {
	const listKey = useRef<HTMLButtonElement>(null);
	const card = useRef<HTMLDivElement>(null);
	const listId = useId();
	const listOpen = !!list?.open;
	const hang = usePresence(listOpen);
	const needKey = usePresence(!!need);
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
		!wide && "flex-1",
	);
	const statusChip = status && (
		<span data-testid="teacher-panel-agent" title={status} className={chipLook}>
			{working && <span aria-hidden className="ob-pulse size-2 shrink-0 bg-current" />}
			{words}
		</span>
	);

	const beside = (
		<>
			{statusChip}
			{follow && <FollowButton look={KEY} />}
		</>
	);

	const inRow = wide || !title;
	return (
		<div className="relative z-10 flex shrink-0 flex-col gap-2 pt-2.5 pb-1.5 pr-3 pl-[18px]">
			<div className="flex min-h-8 items-center gap-2.5">
				{title && (
					<span data-testid="teacher-panel-name" className={cn("max-w-[40%] shrink-0 truncate font-medium text-ink", TYPE)}>
						{title}
					</span>
				)}
				<div className="flex min-w-0 flex-1 items-center gap-2">{inRow && beside}</div>
				{needKey.mounted && (
					<button type="button" data-testid="teacher-panel-need" data-state={needKey.state} onClick={() => need?.()} className={cn("lh-btn h-8 shrink-0 px-3", TYPE, LIT_KEY, "lh-pop")}>
						Background work needs you
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
						// Held down while its list is open.
						className={cn(KEY, listOpen && "text-ink [--lh-key:var(--lh-key-hover)]")}
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
			{!inRow && (statusChip || follow) && <div className="flex min-w-0 items-center gap-2">{beside}</div>}
			{hang.mounted && (
				<div data-state={hang.state} className="lh-hang absolute inset-x-0 top-full">
					<div ref={card} id={listId} role="dialog" aria-label="Activity" tabIndex={-1} data-state={hang.state} data-testid="teacher-panel-list" className="lh-hang-body flex outline-none max-h-[calc((100dvh-3rem)*0.6)] flex-col overflow-y-auto bg-bar px-[18px] pt-1 pb-5">
						<TeacherActivity underStatus />
					</div>
				</div>
			)}
		</div>
	);
}
