/** The Path block on Progress: its title, the topic Study takes, and the rows under it. Pure. */
import { pathNext, type PathProgress, type PathTopicProgress } from "@/shared/core";

/** Rows shown under the topic Study takes until "Show all". */
const PATH_ROWS_AHEAD = 3;

interface PathBlockView {
	/** "Path to backend developer". */
	title: string;
	/** Where the next topic sits, "4 of 28"; null once every topic is strong. */
	count: string | null;
	allStrong: boolean;
	next: PathTopicProgress | null;
	/** The next three after it, or every other topic in order once shown all. */
	rows: PathTopicProgress[];
	/** The count "Show all" names; null when nothing is left out. */
	showAll: number | null;
}

export function pathBlockView(path: PathProgress, shownAll: boolean): PathBlockView {
	const at = pathNext(path);
	const total = path.topics.length;
	const allStrong = path.topics.every((t) => t.status === "strong");
	const ahead = at ? path.topics.slice(at.position, at.position + PATH_ROWS_AHEAD) : path.topics.slice(0, PATH_ROWS_AHEAD);
	const others = path.topics.filter((t) => t !== at?.topic);
	const leftOut = others.length > ahead.length;
	return {
		title: `Path to ${path.goal}`,
		count: at && !allStrong ? `${at.position} of ${total}` : null,
		allStrong,
		next: at?.topic ?? null,
		rows: shownAll ? others : ahead,
		showAll: leftOut && !shownAll ? total : null,
	};
}
