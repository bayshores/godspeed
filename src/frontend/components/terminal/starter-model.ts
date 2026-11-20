/**
 * What the teacher can be asked, as lines one click sends to its terminal:
 * the few for the page on screen (the "Try asking" row) and the whole list,
 * grouped, where a job that cannot work yet says what it needs. Pure.
 */
import { byDue } from "@/frontend/components/deadlines-model";
import type { DeadlineKind } from "@/shared/core";
import type { TerminalFacts } from "./terminal-model";

const STUDY = "What should I study?";
const DUE = "What's due?";
const TEACH = "Teach me a new topic";
const FIND = "Find something in my files";
const SET_UP = "Set up a space from my files";
const PATH = "Build me a path to a goal";
const ADD_DEADLINE = "Add a deadline";

/** Pages that take a line typed in the terminal themselves (a lesson, a cheat sheet). */
const TALK_PAGE = /^\/chat\/|^\/space\/deadline\/[^/]+\/cheat-sheet/;
/** A space's own pages. */
const SPACE_PAGE = /^\/space(\/|$)/;
/** The Graph, which shows what the learner knows in the active space. */
const GRAPH_PAGE = /^\/graph(\/|$)/;

/** What the lists are made from, all of it already loaded by the window. */
export interface IdeaFacts {
	path: string;
	/** The active space; null for none. */
	space: { id: string; name: string; files: number } | null;
	/** How many spaces are open. */
	spaces: number;
	/** The open deadlines of every space. */
	deadlines: readonly { id: string; name: string; kind: DeadlineKind; spaceId: string; date: string; time?: string }[];
}

/** One line to send. `needs`: why it cannot work yet; such a line is shown, never sent. */
export interface Idea {
	line: string;
	needs: string | null;
}

export interface IdeaGroup {
	name: string;
	ideas: Idea[];
}

/** The active space's open deadlines, soonest first; every space's when none is active. */
function near(f: IdeaFacts): IdeaFacts["deadlines"] {
	return byDue(f.deadlines.filter((d) => !f.space || d.spaceId === f.space.id));
}

/** The lines for the page at `f.path`, at most four, each one that works now. None where a
 *  typed line goes to the page. What the page shows or has a key for gets no line. */
export function startersFor(f: IdeaFacts): string[] {
	if (TALK_PAGE.test(f.path)) return [];
	const open = /^\/space\/deadline\/([^/]+)$/.exec(f.path)?.[1];
	const deadline = open === undefined ? undefined : f.deadlines.find((d) => d.id === decodeURIComponent(open));
	if (deadline) return [`Get me ready for ${deadline.name}`, `What am I weakest at for ${deadline.name}?`, DUE];
	const find = f.space && f.space.files > 0 ? [FIND] : [];
	if (f.space && GRAPH_PAGE.test(f.path)) return [`What should I study in ${f.space.name}?`, ...find, TEACH];
	if (f.space && SPACE_PAGE.test(f.path)) return [`What should I study in ${f.space.name}?`, knows(f.space.name), ...find, TEACH];
	if (f.spaces === 0) return [SET_UP, TEACH, PATH];
	return [STUDY, TEACH, ADD_DEADLINE, ...find];
}

const knows = (space: string) => `What do I know in ${space}?`;
const can = (line: string): Idea => ({ line, needs: null });
/** `line` when `thing` is there, else `without` with what it needs. */
const withThing = (thing: { name: string } | undefined, line: (name: string) => string, without: string, needs: string): Idea =>
	thing ? can(line(thing.name)) : { line: without, needs };

/** Everything the teacher can be asked, with the learner's own names in it. */
export function everything(f: IdeaFacts): IdeaGroup[] {
	const deadlines = near(f);
	const homework = deadlines.find((d) => d.kind === "homework" || d.kind === "project");
	const sheet = deadlines.find((d) => d.kind !== "interview");
	const mock = deadlines.find((d) => d.kind === "exam" || d.kind === "quiz" || d.kind === "interview");
	const space = f.space ?? undefined;
	return [
		{
			name: "Learn",
			ideas: [
				can(TEACH),
				can("Quiz me on what I've learned"),
				can(PATH),
				can("Help me prepare for an interview"),
				{ line: "Draw it, show a demo or look it up", needs: "needs an open lesson" },
			],
		},
		{
			name: "Deadlines",
			ideas: [
				can(DUE),
				f.spaces > 0 ? can(ADD_DEADLINE) : { line: ADD_DEADLINE, needs: "needs a space" },
				withThing(deadlines[0], (name) => `Get me ready for ${name}`, "Get me ready for a deadline", "needs a deadline"),
				withThing(homework, (name) => `Help me with ${name}`, "Help me with my homework", "needs a homework deadline"),
				withThing(sheet, (name) => `Make a cheat sheet for ${name}`, "Make a cheat sheet", "needs a deadline"),
				withThing(mock, (name) => `Write a mock exam for ${name}`, "Write a mock exam", "needs an exam or quiz deadline"),
			],
		},
		{
			name: "Spaces and files",
			ideas: [can(SET_UP), space && space.files > 0 ? can(FIND) : { line: FIND, needs: "needs files in a space" }],
		},
		{
			name: "About you",
			ideas: [
				can("Remember how I like to learn"),
				withThing(space, knows, "What do I know?", "needs a space"),
				can("What did we do in my last lesson?"),
			],
		},
	];
}

/** A terminal can take a line now: it runs and has checked in, nothing on its
 *  screen asks the learner and no lesson turn waits. */
export function takesLine(f: TerminalFacts | null): boolean {
	if (!f) return false;
	const { term } = f;
	return !term.ended && f.checkedIn && !term.prompt && !term.url && !f.turnWaits;
}
