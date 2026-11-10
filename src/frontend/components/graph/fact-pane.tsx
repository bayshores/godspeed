/**
 * One fact, opened from its topic: what it says, its answers, where it
 * came from (a class file opens on the desktop, a lesson opens in the
 * app), the facts it builds on and leads to (each opens), and Practice.
 */
import { useMemo } from "react";
import { Link } from "react-router";
import { dayLabel, factMark, localDay, type FactProgress, type GraphChain } from "@/shared/core";
import { Pane } from "@/frontend/components/ui/pane";
import { InlineMath } from "@/frontend/components/overview/inline-math";
import { factLinks, PANEL_ANSWER_COLOR } from "./derive.ts";
import { FactMark } from "./fact-list.tsx";
import { StudyButton } from "./side-panes.tsx";

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
	topicName,
	facts,
	sources,
	onBack,
	onOpenFact,
	onPractice,
	studying,
	studyError,
}: {
	fact: FactProgress;
	topicName: string;
	facts: readonly FactProgress[];
	/** null while the snapshot loads. */
	sources: FactSources | null;
	onBack: () => void;
	onOpenFact: (id: string) => void;
	onPractice: (fact: FactProgress) => void;
	studying: boolean;
	studyError: string | null;
}) {
	const byId = useMemo(() => new Map(facts.map((f) => [f.id, f])), [facts]);
	const links = useMemo(() => (sources ? factLinks(fact.id, sources.chains) : null), [fact.id, sources]);
	const right = fact.answers.filter((a) => a.outcome === "right").length;
	const last = fact.answers.at(-1)?.answeredAt;
	return (
		<Pane name="fact" active data-testid="fact-pane" aria-label="Fact" className="flex min-h-0 flex-1 flex-col">
			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-5 pb-4">
				<button type="button" data-testid="fact-pane-back" onClick={onBack} title={topicName} className="lh-btn max-w-full self-start">
					<span aria-hidden>←</span>
					<span className="truncate">{topicName}</span>
				</button>
				<p data-testid="fact-statement" className="lh-prose">
					<InlineMath text={fact.statement || fact.name} />
				</p>
				<div className="flex items-center gap-3 text-[13px] text-ink-3" data-testid="fact-answers">
					{fact.answers.length > 0 ? (
						<>
							<span aria-hidden className="flex gap-[3px]">
								{fact.answers.slice(-12).map((a) => (
									<span key={`${a.chatId}:${a.toolCallId}`} className="size-3" style={{ background: PANEL_ANSWER_COLOR[a.outcome] }} />
								))}
							</span>
							<span>
								{right} of {fact.answers.length} right{last ? `, last ${dayLabel(localDay(new Date(last)))}` : ""}
							</span>
						</>
					) : (
						<span>Not asked yet.</span>
					)}
				</div>
				<Source born={fact.born} sources={sources} />
				{links && (
					<>
						<FactLinks label="Builds on" ids={links.buildsOn} byId={byId} onOpen={onOpenFact} testid="builds-on" />
						<FactLinks label="Leads to" ids={links.leadsTo} byId={byId} onOpen={onOpenFact} testid="fact-leads-to" />
					</>
				)}
			</div>
			<div className="shrink-0 px-5 pb-5">
				<StudyButton testid="practice-fact" label="practice this fact" busy={studying} error={studyError} onClick={() => onPractice(fact)} />
			</div>
		</Pane>
	);
}

/** Where the fact came from: a class file (open it on the desktop) or a lesson. */
function Source({ born, sources }: { born: string | null; sources: FactSources | null }) {
	if (!born || !sources) return null;
	const file = sources.fileSources[born];
	const lesson = sources.sessions[born];
	if (!file && !lesson) return null;
	const name = file ? file.split(/[\\/]/).pop()! : lesson!;
	const desktop = typeof window !== "undefined" ? window.lh : undefined;
	const pdf = !!file && /\.pdf$/i.test(file);
	return (
		<div data-testid="fact-source" className="flex items-center justify-between gap-3 text-[13px]">
			<span className="min-w-0 truncate text-ink-2" title={name}>
				from {file ? name : `the lesson ${name}`}
			</span>
			{file ? (
				desktop &&
				(pdf ? desktop.openPath : desktop.showInFolder) && (
					<button type="button" data-testid="fact-source-open" onClick={() => void (pdf ? desktop.openPath : desktop.showInFolder)?.(file)} className="lh-btn shrink-0">
						{pdf ? "open" : "show in finder"}
					</button>
				)
			) : (
				<Link to={`/chat/${born}`} data-testid="fact-source-open" className="lh-btn shrink-0">
					open
				</Link>
			)}
		</div>
	);
}

function FactLinks({
	label,
	ids,
	byId,
	onOpen,
	testid,
}: {
	label: string;
	ids: readonly string[];
	byId: ReadonlyMap<string, FactProgress>;
	onOpen: (id: string) => void;
	testid: string;
}) {
	const shown = ids.map((id) => byId.get(id)).filter((f): f is FactProgress => !!f);
	if (shown.length === 0) return null;
	return (
		<div className="flex flex-col gap-1" data-testid={testid}>
			<span className="text-[13px] text-ink-3">{label}</span>
			<ul className="flex flex-col">
				{shown.map((f) => (
					<li key={f.id}>
						<button type="button" data-testid="fact-link" onClick={() => onOpen(f.id)} className="lh-press flex w-full items-center gap-2.5 py-1.5 text-left text-sm text-ink hover:text-ink-max">
							<FactMark mark={factMark(f)} />
							<span className="min-w-0 flex-1 truncate">
								<InlineMath text={f.name} />
							</span>
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}
