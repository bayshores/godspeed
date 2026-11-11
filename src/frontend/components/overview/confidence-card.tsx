import { memo, useMemo } from "react";
import Link from "next/link";
import type { Calibration, CalibrationLevel, SureButWrong } from "@/shared/core";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { InlineMath } from "./inline-math";
import { calibrationTakeaway, isLevelOverconfident, questionHref } from "./overview-model";
import { ROW, TITLE } from "./styles";

/**
 * CAN YOU TRUST YOUR CONFIDENCE? (Progress): for each confidence level 1
 * to 5, the share of answers that were right against the level's target
 * line (level × 20 %). A sure level (4 or 5) that falls short is red.
 * Beside the bars: a one-line takeaway and what the bars mean. Under
 * them: the "sure but wrong" questions, each opening in its lesson.
 */
export const ConfidenceCard = memo(function ConfidenceCard({ calibration }: { calibration: Calibration }) {
	const takeaway = useMemo(() => calibrationTakeaway(calibration.levels), [calibration.levels]);
	return (
		<Pane data-testid="overview-confidence" className="flex flex-col px-6 pt-[18px] pb-4">
			<h2 className={TITLE}>Can you trust your confidence?</h2>
			<div className="flex flex-wrap items-center gap-x-8 gap-y-4 py-3">
				<div className="flex shrink-0 gap-3.5">
					{calibration.levels.map((level) => (
						<LevelBar key={level.level} level={level} />
					))}
				</div>
				<div className="flex min-w-[220px] flex-1 flex-col gap-2.5">
					{takeaway && <p className="text-[17px] text-ink">{takeaway}</p>}
					<div data-testid="calibration-legend" className="flex flex-col gap-2.5 text-[15px] text-ink-2">
						<p>How sure you were, from 1 (guessing) to 5 (certain).</p>
						<p>The fill is how often you were right. The line is where it would be if your confidence matched.</p>
					</div>
				</div>
			</div>
			{calibration.sureButWrong.length > 0 && (
				<>
					<h3 className="border-t-[1.5px] border-ink pt-3 text-[15px] text-ink">Sure but wrong</h3>
					<ul className="flex flex-col">
						{calibration.sureButWrong.map((q) => (
							<SureButWrongRow key={`${q.chatId}:${q.toolCallId}`} q={q} />
						))}
					</ul>
				</>
			)}
		</Pane>
	);
});

/** One level: "right/answered", the bar (right share and target line),
 *  the level number. */
const LevelBar = memo(function LevelBar({ level }: { level: CalibrationLevel }) {
	const red = isLevelOverconfident(level);
	return (
		<div data-testid={`calibration-level-${level.level}`} data-overconfident={red || undefined} className="flex flex-col items-center gap-1.5">
			<span className="font-count text-[15px] text-ink tabular-nums">{level.answered > 0 ? `${level.right}/${level.answered}` : "–"}</span>
			<div className="relative h-[110px] w-[52px] overflow-hidden bg-background">
				{level.rate !== null && (
					<div data-testid="calibration-right" className={cn("absolute inset-x-0 bottom-0", red ? "bg-ans-wrong" : "bg-ans-right")} style={{ height: `${level.rate * 100}%` }} />
				)}
				{/* Edged in the page's color, so the line shows over the fill. */}
				<div data-testid="calibration-target" className="absolute inset-x-0 h-[3px] bg-ink shadow-[0_0_0_1px_var(--background)]" style={{ top: `${100 - level.target}%` }} />
			</div>
			<span className="text-[15px] text-ink tabular-nums">{level.level}</span>
		</div>
	);
});

const SureButWrongRow = memo(function SureButWrongRow({ q }: { q: SureButWrong }) {
	return (
		<li>
			<Link href={questionHref(q.chatId, q.messageId)} prefetch={false} data-testid={`sure-but-wrong-${q.toolCallId}`} className={cn(ROW, "py-[9px]")}>
				<span className="min-w-0 flex-1 truncate font-prose text-lg text-ink">
					<InlineMath text={q.question} />
				</span>
				<span className="shrink-0 text-base text-ink-2">Picked {q.level}</span>
				<PixelIcon name="chevron" className="h-3.5 text-ink" />
			</Link>
		</li>
	);
});
