/**
 * The starter keys under the teacher's screen while its chat is unused:
 * what each says, following the page on screen, and when the row shows.
 * Pure.
 */
import type { TerminalFacts } from "./terminal-model";

const STUDY = "What should I study?";
const DUE = "What's due?";
const CAN_DO = "What can you do?";

/** Pages that take a line typed in the terminal themselves (a lesson, a cheat sheet). */
const TALK_PAGE = /^\/chat\/|^\/space\/deadline\/[^/]+\/cheat-sheet/;
/** A space's pages, and the Graph, which shows the active space. */
const SPACE_PAGE = /^\/(space|graph)(\/|$)/;

/** The starters for the page at `path`; none where a typed line goes to the page. `spaceName`:
 *  the active space's name, null for no space. `deadlines`: the open ones. */
export function startersFor({ path, spaceName, deadlines }: { path: string; spaceName: string | null; deadlines: readonly { id: string; name: string }[] }): string[] {
	if (TALK_PAGE.test(path)) return [];
	const open = /^\/space\/deadline\/([^/]+)$/.exec(path)?.[1];
	const deadline = open === undefined ? undefined : deadlines.find((d) => d.id === decodeURIComponent(open));
	const first = deadline ? `Get me ready for ${deadline.name}` : spaceName && SPACE_PAGE.test(path) ? `What should I study in ${spaceName}?` : STUDY;
	return [first, DUE, CAN_DO];
}

/** The row shows while the teacher's terminal runs and has checked in, nothing on its screen
 *  asks the learner, no lesson turn waits, and nothing was said in this chat yet. */
export function startersShown(f: TerminalFacts | null, chatUsed: boolean): boolean {
	if (!f || chatUsed) return false;
	const { term } = f;
	return term.role === "teacher" && !term.ended && f.checkedIn && !term.prompt && !term.url && !f.turnWaits;
}
