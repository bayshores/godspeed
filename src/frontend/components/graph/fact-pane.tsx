/**
 * One fact, as the slip under the picture: its moon with the answer line
 * under it; its name and what it says; the facts it builds on and leads to
 * (each opens); its file or lesson and Study at the right. The topic it was
 * opened in stands on the top edge as a tab back to the topic, and Close
 * sits at the top right. A tall slip scrolls its middle, so the keys stay
 * in view. Stacked, for a narrow room, the moon sits beside the name and
 * the keys under the words.
 */
import { useMemo } from "react";
import type { FactProgress, GraphChain, TopicProgress } from "@/shared/core";
import { InlineMath } from "@/frontend/components/overview/inline-math";
import { answerLine, factLinks, sameWords } from "./derive.ts";
import { FactMoon } from "./fact-moon.tsx";
import { FactFileKey } from "./fact-file-key.tsx";
import { LinkChips } from "./link-chips.tsx";
import { CloseButton, StudyButton, TopicTab } from "./pane-buttons.tsx";

/** What the page knows about where facts came from (the graph snapshot's maps). */
export interface FactSources {
	chains: readonly Pick<GraphChain, "premises" | "conclusion">[];
	/** A notes source id → its file's path. */
	fileSources: Readonly<Record<string, string>>;
	/** A lesson id → its title. */
	sessions: Readonly<Record<string, string>>;
}

export function FactPane({
	fact,
	topic,
	facts,
	sources,
	stacked,
	onBack,
	onClose,
	onOpenFact,
	onStudy,
	studying,
	studyError,
}: {
	fact: FactProgress;
	/** The topic it was opened in, which the tab returns to; null opens it alone. */
	topic: TopicProgress | null;
	facts: readonly FactProgress[];
	/** null while the snapshot loads. */
	sources: FactSources | null;
	/** One column, for a narrow room. */
	stacked: boolean;
	onBack: () => void;
	/** Closes the fact and its topic. */
	onClose: () => void;
	onOpenFact: (id: string) => void;
	onStudy: (fact: FactProgress) => void;
	studying: boolean;
	studyError: string | null;
}) {
	const answers = (
		<p data-testid="fact-answers" className={`text-base leading-snug text-ink-2 ${stacked ? "" : "text-center"}`}>
			{answerLine(fact)}
		</p>
	);
	const name = (
		<h2 className="text-2xl leading-tight [overflow-wrap:anywhere] text-ink">
			<InlineMath text={fact.name} />
		</h2>
	);
	const words = (
		<>
			{!sameWords(fact.name, fact.statement) && (
				<p data-testid="fact-statement" className="max-w-[72ch] text-[17px] leading-relaxed text-ink">
					<InlineMath text={fact.statement} />
				</p>
			)}
			<FactLinks fact={fact} facts={facts} sources={sources} onOpen={onOpenFact} />
		</>
	);
	const keys = (
		<div className={`flex min-w-0 gap-3 ${stacked ? "items-end justify-between" : "flex-col items-end"}`}>
			<FactFileKey born={fact.born} file={fact.born ? sources?.fileSources[fact.born] : undefined} lesson={fact.born ? sources?.sessions[fact.born] : undefined} />
			<StudyButton testid="study-fact" busy={studying} error={studyError} onClick={() => onStudy(fact)} />
		</div>
	);
	return (
		<section data-testid="fact-pane" aria-label="Fact" className={`lh-sheet relative flex min-h-0 ${stacked ? "flex-col gap-4 p-6" : "items-stretch gap-9 py-6 pr-6 pl-7"}`}>
			{topic && <TopicTab topic={topic} onClick={onBack} />}
			{stacked ? (
				<>
					<div className="flex shrink-0 items-center gap-4 pr-12">
						<FactMoon fact={fact} size={72} />
						<div className="flex min-w-0 flex-col gap-1">
							{name}
							{answers}
						</div>
					</div>
					<div className="absolute top-5 right-5">
						<CloseButton testid="fact-pane-close" onClick={onClose} />
					</div>
					<div className="lh-scroll-fade -mb-4 flex min-h-0 flex-col gap-4 overflow-y-auto">{words}</div>
					{keys}
				</>
			) : (
				<>
					<div className="flex w-[180px] shrink-0 flex-col items-center gap-3 pt-1">
						<FactMoon fact={fact} size={90} />
						{answers}
					</div>
					<div className="lh-scroll-fade -mb-4 flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
						{name}
						{words}
					</div>
					<div className="flex shrink-0 flex-col items-end justify-between gap-4">
						<CloseButton testid="fact-pane-close" onClick={onClose} />
						{keys}
					</div>
				</>
			)}
		</section>
	);
}

function FactLinks({ fact, facts, sources, onOpen }: { fact: FactProgress; facts: readonly FactProgress[]; sources: FactSources | null; onOpen: (id: string) => void }) {
	const byId = useMemo(() => new Map(facts.map((f) => [f.id, f])), [facts]);
	const links = useMemo(() => (sources ? factLinks(fact.id, sources.chains) : null), [fact.id, sources]);
	if (!links) return null;
	const chips = (ids: readonly string[]) =>
		ids
			.map((id) => byId.get(id))
			.filter((f): f is FactProgress => !!f)
			.map((f) => ({ id: f.id, name: f.name, shown: <InlineMath text={f.name} />, mark: <FactMoon fact={f} size={18} /> }));
	const buildsOn = chips(links.buildsOn);
	const leadsTo = chips(links.leadsTo);
	if (buildsOn.length + leadsTo.length === 0) return null;
	return (
		<div className="mt-2 flex min-w-0 flex-wrap gap-x-7 gap-y-2">
			<LinkChips label="Builds on" chips={buildsOn} onOpen={onOpen} testid="builds-on" chipTestid="fact-link" />
			<LinkChips label="Leads to" chips={leadsTo} onOpen={onOpen} testid="fact-leads-to" chipTestid="fact-link" />
		</div>
	);
}
