/**
 * The Graph tab's foot line, pinned under the picture like a map's legend:
 * the space's counts ("N facts" opens All facts), then Find and Costs, and
 * with no space, Add files to pick notes files right here (a space adds files
 * on its Files tab). Find, or the app's find shortcut, turns the line into a
 * bare typing line that says what matches; the x, Escape, or leaving it empty
 * brings the counts back.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { GraphCostSummary } from "@/shared/core";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { GraphCostControl } from "./cost-control.tsx";

/** The foot line's height, kept free under the picture. */
export const FOOT = 60;

const WORD = "lh-btn lh-btn-quiet shrink-0 text-[15px]";

/** "1 topic", "16 topics": the number in the count face, the word quiet. */
function Count({ n, word }: { n: number; word: string }) {
	return (
		<span className="inline-flex items-baseline gap-2 whitespace-nowrap">
			<span className="font-count text-lg leading-none text-ink">{n}</span>
			<span className="text-[15px] text-ink-2">{n === 1 ? word : `${word}s`}</span>
		</span>
	);
}

export function GraphFoot({
	hasFacts,
	topicCount,
	factCount,
	query,
	onQuery,
	matches,
	onOpenChains,
	costs,
	importNotes,
}: {
	hasFacts: boolean;
	/** Topics other than Ungrouped. */
	topicCount: number;
	factCount: number;
	query: string;
	onQuery: (q: string) => void;
	/** Find's lit topics and facts; null with nothing typed. */
	matches: { topics: ReadonlySet<string>; facts: ReadonlySet<string> } | null;
	onOpenChains: () => void;
	/** null until loaded. */
	costs: GraphCostSummary | null;
	/** No space's own file picker; null in a space. */
	importNotes: { importing: boolean; onImportFiles: (files: FileList | null) => void } | null;
}) {
	const [finding, setFinding] = useState(query !== "");
	const line = useRef<HTMLDivElement>(null);
	const findButton = useRef<HTMLButtonElement>(null);
	// Escape or the x removes the focused typing line; focus lands back on Find.
	const backToFind = useRef(false);
	useLayoutEffect(() => {
		if (finding || !backToFind.current) return;
		backToFind.current = false;
		findButton.current?.focus();
	}, [finding]);
	const find = () => setFinding(true);
	const stop = () => {
		onQuery("");
		backToFind.current = true;
		setFinding(false);
	};
	const findRef = useRef(find);
	findRef.current = hasFacts ? find : () => {};
	useEffect(() => {
		const onFind = () => findRef.current();
		window.addEventListener("lh:kbd-find", onFind);
		return () => window.removeEventListener("lh:kbd-find", onFind);
	}, []);

	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-0" style={{ height: FOOT }}>
			<div ref={line} data-testid="graph-foot" className="pointer-events-auto mx-auto flex h-11 w-full max-w-[1240px] items-center gap-6 px-6 pt-1">
				{finding ? (
					<>
						<label className="lh-fade flex min-w-0 flex-1 items-center gap-3">
							<PixelIcon name="search" className="h-[13px]" />
							<input
								// Find was just asked for: the typing line takes focus as it appears.
								autoFocus
								data-testid="graph-find-box"
								value={query}
								onChange={(e) => onQuery(e.target.value)}
								onKeyDown={(e) => {
									if (e.key !== "Escape") return;
									// Claimed, so the docked panel keeps its pick.
									e.preventDefault();
									e.stopPropagation();
									stop();
								}}
								// Leaving it empty closes it, unless focus moved to the x or elsewhere in the line.
								onBlur={(e) => {
									if (!query && !line.current?.contains(e.relatedTarget)) setFinding(false);
								}}
								placeholder="Find a topic or fact"
								aria-label="Find a topic or fact"
								spellCheck={false}
								className="min-w-0 flex-1 border-b-2 border-ink-3 bg-transparent pb-0.5 text-xl leading-7 text-ink outline-none placeholder:text-ink-3"
							/>
						</label>
						{/* Mounted while finding, so a screen reader hears each change. */}
						<span role="status" data-testid="graph-find-status" className="shrink-0">
							{matches?.topics.size === 0 ? (
								<span data-testid="graph-no-match" className="text-[15px] text-ink-2">
									Nothing matches
								</span>
							) : (
								// Before anything is typed, the totals wait faintly.
								<span className={cn("flex items-baseline gap-5", !matches && "opacity-50")}>
									<Count n={matches ? matches.topics.size : topicCount} word="topic" />
									<Count n={matches ? matches.facts.size : factCount} word="fact" />
								</span>
							)}
						</span>
						<button type="button" data-testid="graph-find-close" aria-label="Stop finding" onClick={stop} className="lh-btn lh-btn-quiet h-9 px-2">
							<PixelIcon name="close" />
						</button>
					</>
				) : (
					<>
						{hasFacts && (
							<>
								{/* The same unseen underline as the button beside it, so both sit on one line. */}
								<span className="border-b-2 border-transparent pb-1">
									<Count n={topicCount} word="topic" />
								</span>
								<button
									type="button"
									data-testid="open-chain-table"
									aria-label={`All ${factCount} ${factCount === 1 ? "fact" : "facts"}`}
									onClick={onOpenChains}
									className="border-b-2 border-transparent pb-1 transition-colors hover:border-foreground"
								>
									<Count n={factCount} word="fact" />
								</button>
							</>
						)}
						<span className="flex-1" />
						<span className="flex items-center gap-1">
							{importNotes && <ImportNotes {...importNotes} />}
							{hasFacts && (
								<button ref={findButton} type="button" data-testid="graph-find" onClick={find} className={WORD}>
									<PixelIcon name="search" />
									Find
								</button>
							)}
							{costs && costs.runs.length > 0 && <GraphCostControl costs={costs} />}
						</span>
					</>
				)}
			</div>
		</div>
	);
}

function ImportNotes({ importing, onImportFiles }: { importing: boolean; onImportFiles: (files: FileList | null) => void }) {
	const fileRef = useRef<HTMLInputElement>(null);
	return (
		<>
			<input
				ref={fileRef}
				type="file"
				multiple
				accept=".md,.markdown,.txt"
				className="hidden"
				onChange={(e) => {
					onImportFiles(e.target.files);
					e.target.value = ""; // the same file can be picked again
				}}
			/>
			<button type="button" data-testid="import-notes" disabled={importing} onClick={() => fileRef.current?.click()} className={WORD}>
				<PixelIcon name="plus" />
				{importing ? "Adding…" : "Add files"}
			</button>
		</>
	);
}
