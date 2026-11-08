import { SearchIcon } from "lucide-react";
import { TopBar } from "@/frontend/components/app-bar";
import { slug } from "@/frontend/components/app-bar-model";
import { Hint } from "@/frontend/components/ui/hint";
import { cn } from "@/frontend/lib/utils";
import { kbdEventForAction, type LessonKind, type PlanStepBar } from "@/shared/core";
import type { PracticeProgress } from "./practice-progress";
import { StepBar } from "./step-bar";
import type { useTitleRename } from "./use-title-rename";

/**
 * THE LESSON'S PART OF THE TOP BAR: the path ends in the lesson's name,
 * which renames in place on a click (or F2). Its buttons: the plan step
 * bar (or, in practice, one block per problem), the cheat sheet beside
 * the session, and Find.
 */
export function LessonTopBar({
	kind,
	rename,
	bar,
	practice,
	onJump,
	onOpenPlan,
	sheet,
}: {
	kind: LessonKind;
	rename: ReturnType<typeof useTitleRename>;
	bar: PlanStepBar | null;
	practice: PracticeProgress | null;
	onJump: (toolCallId: string) => void;
	onOpenPlan: () => void;
	/** The cheat sheet beside the session (a session in a class). */
	sheet?: { open: boolean; onToggle: () => void };
}) {
	return (
		<TopBar path={[]} tail={rename.renaming ? <RenameInput rename={rename} /> : <TitleButton rename={rename} />}>
			{kind === "practice"
				? practice && practice.blocks.length > 0 && <PracticeBlocks progress={practice} />
				: bar && bar.steps.length > 0 && <StepBar bar={bar} onJump={onJump} onOpenPlan={onOpenPlan} />}
			{sheet && (
				<button type="button" data-testid="lesson-cheat-sheet" aria-pressed={sheet.open} onClick={sheet.onToggle} className={cn("lh-btn", sheet.open && "border-tint text-tint")}>
					cheat sheet
				</button>
			)}
			<Hint label="Find" side="bottom">
				<button
					type="button"
					data-testid="lesson-find"
					aria-label="Find"
					onClick={() => window.dispatchEvent(new CustomEvent(kbdEventForAction("find")))}
					className="lh-press flex size-7 shrink-0 items-center justify-center text-ink-3 hover:text-ink"
				>
					<SearchIcon className="size-4" />
				</button>
			</Hint>
		</TopBar>
	);
}

function TitleButton({ rename }: { rename: ReturnType<typeof useTitleRename> }) {
	return (
		<Hint label="Rename lesson" side="bottom">
			<button
				type="button"
				data-testid="lesson-title"
				onClick={rename.start}
				className="lh-no-drag min-w-0 shrink cursor-text truncate text-left font-bold text-ink"
			>
				{slug(rename.title)}
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
			className="lh-no-drag min-w-[8ch] max-w-full shrink bg-transparent font-bold text-ink caret-current outline-none [field-sizing:content]"
		/>
	);
}

/** Practice: one block per finished problem (gray solved, dark not),
 *  the active problem white, then the count. */
function PracticeBlocks({ progress }: { progress: PracticeProgress }) {
	return (
		<div data-testid="practice-progress" className="flex shrink-0 items-center gap-3">
			<span className="flex items-center gap-[3px]" aria-hidden>
				{progress.blocks.map((b, i) => (
					<span
						key={i}
						data-block={b}
						className={cn(
							"block h-1.5 w-2.5",
							b === "current" && "bg-ink",
							b === "solved" && "bg-ink-2",
							b === "missed" && "bg-tone-2",
						)}
					/>
				))}
			</span>
			{progress.finished > 0 && (
				<span className="text-sm text-ink-2 tabular-nums">
					{progress.solved} of {progress.finished} solved
				</span>
			)}
		</div>
	);
}
