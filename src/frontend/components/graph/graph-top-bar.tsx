/**
 * The Graph page's top bar: "Graph", then search (topics and facts),
 * All facts (the chain table) and Add files, which opens the class's Files
 * page (No class has no Files page, so there it picks notes files right
 * here). Search and All facts only show once the class has facts.
 */
import { useEffect, useRef, type RefObject } from "react";
import Link from "next/link";
import { PlusIcon, SearchIcon } from "lucide-react";
import { TopBar } from "@/frontend/components/app-bar";

const CHROME_BUTTON = "lh-btn shrink-0";

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
	/** No class's own file picker; null in a class (Add files opens Files). */
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
		<>
			<h1 className="sr-only">Graph</h1>
			<TopBar path={[{ label: "graph", href: null }]}>
			{hasFacts && <SearchBox inputRef={searchRef} query={query} onQuery={onQuery} />}
			{hasFacts && (
				<button type="button" data-testid="open-chain-table" onClick={onOpenChains} className={CHROME_BUTTON}>
					All facts
				</button>
			)}
			{importNotes ? (
				<ImportNotes {...importNotes} />
			) : (
				<Link href="/class/files" data-testid="add-notes" className={CHROME_BUTTON}>
					+ Add files
				</Link>
			)}
			</TopBar>
		</>
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
			<button type="button" data-testid="import-notes" disabled={importing} onClick={() => fileRef.current?.click()} className={CHROME_BUTTON}>
				<PlusIcon className="size-3.5" aria-hidden />
				{importing ? "Adding…" : "Add files"}
			</button>
		</>
	);
}

function SearchBox({ inputRef, query, onQuery }: { inputRef: RefObject<HTMLInputElement | null>; query: string; onQuery: (q: string) => void }) {
	return (
		<label className="flex w-[280px] min-w-[240px] shrink items-center gap-2 border border-edge bg-panel px-2.5 py-2 focus-within:border-ink">
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
