import { useEffect, useMemo, useState } from "react";
import type { DeadlineProgress, FactProgress, ProgressPayload } from "@/shared/core";
import { defaultDeadlineId, pickableDeadlines, searchMatches } from "./derive.ts";
import { FactPane, type FactSources } from "./fact-pane.tsx";
import { LevelColumns } from "./level-columns.tsx";
import { DeadlinePane, WorkOnNextPane } from "./side-panes.tsx";
import { TopicPane } from "./topic-pane.tsx";

/** The level columns and the right side over one progress payload
 *  (loaded lazily by graph-screen.tsx), side by side. The right side
 *  keeps the picked deadline on top; under it the picked fact, else the
 *  picked topic, else what to work on next. */
export function GraphBody({
	data,
	query,
	sources,
	studying,
	studyError,
	onStudy,
	onStudyDeadline,
	onPractice,
	initialSelected = null,
}: {
	data: ProgressPayload;
	query: string;
	/** Where facts came from and how they link; null while it loads. */
	sources: FactSources | null;
	studying: boolean;
	studyError: string | null;
	onStudy: (topicIds: string[]) => void;
	onStudyDeadline: (deadline: DeadlineProgress) => void;
	onPractice: (fact: FactProgress) => void;
	initialSelected?: string | null;
}) {
	const [selectedId, setSelectedId] = useState<string | null>(initialSelected);
	const [factId, setFactId] = useState<string | null>(null);
	const [deadlinePick, setDeadlinePick] = useState<string | null>(null);
	const pickable = useMemo(() => pickableDeadlines(data.deadlines), [data.deadlines]);
	const deadlineId = pickable.some((d) => d.id === deadlinePick) ? deadlinePick : defaultDeadlineId(pickable);
	const selected = selectedId ? data.topics.find((t) => t.id === selectedId) : undefined;
	const fact = factId ? data.facts.find((f) => f.id === factId) : undefined;
	const factTopic = fact ? data.topics.find((t) => t.id === fact.topicId) : undefined;

	const select = (id: string) => {
		setFactId(null);
		setSelectedId((cur) => (cur === id ? null : id));
	};
	// A fact opens with its topic picked, so the columns show where it sits.
	const openFact = (id: string) => {
		const topicId = data.facts.find((f) => f.id === id)?.topicId;
		if (topicId) setSelectedId(topicId);
		setFactId(id);
	};

	// Escape closes the fact, then the topic (menus, dialogs and the search claim theirs first).
	useEffect(() => {
		if (!selected && !fact) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || e.defaultPrevented) return;
			if (fact) setFactId(null);
			else setSelectedId(null);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [selected, fact]);

	const deadline = pickable.find((d) => d.id === deadlineId);
	const matches = useMemo(() => searchMatches(query, data.topics, data.facts), [query, data.topics, data.facts]);
	const deadlineTopics = useMemo(() => (deadline ? new Set(deadline.topicIds) : null), [deadline]);
	// Bright topics: the search's matches, else the picked deadline's.
	const focus = matches ?? deadlineTopics;

	const columns = (
		<LevelColumns topics={data.topics} links={data.topicLinks} facts={data.facts} inClass={data.classId !== null} focus={focus} selectedId={selected?.id ?? null} onSelect={select} />
	);
	if (data.topics.length === 0) return columns;
	return (
		<div className="flex items-start gap-5">
			{columns}
			<aside data-testid="graph-side" aria-label="Where you're at" className="flex w-[320px] shrink-0 flex-col gap-5">
				{deadline && (
					<DeadlinePane
						deadlines={pickable}
						deadline={deadline}
						topics={data.topics}
						onChange={setDeadlinePick}
						onStudy={onStudyDeadline}
						studying={studying}
						studyError={null}
					/>
				)}
				{fact && factTopic ? (
					<FactPane
						key={fact.id}
						fact={fact}
						topicName={factTopic.name}
						facts={data.facts}
						sources={sources}
						onBack={() => setFactId(null)}
						onClose={() => {
							setFactId(null);
							setSelectedId(null);
						}}
						onOpenFact={openFact}
						onPractice={onPractice}
						studying={studying}
						studyError={studyError}
					/>
				) : selected ? (
					<TopicPane
						key={selected.id}
						topic={selected}
						topics={data.topics}
						links={data.topicLinks}
						facts={data.facts}
						onClose={() => setSelectedId(null)}
						onSelectTopic={select}
						onOpenFact={openFact}
						onStudy={onStudy}
						studying={studying}
						studyError={studyError}
					/>
				) : (
					<WorkOnNextPane scope={deadline ?? data.overall} topics={data.topics} onSelectTopic={select} onStudy={onStudy} studying={studying} studyError={studyError} />
				)}
			</aside>
		</div>
	);
}
