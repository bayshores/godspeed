import { memo, useMemo } from "react";
import type { ClassNote, ClassSignature, DeadlineProgress, ProgressPayload } from "@/core";
import { ClassCover } from "./class-cover";
import { ConfidenceCard } from "./confidence-card";
import { LessonsCard } from "./lessons-card";
import { answeredLessons, hasCalibration } from "./overview-model";
import { RunwayCard } from "./runway-card";
import { studiedFacts } from "./runway-model";

/**
 * The Overview page below the top bar (pure view — the render-test seam):
 * the header (a class's cover; "No class" gets just its name), then Ready
 * for what's due (classes only) and the How-lessons-went / confidence row. Each card shows only
 * once it has something to show; while loading the cards are absent.
 */
export const OverviewBody = memo(function OverviewBody({
	name,
	description,
	hasClass,
	classId,
	signature,
	note,
	data,
	nowMs,
	busy,
	onPractice,
	onLearn,
	onAddSignature,
}: {
	name: string;
	description: string;
	hasClass: boolean;
	/** The class shown (Halley flies to its header). */
	classId?: string | null;
	signature?: ClassSignature;
	note?: ClassNote;
	data: ProgressPayload | null;
	/** The window's clock (null before the first client render). */
	nowMs: number | null;
	busy: boolean;
	/** A runway ring: practice that deadline's topics. */
	onPractice: (deadline: DeadlineProgress) => void;
	/** "Most needed" → Learn this. */
	onLearn: (topicId: string) => void;
	/** The cover's "Add a signature" (opens Edit class). */
	onAddSignature?: () => void;
}) {
	const lessons = useMemo(() => answeredLessons(data?.lessons ?? []), [data?.lessons]);
	const facts = useMemo(() => studiedFacts(data?.facts ?? []), [data?.facts]);
	const showRunway = hasClass && !!data && nowMs !== null;
	const showConfidence = !!data && hasCalibration(data.calibration.levels);
	return (
		<div data-testid="class-overview" className="@container flex w-full flex-col pb-8">
			{classId ? (
				<ClassCover classId={classId} name={name} description={description} signature={signature} note={note} facts={data ? facts : null} nowMs={nowMs} onAddSignature={onAddSignature} />
			) : (
				<header className="flex flex-col gap-2 px-[52px] py-6">
					<h1 data-testid="overview-name" className="font-title text-[40px] leading-[48px] tracking-tight text-ink">
						{name}
					</h1>
				</header>
			)}
			<div className="flex flex-col gap-4 px-[52px]">
				{showRunway && (
					<RunwayCard
						deadlines={data.deadlines}
						today={data.today}
						nowMs={nowMs}
						facts={facts}
						busy={busy}
						onPractice={onPractice}
						onLearn={onLearn}
					/>
				)}
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
