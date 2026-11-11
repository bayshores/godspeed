/**
 * The picked topic, under the deadline pane: its fact count and score,
 * one square per fact, a one-line takeaway, the topics it needs first and
 * leads to (each opens that topic), its facts (each opens the fact), and
 * Study.
 */
import { useMemo } from "react";
import { topicFacts, type FactProgress, type TopicLink, type TopicProgress } from "@/shared/core";
import { Pane } from "@/frontend/components/ui/pane";
import { factCells, UNSTUDIED_CELL } from "@/frontend/components/fact-cells";
import { neighbors, STATUS_COLOR, statusLine, takeaway } from "./derive.ts";
import { FactList } from "./fact-list.tsx";
import { StudyButton } from "./side-panes.tsx";

export function TopicPane({
	topic,
	topics,
	links,
	facts,
	onClose,
	onSelectTopic,
	onOpenFact,
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
	onOpenFact: (id: string) => void;
	onStudy: (topicIds: string[]) => void;
	studying: boolean;
	studyError: string | null;
}) {
	const byId = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);
	const { needs, leadsTo } = useMemo(() => neighbors(topic.id, links, byId), [topic.id, links, byId]);
	const list = useMemo(() => topicFacts(facts, topic), [facts, topic]);
	const cells = useMemo(() => factCells(list), [list]);
	return (
		<Pane name={topic.name} active data-testid="topic-pane" aria-label="Topic" className="flex min-h-0 flex-1 flex-col">
			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-5 pb-4">
				<div className="flex items-center justify-between gap-3 text-[13px]">
					<span className="text-ink-3">
						{list.length} {list.length === 1 ? "fact" : "facts"}
					</span>
					<span className="flex items-center gap-3">
						<span data-testid="topic-score" style={{ color: STATUS_COLOR[topic.status] ?? "var(--color-ink-2)" }}>
							{statusLine(topic).toLowerCase()}
						</span>
						<button type="button" data-testid="topic-pane-close" aria-label="Close" onClick={onClose} className="lh-btn">
							close
						</button>
					</span>
				</div>
				<span aria-hidden className="flex flex-wrap gap-[3px]">
					{cells.map((color, i) => (
						<span key={i} className={color === UNSTUDIED_CELL ? "size-3" : "lh-block-in size-3"} style={{ background: color }} />
					))}
				</span>
				<p data-testid="topic-takeaway" className="text-[13.5px] leading-5 text-ink-2">
					{takeaway(topic)}
				</p>
				<Related label="Needs first" empty="Nothing, start here" topics={needs} onSelect={onSelectTopic} testid="needs-first" />
				<Related label="Leads to" empty="Nothing yet" topics={leadsTo} onSelect={onSelectTopic} testid="leads-to" />
				<FactList key={topic.id} facts={list} onOpen={onOpenFact} />
			</div>
			<div className="shrink-0 px-5 pb-5">
				<StudyButton testid="study-topic" label={`study ${topic.name}`} busy={studying} error={studyError} onClick={() => onStudy([topic.id])} />
			</div>
		</Pane>
	);
}

function Related({ label, empty, topics, onSelect, testid }: { label: string; empty: string; topics: readonly TopicProgress[]; onSelect: (id: string) => void; testid: string }) {
	return (
		<div className="flex flex-col gap-1.5" data-testid={testid}>
			<span className="text-[13px] text-ink-3">{label}</span>
			{topics.length === 0 ? (
				<span className="text-[13px] text-ink-2">{empty}</span>
			) : (
				<span className="flex flex-wrap gap-2">
					{topics.map((t) => (
						<button key={t.id} type="button" data-testid="topic-chip" onClick={() => onSelect(t.id)} title={t.name} className="lh-btn max-w-full">
							<span className="truncate">{t.name}</span>
						</button>
					))}
				</span>
			)}
		</div>
	);
}
