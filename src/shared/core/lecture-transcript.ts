/**
 * A lecture recording whose transcript is already in the class: it isn't
 * transcribed again (hours of the computer's time) and its facts come from
 * the transcript. Purely from names, like core/file-series.ts.
 */
import { FILE_NOT_FOUND, isRecordingFile, isTranscriptFile, type ClassFile } from "./contracts.ts";
import { dateInName } from "./file-series.ts";

type Named = Pick<ClassFile, "id" | "name" | "kind">;

const LECTURE_NUMBER = /lecture[\s_\-.]*0*(\d+)/i;

/** Captions, or another file (a PDF, notes) whose name says "transcript". */
const readsAsTranscript = (name: string) => isTranscriptFile(name) || (!isRecordingFile(name) && /transcript/i.test(name));
const lectureOf = (name: string) => {
	const m = LECTURE_NUMBER.exec(name);
	return m ? Number(m[1]) : null;
};

/**
 * The study transcript that covers a study recording: a .srt/.vtt file or
 * a file whose name says "transcript", with the same date in its name (and
 * not another lecture number), or, when either name has no date, the same
 * lecture number.
 * Captions win over other transcripts; then name order. Null when none.
 */
export function transcriptFor<F extends Named>(recording: Named, files: readonly F[]): F | null {
	if (recording.kind !== "study" || !isRecordingFile(recording.name)) return null;
	const date = dateInName(recording.name);
	const lecture = lectureOf(recording.name);
	const matches = files.filter((f) => {
		if (f.id === recording.id || f.kind !== "study" || !readsAsTranscript(f.name)) return false;
		const other = dateInName(f.name);
		const otherLecture = lectureOf(f.name);
		// A day's office hours aren't that day's lecture.
		if (date && other) return date === other && (lecture === null || otherLecture === null || lecture === otherLecture);
		return lecture !== null && lecture === otherLecture;
	});
	matches.sort((a, b) => Number(isTranscriptFile(b.name)) - Number(isTranscriptFile(a.name)) || a.name.localeCompare(b.name));
	return matches[0] ?? null;
}

/**
 * Recordings to process again after the file list changed: one whose
 * transcript left (or became course info) is transcribed after all, and a
 * settled one a newly added transcript covers drops its own facts. Files
 * still waiting or being read see the change when their turn comes, and a
 * recording that is gone waits for the folder scan.
 */
export function recordingsToRecheck(files: readonly Pick<ClassFile, "id" | "name" | "kind" | "status" | "transcriptId" | "error">[]): string[] {
	return files
		.filter((f) =>
			f.transcriptId
				? !files.some((t) => t.id === f.transcriptId && t.kind === "study")
				: f.status !== "pending" && f.status !== "extracting" && f.error !== FILE_NOT_FOUND && transcriptFor(f, files) !== null,
		)
		.map((f) => f.id);
}
