import { useEffect, useMemo, useState } from "react";
import { PanelRightOpenIcon } from "lucide-react";
import type { ProgressPayload } from "@/shared/core";
import { Hint } from "@/frontend/components/ui/hint";
import { defaultDeadlineId, pickableDeadlines, searchMatches } from "./derive.ts";
import { TopicMap } from "./topic-map.tsx";
import { TopicPanel } from "./topic-panel.tsx";
import { WherePanel } from "./where-panel.tsx";

/** The folded Where you're at panel: a strip with the button that opens it. */
function ShowPanelRail({ onShow }: { onShow: () => void }) {
	return (
		<div className="flex h-full w-11 shrink-0 justify-center border-l border-tone-2 bg-panel pt-[18px]">
			<Hint label="Show Where you're at" side="left">
				<button
					type="button"
					data-testid="where-panel-show"
					aria-label="Show Where you're at"
					onClick={onShow}
					className="lh-press flex size-7 items-center justify-center text-ink-3 hover:bg-tone hover:text-ink"
				>
					<PanelRightOpenIcon className="size-4" aria-hidden />
				</button>
			</Hint>
		</div>
	);
}

/** The map and the right panel over one progress payload (loaded lazily
 *  by graph-screen.tsx). */
export function GraphBody({
	data,
	query,
	studying,
	studyError,
	onStudy,
	initialSelected = null,
}: {
	data: ProgressPayload;
	query: string;
	studying: boolean;
	studyError: string | null;
	onStudy: (topicIds: string[]) => void;
	initialSelected?: string | null;
}) {
	const [selectedId, setSelectedId] = useState<string | null>(initialSelected);
	const [deadlinePick, setDeadlinePick] = useState<string | null>(null);
	// The Where you're at panel folds to a strip; a picked topic still opens its panel.
	const [panelHidden, setPanelHidden] = useState(false);
	const [slideIn, setSlideIn] = useState(false);
	const pickable = useMemo(() => pickableDeadlines(data.deadlines), [data.deadlines]);
	const deadlineId = pickable.some((d) => d.id === deadlinePick) ? deadlinePick : defaultDeadlineId(pickable);
	const selected = selectedId ? data.topics.find((t) => t.id === selectedId) : undefined;
	// Only a Show slides the panel in, not closing a topic afterwards.
	if (selected && slideIn) setSlideIn(false);

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
			{panelHidden && !selected ? (
				<ShowPanelRail
					onShow={() => {
						setPanelHidden(false);
						setSlideIn(true);
					}}
				/>
			) : selected ? (
				<TopicPanel
					topic={selected}
					topics={data.topics}
					links={data.topicLinks}
					facts={data.facts}
					onClose={() => setSelectedId(null)}
					onSelectTopic={setSelectedId}
					onStudy={onStudy}
					studying={studying}
					studyError={studyError}
				/>
			) : (
				<WherePanel
					data={data}
					onHide={() => setPanelHidden(true)}
					slideIn={slideIn}
					deadlineId={deadlineId}
					onDeadlineChange={setDeadlinePick}
					onSelectTopic={setSelectedId}
					onStudy={onStudy}
					studying={studying}
					studyError={studyError}
				/>
			)}
		</>
	);
}
