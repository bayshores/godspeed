import { currentVersion, pageSizeLabel, type CheatSheetView, type SheetVersion } from "@/shared/core";

/** The studio bar's status: the newest version's paper, or that there is none yet. */
export function sheetPaper(view: CheatSheetView): string {
	const current = currentVersion(view.sheet);
	return current ? pageSizeLabel(current.pages) : "Not made yet";
}

/** The line under the teacher's name while a request runs (or waits for
 *  an agent to run it); null when nothing runs. */
export function teacherDoing(view: CheatSheetView, agentGone: boolean): string | null {
	if (!view.running) return null;
	if (agentGone) return "No agent connected";
	return currentVersion(view.sheet) ? "is on your message" : "is making your sheet";
}

/** A sheet an older godspeed made (HTML or blocks) can't become a PDF
 *  without the agent: one click asks for it again. */
export function OlderSheet({ onRemake }: { onRemake: () => void }) {
	return (
		<div data-testid="cheat-sheet-older" className="flex max-w-[520px] flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded border border-border bg-background px-3.5 py-3 text-[15px] text-ink">
			<span>Your sheet was made by an older godspeed and can&apos;t be shown anymore.</span>
			<button type="button" data-testid="cheat-sheet-remake" onClick={onRemake} className="lh-btn text-[15px]">
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
