/**
 * RUN EXAMPLES: the program that calls a code question's function on each
 * of its examples, and how what it prints is read. The program is the
 * learner's code with a few lines after it that print one marked line of
 * JSON, so anything the code prints itself stays apart. Pure.
 */
import type { MockLanguage } from "./mock.ts";

/** How one example went. */
export interface ExampleRun {
	/** What the function returned, as JSON text; absent when it threw. */
	returned?: string;
	/** The error it threw. */
	error?: string;
	passed: boolean;
}

export interface RunOutcome {
	/** One per example, in order; empty when the code never got that far. */
	examples: ExampleRun[];
	/** Why nothing ran: a syntax error, the time limit. */
	error?: string;
	/** What the code printed itself. */
	printed?: string;
}

/** The file the program is saved as. */
export const RUN_FILE: Record<MockLanguage, string> = { javascript: "solution.js", python: "solution.py" };

