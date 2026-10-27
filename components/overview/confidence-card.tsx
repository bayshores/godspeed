import { memo, useMemo } from "react";
import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";
import type { Calibration, CalibrationLevel, SureButWrong } from "@/src/core";
import { cn } from "@/lib/utils";
import { InlineMath } from "./inline-math";
import { calibrationTakeaway, isLevelOverconfident, questionHref } from "./overview-model";
import { CARD, CARD_TITLE } from "./styles";

/**
 * CAN YOU TRUST YOUR CONFIDENCE? (Class Overview): for each confidence
 * level 1–5, the share of answers that were right against the level's
 * target line (level × 20 %). A sure level (4–5) that falls short is red.
 * Under it: a one-line takeaway and the "sure but wrong" questions, each
 * opening the question in its lesson.
 */
export const ConfidenceCard = memo(function ConfidenceCard({
	calibration,
	className,
}: {
	calibration: Calibration;
	className?: string;
}) {
	const takeaway = useMemo(() => calibrationTakeaway(calibration.levels), [calibration.levels]);
	return (
		<section data-testid="overview-confidence" className={cn(CARD, className)}>
			<h2 className={CARD_TITLE}>Can you trust your confidence?</h2>
			<div className="flex w-full items-end gap-1.5">
				{calibration.levels.map((level) => (
					<LevelBar key={level.level} level={level} />
				))}
			</div>
			{takeaway && <p className="w-full text-[15px] font-bold text-ink">{takeaway}</p>}
			{calibration.sureButWrong.length > 0 && (
				<ul className="flex w-full flex-col gap-0.5">
					{calibration.sureButWrong.map((q) => (
						<SureButWrongRow key={`${q.chatId}:${q.toolCallId}`} q={q} />
					))}
				</ul>
			)}
		</section>
	);
});

/** One level: "right/answered", the 110px well (right share + target
 *  line), the level number. */
const LevelBar = memo(function LevelBar({ level }: { level: CalibrationLevel }) {
	const red = isLevelOverconfident(level);
	return (
		<div data-testid={`calibration-level-${level.level}`} data-overconfident={red || undefined} className="flex flex-1 flex-col items-center gap-[5px]">
			<span className="font-mono text-xs tabular-nums text-ink-3">{level.answered > 0 ? `${level.right}/${level.answered}` : "–"}</span>
			<div className="relative h-[110px] w-full overflow-hidden bg-tone">
				{level.rate !== null && (
					<div
						data-testid="calibration-right"
						className={cn("absolute inset-x-0 bottom-0", red ? "bg-ans-wrong" : "bg-ink-3")}
						style={{ height: `${level.rate * 100}%` }}
					/>
				)}
				<div
					data-testid="calibration-target"
					className="absolute inset-x-0 h-0.5 bg-ink"
					style={{ top: `${100 - level.target}%` }}
				/>
			</div>
			<span className="font-mono text-[12.5px] font-bold tabular-nums text-ink-2">{level.level}</span>
		</div>
	);
});

const SureButWrongRow = memo(function SureButWrongRow({ q }: { q: SureButWrong }) {
	return (
		<li>
			<Link
				href={questionHref(q.chatId, q.messageId)}
				data-testid={`sure-but-wrong-${q.toolCallId}`}
				className="lh-press flex w-full items-center gap-2.5 bg-tone px-3 py-[9px] hover:bg-tone-2 focus-visible:bg-tone-2"
			>
				<span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
					<InlineMath text={q.question} />
				</span>
				<span className="shrink-0 text-[12.5px] text-ink-3">
					Picked {q.level}
				</span>
				<ArrowUpRightIcon className="size-3.5 shrink-0 text-ink-2" aria-hidden />
			</Link>
		</li>
	);
});
