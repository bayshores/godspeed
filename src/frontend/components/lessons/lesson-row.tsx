import { memo, useEffect, useRef, useState } from "react";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import type { ChatListItem } from "@/shared/core";
import { lessonAge, lessonWaiting } from "./lessons-model";

/**
 * ONE LESSON ROW: the title, under it "marco is writing" (or "Waiting for
 * your agent" while none teaches) or "Waiting for your answer" when either
 * is true, and its age at the right. The whole
 * row opens the lesson. Hovering shows "More", which opens the lesson
 * menu, the same menu a right-click opens.
 */

const ROW = "group relative flex items-center gap-4 border-b border-dotted border-edge px-2 py-4 last:border-b-0";

/** Under the title: what the lesson is waiting on, if anything. */
function StatusLine({ chat, teacher, noAgent }: { chat: ChatListItem; teacher: string; noAgent: boolean }) {
	if (chat.busy) return <span className="text-sm text-ink-2">{noAgent ? "Waiting for your agent" : `${teacher} is writing`}</span>;
	if (!lessonWaiting(chat)) return null;
	return (
		<span data-waiting="" className="flex items-center gap-2 text-sm text-ink">
			<span aria-hidden className="size-2.5 shrink-0 bg-highlight" />
			Waiting for your answer
		</span>
	);
}

function Age({ chat }: { chat: ChatListItem }) {
	return <span className="font-count shrink-0 text-sm text-ink-2">{lessonAge(chat.updatedAt)}</span>;
}

interface LessonRowProps {
	chat: ChatListItem;
	/** The teacher's name, for "marco is writing". */
	teacher: string;
	/** No agent is teaching (agent-status.tsx lessonAgentWaiting): a lesson waiting on a reply says so. */
	noAgent?: boolean;
	/** Opens the lesson (the row passes its own id). */
	onOpen: (id: string) => void;
	/** The search walk's highlight (↑/↓ in the search field). */
	kbdSelected?: boolean;
	/** Opens the lesson menu at the anchor (the row on right-click, or its More button). */
	onMenu?: (anchor: HTMLElement, chat: ChatListItem) => void;
	/** This row's menu is open: its More button stays shown. */
	menuOpen?: boolean;
	/** A lesson that just appeared rises in once. */
	fresh?: boolean;
}

/** One lesson row. Memoized: the list's callbacks are stable, so a row
 *  redraws only when its own lesson changes. */
export const LessonRow = memo(function LessonRow({ chat, teacher, noAgent = false, onOpen, kbdSelected = false, onMenu, menuOpen = false, fresh = false }: LessonRowProps) {
	return (
		<div
			onContextMenu={
				onMenu
					? (e) => {
							e.preventDefault(); // the lesson menu instead of the native one
							onMenu(e.currentTarget, chat);
						}
					: undefined
			}
			className={cn(ROW, "hover:bg-tone", fresh && "lh-rise", (kbdSelected || menuOpen) && "bg-tone")}
		>
			{/* The button's ::after covers the row, so a click anywhere opens the lesson. */}
			<button
				type="button"
				onClick={() => onOpen(chat.id)}
				data-testid={kbdSelected ? "session-row-kbd" : "session-row"}
				data-teacher-target={`lesson:${chat.id}`}
				className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left after:absolute after:inset-0"
			>
				<span className="w-full truncate text-[17px] text-ink">{chat.title}</span>
				<StatusLine chat={chat} teacher={teacher} noAgent={noAgent} />
			</button>
			{onMenu && (
				<button
					type="button"
					aria-label={`More for ${chat.title}`}
					aria-haspopup="menu"
					aria-expanded={menuOpen}
					data-testid="session-row-menu"
					onClick={(e) => onMenu(e.currentTarget, chat)}
					className={cn("lh-btn lh-btn-quiet relative z-10 shrink-0 focus-visible:opacity-100 group-hover:opacity-100", !menuOpen && "opacity-0")}
				>
					More
				</button>
			)}
			<Age chat={chat} />
			<PixelIcon name="chevron" className="text-ink" />
		</div>
	);
});

/** The inline rename row: the row with its title as a text input.
 *  Select-all on entry, Enter or leaving the field saves, Esc discards. */
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
		<div data-testid="session-rename-row" className={cn(ROW, "bg-tone")}>
			<input
				ref={inputRef}
				value={draft}
				spellCheck={false}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={() => onCommit(draft)}
				onKeyDown={(e) => {
					if (e.key === "Enter") e.currentTarget.blur();
					if (e.key === "Escape") {
						e.stopPropagation(); // discard, not also the lesson's Esc chain
						onCancel();
					}
				}}
				aria-label="Rename lesson"
				data-testid="session-rename-input"
				className="min-w-0 flex-1 border-0 border-b border-ink bg-transparent px-0 text-[17px] text-ink outline-none"
			/>
			<Age chat={chat} />
		</div>
	);
}
