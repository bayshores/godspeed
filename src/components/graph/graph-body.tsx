import { useEffect, useMemo, useState } from "react";
import type { ProgressPayload } from "@/core";
import { defaultDeadlineId, pickableDeadlines, searchMatches } from "./derive.ts";
import { TopicMap } from "./topic-map.tsx";
import { TopicPanel } from "./topic-panel.tsx";
import { WherePanel } from "./where-panel.tsx";

/** The map and the right panel over one progress payload (loaded lazily
 *  by graph-screen.tsx). */
export function GraphBody({
	data,
	query,
	practicing,
	practiceError,
	onPractice,
	initialSelected = null,
}: {
	data: ProgressPayload;
	query: string;
	practicing: boolean;
	practiceError: string | null;
	onPractice: (topicIds: string[]) => void;
	initialSelected?: string | null;
}) {
	const [selectedId, setSelectedId] = useState<string | null>(initialSelected);
	const [deadlinePick, setDeadlinePick] = useState<string | null>(null);
	const pickable = useMemo(() => pickableDeadlines(data.deadlines), [data.deadlines]);
	const deadlineId = pickable.some((d) => d.id === deadlinePick) ? deadlinePick : defaultDeadlineId(pickable);
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

	const deadline = pickable.find((d) => d.id === deadlineId);
	const matches = useMemo(() => searchMatches(query, data.topics, data.facts), [query, data.topics, data.facts]);
	const deadlineTopics = useMemo(() => (deadline ? new Set(deadline.topicIds) : null), [deadline]);
	// Bright topics: the search's matches; else, with nothing selected, the
	// picked deadline's topics; else all.
	const focus = matches ?? (selected ? null : deadlineTopics);

	if (data.topics.length === 0) {
		return <TopicMap topics={data.topics} links={data.topicLinks} inClass={data.classId !== null} focus={null} selectedId={null} onSelect={setSelectedId} />;
	}
	return (
		<>
			<TopicMap topics={data.topics} links={data.topicLinks} inClass={data.classId !== null} focus={focus} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
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
					practiceError={practiceError}
				/>
			) : (
				<WherePanel
					data={data}
					deadlineId={deadlineId}
					onDeadlineChange={setDeadlinePick}
					onSelectTopic={setSelectedId}
					onPractice={onPractice}
					practicing={practicing}
					practiceError={practiceError}
				/>
			)}
		</>
	);
}
