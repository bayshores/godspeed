import { DumbbellIcon, SearchIcon } from "lucide-react";
import { SidebarToggle } from "@/components/sidebar";
import { FollowChip } from "@/components/halley/follow-chip";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";
import { kbdEventForAction, type PlanStepBar } from "@/core";
import type { PracticeProgress } from "./practice-progress";
import { StepBar } from "./step-bar";
import type { useTitleRename } from "./use-title-rename";

/**
 * THE LESSON TOP BAR: a 56px window-drag band
 * over the reading pane and the Your-turn panel.
 * - Teaching with a plan: the plan step bar.
 * - Practice: the lesson name, one block per problem and "2 of 3 solved".
 * - Before a plan exists: the lesson name.
 * The name is renamed in place (click or F2); the search icon opens Find.
 */
export function LessonTopBar({
	kind,
	rename,
	bar,
	practice,
	onJump,
	onOpenPlan,
}: {
	kind: "teach" | "practice";
	rename: ReturnType<typeof useTitleRename>;
	bar: PlanStepBar | null;
	practice: PracticeProgress | null;
	onJump: (toolCallId: string) => void;
	onOpenPlan: () => void;
}) {
	const { renaming } = rename;
	return (
		<header
			onMouseDown={(e) => {
				// Any mousedown outside the rename input commits it (via blur).
				if (renaming && e.target !== rename.inputRef.current) rename.inputRef.current?.blur();
			}}
			className={cn(
				// While renaming the bar is no drag surface: app-region:drag would
				// eat the mousedown that ends the rename.
				!renaming && "lh-drag",
				"lh-wco-gutter flex h-14 shrink-0 select-none items-center gap-5 pl-7 pr-5",
			)}
		>
			<div className="flex min-w-0 flex-1 items-center gap-3">
				<SidebarToggle />
				<FollowChip />
				{renaming ? (
					<RenameInput rename={rename} />
				) : kind === "practice" ? (
					<>
						<DumbbellIcon aria-hidden className="size-4 shrink-0 text-ink-2" />
						<TitleButton rename={rename} />
						{practice && practice.blocks.length > 0 && <PracticeBlocks progress={practice} />}
					</>
				) : bar && bar.steps.length > 0 ? (
					<StepBar bar={bar} onJump={onJump} onOpenPlan={onOpenPlan} />
				) : (
					<TitleButton rename={rename} />
				)}
			</div>
			<Hint label="Find" side="bottom">
				<button
					type="button"
					data-testid="lesson-find"
					aria-label="Find"
					onClick={() => window.dispatchEvent(new CustomEvent(kbdEventForAction("find")))}
					className="lh-press flex size-8 shrink-0 items-center justify-center text-ink-3 hover:text-ink"
				>
					<SearchIcon className="size-4" />
				</button>
			</Hint>
		</header>
	);
}

function TitleButton({ rename }: { rename: ReturnType<typeof useTitleRename> }) {
	return (
		<Hint label="Rename lesson" side="bottom">
			<button
				type="button"
				data-testid="lesson-title"
				onClick={rename.start}
				className="lh-no-drag min-w-0 shrink cursor-text truncate text-left text-[15px] font-bold text-ink"
			>
				{rename.title}
			</button>
		</Hint>
	);
}

function RenameInput({ rename }: { rename: ReturnType<typeof useTitleRename> }) {
	return (
		<input
			ref={rename.inputRef}
			value={rename.draft}
			onChange={(e) => rename.setDraft(e.target.value)}
			onKeyDown={(e) => {
				if (e.key === "Enter") void rename.commit(rename.draft);
				else if (e.key === "Escape") {
					// The rename claims its Esc: closing it must not abort a turn.
					e.stopPropagation();
					rename.cancel();
				}
			}}
			onBlur={() => void rename.commit(rename.draft)}
			spellCheck={false}
			aria-label="Lesson name"
			className="lh-no-drag min-w-[8ch] max-w-[70%] shrink-0 bg-transparent text-[15px] font-bold text-ink caret-current outline-none [field-sizing:content]"
		/>
	);
}

/** Practice: one block per finished problem (gray solved, dark not),
 *  the active problem white and wide, then the count. */
function PracticeBlocks({ progress }: { progress: PracticeProgress }) {
	return (
		<div data-testid="practice-progress" className="flex shrink-0 items-center gap-3">
			<span className="flex items-center gap-[3px]" aria-hidden>
				{progress.blocks.map((b, i) => (
					<span
						key={i}
						data-block={b}
						className={cn(
							"block",
							b === "current" ? "h-2.5 w-[22px] bg-ink" : "h-1.5 w-2.5",
							b === "solved" && "bg-ink-2",
							b === "missed" && "bg-tone-2",
						)}
					/>
				))}
			</span>
			{progress.finished > 0 && (
				<span className="font-mono text-[12.5px] text-ink-3 tabular-nums">
					{progress.solved} of {progress.finished} solved
				</span>
			)}
		</div>
	);
}
