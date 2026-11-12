"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { FileCoverage, GraphContextPick, TopicProgress } from "@/shared/core";
import { NoAgentLine } from "@/frontend/components/agent-folder/no-agent-line";
import { useSpaces } from "@/frontend/components/space-context";
import { useRiseOnChange } from "@/frontend/components/motion";
import { useProgress } from "@/frontend/components/use-progress";
import { displayName } from "@/frontend/components/overview/overview-model";
import { DeadlineStarts } from "@/frontend/components/home/deadline-starts";
import { FactsPicker, useGraphSnapshot } from "@/frontend/components/home/facts-picker";
import { SuggestionList } from "@/frontend/components/home/suggestions";
import { homeSuggestions } from "@/frontend/components/home/suggestions-model";
import { TopicBox } from "@/frontend/components/home/topic-box";
import { useLessonStart } from "@/frontend/components/home/use-lesson-start";
import { useLessonStep } from "@/frontend/components/home/use-lesson-step";
import { useAttachmentDraft } from "@/frontend/components/lesson/attachment-tray";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";

/**
 * THE STUDY PAGE ("/new"): where every study session starts, in the
 * active space. "Lessons" goes back to the space's lessons. "Study for
 * <deadline>" for each upcoming deadline ("Continue studying for" while
 * its latest session is unfinished), the topic box ("Start from
 * facts" picks facts from the chain table; Enter or Study starts), then
 * "Suggested for <space>": Continue the latest lesson, Next up (the
 * earliest unstudied file) and Work on next (weak or untested topics).
 */
export function NewLesson() {
	const { active: activeSpaceId, activeSpace } = useSpaces();
	const lesson = useLessonStart();
	const { data } = useProgress();
	// Progress for a space the window just left is never shown.
	const progress = data && data.spaceId === activeSpaceId ? data : null;

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
	const snapshot = useGraphSnapshot(activeSpaceId);

	const topicInputRef = useRef<HTMLTextAreaElement>(null);
	// Switching space swaps the view: it rises in once.
	const viewRef = useRef<HTMLDivElement>(null);
	useRiseOnChange(viewRef, activeSpaceId);

	const { start, studyTopics, studyDeadline } = lesson;
	const startTopic = () => void start({ title: topicRef.current, picks, files: attachments.files.map((f) => f.attachment) });
	const studyFile = useCallback((file: FileCoverage) => void start({ title: displayName(file.name) }), [start]);
	const studyTopic = useCallback((t: TopicProgress) => void studyTopics([t.id]), [studyTopics]);

	const deadlines = useMemo(() => (progress?.deadlines ?? []).filter((d) => d.daysUntil >= 0 && !d.done), [progress]);
	const suggestions = useMemo(() => homeSuggestions(progress), [progress]);
	const latest = progress?.lessons[0] ?? null;
	const step = useLessonStep(latest?.chatId ?? null, latest?.updatedAt ?? null);

	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="home">
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div ref={viewRef} className="mx-auto flex w-full max-w-[768px] flex-col gap-9 px-6 pt-[22px] pb-16" style={{ animationDuration: "var(--lh-dur-slow)" }}>
					<div className="flex flex-col items-start gap-2.5">
						<Link href="/space/lessons" prefetch={false} data-testid="page-back" className="lh-btn lh-btn-quiet -ml-1 text-[15px]">
							<PixelIcon name="chevron" className="-scale-x-100" />
							Lessons
						</Link>
						<h1 className="text-[38px] leading-[1.2] text-ink">What do you want to study?</h1>
					</div>
					<div className="flex flex-col gap-3.5">
						{progress && deadlines.length > 0 && <DeadlineStarts deadlines={deadlines} busy={lesson.busy} onStudy={(d) => void studyDeadline(d)} />}
						<TopicBox
							text={topic}
							onText={(t) => {
								topicRef.current = t;
								setTopic(t);
							}}
							onStart={startTopic}
							busy={lesson.busy}
							inputRef={topicInputRef}
							picks={picks.length}
							canPick={(snapshot?.propositions.length ?? 0) > 0}
							onOpenPicker={() => setPickerOpen(true)}
							onClearPicks={() => setPicks([])}
							attachments={attachments}
						/>
						<NoAgentLine />
						{lesson.error && (
							<p role="alert" data-testid="lesson-start-error" className="text-[15px] text-ans-wrong">
								{lesson.error}
							</p>
						)}
					</div>
					<SuggestionList
						key={activeSpaceId ?? "none"}
						spaceLabel={activeSpace?.name ?? null}
						suggestions={suggestions}
						step={step}
						busy={lesson.busy}
						onStudyFile={studyFile}
						onStudyTopic={studyTopic}
					/>
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
