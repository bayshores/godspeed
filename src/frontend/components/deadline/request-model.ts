/**
 * A deadline request in words: what the learner's agent does on the
 * deadline page (work out what's on it, write a study guide, rewrite what
 * it's like), and why the last one changed nothing. Pure.
 */

export type RequestKind = "coverage" | "guide" | "about";

/** GET /api/spaces/:id/deadlines/:did/request. */
export interface RequestState {
	running: RequestKind | null;
	/** The last request from the page that changed nothing: what the agent said, or why it stopped. */
	failed: { kind: RequestKind; said?: string; error?: string } | null;
}

const DOING: Record<RequestKind, string> = {
	coverage: "working out what's on it",
	guide: "writing a study guide",
	about: "rewriting what it's like",
};

/** What the work frame says the request does. */
export function requestDoing(kind: RequestKind): string {
	return DOING[kind];
}

/** A start the server refused, or that never reached it. */
export interface AskError {
	kind: RequestKind;
	error: string;
}

/** Beside the Ask button of `kind` when its start failed or its request changed nothing; null otherwise. */
export function requestFailedLine(state: RequestState | null, askError: AskError | null, kind: RequestKind, teacher: string): string | null {
	if (askError?.kind === kind) return askError.error;
	const failed = state?.failed;
	if (!failed || failed.kind !== kind || state.running) return null;
	return failed.said ? `${teacher}: ${failed.said}` : `${teacher} couldn't finish: ${failed.error ?? "it changed nothing"}`;
}
