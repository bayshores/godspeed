import { memo, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { LessonKind, LessonProgress } from "@/shared/core";
import { CHIP } from "@/frontend/components/home-page/styles";
import { lessonAge } from "@/frontend/components/lessons/lessons-model";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { keyLabel, statusChip } from "./lesson-record-model";
import { lessonHref } from "./overview-model";
import { OUTCOME_BG, ROW } from "./styles";

/** A lesson's kind as an icon: pages for a lesson, a check for practice, a folder for homework. */
const KIND_ICON = { teach: "pages", study: "pages", practice: "check", homework: "folder" } as const satisfies Record<LessonKind, string>;

/** Every row's cells sit on these widths, so the columns line up down the list. */
const RESULT = "flex w-[236px] shrink-0 items-center justify-end gap-3";
const AGE = "grid w-[100px] shrink-0 items-center justify-items-end";

/**
 * ONE LESSON ROW (the Lessons block). The link's ::after covers the row, so
 * a click anywhere opens the lesson. An unfinished lesson shows its chip
 * (its step, "Homework" or "Started"), and the first of them its key; a
 * studied one shows a square per graded answer and how many were right.
 * Every row ends with its age, which gives way to More while the mouse or
 * the focus is on the row; More opens the lesson menu, as a right-click on
 * the row does.
 */
export const LessonRow = memo(function LessonRow({
	lesson,
	nowMs,
	withKey,
	menuOpen,
	renameFailed,
	onMenu,
}: {
	lesson: LessonProgress;
	/** The window's clock (null before the first client render). */
	nowMs: number | null;
	/** The first unfinished lesson: it carries the block's key. */
	withKey: boolean;
	/** Its menu is open: the row keeps its tone and More stays. */
	menuOpen: boolean;
	/** The last rename failed. */
	renameFailed: boolean;
	/** Opens the lesson menu at the anchor (the row, or its More button). */
	onMenu: (anchor: HTMLElement, chatId: string) => void;
}) {
	const l = lesson;
	return (
		<li>
			<div
				onContextMenu={(e) => {
					e.preventDefault(); // the lesson menu instead of the native one
					onMenu(e.currentTarget, l.chatId);
				}}
				className={cn(ROW, "group relative min-h-12 gap-4 px-3 py-1.5 has-[:focus-visible]:bg-tone", menuOpen && "bg-tone")}
			>
				<span className="flex w-4 shrink-0 justify-center">
					<PixelIcon name={KIND_ICON[l.kind]} className={cn("h-[13px]", l.unfinished ? "text-ink" : "text-ink-2")} />
				</span>
				<Link
					to={lessonHref(l.chatId)}
					data-testid="lesson-row"
					data-teacher-target={`lesson:${l.chatId}`}
					title={l.title}
					className="min-w-0 flex-1 truncate text-[17px] text-ink after:absolute after:inset-0"
				>
					{l.title}
				</Link>
				<span className={RESULT}>
					{l.unfinished ? (
						<>
							{/* The link covers the key, so the key lights and sinks with the link. */}
							{withKey && (
								<span data-testid="lesson-row-key" className="lh-btn h-[30px] px-3 text-[15px] group-has-[a:hover]:bg-(--lh-key-hover) group-has-[a:active]:border-t-(length:--lh-lip) group-has-[a:active]:border-b-0">
									{keyLabel(l)}
								</span>
							)}
							<span data-testid="lesson-row-status" className={cn(CHIP, "text-[15px]")}>
								{statusChip(l)}
							</span>
						</>
					) : (
						l.answered > 0 && (
							<>
								<span aria-hidden className="flex min-w-0 flex-wrap justify-end gap-[3px]">
									{l.answers.map((a) => (
										<span key={a.toolCallId} data-outcome={a.outcome} className={cn("size-3", OUTCOME_BG[a.outcome])} />
									))}
								</span>
								<span className="w-[60px] shrink-0 font-count text-[15px] text-ink tabular-nums">
									{l.right} of {l.answered}
								</span>
							</>
						)
					)}
				</span>
				<span className={AGE}>
					<span className={cn("col-start-1 row-start-1 font-count text-[15px] text-ink-2 tabular-nums group-hover:invisible group-focus-within:invisible", menuOpen && "invisible")}>
						{nowMs !== null && lessonAge(l.updatedAt, new Date(nowMs))}
					</span>
					<button
						type="button"
						aria-label={`More for ${l.title}`}
						aria-haspopup="menu"
						aria-expanded={menuOpen}
						data-testid="lesson-row-menu"
						onClick={(e) => onMenu(e.currentTarget, l.chatId)}
						className={cn("lh-btn lh-btn-quiet relative z-10 col-start-1 row-start-1 h-7 text-[15px] group-hover:visible group-focus-within:visible", !menuOpen && "invisible")}
					>
						More
					</button>
				</span>
			</div>
			{renameFailed && (
				<p role="alert" data-testid="lesson-rename-failed" className="px-3 pb-2 pl-11 text-[15px] text-ans-wrong">
					Couldn&apos;t rename the lesson.
				</p>
			)}
		</li>
	);
});

/** The row with its title as a text field: everything selected on entry,
 *  Enter or leaving the field saves, Esc discards. */
export function RenameRow({ title, onCommit, onCancel }: { title: string; onCommit: (next: string) => void; onCancel: () => void }) {
	const [draft, setDraft] = useState(title);
	const inputRef = useRef<HTMLInputElement | null>(null);
	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);
	return (
		<li className="flex min-h-12 items-center bg-tone py-1.5 pr-3 pl-11">
			<input
				ref={inputRef}
				value={draft}
				spellCheck={false}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={() => onCommit(draft)}
				onKeyDown={(e) => {
					if (e.key === "Enter") e.currentTarget.blur();
					if (e.key === "Escape") {
						e.stopPropagation(); // discard, not also the page's Esc chain
						onCancel();
					}
				}}
				aria-label="Rename lesson"
				data-testid="lesson-rename-input"
				className="lh-well min-w-0 flex-1 px-2 py-1 text-[17px] text-ink outline-none"
			/>
		</li>
	);
}
