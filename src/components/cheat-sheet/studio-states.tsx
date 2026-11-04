import { overflowLine, pageSizeLabel, type CheatSheetView } from "@/core";
import { BrailleSpinner } from "@/components/braille-spinner";

const NO_AGENT = "No agent connected";

/** The top bar's middle: what the agent is doing (or that none is
 *  connected to do it), else the paper and whether it all fits. */
export function StudioStatus({
	view,
	agentName,
	agentGone,
	over,
	onStop,
}: {
	view: CheatSheetView;
	agentName: string;
	/** No agent connected: a request waits for one instead of running. */
	agentGone: boolean;
	/** The pages that run over, counted from 1. */
	over: readonly number[];
	onStop: () => void;
}) {
	const run = view.running;
	const doc = view.sheet.doc;
	if (run)
		return (
			<div data-testid="cheat-sheet-status" className="flex shrink-0 items-center gap-3 text-sm">
				{agentGone ? (
					<span className="font-bold text-ink">{NO_AGENT}</span>
				) : (
					<>
						<BrailleSpinner className="h-3.5 text-ink" />
						<span className="font-bold text-ink">{run.kind === "make" ? `${agentName} is writing your sheet` : `${agentName} is changing your sheet`}</span>
					</>
				)}
				<button type="button" onClick={onStop} className="lh-press font-bold text-ink-2 hover:text-ink">
					Stop
				</button>
			</div>
		);
	if (!doc)
		return (
			<span data-testid="cheat-sheet-status" className="shrink-0 text-sm text-ink-2">
				Not made yet
			</span>
		);
	return (
		<div data-testid="cheat-sheet-status" className="flex shrink-0 items-center gap-3 text-sm">
			<span className="text-ink-2">{pageSizeLabel(doc)}</span>
			{over.length > 0 && (
				<span className="flex items-center gap-2 font-bold text-ans-wrong">
					<span className="size-2 shrink-0 bg-(--lh-ramp-1)" aria-hidden />
					{overflowLine(over, doc.pages.length)}
				</span>
			)}
		</div>
	);
}
