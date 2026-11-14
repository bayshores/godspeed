/** Today's "Your spaces": each open space's topics by status, in words, and the new files its linked folder brought. Pure. */
import { isNewFolderFile, localDay, rampColor, type ProgressPayload, type SpaceFile, type StatusCounts } from "@/shared/core";
import { STATUS_LEGEND } from "@/frontend/components/overview/overview-model";

interface Segment {
	key: keyof StatusCounts;
	count: number;
	color: string;
}

interface SpaceRowWords {
	/** The topic bar, strongest first; empty with no topics. */
	segments: Segment[];
	/** "9 strong, 3 shaky, 6 not tested" (the Graph page's words, zeros left out), or why there are no topics yet. */
	line: string;
}

/** A space's row: its topic bar and the counts, or why it has no topics yet. */
export function spaceRow(progress: Pick<ProgressPayload, "overall" | "files" | "facts"> | undefined): SpaceRowWords {
	if (!progress) return { segments: [], line: "Couldn't load its progress." };
	const counts = progress.overall.counts;
	const segments = STATUS_LEGEND.filter((s) => counts[s.key] > 0).map((s) => ({ key: s.key, count: counts[s.key], color: rampColor(s.rate) }));
	if (segments.length > 0) return { segments, line: segments.map((s) => `${s.count} ${STATUS_LEGEND.find((l) => l.key === s.key)!.label}`).join(", ") };
	if (progress.files.length === 0) return { segments, line: "No study files yet." };
	if (progress.facts.length === 0) return { segments, line: "No facts yet. They show up once your agent reads the files." };
	return { segments, line: "Its facts are not grouped into topics yet." };
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
