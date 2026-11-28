import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { FileCoverage, GraphContextPick, TopicProgress } from "@/shared/core";
import { useMinute } from "@/frontend/components/countdown";
import { spaceColorVar } from "@/frontend/components/space-color";
import { useSpaces } from "@/frontend/components/space-context";
import { useWaited } from "@/frontend/components/loading";
import { useProgress } from "@/frontend/components/use-progress";
import { COMING_UP_ROWS, DeadlineRows } from "@/frontend/components/study-page/deadline-rows";
import { FactsPicker } from "@/frontend/components/study-page/facts-picker";
import { useGraphSnapshot } from "@/frontend/components/graph/use-graph-snapshot";
import { SuggestionList } from "@/frontend/components/study-page/suggestions";
import { comingUp, studyPageSuggestions } from "@/frontend/components/study-page/suggestions-model";
import { TopicBox } from "@/frontend/components/study-page/topic-box";
import { useLessonStart } from "@/frontend/components/study-page/use-lesson-start";
import { useAttachmentDraft } from "@/frontend/components/lesson/attachment-tray";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";

/**
 * THE STUDY PAGE ("/new"): where every study session starts, in the
 * active space. "Progress" goes back to the space's Progress page. The
 * topic box ("Start from facts" picks facts from the chain table; Enter or
 * Study starts), beside it "Coming up" (the soonest deadlines, each with
 * its Study key), then "Suggested for <space>": Continue the latest
 * lesson, Next up (the earliest unstudied file) and Work on next (weak or
 * untested topics).
 */
export function NewLesson() {
	const { active: activeSpaceId, activeSpace } = useSpaces();
	const lesson = useLessonStart();
	const { data } = useProgress();
	// Progress for a space the window just left is never shown.
	const progress = data && data.spaceId === activeSpaceId ? data : null;
	const waited = useWaited(progress !== null);

	const [topic, setTopic] = useState("");
	/* The topic MIRROR: the start reads the ref, kept current at every
	 * write, so a closure never sees a stale draft. */
	const topicRef = useRef("");
	const [picks, setPicks] = useState<GraphContextPick[]>([]);
	const attachments = useAttachmentDraft();
	const [pickerOpen, setPickerOpen] = useState(false);
	// Picks belong to one space's graph — switching space clears them.
	useEffect(() => setPicks([]), [activeSpaceId]);
	const pickedIds = useMemo(() => new Set(picks.map((p) => p.id)), [picks]);
	// The picker's rows.
	const snapshot = useGraphSnapshot(activeSpaceId).value;

	const topicInputRef = useRef<HTMLTextAreaElement>(null);

	const { start, studyTopics, studyFiles, studyPathTopic, studyDeadline, workOnHomework } = lesson;
	const startTopic = () => void start({ title: topicRef.current, picks, files: attachments.files.map((f) => f.attachment) });
	const studyFile = useCallback((file: FileCoverage) => void studyFiles([file.fileId]), [studyFiles]);
	const studyTopic = useCallback((t: TopicProgress) => void studyTopics([t.id]), [studyTopics]);
	const studyPath = useCallback((topicId: string) => void studyPathTopic(topicId), [studyPathTopic]);

	const deadlines = useMemo(() => comingUp(progress), [progress]);
	const suggestions = useMemo(() => studyPageSuggestions(progress, deadlines.slice(0, COMING_UP_ROWS)), [progress, deadlines]);
	const nowMs = useMinute();

	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="home">
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="@container/page lh-page flex flex-col gap-(--lh-head-gap) pt-(--lh-page-top) pb-(--lh-page-end)">
					<div className="flex flex-col items-start gap-2.5">
						<Link to="/space" data-testid="page-back" className="lh-btn lh-btn-quiet lh-btn-flush">
							<PixelIcon name="chevron" className="-scale-x-100" />
							Progress
						</Link>
						<h1 className="lh-page-title">What do you want to study?</h1>
					</div>
					{/* Wide, the topic box with the suggestions under it is the left half and the deadlines are the right. */}
					<div className="grid grid-cols-1 items-start gap-(--lh-gap) @[1100px]/page:grid-cols-2 @[1100px]/page:grid-rows-[auto_auto_1fr]">
						<TopicBox
							text={topic}
							onText={(t) => {
								topicRef.current = t;
								setTopic(t);
							}}
							onStart={startTopic}
							busyOn={lesson.busyOn}
							inputRef={topicInputRef}
							picks={picks.length}
							canPick={(snapshot?.propositions.length ?? 0) > 0}
							onOpenPicker={() => setPickerOpen(true)}
							onClearPicks={() => setPicks([])}
							attachments={attachments}
						/>
						{lesson.error && (
							<p role="alert" data-testid="lesson-start-error" className="text-ui text-ans-wrong">
								{lesson.error}
							</p>
						)}
						{nowMs !== null && deadlines.length > 0 && (
							<div className="flex flex-col @[1100px]/page:col-start-2 @[1100px]/page:row-span-3 @[1100px]/page:row-start-1 @[1100px]/page:self-stretch">
								<DeadlineRows deadlines={deadlines} color={activeSpace ? spaceColorVar(activeSpace.color) : "var(--border)"} nowMs={nowMs} busyOn={lesson.busyOn} onStudy={(d) => void studyDeadline(d)} onWork={(d) => void workOnHomework(d)} />
							</div>
						)}
						<div className="empty:hidden @[1100px]/page:col-start-1">
							<SuggestionList
								key={activeSpaceId ?? "none"}
								spaceLabel={activeSpace?.name ?? null}
								suggestions={suggestions}
								arrives={waited}
								busyOn={lesson.busyOn}
								onStudyFile={studyFile}
								onStudyTopic={studyTopic}
								onStudyPath={studyPath}
							/>
						</div>
					</div>
				</div>
			</div>

			{/* Full-bleed overlay with its own top bar: LAST in the tree, so
			    its window-drag band isn't punched through by earlier controls. */}
			<FactsPicker
				open={pickerOpen}
				snapshot={snapshot}
				picked={pickedIds}
				onPicked={setPicks}
				onClose={() => setPickerOpen(false)}
			/>
		</div>
	);
}
