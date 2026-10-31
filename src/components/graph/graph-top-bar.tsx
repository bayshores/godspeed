/**
 * The Graph page's top bar: "Graph", then search (topics and facts),
 * Chains (the chain table) and Add notes, which opens the class's Files
 * page (No class has no Files page, so there it is Import notes). Search
 * and Chains only show once the class has facts.
 */
import { useEffect, useRef, type RefObject } from "react";
import Link from "next/link";
import { ListIcon, SearchIcon, UploadIcon } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { Hint } from "@/components/ui/hint";

const CHROME_BUTTON = "lh-press flex shrink-0 items-center gap-[7px] bg-panel px-2.5 py-2 text-sm text-ink hover:bg-tone disabled:opacity-50";

export function GraphTopBar({
	hasFacts,
	query,
	onQuery,
	onOpenChains,
	importNotes,
}: {
	hasFacts: boolean;
	query: string;
	onQuery: (q: string) => void;
	onOpenChains: () => void;
	/** No class's Import notes; null in a class (Add notes opens Files). */
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
		<TopBar>
			<h1 className="text-sm font-bold text-ink">Graph</h1>
			<div className="flex-1" />
			{hasFacts && <SearchBox inputRef={searchRef} query={query} onQuery={onQuery} />}
			{hasFacts && (
				<Hint label="Every reasoning chain" side="bottom">
					<button type="button" data-testid="open-chain-table" onClick={onOpenChains} className={CHROME_BUTTON}>
						<ListIcon className="size-3.5" aria-hidden />
						Chains
					</button>
				</Hint>
			)}
			{importNotes ? (
				<ImportNotes {...importNotes} />
			) : (
				<Hint label="Add notes on the Files page" side="bottom">
					<Link href="/class/files" data-testid="add-notes" className={CHROME_BUTTON}>
						<UploadIcon className="size-3.5" aria-hidden />
						Add notes
					</Link>
				</Hint>
			)}
		</TopBar>
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
			<Hint label="Import notes into the graph" side="bottom">
				<button type="button" data-testid="import-notes" disabled={importing} onClick={() => fileRef.current?.click()} className={CHROME_BUTTON}>
					<UploadIcon className="size-3.5" aria-hidden />
					{importing ? "Importing…" : "Import notes"}
				</button>
			</Hint>
		</>
	);
}

function SearchBox({ inputRef, query, onQuery }: { inputRef: RefObject<HTMLInputElement | null>; query: string; onQuery: (q: string) => void }) {
	return (
		<label className="flex w-[280px] min-w-0 shrink items-center gap-2 border border-tone-2 bg-panel px-2.5 py-2 focus-within:border-ink-3">
			<SearchIcon className="size-3.5 shrink-0 text-ink-3" aria-hidden />
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
				className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
			/>
		</label>
	);
}
