"use client";

/**
 * THE GRAPH PAGE: the class's topics as level columns with a right side:
 * the next deadline on top, under it what to work on next, the picked
 * topic, or the picked fact. Data: useProgress (GET /api/progress) and the
 * raw graph (GET /api/graph) for where facts came from, how they link,
 * and the chain table. Keyed by class by the route, so a class switch
 * starts clean.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { GraphSnapshot } from "@/shared/core";
import { classQuery, useClasses } from "@/frontend/components/class-context";
import { useProgress } from "@/frontend/components/use-progress";
import { useActivity } from "@/frontend/components/activity-dock";
import { LazyChainTableOverlay as ChainTableOverlay } from "@/frontend/components/chain-table-lazy.tsx";
import { LoadFailed } from "@/frontend/components/load-failed";
import { NotesImportErrors, useNotesImport } from "@/frontend/components/notes-import";
import { GraphTopBar } from "./graph-top-bar.tsx";
import { useLessonStart } from "@/frontend/components/home/use-lesson-start";

// The columns and panes load in their own chunk once the progress data has arrived.
const GraphBody = dynamic(() => import("./graph-body.tsx").then((m) => m.GraphBody), { ssr: false });

export function GraphScreen() {
	const { active } = useClasses();
	return <GraphScreenBody key={active ?? "none"} />;
}

function GraphScreenBody() {
	const { active } = useClasses();
	const progress = useProgress();
	const { refresh } = progress;
	const [query, setQuery] = useState("");
	const [chainsOpen, setChainsOpen] = useState(false);
	const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);

	const loadSnapshot = useCallback(() => {
		fetch(`/api/graph${classQuery(active)}`)
			.then((res) => {
				if (!res.ok) throw new Error(String(res.status));
				return res.json() as Promise<GraphSnapshot>;
			})
			.then(setSnapshot)
			// The page works without it: no fact sources or links, and All facts waits.
			.catch(() => setChainsOpen(false));
	}, [active]);
	useEffect(() => loadSnapshot(), [loadSnapshot]);

	// A delete (fact menu or chain table) announces the new revision.
	useEffect(() => {
		const onRevision = () => {
			refresh();
			loadSnapshot();
		};
		window.addEventListener("lh:graph-revision", onRevision);
		return () => window.removeEventListener("lh:graph-revision", onRevision);
	}, [refresh, loadSnapshot]);
	const sources = useMemo(
		() => (snapshot ? { chains: snapshot.chains, fileSources: snapshot.fileSources, sessions: snapshot.sessions } : null),
		[snapshot],
	);

	const refreshActivity = useActivity().refresh;
	const notesImport = useNotesImport({ onStart: refreshActivity, onFinish: refresh });
	const study = useLessonStart();

	const data = progress.data;
	const hasFacts = (data?.facts.length ?? 0) > 0;
	// Deleting every fact hides the table; close it so new facts don't reopen it.
	if (chainsOpen && data && !hasFacts) setChainsOpen(false);
	return (
		<div className="relative flex h-full min-h-0 flex-col" data-testid="graph-page">
			<GraphTopBar
				hasFacts={hasFacts}
				query={query}
				onQuery={setQuery}
				onOpenChains={() => setChainsOpen(true)}
				importNotes={active ? null : notesImport}
			/>
			<div className="relative flex min-h-0 flex-1">
				{data ? (
					<GraphBody
						data={data}
						query={query}
						sources={sources}
						studying={study.busy}
						studyError={study.error}
						onStudy={(ids) => void study.studyTopics(ids)}
						onStudyDeadline={(d) => void study.studyDeadline(d)}
						onPractice={(f) => void study.start({ title: "", picks: [{ id: f.id, name: f.name, statement: f.statement }] })}
					/>
				) : progress.error ? (
					<LoadFailed message="Couldn't load your graph." onRetry={refresh} className="m-auto" />
				) : (
					<p className="m-auto text-sm text-ink-2">Loading…</p>
				)}
				{notesImport.errors.length > 0 && (
					<div className="absolute inset-x-6 top-12 z-10 flex flex-col gap-1">
						<NotesImportErrors errors={notesImport.errors} />
					</div>
				)}
			</div>
			{/* Last child: the overlay covers the page and its top bar (one bar,
			    one Follow chip; app-region subtraction follows DOM order). */}
			<ChainTableOverlay
				open={chainsOpen && snapshot !== null}
				nodes={snapshot?.propositions ?? []}
				chains={snapshot?.chains ?? []}
				sessions={snapshot?.sessions ?? {}}
				fileSources={snapshot?.fileSources ?? {}}
				onClose={() => setChainsOpen(false)}
			/>
		</div>
	);
}
