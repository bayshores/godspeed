/**
 * Prep contracts.
 *
 * A prep is a space made to get ready for one thing (an interview round,
 * an online assessment, a test). Instead of space files it starts from the
 * learner's own words, and the teacher writes its prep sheet: what the
 * thing is like, where that was found, the topics to study in order, and
 * what a mock of it looks like. Pure types.
 */

/** A page the teacher read while writing the sheet. */
export interface PrepSource {
	title: string;
	url: string;
}

/** One thing to study. Its id is the plan node of study sessions on it, so
 *  answers there (and in mocks) count for it. */
export interface PrepTopic {
	/** "pt_" + 8 hex; kept when the sheet is written again. */
	id: string;
	name: string;
	/** One line: why it is on the list. */
	why?: string;
}

/** What one mock is: how many questions in how many minutes. */
export interface MockFormat {
	questions: number;
	minutes: number;
}

export interface SpacePrep {
	/** The learner's own words: what they are preparing for. */
	goal: string;
	/** The day it happens, YYYY-MM-DD (absent: no date yet). */
	date?: string;
	/** What it is like, in markdown ("" until the sheet is written). */
	about: string;
	sources: PrepSource[];
	/** In the order to study them. */
	topics: PrepTopic[];
	/** Absent until the sheet is written. */
	mock?: MockFormat;
	/** ISO time the teacher last wrote the sheet. */
	writtenAt?: string;
}
