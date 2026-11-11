import { currentVersion, pageSizeLabel, type CheatSheetView, type ClassColor, type SheetVersion } from "@/shared/core";
import { classColorVar } from "@/frontend/components/class-color";
import { TeacherSprite } from "@/frontend/components/halley/teacher-sprite";

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

/** The top of the teacher side: the mascot on the class's pale color, the
 *  teacher's name and what it is doing. */
export function TeacherHead({ name, color, doing }: { name: string; color: ClassColor | undefined; doing: string | null }) {
	return (
		<div
			data-testid="sheet-teacher"
			className="flex shrink-0 items-center gap-3 border-b-2 border-line bg-tone py-3 pr-3.5 pl-5"
			// The pale class color CountBlock uses.
			style={color ? { background: `color-mix(in srgb, ${classColorVar(color)} 57%, var(--lh-class-wash))` } : undefined}
		>
			<TeacherSprite mood="idle" className="w-[26px] shrink-0" />
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate text-[18px] leading-snug font-medium text-ink">{name}</span>
				{doing && (
					<span data-testid="sheet-teacher-doing" className="truncate text-base text-ink-2">
						{doing}
					</span>
				)}
			</div>
		</div>
	);
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
