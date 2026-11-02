/**
 * A lecture recording finds the transcript already in its class by date,
 * or by lecture number when a name has no date (the real CSE 21 names).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recordingsToRecheck, transcriptFor } from "../src/core/lecture-transcript.ts";

type Kind = "study" | "info";
const f = (id: string, name: string, kind: Kind = "study") => ({ id, name, kind });
const REC = f("rec", "CSE21_Lecture_01_2026-09-25.mp4");

describe("a recording's transcript", () => {
	it("matches captions or a transcript PDF with the same date, captions first", () => {
		const pdf = f("pdf", "CSE 21 Lecture 01 (2026-09-25) transcript.pdf");
		const srt = f("srt", "Lecture01_2026-09-25.srt");
		assert.equal(transcriptFor(REC, [REC, pdf])?.id, "pdf");
		assert.equal(transcriptFor(REC, [REC, pdf, srt])?.id, "srt");
	});

	it("ignores other days, slides, other recordings and course info", () => {
		const files = [
			REC,
			f("other", "Lecture02_2026-09-28.srt"),
			f("slides", "2026-09-25 Intro and Counting (lecture slides).pdf"),
			f("video", "CSE21_Lecture_01_2026-09-25 (copy).mp4"),
			f("info", "Lecture01_2026-09-25.srt", "info"),
		];
		assert.equal(transcriptFor(REC, files), null);
	});

	it("matches by lecture number when a name has no date", () => {
		const rec = f("rec", "Lecture 3.mp4");
		assert.equal(transcriptFor(rec, [rec, f("t", "lecture_03 transcript.txt")])?.id, "t");
		assert.equal(transcriptFor(rec, [rec, f("t", "Lecture 4 transcript.txt")]), null);
		assert.equal(transcriptFor(rec, [rec, f("t", "week 3 transcript.txt")]), null, "needs \"lecture\" in both names");
	});

	it("rechecks a recording whose transcript went, or a settled one a new transcript covers", () => {
		const srt = { ...f("srt", "Lecture01_2026-09-25.srt"), status: "ready" as const };
		const covered = { ...REC, status: "ready" as const, transcriptId: "srt" };
		assert.deepEqual(recordingsToRecheck([covered, srt]), []);
		assert.deepEqual(recordingsToRecheck([covered]), ["rec"], "its transcript was removed");
		assert.deepEqual(recordingsToRecheck([covered, { ...srt, kind: "info" as const }]), ["rec"], "its transcript became course info");
		assert.deepEqual(recordingsToRecheck([{ ...REC, status: "ready" as const }, srt]), ["rec"], "transcribed before its transcript came");
		assert.deepEqual(recordingsToRecheck([{ ...REC, status: "failed" as const }, srt]), ["rec"]);
		assert.deepEqual(recordingsToRecheck([{ ...REC, status: "pending" as const }, srt]), [], "a waiting one sees it on its turn");
		assert.deepEqual(recordingsToRecheck([{ ...REC, status: "extracting" as const }, srt]), []);
	});

	it("only for a study recording", () => {
		const srt = f("srt", "Lecture01_2026-09-25.srt");
		assert.equal(transcriptFor({ ...REC, kind: "info" as const }, [srt]), null);
		assert.equal(transcriptFor(f("pdf", "Lecture01_2026-09-25 notes.pdf"), [srt]), null, "not a recording");
	});
});
