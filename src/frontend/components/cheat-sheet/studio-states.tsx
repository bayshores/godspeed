import type { SheetVersion } from "@/shared/core";

/** A sheet an older godspeed made (HTML or blocks) can't become a PDF
 *  without the agent: one click asks for it again. */
export function OlderSheet({ onRemake }: { onRemake: () => void }) {
	return (
		<div data-testid="cheat-sheet-older" className="flex max-w-[520px] flex-wrap items-center justify-center gap-x-3 gap-y-2 lh-well rounded px-3.5 py-3 text-ui text-ink">
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
export function emptyChatLine(made: boolean): string {
	return made
		? "Ask about the sheet, point at a part that confuses you, or say what to change."
		: "Say which paper, one side or both, and what must be on it. Your weak topics and mistakes go first.";
}
