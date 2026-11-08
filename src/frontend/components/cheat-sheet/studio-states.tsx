import { currentVersion, pageSizeLabel, type CheatSheetView, type SheetVersion } from "@/shared/core";
import { BrailleSpinner } from "@/frontend/components/braille-spinner";

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
	const current = currentVersion(view.sheet);
	if (view.running)
		return (
			<div data-testid="cheat-sheet-status" className="flex shrink-0 items-center gap-3 text-sm">
				{agentGone ? (
					<span className="font-bold text-ink">{NO_AGENT}</span>
				) : (
					<>
						<BrailleSpinner className="h-3.5 text-ink" />
						<span className="font-bold text-ink">{current ? `${agentName} is on your message` : `${agentName} is making your sheet`}</span>
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
			<button type="button" data-testid="cheat-sheet-remake" onClick={onRemake} className="lh-btn">
				Make it again
			</button>
		</div>
	);
}

const when = (at: string) => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The line above a version on the canvas. */
export function versionLabel(v: SheetVersion, newest: boolean): string {
	return `${newest ? "Current" : when(v.at)}, ${v.fromFolder ? "From the working folder" : v.prompt || "From the files you sent"}`;
}

/** What an empty chat says, before and after the sheet is made. */
export function emptyChatLine(agentName: string, made: boolean): string {
	return made
		? `Ask ${agentName} anything about the sheet, point at a part that confuses you, or say what to change.`
		: `Say what you want on it: the paper, one side or both, what to put first. ${agentName} reads your class's rules in the syllabus, puts your weak topics and mistakes first, and makes it as a PDF.`;
}
