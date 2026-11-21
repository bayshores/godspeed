import { memo, type ReactNode } from "react";
import { Link } from "react-router";
import type { FileCoverage, TopicProgress } from "@/shared/core";
import { Key } from "@/frontend/components/ui/key";
import { InlineMath } from "@/frontend/components/overview/inline-math";
import { StepBlocks } from "@/frontend/components/overview/lesson-rows";
import { stepBlocks } from "@/frontend/components/overview/lesson-record-model";
import { lessonHref } from "@/frontend/components/overview/overview-model";
import { Pane } from "@/frontend/components/ui/pane";
import { suggestionKey, suggestionLine, type Suggestion } from "./suggestions-model";

const ACTION = "shrink-0 text-[15px]";

/**
 * "Suggested for <space>": Continue (the newest unfinished lesson, Open), Next up
 * (the path's next topic or the earliest unstudied file, Study) and Work
 * on next (topics, Study). Renders nothing when there is nothing to
 * suggest.
 */
export const SuggestionList = memo(function SuggestionList({
	spaceLabel: label,
	suggestions,
	busyOn,
	onStudyFile,
	onStudyTopic,
	onStudyPath,
}: {
	/** The space's name; null = no space. */
	spaceLabel: string | null;
	suggestions: readonly Suggestion[];
	busyOn: string | null;
	onStudyFile: (file: FileCoverage) => void;
	onStudyTopic: (topic: TopicProgress) => void;
	onStudyPath: (topicId: string) => void;
}) {
	if (suggestions.length === 0) return null;
	return (
		<Pane data-testid="home-suggestions" className="lh-card lh-rise">
			<div className="lh-card-head">
				<h2 className="lh-card-title">{label ? `Suggested for ${label}` : "Suggested"}</h2>
			</div>
			<ul className="flex w-full flex-col gap-4">
				{suggestions.map((s) => (
					<SuggestionRow key={suggestionKey(s)} suggestion={s} busyOn={busyOn} onStudyFile={onStudyFile} onStudyTopic={onStudyTopic} onStudyPath={onStudyPath} />
				))}
			</ul>
		</Pane>
	);
});

const SuggestionRow = memo(function SuggestionRow({
	suggestion: s,
	busyOn,
	onStudyFile,
	onStudyTopic,
	onStudyPath,
}: {
	suggestion: Suggestion;
	busyOn: string | null;
	onStudyFile: (file: FileCoverage) => void;
	onStudyTopic: (topic: TopicProgress) => void;
	onStudyPath: (topicId: string) => void;
}) {
	const blocks = s.kind === "continue" ? stepBlocks(s.lesson) : null;
	let title: string;
	let action: ReactNode;
	if (s.kind === "continue") {
		title = s.lesson.title;
		action = (
			<Link to={lessonHref(s.lesson.chatId)} data-testid="home-continue" className={`lh-btn ${ACTION}`}>
				Open
			</Link>
		);
	} else if (s.kind === "next-up") {
		title = s.file.displayName;
		action = (
			<Key data-testid="home-study-file" busy={busyOn === s.file.fileId} disabled={busyOn !== null} onClick={() => onStudyFile(s.file)} className={ACTION}>
				Study
			</Key>
		);
	} else if (s.kind === "path") {
		const topicId = s.topic.id;
		title = s.topic.name;
		action = (
			<Key data-testid="home-study-path" busy={busyOn === topicId} disabled={busyOn !== null} onClick={() => onStudyPath(topicId)} className={ACTION}>
				Study
			</Key>
		);
	} else {
		title = s.topic.name;
		action = (
			<Key data-testid="home-study-topic" busy={busyOn === s.topic.id} disabled={busyOn !== null} onClick={() => onStudyTopic(s.topic)} className={ACTION}>
				Study
			</Key>
		);
	}
	return (
		<li data-testid={`home-suggestion-${s.kind}`} className="flex w-full items-center gap-3.5">
			<span className="flex min-w-0 flex-1 flex-col gap-1">
				<span className="truncate text-[17px] leading-tight text-ink">
					<InlineMath text={title} />
				</span>
				<span className="flex min-w-0 items-center gap-2.5 text-base text-ink-2">
					{blocks && <StepBlocks done={blocks.done} total={blocks.total} />}
					<span className="truncate">{suggestionLine(s)}</span>
				</span>
			</span>
			{action}
		</li>
	);
});
