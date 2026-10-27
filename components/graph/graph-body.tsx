import { useEffect, useMemo, useState } from "react";
import type { ProgressPayload } from "@/src/core";
import { defaultExamId, searchMatches } from "./derive.ts";
import { TopicMap } from "./topic-map.tsx";
import { TopicPanel } from "./topic-panel.tsx";
import { WherePanel } from "./where-panel.tsx";

/** The map and the right panel over one progress payload (loaded lazily
 *  by graph-screen.tsx). */
export function GraphBody({
	data,
	query,
	practicing,
	onPractice,
	initialSelected = null,
}: {
	data: ProgressPayload;
	query: string;
	practicing: boolean;
	onPractice: (topicIds: string[]) => void;
	initialSelected?: string | null;
}) {
	const [selectedId, setSelectedId] = useState<string | null>(initialSelected);
	const [examPick, setExamPick] = useState<string | null>(null);
	const examId = data.exams.some((e) => e.id === examPick) ? examPick : defaultExamId(data.exams);
	const selected = selectedId ? data.topics.find((t) => t.id === selectedId) : undefined;

	// Escape closes the topic (menus, dialogs and the search claim theirs first).
	useEffect(() => {
		if (!selected) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !e.defaultPrevented) setSelectedId(null);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [selected]);

	const exam = data.exams.find((e) => e.id === examId);
	const matches = useMemo(() => searchMatches(query, data.topics, data.facts), [query, data.topics, data.facts]);
	const examTopics = useMemo(() => (exam ? new Set(exam.topicIds) : null), [exam]);
	// Bright topics: the search's matches; else, with nothing selected, the
	// picked exam's topics; else all.
	const focus = matches ?? (selected ? null : examTopics);

	if (data.topics.length === 0) {
		return <TopicMap topics={data.topics} links={data.topicLinks} focus={null} selectedId={null} onSelect={setSelectedId} />;
	}
	return (
		<>
			<TopicMap topics={data.topics} links={data.topicLinks} focus={focus} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
			{selected ? (
				<TopicPanel
					topic={selected}
					topics={data.topics}
					links={data.topicLinks}
					facts={data.facts}
					onClose={() => setSelectedId(null)}
					onSelectTopic={setSelectedId}
					onPractice={onPractice}
					practicing={practicing}
				/>
			) : (
				<WherePanel
					data={data}
					examId={examId}
					onExamChange={setExamPick}
					onSelectTopic={setSelectedId}
					onPractice={onPractice}
					practicing={practicing}
				/>
			)}
		</>
	);
}
