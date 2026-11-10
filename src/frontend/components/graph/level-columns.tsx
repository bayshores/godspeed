/**
 * The class's topics as level columns: one pane per level (the longest
 * chain of topics a topic needs first), read top to bottom, no lines and
 * no zoom. A row is the topic's name over one square per fact in its
 * right rate's color. With a topic picked, the topics it needs show ←,
 * the ones it leads to show →, and the rest dim; a search or the picked
 * deadline dims what it doesn't cover. More levels than fit scroll sideways.
 */
import { memo, useMemo } from "react";
import Link from "next/link";
import { topicFacts, type FactProgress, type TopicLink, type TopicProgress } from "@/shared/core";
import { Pane } from "@/frontend/components/ui/pane";
import { factCells, UNSTUDIED_CELL } from "@/frontend/components/home-page/home-page-model";
import { cn } from "@/frontend/lib/utils";
import { levelName, neighbors, statusLine, topicLevels } from "./derive.ts";

export function LevelColumns({
	topics,
	links,
	facts,
	inClass,
	focus,
	selectedId,
	onSelect,
}: {
	topics: readonly TopicProgress[];
	links: readonly TopicLink[];
	facts: readonly FactProgress[];
	inClass: boolean;
	/** The bright topics (a search's matches, or the picked deadline's); null = all. */
	focus: ReadonlySet<string> | null;
	selectedId: string | null;
	onSelect: (id: string) => void;
}) {
	const levels = useMemo(() => topicLevels(topics), [topics]);
	const byId = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);
	const marks = useMemo(() => {
		if (!selectedId) return null;
		const { needs, leadsTo } = neighbors(selectedId, links, byId);
		return new Map<string, "←" | "→">([...needs.map((t) => [t.id, "←"] as const), ...leadsTo.map((t) => [t.id, "→"] as const)]);
	}, [selectedId, links, byId]);
	const cellsOf = useMemo(() => {
		const map = new Map<string, string[]>();
		for (const t of topics) map.set(t.id, factCells(topicFacts(facts, t)));
		return map;
	}, [topics, facts]);

	if (topics.length === 0) {
		return (
			<p data-testid="graph-empty" className="m-auto px-6 text-center text-sm text-ink-2">
				{inClass ? (
					<span>
						Start a lesson or{" "}
						<Link href="/class/files" data-testid="graph-empty-add-files" className="font-bold text-ink hover:text-ink-max">
							add files
						</Link>{" "}
						to build your graph.
					</span>
				) : (
					"Start a lesson or add files to build your graph."
				)}
			</p>
		);
	}
	return (
		<div data-testid="level-columns" className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto p-5 pr-0">
			{levels.map((level, i) => (
				<Pane key={i} name={levelName(i, levels.length)} data-testid="level" className="flex min-h-0 w-[244px] shrink-0 flex-col">
					<ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-4 pb-2">
						{level.map((t) => (
							<TopicRow
								key={t.id}
								topic={t}
								cells={cellsOf.get(t.id) ?? []}
								selected={t.id === selectedId}
								mark={marks?.get(t.id) ?? null}
								dim={selectedId ? t.id !== selectedId && !marks?.has(t.id) : !!focus && !focus.has(t.id)}
								onSelect={onSelect}
							/>
						))}
					</ul>
				</Pane>
			))}
		</div>
	);
}

const TopicRow = memo(function TopicRow({
	topic,
	cells,
	selected,
	mark,
	dim,
	onSelect,
}: {
	topic: TopicProgress;
	cells: readonly string[];
	selected: boolean;
	mark: "←" | "→" | null;
	dim: boolean;
	onSelect: (id: string) => void;
}) {
	const relation = mark === "←" ? ", needed first" : mark === "→" ? ", comes next" : "";
	return (
		<li>
			<button
				type="button"
				data-testid="topic-row"
				data-dim={dim || undefined}
				aria-pressed={selected}
				aria-label={`${topic.name}, ${statusLine(topic)}, ${topic.members.length} ${topic.members.length === 1 ? "fact" : "facts"}${relation}`}
				onClick={() => onSelect(topic.id)}
				className={cn(
					"lh-press flex w-full flex-col gap-1.5 border px-2.5 py-2 text-left transition-opacity duration-(--lh-dur)",
					selected ? "border-ink bg-tone" : "border-transparent hover:bg-tone",
					dim && "opacity-45",
				)}
			>
				<span className={cn("flex min-w-0 items-baseline gap-[1ch] text-[13px] leading-5", selected ? "font-bold text-ink" : mark ? "text-ink" : "text-ink-2")}>
					{mark && (
						<span data-testid="topic-mark" aria-hidden className="font-bold">
							{mark}
						</span>
					)}
					<span className="truncate" title={topic.name}>
						{topic.name}
					</span>
				</span>
				<span aria-hidden className="flex flex-wrap gap-[2px]">
					{cells.map((color, i) => (
						<span key={i} className={color === UNSTUDIED_CELL ? "size-[7px]" : "lh-block-in size-[7px]"} style={{ background: color }} />
					))}
				</span>
			</button>
		</li>
	);
});
