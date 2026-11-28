/**
 * The Graph tab's foot line, pinned under the picture like a map's legend:
 * the space's counts ("N facts" opens All facts). Zoomed in, the counts are
 * what is in view (the topic's name and how many of its facts are lit when it
 * is the only one) and Whole space flies back out. While something is typed
 * in the top bar's Find, the line says what matches. Before any topic it
 * counts only facts. Find, Costs and, with no space, Add files are words in
 * the top bar.
 */
import type { InView } from "./use-in-view.ts";

/** The foot line's height, kept free under the picture. */
export const FOOT = 60;

/** "1 topic", "16 topics": the number in the count face, the word quiet. */
function Count({ n, word }: { n: number; word: string }) {
	return (
		<span className="inline-flex items-baseline gap-2 whitespace-nowrap">
			<span className="font-count text-lg leading-none text-ink">{n}</span>
			<span className="text-ui text-ink-2">{n === 1 ? word : `${word}s`}</span>
		</span>
	);
}

export function GraphFoot({
	hasFacts,
	topicCount,
	factCount,
	matches,
	onOpenChains,
	inView,
	onWholeSpace,
}: {
	hasFacts: boolean;
	/** Topics other than Ungrouped; 0 before any topic, when only facts are counted. */
	topicCount: number;
	factCount: number;
	/** Find's lit topics and facts; null with nothing typed. */
	matches: { topics: ReadonlySet<string>; facts: ReadonlySet<string> } | null;
	onOpenChains: () => void;
	/** What is in view while the picture is zoomed in; null at the whole space. */
	inView: InView | null;
	onWholeSpace: () => void;
}) {
	const wholeSpace = (
		<button
			type="button"
			data-testid="graph-whole-space"
			onClick={onWholeSpace}
			className="lh-fade border-b-2 border-transparent pb-1 text-ui text-ink-2 transition-colors hover:border-foreground hover:text-ink"
		>
			Whole space
		</button>
	);
	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-0" style={{ height: FOOT }}>
			<div data-testid="graph-foot" className="lh-page pointer-events-auto flex h-11 items-center gap-6 pt-1">
				{matches ? (
					// Mounted while a query is typed, so a screen reader hears each change.
					<span role="status" data-testid="graph-find-status" className="shrink-0 border-b-2 border-transparent pb-1">
						{matches.topics.size === 0 ? (
							<span data-testid="graph-no-match" className="text-ui text-ink-2">
								Nothing matches
							</span>
						) : (
							<span className="flex items-baseline gap-5">
								{topicCount > 0 && <Count n={matches.topics.size} word="topic" />}
								<Count n={matches.facts.size} word="fact" />
							</span>
						)}
					</span>
				) : hasFacts && inView && topicCount > 0 ? (
					<>
						{/* Plain words: the in-view counts open nothing, so All facts stays one click away at the whole space. */}
						<span data-testid="graph-in-view" className="flex items-baseline gap-6 border-b-2 border-transparent pb-1">
							{inView.name ? <span className="whitespace-nowrap text-ui text-ink">{inView.name}</span> : <Count n={inView.topics} word="topic" />}
							{/* One topic in view reads how much of it is lit. */}
							{inView.name ? (
								<span className="inline-flex items-baseline gap-2 whitespace-nowrap">
									<span className="font-count text-lg leading-none text-ink">{inView.lit}</span>
									<span className="text-ui text-ink-2">of</span>
									<span className="font-count text-lg leading-none text-ink">{inView.facts}</span>
									<span className="text-ui text-ink-2">lit</span>
								</span>
							) : (
								<Count n={inView.facts} word="fact" />
							)}
						</span>
						{wholeSpace}
					</>
				) : (
					hasFacts && (
						<>
							{/* The same unseen underline as the button beside it, so both sit on one line. */}
							{topicCount > 0 && (
								<span className="border-b-2 border-transparent pb-1">
									<Count n={topicCount} word="topic" />
								</span>
							)}
							<button
								type="button"
								data-testid="open-chain-table"
								aria-label={`All ${factCount} ${factCount === 1 ? "fact" : "facts"}`}
								onClick={onOpenChains}
								className="border-b-2 border-transparent pb-1 transition-colors hover:border-foreground"
							>
								<Count n={factCount} word="fact" />
							</button>
							{/* Zoomed in before any topic: nothing to count in view, so the space's facts stay. */}
							{inView && wholeSpace}
						</>
					)
				)}
			</div>
		</div>
	);
}
