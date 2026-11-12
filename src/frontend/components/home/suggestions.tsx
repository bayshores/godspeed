import { memo, type ReactNode } from "react";
import Link from "next/link";
import type { FileCoverage, TopicProgress } from "@/shared/core";
import { InlineMath } from "@/frontend/components/overview/inline-math";
import { displayName, lessonHref } from "@/frontend/components/overview/overview-model";
import { suggestionKey, suggestionLine, type LessonStep, type Suggestion } from "./suggestions-model";

const ACTION = "lh-btn shrink-0 text-[15px]";

/**
 * "Suggested for <space>": Continue (the latest lesson, Open), Next up
 * (the earliest unstudied file, Study) and Work on next (topics,
 * Study). Renders nothing when there is nothing to suggest.
 */
export const SuggestionList = memo(function SuggestionList({
	spaceLabel: label,
	suggestions,
	step,
	busy,
	onStudyFile,
	onStudyTopic,
}: {
	/** The space's name; null = no space. */
	spaceLabel: string | null;
	suggestions: readonly Suggestion[];
	/** The Continue lesson's plan position, once read. */
	step: LessonStep | null;
	busy: boolean;
	onStudyFile: (file: FileCoverage) => void;
	onStudyTopic: (topic: TopicProgress) => void;
}) {
	if (suggestions.length === 0) return null;
	return (
		<section data-testid="home-suggestions" className="lh-rise flex w-full flex-col">
			<h2 className="border-b-[1.5px] border-ink pb-1.5 text-xl leading-tight text-ink">{label ? `Suggested for ${label}` : "Suggested"}</h2>
			<ul className="flex w-full flex-col">
				{suggestions.map((s) => (
					<SuggestionRow key={suggestionKey(s)} suggestion={s} step={step} busy={busy} onStudyFile={onStudyFile} onStudyTopic={onStudyTopic} />
				))}
			</ul>
		</section>
	);
});

const SuggestionRow = memo(function SuggestionRow({
	suggestion: s,
	step,
	busy,
	onStudyFile,
	onStudyTopic,
}: {
	suggestion: Suggestion;
	step: LessonStep | null;
	busy: boolean;
	onStudyFile: (file: FileCoverage) => void;
	onStudyTopic: (topic: TopicProgress) => void;
}) {
	let title: string;
	let action: ReactNode;
	if (s.kind === "continue") {
		title = s.lesson.title;
		action = (
			<Link href={lessonHref(s.lesson.chatId)} data-testid="home-continue" className={ACTION}>
				Open
			</Link>
		);
	} else if (s.kind === "next-up") {
		title = displayName(s.file.name);
		action = (
			<button type="button" data-testid="home-study-file" disabled={busy} onClick={() => onStudyFile(s.file)} className={ACTION}>
				Study
			</button>
		);
	} else {
		title = s.topic.name;
		action = (
			<button type="button" data-testid="home-study-topic" disabled={busy} onClick={() => onStudyTopic(s.topic)} className={ACTION}>
				Study
			</button>
		);
	}
	return (
		<li data-testid={`home-suggestion-${s.kind}`} className="flex w-full items-center gap-3.5 border-b border-dotted border-edge px-1 py-[13px] last:border-b-0">
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate text-[17px] leading-tight text-ink">
					<InlineMath text={title} />
				</span>
				<span className="truncate text-base text-ink-2">{suggestionLine(s, step)}</span>
			</span>
			{action}
		</li>
	);
});
