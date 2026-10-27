"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { FileCoverage, GraphContextPick, GraphCostSummary, TopicProgress } from "@/src/core";
import { classQuery, useClasses } from "@/components/class-context";
import { SetupDialog } from "@/components/setup-dialog";
import { ConnectPill } from "@/components/setup-cta";
import { useFieldCycle } from "@/components/field-cycle";
import { useRiseOnChange } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { useProgress } from "@/components/use-progress";
import { GraphCostControl } from "@/components/graph/cost-control.tsx";
import { displayName } from "@/components/overview/overview-model";
import { FactsPicker, useGraphSnapshot } from "@/components/home/facts-picker";
import { SuggestionList } from "@/components/home/suggestions";
import { homeSuggestions } from "@/components/home/suggestions-model";
import { ModeSwitch, TopicBox, type HomeMode } from "@/components/home/topic-box";
import { useLessonStart } from "@/components/home/use-lesson-start";
import { useLessonStep } from "@/components/home/use-lesson-step";

/**
 * HOME — "New lesson" (redesign Phase 6): where new lessons start
 * (the sidebar's New lesson and Practice buttons and ⌘N open it), in the
 * active class. Teach / Practice, the topic box ("Start from facts" picks facts
 * from the chain table; Enter or "Start lesson" starts), then
 * "Suggested for <class>": Continue the latest lesson, Next up (the
 * earliest unstudied file) and Work on next (weak or untested topics).
 * The top bar keeps the setup prompt and the graph-cost control.
 */
export function Home({ initialConfigured }: { initialConfigured: boolean }) {
	const { active: activeClassId, activeClass } = useClasses();
	const lesson = useLessonStart(initialConfigured);
	const { data } = useProgress();
	// Progress for a class the window just left is never shown.
	const progress = data && data.classId === activeClassId ? data : null;

	const [topic, setTopic] = useState("");
	/* The topic MIRROR: the start reads the ref, kept current at every
	 * write, so a closure never sees a stale draft. */
	const topicRef = useRef("");
	// The mode lives in the URL ("/?mode=practice" is the sidebar's
	// Practice button), so the sidebar always lands on the right one; the
	// switch rewrites it in place (no navigation, no history entry).
	const mode: HomeMode = useSearchParams().get("mode") === "practice" ? "practice" : "teach";
	const setMode = useCallback((m: HomeMode) => {
		window.history.replaceState(null, "", m === "practice" ? "/?mode=practice" : "/");
	}, []);
	const [picks, setPicks] = useState<GraphContextPick[]>([]);
	const [pickerOpen, setPickerOpen] = useState(false);
	// Picks belong to one class's graph — switching class clears them.
	useEffect(() => setPicks([]), [activeClassId]);
	const pickedIds = useMemo(() => new Set(picks.map((p) => p.id)), [picks]);
	const snapshot = useGraphSnapshot(activeClassId);
	const costs = useGraphCosts(activeClassId);

	// Tab moves into the topic box (the app's field cycle).
	const topicInputRef = useRef<HTMLTextAreaElement>(null);
	const cycleTopicField = useCallback(
		(): readonly HTMLElement[] => (topicInputRef.current ? [topicInputRef.current] : []),
		[],
	);
	useFieldCycle(cycleTopicField);
	// Switching class swaps the view: it rises in once.
	const viewRef = useRef<HTMLDivElement>(null);
	useRiseOnChange(viewRef, activeClassId);

	const { start, practiceTopic } = lesson;
	const startTopic = () => void start({ title: topicRef.current, kind: mode, picks });
	const learn = useCallback((file: FileCoverage) => void start({ title: displayName(file.name) }), [start]);
	const facts = progress?.facts;
	const practice = useCallback((t: TopicProgress) => void practiceTopic(t, facts ?? []), [practiceTopic, facts]);

	const suggestions = useMemo(() => homeSuggestions(progress), [progress]);
	const latest = progress?.lessons[0] ?? null;
	const step = useLessonStep(latest?.chatId ?? null, latest?.updatedAt ?? null);

	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="home">
			<TopBar>
				<h1 className="text-[15px] font-bold text-ink">New lesson</h1>
				<div className="flex-1" />
				{lesson.noConnection ? (
					<ConnectPill inline onOpen={lesson.openSetup} />
				) : (
					!lesson.configured && (
						<button
							type="button"
							data-testid="setup-cta"
							onClick={lesson.openSetup}
							className="lh-press bg-panel px-2.5 py-2 text-sm text-ink hover:bg-tone"
						>
							Set up your models
						</button>
					)
				)}
				{costs && costs.runs.length > 0 && <GraphCostControl costs={costs} />}
			</TopBar>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<div
					ref={viewRef}
					className="mx-auto flex w-full max-w-[712px] flex-col px-4 pb-16 pt-[92px]"
					style={{ animationDuration: "var(--lh-dur-slow)" }}
				>
					<h2 className="font-title text-[34px] font-bold leading-tight text-ink">What do you want to learn?</h2>
					<div className="mt-5">
						<ModeSwitch mode={mode} onMode={setMode} />
					</div>
					<div className="mt-2.5">
						<TopicBox
							text={topic}
							onText={(t) => {
								topicRef.current = t;
								setTopic(t);
							}}
							onStart={startTopic}
							busy={lesson.busy}
							inputRef={topicInputRef}
							picks={picks.length}
							canPick={(snapshot?.propositions.length ?? 0) > 0}
							onOpenPicker={() => setPickerOpen(true)}
							onClearPicks={() => setPicks([])}
						/>
					</div>
					<div className="mt-10">
						<SuggestionList
							key={activeClassId ?? "none"}
							classLabel={activeClass?.name ?? null}
							suggestions={suggestions}
							step={step}
							busy={lesson.busy}
							onLearn={learn}
							onPractice={practice}
						/>
					</div>
				</div>
			</div>

			<SetupDialog open={lesson.setupOpen} onClose={lesson.closeSetup} onDone={lesson.setupDone} />
			{/* Full-bleed overlay with its own top bar: LAST in the tree, so
			    its window-drag band isn't punched through by earlier controls. */}
			<FactsPicker
				open={pickerOpen}
				snapshot={snapshot}
				picked={pickedIds}
				onPicked={setPicks}
				onClose={() => setPickerOpen(false)}
			/>
		</div>
	);
}

/** The class's graph-pipeline spend (the top bar's cost control). */
function useGraphCosts(classId: string | null): GraphCostSummary | null {
	const [state, setState] = useState<{ classId: string | null; costs: GraphCostSummary } | null>(null);
	useEffect(() => {
		let live = true;
		fetch(`/api/graph/costs${classQuery(classId)}`)
			.then((res) => res.json() as Promise<GraphCostSummary>)
			.then((costs) => {
				if (live) setState({ classId, costs });
			})
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [classId]);
	return state && state.classId === classId ? state.costs : null;
}
