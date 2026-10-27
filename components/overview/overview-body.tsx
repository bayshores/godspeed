import { memo, useMemo } from "react";
import type { FileCoverage, ProgressPayload } from "@/src/core";
import { CoverageCard } from "./coverage-card";
import { ConfidenceCard } from "./confidence-card";
import { LessonsCard } from "./lessons-card";
import { answeredLessons, hasCalibration } from "./overview-model";

/**
 * The Overview page below the top bar (pure view — the render-test seam):
 * the header (class name in CMU, its description), then Coverage (classes
 * only) and the How-lessons-went / confidence row. Each card shows only
 * once it has something to show; while loading the cards are absent.
 */
export const OverviewBody = memo(function OverviewBody({
	name,
	description,
	hasClass,
	data,
	busy,
	onLearn,
}: {
	name: string;
	description: string;
	hasClass: boolean;
	data: ProgressPayload | null;
	busy: boolean;
	onLearn: (file: FileCoverage) => void;
}) {
	const lessons = useMemo(() => answeredLessons(data?.lessons ?? []), [data?.lessons]);
	const showCoverage = hasClass && !!data && data.files.length > 0;
	const showConfidence = !!data && hasCalibration(data.calibration.levels);
	return (
		<div data-testid="class-overview" className="@container flex w-full flex-col pb-8">
			<header className="flex flex-col gap-2 px-[52px] py-6">
				<h1 data-testid="overview-name" className="font-title text-[40px] leading-[48px] tracking-tight text-ink">
					{name}
				</h1>
				{description && <p className="text-base text-ink-2">{description}</p>}
			</header>
			<div className="flex flex-col gap-4 px-[52px]">
				{showCoverage && <CoverageCard files={data.files} nextUp={data.nextUp} busy={busy} onLearn={onLearn} />}
				{(lessons.length > 0 || showConfidence) && (
					<div className="flex flex-col items-start gap-4 @4xl:flex-row">
						{lessons.length > 0 && (
							<div className="w-full min-w-0 flex-1">
								<LessonsCard lessons={lessons} />
							</div>
						)}
						{showConfidence && <ConfidenceCard calibration={data.calibration} className="@4xl:w-[440px] @4xl:shrink-0" />}
					</div>
				)}
			</div>
		</div>
	);
});
