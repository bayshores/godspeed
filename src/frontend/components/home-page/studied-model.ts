/** Today's line on studying: the days of the last 7 (today and the six
 *  before) with an answer in any open space or in a lesson with no space,
 *  and the answers. Pure. */
import { localDay, type ProgressPayload } from "@/shared/core";
import { plural } from "@/frontend/lib/plural";

/** "You studied 4 of the last 7 days and answered 31 questions." A lesson
 *  listed twice counts once. */
export function studiedLine(payloads: readonly Pick<ProgressPayload, "lessons">[], nowMs: number): string {
	const now = new Date(nowMs);
	const answersOn = new Map(Array.from({ length: 7 }, (_, i) => [localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)), 0]));
	for (const payload of payloads) {
		const seen = new Set<string>();
		for (const lesson of payload.lessons) {
			if (seen.has(lesson.chatId)) continue;
			seen.add(lesson.chatId);
			for (const answer of lesson.answers) {
				const day = localDay(new Date(answer.answeredAt));
				const count = answersOn.get(day);
				if (count !== undefined) answersOn.set(day, count + 1);
			}
		}
	}
	const counts = [...answersOn.values()];
	const answers = counts.reduce((sum, n) => sum + n, 0);
	if (answers === 0) return "No studying in the last 7 days.";
	return `You studied ${counts.filter((n) => n > 0).length} of the last 7 days and answered ${plural(answers, "question")}.`;
}
