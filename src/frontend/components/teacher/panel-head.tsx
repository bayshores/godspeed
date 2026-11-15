import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { usePresence } from "@/frontend/components/presence";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { TeacherActivity } from "./teacher-activity";

const KEY = "lh-btn h-8 shrink-0 px-3 text-[14px]";
/** A key that needs the learner: lit like the chip that says so. */
const LIT_KEY = "[--lh-key:var(--lh-highlight)] [--lh-key-hover:color-mix(in_srgb,var(--lh-highlight)_85%,#fff)] text-ink";
/** The hanging list keeps this far from the panel's sides, so its curves show. */
const LIST_INSET = 26;
const LIST_WIDTH = 440;

/**
 * The panel's one head row: whose screen it is, its status as a chip (lit
 * while it needs the learner, its words fading from one to the next, a
 * breathing square while the teacher works), then the key to background
 * work's screen while that needs the learner, or Back from it, and Close.
 * On the teacher's screen the chip also drops the Activity list over the
 * top of the screen. In the narrow panel the chip takes its own row.
 */
export function PanelHead({
	title,
	status,
	lit,
	working,
	list,
	need,
	back,
	wide,
	onClose,
}: {
	title: string;
	status: string | null;
	lit: boolean;
	working: boolean;
	/** The Activity list the chip drops; null where the chip only tells. */
	list: { open: boolean; onOpen: (open: boolean) => void } | null;
	/** Background work needs the learner: its key goes to its screen. */
	need: (() => void) | null;
	back: (() => void) | null;
	wide: boolean;
	onClose: () => void;
}) {
	const head = useRef<HTMLDivElement>(null);
	const chip = useRef<HTMLButtonElement>(null);
	const card = useRef<HTMLDivElement>(null);
	const listId = useId();
	const listOpen = !!list?.open;
	const hang = usePresence(listOpen);
	const needKey = usePresence(!!need);
	const [at, setAt] = useState({ left: LIST_INSET, width: LIST_WIDTH });
	useLayoutEffect(() => {
		if (!listOpen || !head.current || !chip.current) return;
		const room = head.current.clientWidth;
		const width = Math.min(LIST_WIDTH, room - 2 * LIST_INSET);
		const chipLeft = chip.current.getBoundingClientRect().left - head.current.getBoundingClientRect().left;
		setAt({ width, left: Math.max(LIST_INSET, Math.min(chipLeft, room - LIST_INSET - width)) });
	}, [listOpen]);
	// It closes on a click outside it or on Esc, which then goes no further.
	const onOpen = list?.onOpen;
	useEffect(() => {
		if (!listOpen || !onOpen) return;
		const onDown = (e: PointerEvent) => {
			const t = e.target as Node | null;
			if (!card.current?.contains(t) && !chip.current?.contains(t)) onOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			onOpen(false);
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
	const chipLook = cn(
		"flex min-w-0 items-center gap-2 rounded-[10px] px-2.5 py-1 text-left text-[14px] leading-5 transition-colors duration-(--lh-dur) ease-(--lh-ease-out)",
		lit ? "bg-highlight text-ink" : "bg-tone text-ink-2",
		!wide && "w-full",
	);
	const chipInside = (
		<>
			{working && <span aria-hidden className="ob-pulse size-2 shrink-0 bg-current" />}
			{words}
		</>
	);
	const statusChip =
		status &&
		(list ? (
			<button
				ref={chip}
				type="button"
				data-testid="teacher-panel-agent"
				title={status}
				aria-expanded={listOpen}
				aria-controls={listId}
				aria-label={`${status} Activity`}
				onClick={() => list.onOpen(!listOpen)}
				className={cn(chipLook, "lh-press hover:text-ink")}
			>
				{chipInside}
				<PixelIcon name="chevron" className={cn("h-2.5 shrink-0 transition-transform duration-(--lh-dur) ease-(--lh-ease-out)", listOpen ? "-rotate-90" : "rotate-90")} />
			</button>
		) : (
			<span data-testid="teacher-panel-agent" title={status} className={chipLook}>
				{chipInside}
			</span>
		));

	return (
		<div ref={head} className="relative z-10 flex shrink-0 flex-col gap-2 py-3 pr-3 pl-[15px]">
			<div className="flex min-h-8 items-center gap-2.5">
				<span data-testid="teacher-panel-name" className="max-w-[40%] shrink-0 truncate text-xl leading-snug font-medium text-ink">
					{title}
				</span>
				<div className="flex min-w-0 flex-1 items-center">{wide && statusChip}</div>
				{needKey.mounted && (
					<button type="button" data-testid="teacher-panel-need" data-state={needKey.state} onClick={() => need?.()} className={cn(KEY, LIT_KEY, "lh-pop")}>
						Background work needs you
					</button>
				)}
				{back && (
					<button type="button" data-testid="teacher-panel-back" onClick={back} className={KEY}>
						Back
					</button>
				)}
				<button type="button" data-testid="teacher-panel-close" onClick={onClose} className={KEY}>
					<PixelIcon name="close" />
					Close
				</button>
			</div>
			{!wide && statusChip}
			{hang.mounted && (
				<div data-state={hang.state} className="lh-hang absolute top-full" style={{ ...at, ["--lh-hang-fill" as string]: "var(--color-panel)" }}>
					<div ref={card} id={listId} role="dialog" aria-label="Activity" data-state={hang.state} data-testid="teacher-panel-list" className="lh-hang-body flex max-h-[calc((100dvh-3rem)*0.6)] flex-col overflow-y-auto bg-panel px-4 pt-1 pb-4">
						<TeacherActivity underStatus />
					</div>
				</div>
			)}
		</div>
	);
}
