/**
 * The Graph tab's bar under the space head: search (topics and facts),
 * then Graph costs, All facts (the chain table) and Add files, which
 * opens the space's Files tab (No space has no Files tab, so there it
 * picks notes files right here). Search and All facts only show once the
 * space has facts; Graph costs once a graph run has been recorded.
 */
import { useEffect, useRef, type RefObject } from "react";
import Link from "next/link";
import type { GraphCostSummary } from "@/shared/core";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { GraphCostControl } from "./cost-control.tsx";

const BUTTON = "lh-btn shrink-0 text-[15px]";

export function GraphTopBar({
	hasFacts,
	query,
	onQuery,
	onOpenChains,
	costs,
	importNotes,
}: {
	hasFacts: boolean;
	query: string;
	onQuery: (q: string) => void;
	onOpenChains: () => void;
	/** null until loaded. */
	costs: GraphCostSummary | null;
	/** No space's own file picker; null in a space (Add files opens Files). */
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
		<div data-testid="graph-tools" className="flex flex-wrap items-center gap-2.5">
			<h1 className="sr-only">Graph</h1>
			{hasFacts && <SearchBox inputRef={searchRef} query={query} onQuery={onQuery} />}
			<span className="flex-1" />
			{costs && costs.runs.length > 0 && <GraphCostControl costs={costs} />}
			{hasFacts && (
				<button type="button" data-testid="open-chain-table" onClick={onOpenChains} className={BUTTON}>
					All facts
				</button>
			)}
			{importNotes ? (
				<ImportNotes {...importNotes} />
			) : (
				<Link href="/space/files" data-testid="add-notes" className={BUTTON}>
					<PixelIcon name="plus" />
					Add files
				</Link>
			)}
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
			<button type="button" data-testid="import-notes" disabled={importing} onClick={() => fileRef.current?.click()} className={BUTTON}>
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
			className="h-10 w-[340px] max-w-full rounded border-[1.5px] border-ink bg-background px-3 text-[15px] text-ink outline-none placeholder:text-ink-3"
		/>
	);
}
