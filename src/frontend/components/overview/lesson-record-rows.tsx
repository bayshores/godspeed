import { memo, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { LessonProgress } from "@/shared/core";
import { lessonAge } from "@/frontend/components/lessons/lessons-model";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { keyLabel, stepLine } from "./lesson-record-model";
import { lessonHref } from "./overview-model";
import { OUTCOME_BG, ROW } from "./styles";

/**
 * ONE LESSON ROW (the Lessons block). The link's ::after covers the row, so
 * a click anywhere opens the lesson; More sits above it and opens the
 * lesson menu, as a right-click on the row does. An unfinished lesson shows
 * its step under the title, More, then its key ("Continue", or "Work on it"
 * for homework); a studied one shows a square per graded answer, how many
 * were right, its age, More and a chevron.
 */
export const LessonRow = memo(function LessonRow({
	lesson,
	nowMs,
	menuOpen,
	renameFailed,
	onMenu,
}: {
	lesson: LessonProgress;
	/** The window's clock (null before the first client render). */
	nowMs: number | null;
	/** Its menu is open: the row keeps its tone. */
	menuOpen: boolean;
	/** The last rename failed. */
	renameFailed: boolean;
	/** Opens the lesson menu at the anchor (the row, or its More button). */
	onMenu: (anchor: HTMLElement, chatId: string) => void;
}) {
	const l = lesson;
	const line = l.unfinished ? stepLine(l) : null;
	const more = (
		<button
			type="button"
			aria-label={`More for ${l.title}`}
			aria-haspopup="menu"
			aria-expanded={menuOpen}
			data-testid="lesson-row-menu"
			onClick={(e) => onMenu(e.currentTarget, l.chatId)}
			className="lh-btn lh-btn-quiet relative z-10 h-7 shrink-0 text-[15px]"
		>
			More
		</button>
	);
	return (
		<li>
			<div
				onContextMenu={(e) => {
					e.preventDefault(); // the lesson menu instead of the native one
					onMenu(e.currentTarget, l.chatId);
				}}
				className={cn(ROW, "relative py-3 has-[:focus-visible]:bg-tone", menuOpen && "bg-tone")}
			>
				{l.unfinished ? (
					<>
						<Link to={lessonHref(l.chatId)} data-testid="lesson-row" data-teacher-target={`lesson:${l.chatId}`} className="peer flex min-w-0 flex-1 flex-col gap-0.5 after:absolute after:inset-0">
							<span title={l.title} className="truncate text-[17px] text-ink">
								{l.title}
							</span>
							{line && <span className="text-base text-ink-2">{line}</span>}
						</Link>
						{more}
						{/* Both labels share one width, so the keys line up. The link covers the
						    key, so the key lights and sinks with the link. */}
						<span className="lh-btn w-[120px] shrink-0 justify-center peer-hover:bg-(--lh-key-hover) peer-active:border-t-(length:--lh-lip) peer-active:border-b-0">{keyLabel(l)}</span>
					</>
				) : (
					<>
						{/* The title keeps 200 px; the squares give way first. */}
						<Link to={lessonHref(l.chatId)} data-testid="lesson-row" data-teacher-target={`lesson:${l.chatId}`} className="min-w-[200px] flex-1 after:absolute after:inset-0">
							<span title={l.title} className="block truncate text-[17px] text-ink">
								{l.title}
							</span>
						</Link>
						{l.answered > 0 && (
							<>
								<span className="flex min-w-0 max-w-[45%] flex-wrap justify-end gap-[3px]" aria-hidden>
									{l.answers.map((a) => (
										<span key={a.toolCallId} data-outcome={a.outcome} className={cn("size-3", OUTCOME_BG[a.outcome])} />
									))}
								</span>
								<span className="min-w-16 shrink-0 font-count text-[15px] text-ink tabular-nums">
									{l.right} of {l.answered}
								</span>
							</>
						)}
						<span className="min-w-16 shrink-0 text-right font-count text-[15px] text-ink-2">{nowMs !== null && lessonAge(l.updatedAt, new Date(nowMs))}</span>
						{more}
						<PixelIcon name="chevron" className="h-3.5 text-ink" />
					</>
				)}
			</div>
			{renameFailed && (
				<p role="alert" data-testid="lesson-rename-failed" className="px-1 pb-2 text-[15px] text-ans-wrong">
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
		<li className="flex items-center bg-tone px-1 py-3">
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
