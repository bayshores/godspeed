import { memo } from "react";
import { PlusIcon } from "lucide-react";
import type { ClassSummary, ProgressPayload } from "@/core";
import { nextDueText, type OpenDeadline } from "@/components/deadlines-model";
import { InkedSignature } from "@/components/overview/class-cover";
import { studiedShare } from "@/components/overview/class-cover-model";
import { studiedFacts } from "@/components/overview/runway-model";
import { CARD } from "@/components/overview/styles";
import { cn } from "@/lib/utils";

/**
 * A CLASS BLOCK (Home's right column):
 * the class name and the first line of its description (its signature
 * small and dim behind them, inked like the cover), the facts studied
 * with a bar, the next deadline, then Continue (the latest lesson; "New
 * lesson" when there is none) and Open class.
 */
export const ClassBlock = memo(function ClassBlock({
	cls,
	progress,
	nextDue,
	nowMs,
	onContinue,
	onNewLesson,
	onOpenClass,
}: {
	cls: Pick<ClassSummary, "id" | "name" | "description" | "signature">;
	progress: Pick<ProgressPayload, "facts" | "lessons">;
	/** The class's soonest open deadline. */
	nextDue: OpenDeadline | null;
	nowMs: number;
	onContinue: (classId: string, chatId: string) => void;
	onNewLesson: (classId: string) => void;
	onOpenClass: (classId: string) => void;
}) {
	const firstLine = cls.description.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
	const facts = studiedFacts(progress.facts);
	const latest = progress.lessons[0] ?? null;
	return (
		<section data-testid={`class-block-${cls.id}`} className={cn(CARD, "relative overflow-hidden")}>
			{cls.signature && (
				<InkedSignature
					signature={cls.signature}
					share={studiedShare(facts)}
					className={cn("absolute top-3 right-4", cls.signature.kind === "math" ? "text-[30px]" : "text-[44px]")}
				/>
			)}
			<div className="relative flex w-full min-w-0 flex-col gap-1">
				<h2 className="truncate font-title text-[22px] leading-7 font-bold text-ink">{cls.name}</h2>
				{firstLine && <p className="truncate text-[13.5px] leading-5 text-ink-2">{firstLine}</p>}
			</div>
			<div className="flex w-full flex-col gap-2">
				<div data-testid="class-block-facts" className="flex items-baseline gap-1.5 text-[13.5px] text-ink-2">
					<span className="font-mono text-[18px] leading-none font-bold tabular-nums text-ink">{facts.studied}</span>
					<span>
						of <span className="font-mono tabular-nums">{facts.total}</span> facts studied
					</span>
				</div>
				<span className="flex h-1.5 w-full bg-tone-2" aria-hidden>
					{facts.total > 0 && <span className="h-full bg-ink-2" style={{ width: `${(facts.studied / facts.total) * 100}%` }} />}
				</span>
			</div>
			{nextDue && (
				<p data-testid="class-block-next-due" className="w-full truncate text-[13.5px] text-ink-2">
					Next due: <span className="text-ink">{nextDueText(nextDue, nowMs)}</span>
				</p>
			)}
			<div className="flex w-full gap-2">
				{latest ? (
					<button
						type="button"
						data-testid="class-block-continue"
						onClick={() => onContinue(cls.id, latest.chatId)}
						className="lh-press flex min-w-0 flex-1 items-center gap-1.5 bg-ink px-3.5 py-2 text-sm font-extrabold text-black hover:bg-white"
					>
						<span className="min-w-0 truncate">Continue: {latest.title}</span>
					</button>
				) : (
					<button
						type="button"
						data-testid="class-block-new-lesson"
						onClick={() => onNewLesson(cls.id)}
						className="lh-press flex min-w-0 flex-1 items-center gap-1.5 bg-ink px-3.5 py-2 text-sm font-extrabold text-black hover:bg-white"
					>
						<PlusIcon className="size-3.5 shrink-0" aria-hidden />
						New lesson
					</button>
				)}
				<button
					type="button"
					data-testid="class-block-open"
					onClick={() => onOpenClass(cls.id)}
					className="lh-press flex shrink-0 items-center bg-tone px-3.5 py-2 text-sm font-bold text-ink hover:bg-tone-2"
				>
					Open class
				</button>
			</div>
		</section>
	);
});
