/**
 * THE GRAPH TAB, under the space head: one picture of the space's topics and
 * facts and how they link, fitted to the window so the page never scrolls,
 * over a foot line (counts); Find, Costs and Add files are words in the top
 * bar. A picked topic or fact docks its panel beside it. Data: useProgress (GET /api/progress) and the
 * raw graph (GET /api/graph) for where facts came from, how they link,
 * and the chain table. Keyed by space by the route, so a space switch
 * starts clean.
 */
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { FactProgress } from "@/shared/core";
import { useSpaces } from "@/frontend/components/space-context";
import { useProgress } from "@/frontend/components/use-progress";
import { useActivity } from "@/frontend/components/activity-dock";
import { LazyChainTableOverlay as ChainTableOverlay } from "@/frontend/components/chain-table-lazy.tsx";
import { LoadFailed } from "@/frontend/components/load-failed";
import { useBarFind } from "@/frontend/components/use-bar-find";
import { NotesImportErrors, useNotesImport } from "@/frontend/components/notes-import";
import { findMatches } from "./derive.ts";
import { GraphBar } from "./graph-bar.tsx";
import { GraphFoot } from "./graph-foot.tsx";
import { useGraphCosts } from "./use-graph-costs.ts";
import { useGraphSnapshot } from "./use-graph-snapshot.ts";
import { useLessonStart } from "@/frontend/components/study-page/use-lesson-start";
import { lazyComponent } from "@/frontend/lib/lazy-component";
import type { Aim, Flight } from "./constellation-camera.ts";
import type { InView } from "./use-in-view.ts";

// The picture and panels load in their own chunk once the progress data has arrived.
// Kept from rendering again when only the foot line's in-view counts change, which they do as the camera moves.
const GraphBody = memo(lazyComponent(() => import("./graph-body.tsx").then((m) => m.GraphBody)));

export function GraphScreen() {
	const { active } = useSpaces();
	return <GraphScreenBody key={active ?? "none"} />;
}

function GraphScreenBody() {
	const { active } = useSpaces();
	const progress = useProgress();
	const { refresh } = progress;
	const [chainsOpen, setChainsOpen] = useState(false);
	const { value: snapshot, error: snapshotError, reload: loadSnapshot } = useGraphSnapshot(active);
	// The page works without it: no fact sources or links, and All facts waits.
	useEffect(() => {
		if (snapshotError !== null) setChainsOpen(false);
	}, [snapshotError]);

	// A delete (fact menu or chain table) announces the new revision.
	useEffect(() => {
		const onRevision = () => {
			void refresh();
			void loadSnapshot();
		};
		window.addEventListener("lh:graph-revision", onRevision);
		return () => window.removeEventListener("lh:graph-revision", onRevision);
	}, [refresh, loadSnapshot]);
	const sources = useMemo(
		() => (snapshot ? { chains: snapshot.chains, fileSources: snapshot.fileSources, sessions: snapshot.sessions } : null),
		[snapshot],
	);
	const [inView, setInView] = useState<InView | null>(null);
	// The camera's latest flight: the picture asks for picks, the foot line and Find for the whole space.
	const [aim, setAim] = useState<Aim | null>(null);
	const fly = useCallback((to: Flight) => {
		// Whole space leaves the foot line as the camera flies out; focus on it moves to the picture's Tab stop instead of the page.
		if (to.to === "whole" && document.activeElement?.closest("[data-testid=graph-whole-space]")) document.querySelector<HTMLElement>("[data-testid=graph-topic][tabindex='0']")?.focus();
		setAim((a) => ({ ...to, seq: (a?.seq ?? 0) + 1 }));
	}, []);

	const refreshActivity = useActivity().refresh;
	const notesImport = useNotesImport({ onStart: refreshActivity, onFinish: refresh });
	const study = useLessonStart();
	const costs = useGraphCosts(active);
	const { studyTopics, start } = study;
	const onStudy = useCallback((ids: string[]) => void studyTopics(ids), [studyTopics]);
	const onStudyFact = useCallback((f: FactProgress) => void start({ title: "", picks: [{ id: f.id, name: f.name, statement: f.statement }] }), [start]);

	const data = progress.data;
	const hasFacts = (data?.facts.length ?? 0) > 0;
	const find = useBarFind(hasFacts);
	const matches = useMemo(() => (data ? findMatches(find.query, data.topics, data.facts) : null), [find.query, data]);
	// Typing in Find shows the whole space, so every match is in view.
	const finding = matches !== null;
	useEffect(() => {
		if (finding) fly({ to: "whole" });
	}, [finding, fly]);
	// Deleting every fact hides the table; close it so new facts don't reopen it.
	if (chainsOpen && data && !hasFacts) setChainsOpen(false);
	return (
		<div className="relative h-full" data-testid="graph-page">
			<div className="h-full overflow-hidden">
				<div className="lh-page flex flex-col gap-4 pt-3">
					<h1 className="sr-only">Graph</h1>
					{notesImport.errors.length > 0 && (
						<div className="flex flex-col gap-1">
							<NotesImportErrors errors={notesImport.errors} />
						</div>
					)}
					{data ? (
						<GraphBody
							data={data}
							matches={matches}
							sources={sources}
							studying={study.busy}
							studyError={study.error}
							onStudy={onStudy}
							onStudyFact={onStudyFact}
							onInView={setInView}
							aim={aim}
							onFly={fly}
						/>
					) : progress.error ? (
						<LoadFailed message="Couldn't load your graph." onRetry={refresh} className="py-10" />
					) : (
						<p className="py-10 text-center text-[15px] text-ink-2">Loading…</p>
					)}
				</div>
			</div>
			<GraphBar hasFacts={hasFacts} find={find} costs={costs} importNotes={active ? null : notesImport} />
			<GraphFoot
				hasFacts={hasFacts}
				topicCount={data?.topics.filter((t) => !t.ungrouped).length ?? 0}
				factCount={data?.facts.length ?? 0}
				matches={matches}
				onOpenChains={() => setChainsOpen(true)}
				inView={inView}
				onWholeSpace={() => fly({ to: "whole" })}
			/>
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
