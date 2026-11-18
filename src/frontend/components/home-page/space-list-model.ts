/** Today's "Your spaces": each open space's topics by status, in words, and the new files its linked folder brought. Pure. */
import { isNewFolderFile, localDay, pathNext, rampColor, type ProgressPayload, type SpaceFile, type StatusCounts } from "@/shared/core";
import { STATUS_LEGEND } from "@/frontend/components/overview/overview-model";

interface Segment {
	key: keyof StatusCounts;
	count: number;
	color: string;
}

interface SpaceRowWords {
	/** The topic bar, strongest first; empty with no topics. */
	segments: Segment[];
	/** "18 topics, 9 strong, 3 shaky, 6 not tested" (the Graph page's words, zeros left out), a path's next topic or "No study files yet." with no files, else empty (loading, or files still being read). */
	line: string;
}

/** A space's row: its topic bar and the counts, or what to add when it has
 *  no files. With no progress it is still loading, unless its read `failed`. */
export function spaceRow(progress: Pick<ProgressPayload, "overall" | "files" | "path"> | undefined, failed: boolean): SpaceRowWords {
	if (!progress) return { segments: [], line: failed ? "Couldn't load its progress." : "" };
	const counts = progress.overall.counts;
	const shown = STATUS_LEGEND.filter((s) => counts[s.key] > 0);
	const segments = shown.map((s) => ({ key: s.key, count: counts[s.key], color: rampColor(s.rate) }));
	if (segments.length > 0) {
		const total = segments.reduce((sum, s) => sum + s.count, 0);
		const parts = shown.map((s) => `${counts[s.key]} ${s.label}`);
		return { segments, line: [`${total} ${total === 1 ? "topic" : "topics"}`, ...parts].join(", ") };
	}
	if (progress.files.length === 0) {
		const onPath = progress.path ? pathNext(progress.path) : null;
		return { segments, line: onPath ? `Next up: ${onPath.topic.name}` : "No study files yet." };
	}
	// Its files are still being read: the top bar's pill says so.
	return { segments, line: "" };
}

/** "2 new files since Monday": files a scan of the linked folder found
 *  lately that came after `seenAt` (the newest one the learner saw on the
 *  Files page), counted from the day the first of them came. Null when none. */
export function newFilesLine(files: readonly Pick<SpaceFile, "foundByScan" | "addedAt">[], seenAt: string | null, nowMs: number): string | null {
	const fresh = files.filter((f) => isNewFolderFile(f, nowMs) && (!seenAt || f.addedAt > seenAt));
	if (fresh.length === 0) return null;
	const first = new Date(fresh.reduce((min, f) => (f.addedAt < min ? f.addedAt : min), fresh[0]!.addedAt));
	const now = new Date(nowMs);
	const day = localDay(first);
	const since =
		day === localDay(now)
			? "today"
			: day === localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
				? "since yesterday"
				: `since ${first.toLocaleDateString("en-US", { weekday: "long" })}`;
	return `${fresh.length} new ${fresh.length === 1 ? "file" : "files"} ${since}`;
}
