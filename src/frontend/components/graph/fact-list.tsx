/**
 * A topic's facts in the topic sheet: a square in the fact's color and
 * the fact's name; a click opens the fact. The first FACTS_SHOWN show
 * until "Show all N". Deleting facts is in All facts.
 */
import { memo, useState } from "react";
import type { FactProgress } from "@/shared/core";
import { factCells } from "@/frontend/components/fact-cells";
import { InlineMath } from "@/frontend/components/overview/inline-math";
import { factCellLabel } from "./derive.ts";
import { PANE_ROW } from "./styles.ts";

const FACTS_SHOWN = 4;

export function FactList({
	facts,
	onOpen,
}: {
	/** Already in display order (core topicFacts). */
	facts: readonly FactProgress[];
	onOpen: (id: string) => void;
}) {
	const [showAll, setShowAll] = useState(false);

	// One hidden fact isn't worth a button: show it.
	const folded = !showAll && facts.length > FACTS_SHOWN + 1;
	const shown = folded ? facts.slice(0, FACTS_SHOWN) : facts;

	return (
		<>
			<ul className="flex w-full flex-col" data-testid="fact-list">
				{shown.map((f) => (
					<FactRow key={f.id} fact={f} onOpen={onOpen} />
				))}
			</ul>
			{folded && (
				<button type="button" data-testid="facts-show-all" onClick={() => setShowAll(true)} className="lh-btn lh-btn-quiet lh-btn-small self-start">
					Show all {facts.length}
				</button>
			)}
		</>
	);
}

const FactRow = memo(function FactRow({
	fact,
	onOpen,
}: {
	fact: FactProgress;
	onOpen: (id: string) => void;
}) {
	return (
		<li>
			<button type="button" data-testid="fact-row" onClick={() => onOpen(fact.id)} className={PANE_ROW}>
				<span role="img" aria-label={factCellLabel(fact)} className="size-[9px] shrink-0" style={{ background: factCells([fact])[0] }} />
				<span className="min-w-0 flex-1 truncate">
					<InlineMath text={fact.name} />
				</span>
			</button>
		</li>
	);
});
