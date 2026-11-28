/**
 * One fact, as the slip under the picture: its moon with the answer line
 * under it; its name and what it says; the facts it builds on and leads to
 * (each opens); its file or lesson and Study at the right. The topic it was
 * opened in stands on the top edge as a tab back to the topic, and Close
 * sits at the top right. At rest the links fold so the slip shows whole;
 * opened, its middle scrolls and the keys stay in view. Stacked, for a
 * narrow room, the moon sits beside the name and the keys under the words.
 * Each time a fact opens its moon prints row by row; one that replaced
 * another panel steps its blocks in top to bottom.
 */
import { useMemo } from "react";
import type { FactProgress, GraphChain, TopicProgress } from "@/shared/core";
import { InlineMath } from "@/frontend/components/overview/inline-math";
import { answerLine, factLinks, sameWords, shareLinks } from "./derive.ts";
import { FactMoon } from "./fact-moon.tsx";
import { FactFileKey } from "./fact-file-key.tsx";
import { LinkChips } from "./link-chips.tsx";
import { CloseButton, StudyButton, TopicTab } from "./pane-buttons.tsx";
import { blockDelay, chipSteps, rowStart } from "./slip-motion-model.ts";
import { useLinkFit, type PanelRoom } from "./use-link-fit.ts";
import { stepIn } from "./use-step-in.ts";

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
	room,
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
	room: PanelRoom;
	onBack: () => void;
	/** Closes the fact and its topic. */
	onClose: () => void;
	onOpenFact: (id: string) => void;
	onStudy: (fact: FactProgress) => void;
	studying: boolean;
	studyError: string | null;
}) {
	const { stacked, motion } = room;
	const block = (n: number) => stepIn(blockDelay(motion, n));
	const [nameStep, wordsStep, keysStep] = [block(0), block(1), block(3)];
	const moon = <FactMoon fact={fact} size={stacked ? 72 : 90} className={motion === "still" ? "" : "lh-print"} />;
	const links = useLinkChips(fact.id, facts, sources);
	const fit = useLinkFit(links.buildsOn.length + links.leadsTo.length, room);
	const [buildsOn = 0, leadsTo = 0] = shareLinks([links.buildsOn.length, links.leadsTo.length], fit.shown);
	const answers = (
		<p data-testid="fact-answers" className={`text-ui leading-snug text-ink-2 ${stacked ? "" : "text-center"} ${wordsStep.className}`} style={wordsStep.style}>
			{answerLine(fact)}
		</p>
	);
	const name = (
		<h2 className={`text-2xl leading-tight [overflow-wrap:anywhere] text-ink ${nameStep.className}`} style={nameStep.style}>
			<InlineMath text={fact.name} />
		</h2>
	);
	const words = (
		<>
			{!sameWords(fact.name, fact.statement) && (
				<p data-testid="fact-statement" className={`max-w-[72ch] text-item leading-relaxed text-ink ${wordsStep.className}`} style={wordsStep.style}>
					<InlineMath text={fact.statement} />
				</p>
			)}
			{links.buildsOn.length + links.leadsTo.length > 0 && (
				<div className="mt-2 flex min-w-0 flex-wrap gap-x-7 gap-y-2">
					<LinkChips label="Builds on" chips={links.buildsOn} shown={buildsOn} stepFrom={rowStart(motion, 2)} stepsBefore={0} onOpen={onOpenFact} onMore={fit.openAll} testid="builds-on" chipTestid="fact-link" />
					<LinkChips label="Leads to" chips={links.leadsTo} shown={leadsTo} stepFrom={rowStart(motion, 2)} stepsBefore={chipSteps(links.buildsOn.length, buildsOn)} onOpen={onOpenFact} onMore={fit.openAll} testid="fact-leads-to" chipTestid="fact-link" />
				</div>
			)}
		</>
	);
	const keys = (
		<div className={`flex min-w-0 gap-3 ${stacked ? "items-end justify-between" : "flex-col items-end"} ${keysStep.className}`} style={keysStep.style}>
			<FactFileKey born={fact.born} file={fact.born ? sources?.fileSources[fact.born] : undefined} lesson={fact.born ? sources?.sessions[fact.born] : undefined} />
			<StudyButton testid="study-fact" busy={studying} error={studyError} onClick={() => onStudy(fact)} />
		</div>
	);
	// The tab sits outside the section, on the slip's edge, so the slip's clip while it glides never cuts it.
	return (
		<>
			{topic && <TopicTab topic={topic} onClick={onBack} />}
			<section ref={fit.box} data-testid="fact-pane" aria-label="Fact" className={`relative flex min-h-0 ${stacked ? "flex-col gap-4 p-6" : "items-stretch gap-9 py-6 pr-6 pl-7"}`}>
				{stacked ? (
					<>
						<div className="flex shrink-0 items-center gap-4 pr-12">
							{moon}
							<div className="flex min-w-0 flex-col gap-1">
								{name}
								{answers}
							</div>
						</div>
						<div className="absolute top-5 right-5">
							<CloseButton testid="fact-pane-close" onClick={onClose} />
						</div>
						<div ref={fit.middle} className="lh-scroll-fade -mb-4 flex min-h-0 flex-col gap-4 overflow-y-auto">
							{words}
						</div>
						{keys}
					</>
				) : (
					<>
						<div className="flex w-[180px] shrink-0 flex-col items-center gap-3 pt-1">
							{moon}
							{answers}
						</div>
						<div ref={fit.middle} className="lh-scroll-fade -mb-4 flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
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
		</>
	);
}

/** The chips for the facts a fact builds on and leads to; none while the snapshot loads. */
function useLinkChips(factId: string, facts: readonly FactProgress[], sources: FactSources | null) {
	return useMemo(() => {
		const byId = new Map(facts.map((f) => [f.id, f]));
		const links = sources ? factLinks(factId, sources.chains) : { buildsOn: [], leadsTo: [] };
		const chips = (ids: readonly string[]) =>
			ids
				.map((id) => byId.get(id))
				.filter((f): f is FactProgress => !!f)
				.map((f) => ({ id: f.id, name: f.name, shown: <InlineMath text={f.name} />, mark: <FactMoon fact={f} size={18} /> }));
		return { buildsOn: chips(links.buildsOn), leadsTo: chips(links.leadsTo) };
	}, [factId, facts, sources]);
}
