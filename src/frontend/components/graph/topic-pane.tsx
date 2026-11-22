/**
 * The picked topic, as the slip under the picture: its name, the fact count
 * and score, each fact as its moon (each opens the fact), the sure-miss
 * note, the topics it needs first and leads to (each opens that topic),
 * then its note in Obsidian and Study at the right, under Close. At rest
 * the links fold so the slip shows whole; opened, its middle scrolls and
 * the keys stay in view. Its moons step in left to right; one that replaced
 * another panel steps its blocks in top to bottom.
 */
import { useMemo } from "react";
import { topicFacts, type FactProgress, type TopicLink, type TopicProgress } from "@/shared/core";
import { neighbors, shareLinks, sureMissNote, topicColor, topicCountLine } from "./derive.ts";
import { LinkChips } from "./link-chips.tsx";
import { NoteKey } from "./note-key.tsx";
import { CloseButton, StudyButton } from "./pane-buttons.tsx";
import { blockDelay, chipSteps, rowStart } from "./slip-motion-model.ts";
import { TopicMoons } from "./topic-moons.tsx";
import { useLinkFit, type PanelRoom } from "./use-link-fit.ts";
import { stepIn } from "./use-step-in.ts";

export function TopicPane({
	topic,
	topics,
	links,
	facts,
	room,
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
	room: PanelRoom;
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
	const note = sureMissNote(topic);
	const { stacked, motion } = room;
	const block = (n: number) => stepIn(blockDelay(motion, n));
	const [nameStep, scoreStep, laterStep] = [block(0), block(1), block(3)];
	const fit = useLinkFit(needs.length + leadsTo.length, room);
	const [needsShown = 0, leadsShown = 0] = shareLinks([needs.length, leadsTo.length], fit.shown);
	const chips = (ts: readonly TopicProgress[]) => ts.map((t) => ({ id: t.id, name: t.name, mark: <span aria-hidden className="mx-1 size-[10px] shrink-0" style={{ background: topicColor(t) }} /> }));
	const keys = (
		<div className={`flex min-w-0 gap-3 ${stacked ? "items-end justify-between" : "flex-col items-end"} ${laterStep.className}`} style={laterStep.style}>
			<NoteKey topicId={topic.id} />
			<StudyButton testid="study-topic" busy={studying} error={studyError} onClick={() => onStudy([topic.id])} />
		</div>
	);
	return (
		<section ref={fit.box} data-testid="topic-pane" aria-label="Topic" className={`relative flex min-h-0 ${stacked ? "flex-col gap-4 p-6" : "items-stretch gap-9 py-6 pr-6 pl-7"}`}>
			<div ref={fit.middle} className="lh-scroll-fade -mb-4 flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
				<h2 className={`${stacked ? "pr-12 " : ""}text-2xl leading-tight [overflow-wrap:anywhere] text-ink ${nameStep.className}`} style={nameStep.style}>
					{topic.name}
				</h2>
				<p data-testid="topic-score" className={`-mt-1 text-base text-ink-2 ${scoreStep.className}`} style={scoreStep.style}>
					{topicCountLine(list.length, topic)}
				</p>
				{list.length > 0 && <TopicMoons key={topic.id} facts={list} onOpen={onOpenFact} size={36} stepFrom={rowStart(motion, 2)} />}
				{note && (
					<p data-testid="topic-note" className={`text-[15px] leading-snug text-ink-2 ${laterStep.className}`} style={laterStep.style}>
						{note}
					</p>
				)}
				<div className="mt-1 flex min-w-0 flex-wrap gap-x-7 gap-y-2">
					<LinkChips label="Needs first" chips={chips(needs)} shown={needsShown} stepFrom={rowStart(motion, 4)} stepsBefore={0} onOpen={onSelectTopic} onMore={fit.openAll} testid="needs-first" chipTestid="topic-link" />
					<LinkChips label="Leads to" chips={chips(leadsTo)} shown={leadsShown} stepFrom={rowStart(motion, 4)} stepsBefore={chipSteps(needs.length, needsShown)} onOpen={onSelectTopic} onMore={fit.openAll} testid="leads-to" chipTestid="topic-link" />
				</div>
			</div>
			{stacked ? (
				<>
					<div className="absolute top-5 right-5">
						<CloseButton testid="topic-pane-close" onClick={onClose} />
					</div>
					{keys}
				</>
			) : (
				<div className="flex shrink-0 flex-col items-end justify-between gap-4">
					<CloseButton testid="topic-pane-close" onClick={onClose} />
					{keys}
				</div>
			)}
		</section>
	);
}
