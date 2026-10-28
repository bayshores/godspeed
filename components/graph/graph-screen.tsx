"use client";

/**
 * THE GRAPH PAGE (redesign plan, Phase 5): the class's topics as a map
 * with a right panel — "Where you're at" when nothing is selected, the
 * topic's details when one is. Data: useProgress (GET /api/progress); the
 * chain table reads the raw graph (GET /api/graph) only while it is open.
 * Keyed by class by the route, so a class switch starts clean.
 */
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { GraphSnapshot } from "@/src/core";
import { classQuery, useClasses } from "@/components/class-context";
import { useProgress } from "@/components/use-progress";
import { useActivity } from "@/components/activity-dock";
import { LazyChainTableOverlay as ChainTableOverlay } from "@/components/chain-table-lazy.tsx";
import { NotesImportErrors, useNotesImport } from "@/components/notes-import";
import { SetupDialog } from "@/components/setup-dialog";
import { GraphTopBar } from "./graph-top-bar.tsx";
import { usePracticeStart } from "./practice.ts";

// The map and its panels (with d3-zoom) load in their own chunk once the
// progress data has arrived.
const GraphBody = dynamic(() => import("./graph-body.tsx").then((m) => m.GraphBody), { ssr: false });

export function GraphScreen({ initialConfigured }: { initialConfigured: boolean }) {
	const { active } = useClasses();
	return <GraphScreenBody key={active ?? "none"} initialConfigured={initialConfigured} />;
}

function GraphScreenBody({ initialConfigured }: { initialConfigured: boolean }) {
	const { active } = useClasses();
	const progress = useProgress();
	const { refresh } = progress;
	const [query, setQuery] = useState("");
	const [chainsOpen, setChainsOpen] = useState(false);
	const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);

	// The chain table's data, read while it is open.
	const loadSnapshot = useCallback(() => {
		fetch(`/api/graph${classQuery(active)}`)
			.then((res) => res.json() as Promise<GraphSnapshot>)
			.then(setSnapshot)
			.catch(() => {});
	}, [active]);
	useEffect(() => {
		if (chainsOpen) loadSnapshot();
	}, [chainsOpen, loadSnapshot]);

	// A delete (fact menu or chain table) announces the new revision.
	useEffect(() => {
		const onRevision = () => {
			refresh();
			if (chainsOpen) loadSnapshot();
		};
		window.addEventListener("lh:graph-revision", onRevision);
		return () => window.removeEventListener("lh:graph-revision", onRevision);
	}, [refresh, chainsOpen, loadSnapshot]);

	const refreshActivity = useActivity().refresh;
	const notesImport = useNotesImport({ onStart: refreshActivity, onFinish: refresh });
	const practice = usePracticeStart(initialConfigured);

	const data = progress.data;
	const hasFacts = (data?.facts.length ?? 0) > 0;
	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="graph-page">
			<GraphTopBar
				hasFacts={hasFacts}
				query={query}
				onQuery={setQuery}
				onOpenChains={() => setChainsOpen(true)}
				importing={notesImport.importing}
				onImportFiles={notesImport.onImportFiles}
			/>
			<div className="relative flex min-h-0 flex-1">
				{data ? (
					<GraphBody
						data={data}
						query={query}
						practicing={practice.busy}
						onPractice={(ids) => {
							const topics = ids.map((id) => data.topics.find((t) => t.id === id)).filter((t) => t !== undefined);
							void practice.start(topics, data.facts);
						}}
					/>
				) : (
					progress.error && <p className="m-auto text-sm text-ink-3">{progress.error}</p>
				)}
				{notesImport.errors.length > 0 && (
					<div className="absolute inset-x-6 top-12 z-10 flex flex-col gap-1">
						<NotesImportErrors errors={notesImport.errors} />
					</div>
				)}
				{/* Last child: the overlay covers the page and its top bar
				    (app-region subtraction follows DOM order). */}
				<ChainTableOverlay
					open={chainsOpen && hasFacts}
					nodes={snapshot?.propositions ?? []}
					chains={snapshot?.chains ?? []}
					sessions={snapshot?.sessions ?? {}}
					fileSources={snapshot?.fileSources ?? {}}
					onClose={() => setChainsOpen(false)}
				/>
			</div>
			<SetupDialog open={practice.setupOpen} onClose={practice.closeSetup} onDone={practice.setupDone} />
		</div>
	);
}
