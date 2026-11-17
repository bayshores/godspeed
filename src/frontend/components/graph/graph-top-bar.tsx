/**
 * The Graph tab's bar under the space head: search (topics and facts),
 * then quiet words: All facts (the chain table), Graph costs and, with no
 * space, Add files to pick notes files right here (a space adds files on
 * its Files tab). Search and All facts only show once the space has facts;
 * Graph costs once a graph run has been recorded.
 */
import { useEffect, useRef, type RefObject } from "react";
import type { GraphCostSummary } from "@/shared/core";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { GraphCostControl } from "./cost-control.tsx";

const WORD = "lh-btn lh-btn-quiet shrink-0 text-[15px]";

export function GraphTopBar({
	hasFacts,
	query,
	onQuery,
	nothingMatches,
	onOpenChains,
	costs,
	importNotes,
}: {
	hasFacts: boolean;
	query: string;
	onQuery: (q: string) => void;
	/** A search that lights nothing. */
	nothingMatches: boolean;
	onOpenChains: () => void;
	/** null until loaded. */
	costs: GraphCostSummary | null;
	/** No space's own file picker; null in a space. */
	importNotes: { importing: boolean; onImportFiles: (files: FileList | null) => void } | null;
}) {
	const searchRef = useRef<HTMLInputElement>(null);
	// The app's find shortcut focuses the search here.
	useEffect(() => {
		const onFind = () => searchRef.current?.focus();
		window.addEventListener("lh:kbd-find", onFind);
		return () => window.removeEventListener("lh:kbd-find", onFind);
	}, []);
	return (
		<div data-testid="graph-tools" className="flex flex-wrap items-center gap-x-5 gap-y-2">
			<h1 className="sr-only">Graph</h1>
			{hasFacts && <SearchBox inputRef={searchRef} query={query} onQuery={onQuery} />}
			{nothingMatches && (
				<span data-testid="graph-no-match" className="text-[15px] text-ink-2">
					Nothing matches
				</span>
			)}
			<span className="flex-1" />
			<span className="flex items-center gap-1">
				{hasFacts && (
					<button type="button" data-testid="open-chain-table" onClick={onOpenChains} className={WORD}>
						All facts
					</button>
				)}
				{costs && costs.runs.length > 0 && <GraphCostControl costs={costs} />}
				{importNotes && <ImportNotes {...importNotes} />}
			</span>
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

function SearchBox({ inputRef, query, onQuery }: { inputRef: RefObject<HTMLInputElement | null>; query: string; onQuery: (q: string) => void }) {
	return (
		<input
			ref={inputRef}
			data-testid="graph-search"
			value={query}
			onChange={(e) => onQuery(e.target.value)}
			onKeyDown={(e) => {
				if (e.key === "Escape" && query) {
					e.stopPropagation();
					onQuery("");
				}
			}}
			placeholder="Search topics and facts"
			aria-label="Search topics and facts"
			spellCheck={false}
			className="h-10 w-[340px] max-w-full lh-well rounded px-3 text-[15px] text-ink outline-none placeholder:text-ink-3"
		/>
	);
}
