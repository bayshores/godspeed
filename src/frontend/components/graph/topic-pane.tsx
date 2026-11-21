/**
 * The picked topic, docked beside the picture: its name and Close, one
 * square per fact with the fact count and score under them, the
 * sure-miss note, the topics it needs first and leads to (each opens
 * that topic), its facts
 * (each opens the fact), and Study. A tall panel scrolls its middle, so
 * Study stays in view.
 */
import { useMemo } from "react";
import { topicFacts, type FactProgress, type TopicLink, type TopicProgress } from "@/shared/core";
import { Pane } from "@/frontend/components/ui/pane";
import { factCells, UNSTUDIED_CELL } from "@/frontend/components/fact-cells";
import { neighbors, sureMissNote, topicCountLine } from "./derive.ts";
import { FactList } from "./fact-list.tsx";
import { CloseButton, StudyButton } from "./pane-buttons.tsx";
import { LinkRows } from "./link-rows.tsx";
import { NoteRow } from "./note-row.tsx";
import { GROUP_LABEL, SIDE_TITLE } from "./styles.ts";

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
	const note = sureMissNote(topic);
	return (
		<Pane active data-testid="topic-pane" aria-label="Topic" className="flex min-h-0 flex-col gap-[9px] p-4">
			<div className="flex shrink-0 items-start gap-2">
				<h2 title={topic.name} className={`${SIDE_TITLE} flex-1`}>
					{topic.name}
				</h2>
				<CloseButton testid="topic-pane-close" onClick={onClose} />
			</div>
			<div className="-mx-4 flex min-h-0 shrink flex-col gap-[9px] overflow-y-auto px-4">
				<div className="flex flex-col gap-1.5">
					<span aria-hidden className="flex flex-wrap gap-[3px]">
						{cells.map((color, i) => (
							<span key={i} className={color === UNSTUDIED_CELL ? "size-[11px]" : "lh-block-in size-[11px]"} style={{ background: color }} />
						))}
					</span>
					<span data-testid="topic-score" className="text-base text-ink-2">
						{topicCountLine(list.length, topic)}
					</span>
				</div>
				{note && (
					<p data-testid="topic-note" className="text-[15px] leading-snug text-ink-2">
						{note}
					</p>
				)}
				<LinkRows label="Needs first" empty="Nothing, start here" rows={needs} onOpen={onSelectTopic} testid="needs-first" rowTestid="topic-link" />
				<LinkRows label="Leads to" empty="Nothing yet" rows={leadsTo} onOpen={onSelectTopic} testid="leads-to" rowTestid="topic-link" />
				{list.length > 0 && (
					<>
						<span className={GROUP_LABEL}>Facts</span>
						<FactList key={topic.id} facts={list} onOpen={onOpenFact} />
					</>
				)}
				<NoteRow topicId={topic.id} />
			</div>
			<StudyButton testid="study-topic" label="Study" busy={studying} error={studyError} onClick={() => onStudy([topic.id])} />
		</Pane>
	);
}
