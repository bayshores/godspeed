import type { GraphCostSummary } from "@/shared/core";
import { BarFind } from "@/frontend/components/top-bar/bar-find";
import { BarActions } from "@/frontend/components/top-bar/bar-slots";
import type { useBarFind } from "@/frontend/components/use-bar-find";
import { GraphCostControl } from "./cost-control.tsx";
import { ImportNotes } from "./import-notes.tsx";

/**
 * THE GRAPH PAGE IN THE TOP BAR: Find (with facts), Costs (with a run) and,
 * with no space, Add files. Opening Find swaps the other words for its field.
 */
export function GraphBar({
	hasFacts,
	find,
	costs,
	importNotes,
}: {
	hasFacts: boolean;
	find: ReturnType<typeof useBarFind>;
	/** null until loaded. */
	costs: GraphCostSummary | null;
	/** No space's own file picker; null in a space. */
	importNotes: { importing: boolean; onImportFiles: (files: FileList | null) => void } | null;
}) {
	return (
		<BarActions>
			{hasFacts && (
				<BarFind
					label="Find a topic or fact"
					testIds={{ key: "graph-find", field: "graph-find-field" }}
					open={find.open}
					onOpen={find.start}
					query={find.query}
					onQuery={find.setQuery}
					inputRef={find.inputRef}
					keyRef={find.keyRef}
					onKeyDown={find.onKeyDown}
					onClose={find.close}
				/>
			)}
			{!find.open && (
				<>
					{costs && costs.runs.length > 0 && <GraphCostControl costs={costs} />}
					{importNotes && <ImportNotes {...importNotes} />}
				</>
			)}
		</BarActions>
	);
}
