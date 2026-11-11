"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { hasProblems, type DeadlineProgress } from "@/shared/core";
import { classColorVar } from "@/frontend/components/class-color";
import { useClasses } from "@/frontend/components/class-context";
import { ClassHeadAside } from "@/frontend/components/class-page/class-head";
import { LoadFailed } from "@/frontend/components/load-failed";
import { useMinute } from "@/frontend/components/countdown";
import { useLessonStart } from "@/frontend/components/home/use-lesson-start";
import { useProgress } from "@/frontend/components/use-progress";
import { PickClass } from "@/frontend/components/pick-class";
import { HeadSignature } from "./head-signature";
import { OverviewBody } from "./overview-body";
import { studiedShare } from "./overview-model";

/**
 * THE CLASS'S PROGRESS TAB: the body reads the active class's progress
 * (useProgress), and the class's signature goes in the class head.
 *
 * The next deadline's button works on it or studies for it; "Most needed"
 * → Study starts a study session on that topic (useLessonStart, in the
 * active class).
 */
export function ClassOverview() {
	const { active, activeClass } = useClasses();
	const { data, error, refresh } = useProgress();
	const router = useRouter();
	const lesson = useLessonStart();
	const nowMs = useMinute();

	// Progress for a class the window just left is never shown.
	const current = data && data.classId === active ? data : null;
	const share = useMemo(() => (current ? studiedShare(current.facts) : null), [current]);

	const { studyTopics, studyDeadline, workOnHomework } = lesson;
	const study = useCallback((topicId: string) => void studyTopics([topicId]), [studyTopics]);
	const startDeadline = useCallback((d: DeadlineProgress) => void (hasProblems(d.kind) ? workOnHomework(d) : studyDeadline(d)), [workOnHomework, studyDeadline]);

	return (
		<div className="h-full overflow-y-auto">
			{activeClass?.signature && (
				<ClassHeadAside>
					<HeadSignature signature={activeClass.signature} share={share} />
				</ClassHeadAside>
			)}
			<OverviewBody
				key={active ?? "none"}
				hasClass={!!activeClass}
				color={activeClass ? classColorVar(activeClass.color) : "var(--border)"}
				note={activeClass?.note}
				data={current}
				nowMs={nowMs}
				busy={lesson.busy}
				startError={lesson.error}
				onStudy={study}
				onStartDeadline={startDeadline}
				onAddDeadline={() => router.push("/class/deadlines")}
				pickClass={active ? undefined : <PickClass line="Pick a class to see how it's going." />}
			/>
			{!current && error && <LoadFailed message="Couldn't load this class's progress." onRetry={refresh} className="mx-auto w-full max-w-[908px] px-6" />}
		</div>
	);
}
