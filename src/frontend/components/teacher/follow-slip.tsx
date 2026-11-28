/**
 * FOLLOW'S SLIP at the page's foot, while Follow is on and the teacher works: one line in the
 * teacher's dark, along the foot from the window's left edge to the strip (or the docked panel),
 * so the two read as one frame. The pencil, what the teacher does now in the server's words
 * ("Reading HW7_F26.pdf, page 1"), "Thinking" between steps, or why Follow waits with a "Go to"
 * key, and the count of steps. A click opens the round's earlier rows upward: a change goes to
 * its page, a file read opens that passage in the source pop-up. "Done, 6 steps", then it leaves.
 * It rises from past the window's foot and leaves the same way, and the page makes room for it
 * as for the docked panel (--lh-follow-push). follow-slip-model.ts decides what it says.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { CiteDialog } from "@/frontend/components/citations/cite-dialog";
import type { FileCite, PassageCite } from "@/frontend/components/citations/page-excerpt-model";
import { useReplayOnChange } from "@/frontend/components/motion";
import { usePresence } from "@/frontend/components/presence";
import { travelMs } from "@/frontend/components/slip-travel-model";
import { goLabel } from "@/frontend/components/top-bar/top-bar-model";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { useFold } from "@/frontend/components/use-fold";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { useSlipTravel } from "@/frontend/components/use-slip-travel";
import { cn } from "@/frontend/lib/utils";
import type { StepLink } from "@/shared/core";
import { useTeacher } from "./teacher-context";
import type { FollowSlip as Slip } from "./use-follow-slip";
import type { TimelineRow } from "./timeline-model";

/** The line's height. The page makes room for the line, and for the "Go to" key too once it drops under the line. */
const LINE_H = 44;
/** The page's room for the slip (main's foot padding reads it). */
const PUSH_VAR = "--lh-follow-push";
/** It is held on screen this long while it leaves. */
const LEAVE_MS = travelMs(LINE_H, "out");
const LIST_ID = "lh-follow-slip-list";
/** The words and the count step in again when they change, the words a beat after the old ones go. */
const STEP_IN = { "--lh-block-delay": "60ms" } as CSSProperties;

/** The teacher's words are in its screen's font, as the strip's and the panel's head are. */
const TYPE = "font-mono text-(length:--text-sm)";
const ROW = cn("flex min-h-9 w-full items-center gap-2.5 px-4 py-1.5 text-left", TYPE);

/** The source pop-up's cite for a file read's link. */
function citeOf(link: StepLink): FileCite | PassageCite {
	return "passage" in link ? { fileId: link.fileId, passage: link.passage, name: link.name } : { kind: "file", fileId: link.fileId, range: link.range, name: link.name };
}

export function FollowSlip() {
	const teacher = useTeacher();
	const slip = teacher?.slip ?? null;
	const presence = usePresence(slip !== null, LEAVE_MS);
	const last = useRef(slip);
	if (slip) last.current = slip;
	const shown = slip ?? (presence.mounted ? last.current : null);
	const leaving = !slip && !!shown;
	const travel = useSlipTravel(!shown?.still, leaving, (el) => ({ by: "100%", points: el.offsetHeight }));
	const [lineH, setLineH] = useState(LINE_H);
	usePush(!!slip, !!slip?.still, lineH);
	const [cite, setCite] = useState<FileCite | PassageCite | null>(null);
	return (
		<>
			{shown && teacher && (
				<div ref={travel.ref} data-testid="follow-slip" data-state={presence.state} data-mark={shown.view.mark} inert={leaving} className="lh-popup lh-follow-slip">
					<SlipBody slip={shown} go={teacher.go} onCite={setCite} onHeight={setLineH} />
				</div>
			)}
			<CiteDialog cite={cite} onClose={() => setCite(null)} />
		</>
	);
}

/** The page makes room for the slip while it is up, and gets it back the moment it starts to leave. Up with the
 *  window's first read of the round, the room is simply there: the page does not glide. */
function usePush(up: boolean, still: boolean, height: number) {
	useLayoutEffect(() => {
		const root = document.documentElement.style;
		const main = document.getElementById("lh-page");
		if (!(up && still) || !main) {
			root.setProperty(PUSH_VAR, up ? `${height}px` : "0px");
			return;
		}
		main.style.transition = "none";
		root.setProperty(PUSH_VAR, `${height}px`);
		void main.offsetHeight;
		main.style.transition = "";
	}, [up, still, height]);
	useEffect(
		() => () => {
			document.documentElement.style.removeProperty(PUSH_VAR);
		},
		[],
	);
}

function SlipBody({
	slip,
	go,
	onCite,
	onHeight,
}: {
	slip: Slip;
	go: (action: NonNullable<Slip["view"]["waiting"]>) => void;
	onCite: (cite: FileCite | PassageCite) => void;
	/** The line's height, with the "Go to" key's row when it drops under the line. */
	onHeight: (height: number) => void;
}) {
	const { view, open, setOpen } = slip;
	const lists = view.past.length > 0;
	const fold = useFold(open && lists);
	const button = useRef<HTMLButtonElement>(null);
	const close = useCallback(() => setOpen(false), [setOpen]);
	useMenuDismiss(open, close, button);
	const words = useRef<HTMLSpanElement>(null);
	const count = useRef<HTMLSpanElement>(null);
	useReplayOnChange(words, view.line, "lh-block-in");
	useReplayOnChange(count, view.count, "lh-block-in");
	const key = view.waiting && goLabel({ following: true, offer: view.waiting, held: true });
	const waiting = view.waiting;
	const line = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const el = line.current;
		if (!el) return;
		const observer = new ResizeObserver(() => onHeight(el.offsetHeight));
		observer.observe(el);
		return () => observer.disconnect();
	}, [onHeight]);
	return (
		<>
			{fold.mounted && (
				<div data-state={fold.state} data-lh-menu="" className="lh-collapse">
					<div>
						<RoundList rows={view.past} open={fold.state === "open"} onPick={(row) => {
							close();
							if (row.kind === "change") go(row.action);
							else if (row.link) onCite(citeOf(row.link));
						}} />
					</div>
				</div>
			)}
			{/* In a narrow room beside the teacher's panel the "Go to" key drops under the line, so the words shorten
			    only down to a few letters and the count always shows. */}
			<div ref={line} className="flex flex-wrap items-center justify-end gap-x-3 pr-4">
				<button
					ref={button}
					type="button"
					data-testid="follow-slip-line"
					aria-expanded={lists ? open : undefined}
					aria-controls={open && lists ? LIST_ID : undefined}
					disabled={!lists}
					onClick={() => setOpen(!open)}
					style={{ height: LINE_H }}
					className={cn("lh-press flex min-w-44 flex-1 items-center gap-2.5 pl-4 text-left disabled:cursor-default", TYPE, lists && "hover:bg-bar-ink/10")}
				>
					<Mark mark={view.mark} />
					<span ref={words} style={STEP_IN} className="min-w-0 flex-1 truncate">
						{view.line}
					</span>
					{view.count && (
						<span ref={count} data-testid="follow-slip-count" style={STEP_IN} className="font-count shrink-0 text-(length:--text-sm)">
							{view.count}
						</span>
					)}
					{lists && <PixelIcon name="chevron" className={cn("h-[9px] transition-transform duration-(--lh-dur) ease-(--lh-ease-out)", open ? "rotate-90" : "-rotate-90")} />}
				</button>
				{key && waiting && (
					<button type="button" data-testid="follow-slip-go" onClick={() => go(waiting)} className="lh-btn lh-btn-small my-[7px] shrink-0">
						{key}
					</button>
				)}
			</div>
		</>
	);
}

/** Before the words: the pencil, which writes while the teacher works and rests while Follow waits, or a check once it is done. */
function Mark({ mark }: { mark: Slip["view"]["mark"] }) {
	return mark === "done" ? <PixelIcon name="check" className="h-[9px]" /> : <PixelIcon name="pencil" className={cn("h-[13px]", mark === "live" && "ob-pulse")} />;
}

/** The round's earlier rows, newest at the bottom by the line, eight in view and the rest scrolled up. A change and a
 *  file read are keys to what they name; the other rows are words. */
function RoundList({ rows, open, onPick }: { rows: readonly TimelineRow[]; open: boolean; onPick: (row: TimelineRow) => void }) {
	const list = useRef<HTMLOListElement>(null);
	// Opened at its newest rows, by the line.
	useLayoutEffect(() => {
		if (open && list.current) list.current.scrollTop = list.current.scrollHeight;
	}, [open]);
	return (
		<ol ref={list} id={LIST_ID} data-testid="follow-slip-list" className="max-h-[288px] overflow-y-auto pt-2">
			{rows.map((row) => {
				const opens = row.kind === "change" || !!row.link;
				const inside = (
					<>
						<PixelIcon name="check" className="h-[9px]" />
						<span className="min-w-0 flex-1 break-words">{row.text}</span>
						{opens && <PixelIcon name="chevron" className="h-[9px]" />}
					</>
				);
				return (
					<li key={row.id} className="text-muted-foreground">
						{opens ? (
							<button type="button" data-testid="follow-slip-row" onClick={() => onPick(row)} className={cn(ROW, "lh-press hover:bg-bar-ink/10 hover:text-bar-ink")}>
								{inside}
							</button>
						) : (
							<div data-testid="follow-slip-row" className={ROW}>
								{inside}
							</div>
						)}
					</li>
				);
			})}
		</ol>
	);
}
