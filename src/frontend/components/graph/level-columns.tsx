/**
 * The class's topics as level columns in one sheet: one column per level
 * (the longest chain of topics a topic needs first), read top to bottom,
 * no lines and no zoom. A row is the topic's name with one square per
 * fact in its right rate's color; a key under the columns says what the
 * colors mean. With a topic picked, it is marked and the topics it needs
 * or leads to turn bold; a search or the picked deadline dims what it
 * doesn't cover. More levels than fit scroll sideways.
 */
import { memo, useMemo } from "react";
import Link from "next/link";
import { RAMP_COLORS, topicFacts, UNTESTED_COLOR, type FactProgress, type TopicLink, type TopicProgress } from "@/shared/core";
import { Pane } from "@/frontend/components/ui/pane";
import { factCells, UNSTUDIED_CELL } from "@/frontend/components/fact-cells";
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
		return new Map<string, "needs" | "leads">([...needs.map((t) => [t.id, "needs"] as const), ...leadsTo.map((t) => [t.id, "leads"] as const)]);
	}, [selectedId, links, byId]);
	const cellsOf = useMemo(() => {
		const map = new Map<string, string[]>();
		for (const t of topics) map.set(t.id, factCells(topicFacts(facts, t)));
		return map;
	}, [topics, facts]);

	if (topics.length === 0) {
		return (
			<Pane data-testid="graph-empty" className="flex-1 px-6 py-10 text-center text-[15px] text-ink-2">
				{inClass ? (
					<span>
						Start a lesson or{" "}
						<Link href="/class/files" data-testid="graph-empty-add-files" className="text-ink underline hover:text-ink-max">
							add files
						</Link>{" "}
						to build your graph.
					</span>
				) : (
					"Start a lesson or add files to build your graph."
				)}
			</Pane>
		);
	}
	return (
		<Pane data-testid="level-columns" className="flex min-w-0 flex-1 flex-col gap-[22px] p-6">
			<div className="grid auto-cols-[minmax(200px,1fr)] grid-flow-col gap-7 overflow-x-auto">
				{levels.map((level, i) => (
					<section key={i} data-testid="level" className="flex min-w-0 flex-col gap-1">
						<h2 className="text-[15px] font-medium text-ink">{levelName(i, levels.length)}</h2>
						<span aria-hidden className="h-[1.5px] w-full bg-ink" />
						<ul className="flex flex-col">
							{level.map((t) => (
								<TopicRow
									key={t.id}
									topic={t}
									cells={cellsOf.get(t.id) ?? []}
									selected={t.id === selectedId}
									mark={marks?.get(t.id) ?? null}
									dim={!!focus && !focus.has(t.id)}
									onSelect={onSelect}
								/>
							))}
						</ul>
					</section>
				))}
			</div>
			<span aria-hidden className="border-t-2 border-dotted border-edge" />
			<CellKey />
		</Pane>
	);
}

const KEY: { color: string; label: string }[] = [
	{ color: RAMP_COLORS[4], label: "right" },
	{ color: RAMP_COLORS[0], label: "wrong" },
	{ color: UNTESTED_COLOR, label: "in a lesson, not answered" },
	{ color: UNSTUDIED_CELL, label: "not studied" },
];

/** What the squares' colors mean. */
function CellKey() {
	return (
		<p data-testid="cell-key" className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-base text-ink-2">
			<span>One square is one fact</span>
			{KEY.map(({ color, label }) => (
				<span key={label} className="flex items-center gap-[5px]">
					<span aria-hidden className="size-[9px] shrink-0" style={{ background: color }} />
					{label}
				</span>
			))}
		</p>
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
	mark: "needs" | "leads" | null;
	dim: boolean;
	onSelect: (id: string) => void;
}) {
	const relation = mark === "needs" ? ", needed first" : mark === "leads" ? ", comes next" : "";
	return (
		<li>
			<button
				type="button"
				data-testid="topic-row"
				data-mark={mark ?? undefined}
				data-dim={dim || undefined}
				aria-pressed={selected}
				aria-label={`${topic.name}, ${statusLine(topic)}, ${topic.members.length} ${topic.members.length === 1 ? "fact" : "facts"}${relation}`}
				onClick={() => onSelect(topic.id)}
				className={cn(
					// Squares that don't fit beside the name drop under it.
					"lh-press flex w-full flex-wrap items-start gap-x-2 px-2 py-[7px] text-left transition-opacity duration-(--lh-dur)",
					selected ? "bg-highlight" : "hover:bg-tone",
					// The picked topic stays readable even outside the deadline or search.
					dim && !selected && "opacity-45",
				)}
			>
				<span className={cn("min-w-0 flex-auto text-[15px] leading-snug break-words text-ink", (selected || mark) && "font-medium")}>{topic.name}</span>
				<span aria-hidden className="my-1.5 flex max-w-full flex-wrap gap-[3px]">
					{cells.map((color, i) => (
						<span key={i} className={color === UNSTUDIED_CELL ? "size-2" : "lh-block-in size-2"} style={{ background: color }} />
					))}
				</span>
			</button>
		</li>
	);
});
