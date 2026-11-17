import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { LessonProgress } from "@/shared/core";
import { cn } from "@/frontend/lib/utils";
import { keyLabel } from "./lesson-record-model";
import { lessonHref } from "./overview-model";
import { OUTCOME_BG } from "./styles";
import type { LessonActions } from "./use-lesson-actions";

/** A row that opens its lesson: lit under the mouse, under the focus and while its menu is open. */
const ROW = "lh-press group relative hover:bg-tone has-[:focus-visible]:bg-tone";

/** Steps (or a homework's problems) as blocks: done ones inked, the rest dim. With no label
 *  the words beside them say it. */
export function StepBlocks({ done, total, label, className = "h-3 w-5" }: { done: number; total: number; label?: string; className?: string }) {
	return (
		<span {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })} data-testid="step-blocks" className="flex flex-wrap gap-[3px]">
			{Array.from({ length: total }, (_, i) => (
				<span key={i} className={cn("shrink-0", className, i < done ? "bg-ink" : "bg-(--border)")} />
			))}
		</span>
	);
}

/** The lesson's title as a link whose ::after covers the row, so a click anywhere opens it;
 *  a text field in its place while it is renamed. */
function TitleCell({ lesson, actions, className }: { lesson: LessonProgress; actions: LessonActions; className?: string }) {
	if (actions.renamingId === lesson.chatId) return <RenameField title={lesson.title} onCommit={(next) => actions.commitRename(lesson, next)} onCancel={actions.cancelRename} />;
	return (
		<Link
			to={lessonHref(lesson.chatId)}
			data-testid="lesson-row"
			data-teacher-target={`lesson:${lesson.chatId}`}
			title={lesson.title}
			className={cn("line-clamp-2 min-w-0 text-[17px] leading-snug text-ink after:absolute after:inset-0", className)}
		>
			{lesson.title}
		</Link>
	);
}

/** More: nothing at rest, there while the mouse or the focus is on the row or its menu is open. */
function MoreButton({ lesson, actions, className }: { lesson: LessonProgress; actions: LessonActions; className?: string }) {
	const open = actions.menuId === lesson.chatId;
	return (
		<button
			type="button"
			aria-label={`More for ${lesson.title}`}
			aria-haspopup="menu"
			aria-expanded={open}
			data-testid="lesson-row-menu"
			onClick={(e) => actions.onMenu(e.currentTarget, lesson.chatId)}
			className={cn("lh-btn lh-btn-quiet relative z-10 h-7 text-[15px] group-hover:visible group-focus-within:visible", !open && "invisible", className)}
		>
			More
		</button>
	);
}

/** The row's shell: a right-click opens the lesson menu; a failed rename says so under it. */
function RowShell({ lesson, actions, spaced = false, className, children }: { lesson: LessonProgress; actions: LessonActions; spaced?: boolean; className: string; children: ReactNode }) {
	return (
		<li className={spaced ? "mt-2" : undefined}>
			<div
				onContextMenu={(e) => {
					e.preventDefault(); // the lesson menu instead of the native one
					actions.onMenu(e.currentTarget, lesson.chatId);
				}}
				className={cn(ROW, className, actions.menuId === lesson.chatId && "bg-tone")}
			>
				{children}
			</div>
			{actions.renameFailedId === lesson.chatId && (
				<p role="alert" data-testid="lesson-rename-failed" className="px-2 pt-1 pb-2 text-[15px] text-ans-wrong">
					Couldn&apos;t rename the lesson.
				</p>
			)}
		</li>
	);
}

/**
 * A FINISHED LESSON (the Lessons sheet): the day where it changes from the
 * row above (a little space above it), a square per graded answer in a fixed column, and the title.
 */
export function FinishedRow({ lesson: l, day, spaced, actions }: { lesson: LessonProgress; day: string | null; spaced: boolean; actions: LessonActions }) {
	return (
		<RowShell lesson={l} actions={actions} spaced={spaced} className="grid min-h-10 grid-cols-[84px_148px_minmax(0,1fr)_auto] items-center gap-x-4 px-3 py-1.5">
			<span className="font-count text-[15px] text-ink-2">{day}</span>
			{l.answered > 0 ? (
				<span role="img" aria-label={`${l.right} of ${l.answered} right`} className="flex flex-wrap gap-[3px] py-1">
					{l.answers.map((a) => (
						<span key={a.toolCallId} data-outcome={a.outcome} className={cn("size-3", OUTCOME_BG[a.outcome])} />
					))}
				</span>
			) : (
				<span />
			)}
			<TitleCell lesson={l} actions={actions} />
			<MoreButton lesson={l} actions={actions} />
		</RowShell>
	);
}

/**
 * AN UNFINISHED LESSON (the side column): the title, then its steps as
 * blocks (a homework's: its deadline's problems) and, on the first row
 * only, its key. The link covers the key, so the key lights and sinks with
 * the row.
 */
export function UnfinishedRow({ lesson: l, blocks, withKey, actions }: { lesson: LessonProgress; blocks: { done: number; total: number } | null; withKey: boolean; actions: LessonActions }) {
	const blockLabel = blocks && (l.kind === "homework" ? `${blocks.done} of ${blocks.total} problems done` : `Step ${blocks.done} of ${blocks.total}`);
	return (
		<RowShell lesson={l} actions={actions} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-1 gap-y-2 px-2 py-2">
			<TitleCell lesson={l} actions={actions} />
			<MoreButton lesson={l} actions={actions} className="-my-0.5" />
			{(blocks || withKey) && (
				<span className="col-span-2 flex items-center justify-between gap-3">
					{blocks && blockLabel ? <StepBlocks done={blocks.done} total={blocks.total} label={blockLabel} /> : <span />}
					{withKey && (
						<span
							data-testid="lesson-row-key"
							className="lh-btn h-[30px] shrink-0 px-3 text-[15px] group-has-[a:hover]:bg-(--lh-key-hover) group-has-[a:active]:border-t-(length:--lh-lip) group-has-[a:active]:border-b-0"
						>
							{keyLabel(l)}
						</span>
					)}
				</span>
			)}
		</RowShell>
	);
}

/** The title as a text field: everything selected on entry, Enter or
 *  leaving the field saves, Esc discards. */
function RenameField({ title, onCommit, onCancel }: { title: string; onCommit: (next: string) => void; onCancel: () => void }) {
	const [draft, setDraft] = useState(title);
	const inputRef = useRef<HTMLInputElement | null>(null);
	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);
	return (
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
			className="lh-well relative z-10 w-full min-w-0 px-2 py-1 text-[17px] text-ink outline-none"
		/>
	);
}
