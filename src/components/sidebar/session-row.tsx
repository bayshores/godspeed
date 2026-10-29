import { memo, useEffect, useRef, useState } from "react";
import { BrailleSpinner } from "@/components/braille-spinner";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ChatListItem } from "@/core";

/**
 * ONE LESSON ROW: the title (14.5px), then a short
 * meta line — "now", "5m", "1d", or "Working…" while the teacher writes.
 * A 6×6 white square in front of the meta means the lesson is waiting
 * for the learner's answer; hovering (or focusing) the row then explains
 * it: "Waiting for your answer · Teacher replied 1 day ago". The active
 * lesson sits on the tone block in bold.
 */

function isoDate(iso: string): string {
	const date = new Date(iso);
	const mm = String(date.getMonth() + 1).padStart(2, "0");
	const dd = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${mm}-${dd}`;
}

/** The row's short age: "now", "5m", "3h", "2d", then the ISO date. */
export function shortAgo(iso: string, now = new Date()): string {
	const ms = now.getTime() - new Date(iso).getTime();
	if (ms < 60_000) return "now";
	const min = Math.floor(ms / 60_000);
	if (min < 60) return `${min}m`;
	const h = Math.floor(min / 60);
	if (h < 24) return `${h}h`;
	const d = Math.floor(h / 24);
	if (d < 7) return `${d}d`;
	return isoDate(iso);
}

/** The tooltip's age, written out: "just now", "5 minutes ago",
 *  "1 day ago", then "on 2026-01-02". */
export function longAgo(iso: string, now = new Date()): string {
	const ms = now.getTime() - new Date(iso).getTime();
	if (ms < 60_000) return "just now";
	const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
	const min = Math.floor(ms / 60_000);
	if (min < 60) return plural(min, "minute");
	const h = Math.floor(min / 60);
	if (h < 24) return plural(h, "hour");
	const d = Math.floor(h / 24);
	if (d < 7) return plural(d, "day");
	return `on ${isoDate(iso)}`;
}

/** The lesson waits for the learner: an open question, or (practice) a
 *  posed problem. */
export function lessonWaiting(chat: ChatListItem): boolean {
	return chat.pendingQuestion || ((chat.kind ?? "teach") === "practice" && chat.pendingProblem);
}

/** The meta line's text. */
function sessionMeta(chat: ChatListItem, now = new Date()): string {
	if (chat.compacting) return "Compacting context…";
	if (chat.busy) return "Working…";
	return shortAgo(chat.updatedAt, now);
}

/** The meta line: spinner while working, the white square while waiting. */
function MetaLine({ chat }: { chat: ChatListItem }) {
	const working = chat.busy || chat.compacting;
	const waiting = !working && lessonWaiting(chat);
	return (
		<span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-ink-2">
			{working && <BrailleSpinner />}
			{waiting && (
				<span data-testid="session-waiting-dot" className="size-1.5 shrink-0 bg-ink" aria-hidden />
			)}
			<span className="truncate">{sessionMeta(chat)}</span>
			{waiting && <span className="sr-only">Waiting for your answer</span>}
		</span>
	);
}

interface SessionRowProps {
	chat: ChatListItem;
	active: boolean;
	/** Opens the lesson (the row passes its own id). */
	onOpen: (id: string) => void;
	/** The search walk's highlight (↑/↓ in the search field). */
	kbdSelected?: boolean;
	/** Right-click opens the lesson menu. */
	onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>, chat: ChatListItem) => void;
	/** A lesson that just appeared rises in once. */
	fresh?: boolean;
}

/** One lesson row. Memoized: the list's callbacks are stable, so a row
 *  redraws only when its own lesson changes. */
export const SessionRow = memo(function SessionRow({
	chat,
	active,
	onOpen,
	kbdSelected = false,
	onContextMenu,
	fresh = false,
}: SessionRowProps) {
	const waiting = !(chat.busy || chat.compacting) && lessonWaiting(chat);
	return (
		<Tip
			disabled={!waiting}
			title="Waiting for your answer"
			body={`Teacher replied ${longAgo(chat.updatedAt)}`}
			side="right"
		>
			<button
				type="button"
				onClick={() => onOpen(chat.id)}
				onContextMenu={onContextMenu ? (e) => onContextMenu(e, chat) : undefined}
				data-testid={kbdSelected ? "session-row-kbd" : "session-row"}
				data-halley-target={`lesson:${chat.id}`}
				data-active={active || undefined}
				aria-current={active ? "page" : undefined}
				className={cn(
					"lh-press flex w-full flex-col items-start gap-[3px] px-2.5 py-2 text-left hover:bg-tone",
					active && "bg-tone",
					fresh && "lh-rise",
					kbdSelected && !active && "bg-tone/60 ring-1 ring-tone-2 ring-inset",
				)}
			>
				<span className={cn("block w-full truncate text-[14.5px] text-ink", active && "font-bold")}>
					{chat.title}
				</span>
				<MetaLine chat={chat} />
			</button>
		</Tip>
	);
});

/** The inline rename row: same geometry as SessionRow, the title becomes
 *  a text input — select-all on entry, Enter/blur commits, Esc discards.
 *  The meta line stays so the row never changes height mid-edit. */
export function RenameRow({ chat, onCommit, onCancel }: { chat: ChatListItem; onCommit: (next: string) => void; onCancel: () => void }) {
	const [draft, setDraft] = useState(chat.title);
	const inputRef = useRef<HTMLInputElement | null>(null);
	useEffect(() => {
		const el = inputRef.current;
		if (el) {
			el.focus();
			el.select();
		}
	}, []);
	return (
		<div data-testid="session-rename-row" className="flex w-full flex-col items-start gap-[3px] bg-tone px-2.5 py-2">
			{/* Borderless and padding-free at the title's exact x: the
			    underline is the only editing cue (nothing moves). */}
			<input
				ref={inputRef}
				value={draft}
				spellCheck={false}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={() => onCommit(draft)}
				onKeyDown={(e) => {
					if (e.key === "Enter") e.currentTarget.blur();
					if (e.key === "Escape") {
						e.stopPropagation(); // discard, not also the sidebar/chat chains
						onCancel();
					}
				}}
				aria-label="Rename lesson"
				data-testid="session-rename-input"
				className="w-full min-w-0 truncate border-0 border-b border-tone-2 bg-transparent px-0 text-[14.5px] text-ink outline-none"
			/>
			<MetaLine chat={chat} />
		</div>
	);
}
