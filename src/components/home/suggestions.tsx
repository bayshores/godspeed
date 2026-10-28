import { memo, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import type { FileCoverage, TopicProgress } from "@/core";
import { InlineMath } from "@/components/overview/inline-math";
import { displayName, lessonHref } from "@/components/overview/overview-model";
import { STATUS_COLOR } from "@/components/graph/derive";
import { suggestionKey, type LessonStep, type Suggestion } from "./suggestions-model";

const ACTION =
	"lh-press flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-[13.5px] font-bold text-ink outline outline-1 -outline-offset-1 outline-tone-2 hover:bg-tone-2 disabled:opacity-60";

const KIND_LABEL: Record<Suggestion["kind"], string> = {
	continue: "Continue",
	"next-up": "Next up",
	"work-on-next": "Work on next",
};

/** Numbers line up in mono; words stay in the UI font. */
function Num({ children }: { children: ReactNode }) {
	return <span className="font-mono tabular-nums">{children}</span>;
}

/**
 * "Suggested for <class>": Continue (the latest lesson, Open), Next up
 * (the earliest unstudied file, Learn this) and Work on next (topics,
 * Practice). Renders nothing when there is nothing to suggest.
 */
export const SuggestionList = memo(function SuggestionList({
	classLabel: label,
	suggestions,
	step,
	busy,
	onLearn,
	onPractice,
}: {
	/** The class's name; null = no class. */
	classLabel: string | null;
	suggestions: readonly Suggestion[];
	/** The Continue lesson's plan position, once read. */
	step: LessonStep | null;
	busy: boolean;
	onLearn: (file: FileCoverage) => void;
	onPractice: (topic: TopicProgress) => void;
}) {
	if (suggestions.length === 0) return null;
	return (
		<section data-testid="home-suggestions" className="lh-rise flex w-full flex-col gap-2.5">
			<h2 className="text-[13px] font-bold text-ink-3">{label ? `Suggested for ${label}` : "Suggested"}</h2>
			<ul className="flex w-full flex-col gap-0.5">
				{suggestions.map((s) => (
					<SuggestionRow key={suggestionKey(s)} suggestion={s} step={step} busy={busy} onLearn={onLearn} onPractice={onPractice} />
				))}
			</ul>
		</section>
	);
});

const SuggestionRow = memo(function SuggestionRow({
	suggestion: s,
	step,
	busy,
	onLearn,
	onPractice,
}: {
	suggestion: Suggestion;
	step: LessonStep | null;
	busy: boolean;
	onLearn: (file: FileCoverage) => void;
	onPractice: (topic: TopicProgress) => void;
}) {
	/** null = no dot; otherwise a class and/or a color. */
	let dot: { className?: string; color?: string } | null;
	let title: string;
	let meta: ReactNode = null;
	let action: ReactNode;
	if (s.kind === "continue") {
		dot = { className: "bg-white" };
		title = s.lesson.title;
		if (step) {
			meta = (
				<>
					step{" "}
					<Num>
						{step.position} / {step.total}
					</Num>
				</>
			);
		}
		action = (
			<Link href={lessonHref(s.lesson.chatId)} data-testid="home-continue" className={ACTION}>
				Open
				<ArrowRightIcon aria-hidden className="size-[13px]" />
			</Link>
		);
	} else if (s.kind === "next-up") {
		dot = null;
		title = displayName(s.file.name);
		meta = (
			<>
				<Num>{s.file.facts}</Num> {s.file.facts === 1 ? "fact" : "facts"}
			</>
		);
		action = (
			<button type="button" data-testid="home-learn-this" disabled={busy} onClick={() => onLearn(s.file)} className={ACTION}>
				Learn this
				<ArrowRightIcon aria-hidden className="size-[13px]" />
			</button>
		);
	} else {
		const color = STATUS_COLOR[s.topic.status];
		dot = color ? { color } : { className: "bg-ans-dontknow" };
		title = s.topic.name;
		meta =
			s.topic.answered > 0 ? (
				<Num>
					{s.topic.right} / {s.topic.answered}
				</Num>
			) : (
				"untested"
			);
		action = (
			<button
				type="button"
				data-testid="home-practice-topic"
				disabled={busy}
				onClick={() => onPractice(s.topic)}
				className={ACTION}
			>
				Practice
				<ArrowRightIcon aria-hidden className="size-[13px]" />
			</button>
		);
	}
	return <Row kind={s.kind} dot={dot} title={title} meta={meta} action={action} />;
});

function Row({
	kind,
	dot,
	title,
	meta,
	action,
}: {
	kind: Suggestion["kind"];
	/** null = no dot (an empty slot keeps the text aligned). */
	dot: { className?: string; color?: string } | null;
	title: string;
	meta: ReactNode;
	action: ReactNode;
}) {
	return (
		<li data-testid={`home-suggestion-${kind}`} className="flex w-full items-center gap-3 bg-tone px-3.5 py-3">
			<span
				aria-hidden
				className={dot ? `size-2 shrink-0 rounded-full ${dot.className ?? ""}` : "size-2 shrink-0"}
				style={dot?.color ? { background: dot.color } : undefined}
			/>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="text-[12.5px] font-bold text-ink-3">{KIND_LABEL[kind]}</span>
				<span className="truncate text-[15px] font-bold text-ink">
					<InlineMath text={title} />
				</span>
			</span>
			{meta && <span className="shrink-0 whitespace-nowrap text-[12.5px] text-ink-3">{meta}</span>}
			{action}
		</li>
	);
}
