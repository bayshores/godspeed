/**
 * The right panel with a topic selected: its name (CMU), its answers as
 * blocks with a one-line takeaway, "Needs first" / "Leads to" chips (each
 * opens that topic), its facts, and "Study this topic".
 */
import { memo, useMemo } from "react";
import { XIcon } from "lucide-react";
import { topicFacts, type FactProgress, type TopicLink, type TopicProgress } from "@/core";
import { Hint } from "@/components/ui/hint";
import { neighbors, PANEL_ANSWER_COLOR, takeaway } from "./derive.ts";
import { FactList } from "./fact-list.tsx";
import { StudyBar, SIDE_PANEL, StatusMark } from "./where-panel.tsx";
import { LABEL_TEXT } from "@/components/ui/label-text";
import { cn } from "@/lib/utils";

/** At most this many answer blocks (the newest). */
const MAX_BLOCKS = 40;

export function TopicPanel({
	topic,
	topics,
	links,
	facts,
	onClose,
	onSelectTopic,
	onStudy,
	studying,
	studyError,
}: {
	topic: TopicProgress;
	topics: readonly TopicProgress[];
	links: readonly TopicLink[];
	facts: readonly FactProgress[];
	onClose: () => void;
	onSelectTopic: (id: string) => void;
	onStudy: (topicIds: string[]) => void;
	studying: boolean;
	/** Why the last Study start failed (shown under the button). */
	studyError: string | null;
}) {
	const byId = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);
	const { needs, leadsTo } = useMemo(() => neighbors(topic.id, [...links], byId), [topic.id, links, byId]);
	const list = useMemo(() => topicFacts(facts, topic), [facts, topic]);
	const blocks = topic.answers.slice(-MAX_BLOCKS);
	return (
		<aside data-testid="topic-panel" className={SIDE_PANEL}>
			<div className="min-h-0 flex-1 overflow-y-auto px-6 py-[22px]">
				<Hint label="Close" side="bottom">
					<button
						type="button"
						data-testid="topic-panel-close"
						aria-label="Close"
						onClick={onClose}
						className="lh-press -m-1 p-1 text-ink-2 hover:text-ink"
					>
						<XIcon className="size-4" />
					</button>
				</Hint>
				<h2 className="mt-2 font-title text-[30px] leading-9 text-ink" data-testid="topic-panel-name">
					{topic.name}
				</h2>
				<div className="mt-3.5 flex w-full flex-col gap-2 bg-tone px-3.5 py-3" data-testid="topic-results">
					{blocks.length > 0 && (
						<div className="flex w-full gap-[3px]" aria-hidden>
							{blocks.map((a) => (
								<span key={`${a.chatId}:${a.toolCallId}`} className="h-2.5 flex-1" style={{ background: PANEL_ANSWER_COLOR[a.outcome] }} />
							))}
						</div>
					)}
					<p className="text-[13.5px] leading-5 text-ink-2">{takeaway(topic)}</p>
				</div>
				{(needs.length > 0 || leadsTo.length > 0) && (
					<div className="mt-4 flex w-full gap-2.5">
						<ChipColumn label="Needs first" empty="Nothing, start here" topics={needs} onSelect={onSelectTopic} testid="needs-first" />
						<ChipColumn label="Leads to" empty="Nothing yet" topics={leadsTo} onSelect={onSelectTopic} testid="leads-to" />
					</div>
				)}
				<h3 className={cn("mt-4", LABEL_TEXT)}>Facts in this topic · {list.length}</h3>
				<div className="h-1.5" />
				<FactList key={topic.id} facts={list} />
			</div>
			<StudyBar testid="study-topic" label="Study this topic" busy={studying} error={studyError} onClick={() => onStudy([topic.id])} />
		</aside>
	);
}

const ChipColumn = memo(function ChipColumn({
	label,
	empty,
	topics,
	onSelect,
	testid,
}: {
	label: string;
	/** Said when the column has no topics. */
	empty: string;
	topics: readonly TopicProgress[];
	onSelect: (id: string) => void;
	testid: string;
}) {
	return (
		<div className="flex min-w-0 flex-1 flex-col gap-1" data-testid={testid}>
			<span className={LABEL_TEXT}>{label}</span>
			{topics.length === 0 && <span className="text-[13px] text-ink-2">{empty}</span>}
			{topics.map((t) => (
				<button
					key={t.id}
					type="button"
					data-testid="topic-chip"
					onClick={() => onSelect(t.id)}
					className="lh-press flex w-full items-center gap-[7px] bg-tone px-[9px] py-[7px] text-left text-[13px] text-ink hover:bg-tone-2"
				>
					<StatusMark status={t.status} size="size-[9px]" round />
					<span title={t.name} className="truncate">{t.name}</span>
				</button>
			))}
		</div>
	);
});
