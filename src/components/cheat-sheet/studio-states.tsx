import { currentVersion, pageSizeLabel, type CheatSheetView } from "@/core";
import { BrailleSpinner } from "@/components/braille-spinner";

const NO_AGENT = "No agent connected";

/** The top bar's middle: what the agent is doing (or that none is
 *  connected to do it), else the paper. */
export function StudioStatus({
	view,
	agentName,
	agentGone,
	onStop,
}: {
	view: CheatSheetView;
	agentName: string;
	/** No agent connected: a request waits for one instead of running. */
	agentGone: boolean;
	onStop: () => void;
}) {
	const run = view.running;
	const current = currentVersion(view.sheet);
	if (run)
		return (
			<div data-testid="cheat-sheet-status" className="flex shrink-0 items-center gap-3 text-sm">
				{agentGone ? (
					<span className="font-bold text-ink">{NO_AGENT}</span>
				) : (
					<>
						<BrailleSpinner className="h-3.5 text-ink" />
						<span className="font-bold text-ink">{run.kind === "make" ? `${agentName} is making your sheet` : `${agentName} is changing your sheet`}</span>
					</>
				)}
				<button type="button" onClick={onStop} className="lh-press font-bold text-ink-2 hover:text-ink">
					Stop
				</button>
			</div>
		);
	return (
		<span data-testid="cheat-sheet-status" className="shrink-0 text-sm text-ink-2">
			{current ? pageSizeLabel(current.pages) : "Not made yet"}
		</span>
	);
}

/** A sheet an older godspeed made (HTML or blocks) can't become a PDF
 *  without the agent: one click asks for it again. */
export function OlderSheet({ onRemake }: { onRemake: () => void }) {
	return (
		<div data-testid="cheat-sheet-older" className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3 text-sm text-ink-2 outline outline-1 -outline-offset-1 outline-tone-2">
			<span>Your sheet was made by an older godspeed and can&apos;t be shown anymore.</span>
			<button type="button" data-testid="cheat-sheet-remake" onClick={onRemake} className="lh-press bg-tone px-2.5 py-1.5 font-bold text-ink hover:bg-tone-2">
				Make it again
			</button>
		</div>
	);
}
