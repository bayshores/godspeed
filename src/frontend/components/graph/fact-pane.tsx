/**
 * One fact, opened from its topic: back to the topic (none before the
 * space has topics) and Close, what it
 * says, its answers, where it came from (a space file opens on the
 * desktop, a lesson opens in the app), the facts it builds on and leads
 * to (each opens), and Study. A tall panel scrolls its middle, so Study
 * stays in view.
 */
import { useMemo } from "react";
import { Link } from "react-router";
import { dayLabel, localDay, rightWords, tally, type FactProgress, type GraphChain } from "@/shared/core";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { InlineMath } from "@/frontend/components/overview/inline-math";
import { factLinks, PANEL_ANSWER_COLOR } from "./derive.ts";
import { CloseButton, StudyButton } from "./pane-buttons.tsx";
import { factCells } from "@/frontend/components/fact-cells";
import { LinkRows } from "./link-rows.tsx";
import { CHIP } from "./styles.ts";
import { useFactFile } from "./use-fact-file.ts";
import { fileBrowserName } from "@/frontend/components/files/files-model";

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
	onClose,
	onOpenFact,
	onStudy,
	studying,
	studyError,
}: {
	fact: FactProgress;
	/** The topic it was opened in, which the back key returns to; null opens it alone. */
	topicName: string | null;
	facts: readonly FactProgress[];
	/** null while the snapshot loads. */
	sources: FactSources | null;
	onBack: () => void;
	/** Closes the fact and its topic. */
	onClose: () => void;
	onOpenFact: (id: string) => void;
	onStudy: (fact: FactProgress) => void;
	studying: boolean;
	studyError: string | null;
}) {
	const byId = useMemo(() => new Map(facts.map((f) => [f.id, f])), [facts]);
	const links = useMemo(() => (sources ? factLinks(fact.id, sources.chains) : null), [fact.id, sources]);
	const last = fact.answers.at(-1)?.answeredAt;
	return (
		<Pane active data-testid="fact-pane" aria-label="Fact" className="flex min-h-0 flex-col gap-3.5 p-5">
			<div className="flex shrink-0 items-center gap-2">
				{topicName !== null && (
					<button type="button" data-testid="fact-pane-back" onClick={onBack} title={topicName} className={`${CHIP} min-w-0`}>
						<PixelIcon name="chevron" className="-scale-x-100" />
						<span className="truncate">{topicName}</span>
					</button>
				)}
				<span className="flex-1" />
				<CloseButton testid="fact-pane-close" onClick={onClose} />
			</div>
			<div className="-mx-5 flex min-h-0 shrink flex-col gap-3.5 overflow-y-auto px-5">
				<p data-testid="fact-statement" className="text-[17px] leading-snug text-ink">
					<InlineMath text={fact.statement || fact.name} />
				</p>
				<div className="flex items-center gap-2.5 text-base text-ink-2" data-testid="fact-answers">
					{fact.answers.length > 0 ? (
						<>
							<span aria-hidden className="flex flex-wrap gap-[3px]">
								{fact.answers.slice(-12).map((a) => (
									<span key={`${a.chatId}:${a.toolCallId}`} className="size-[11px]" style={{ background: PANEL_ANSWER_COLOR[a.outcome] }} />
								))}
							</span>
							<span>
								{rightWords(tally(fact.answers))}
								{last ? `, last ${dayLabel(localDay(new Date(last)))}` : ""}
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
			<StudyButton testid="study-fact" label="Study" busy={studying} error={studyError} onClick={() => onStudy(fact)} />
		</Pane>
	);
}

/** Where the fact came from: a space file (open it or show it on the desktop) or a lesson. */
function Source({ born, sources }: { born: string | null; sources: FactSources | null }) {
	const onDisk = useFactFile(born);
	if (!born || !sources) return null;
	const file = sources.fileSources[born];
	const lesson = sources.sessions[born];
	if (!file && !lesson) return null;
	const name = file ? file.split(/[\\/]/).pop()! : lesson!;
	return (
		<div data-testid="fact-source" className="flex flex-col gap-1.5 pt-3.5">
			<span className="truncate text-base text-ink-2" title={name}>
				From {file ? name : `the lesson ${name}`}
			</span>
			<span className="flex flex-wrap gap-2 empty:hidden">
				{file ? (
					onDisk && (
						<>
							{onDisk.opens && (
								<button type="button" data-testid="fact-source-open" onClick={() => onDisk.show("open")} className={CHIP}>
									Open
								</button>
							)}
							<button type="button" data-testid="fact-source-show" onClick={() => onDisk.show("folder")} className={CHIP}>
								Show in {fileBrowserName(window.lh?.platform)}
							</button>
						</>
					)
				) : (
					<Link to={`/chat/${born}`} data-testid="fact-source-open" className={CHIP}>
						Open
					</Link>
				)}
			</span>
			{onDisk?.error && (
				<p role="alert" data-testid="fact-source-error" className="text-sm text-ans-wrong">
					{onDisk.error}
				</p>
			)}
		</div>
	);
}
function FactLinks({ label, ids, byId, onOpen, testid }: { label: string; ids: readonly string[]; byId: ReadonlyMap<string, FactProgress>; onOpen: (id: string) => void; testid: string }) {
	const rows = ids
		.map((id) => byId.get(id))
		.filter((f): f is FactProgress => !!f)
		.map((f) => ({ id: f.id, name: f.name, shown: <InlineMath text={f.name} />, color: factCells([f])[0]! }));
	return <LinkRows label={label} rows={rows} onOpen={onOpen} testid={testid} rowTestid="fact-link" />;
}
