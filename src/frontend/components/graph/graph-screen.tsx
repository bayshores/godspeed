/**
 * THE GRAPH TAB, under the space head: its bar (search, Graph costs, All
 * facts, Add files), then the space's topics as level columns with a
 * right side: the picked deadline on top, under it what to work on next,
 * the picked topic, or the picked fact. Data: useProgress (GET /api/progress) and the
 * raw graph (GET /api/graph) for where facts came from, how they link,
 * and the chain table. Keyed by space by the route, so a space switch
 * starts clean.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GraphSnapshot } from "@/shared/core";
import { spaceQuery, useSpaces } from "@/frontend/components/space-context";
import { useProgress } from "@/frontend/components/use-progress";
import { useActivity } from "@/frontend/components/activity-dock";
import { LazyChainTableOverlay as ChainTableOverlay } from "@/frontend/components/chain-table-lazy.tsx";
import { LoadFailed } from "@/frontend/components/load-failed";
import { NotesImportErrors, useNotesImport } from "@/frontend/components/notes-import";
import { GraphTopBar } from "./graph-top-bar.tsx";
import { useGraphCosts } from "./use-graph-costs.ts";
import { useLessonStart } from "@/frontend/components/home/use-lesson-start";
import { lazyComponent } from "@/frontend/lib/lazy-component";

// The columns and panes load in their own chunk once the progress data has arrived.
const GraphBody = lazyComponent(() => import("./graph-body.tsx").then((m) => m.GraphBody));

export function GraphScreen() {
	const { active } = useSpaces();
	return <GraphScreenBody key={active ?? "none"} />;
}

function GraphScreenBody() {
	const { active } = useSpaces();
	const progress = useProgress();
	const { refresh } = progress;
	const [query, setQuery] = useState("");
	const [chainsOpen, setChainsOpen] = useState(false);
	const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);

	const loadSnapshot = useCallback(() => {
		fetch(`/api/graph${spaceQuery(active)}`)
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
	const costs = useGraphCosts(active);

	const data = progress.data;
	const hasFacts = (data?.facts.length ?? 0) > 0;
	// Deleting every fact hides the table; close it so new facts don't reopen it.
	if (chainsOpen && data && !hasFacts) setChainsOpen(false);
	return (
		<div className="relative h-full" data-testid="graph-page">
			<div className="h-full overflow-y-auto">
				<div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-6 pt-6 pb-16">
					<GraphTopBar
						hasFacts={hasFacts}
						query={query}
						onQuery={setQuery}
						onOpenChains={() => setChainsOpen(true)}
						costs={costs}
						importNotes={active ? null : notesImport}
					/>
					{notesImport.errors.length > 0 && (
						<div className="flex flex-col gap-1">
							<NotesImportErrors errors={notesImport.errors} />
						</div>
					)}
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
						<LoadFailed message="Couldn't load your graph." onRetry={refresh} className="py-10" />
					) : (
						<p className="py-10 text-center text-[15px] text-ink-2">Loading…</p>
					)}
				</div>
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
