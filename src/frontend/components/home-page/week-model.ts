/** Today's "This week": the local days from Monday to Sunday with an answer in any open space. Pure. */
import { localDay, type ProgressPayload } from "@/shared/core";
import { joinAnd } from "@/frontend/components/overview/overview-model";

interface WeekDay {
	/** YYYY-MM-DD, local. */
	day: string;
	/** "Monday". */
	name: string;
	/** At least one answer that day. */
	studied: boolean;
	today: boolean;
}

interface Week {
	/** Monday first. */
	days: WeekDay[];
	/** "You studied 4 days this week and answered 31 questions." */
	sentence: string;
	/** What the squares show, for a screen reader. */
	label: string;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The week holding `nowMs`, from every space's answers. A lesson listed
 *  twice counts once. */
export function weekStrip(payloads: readonly Pick<ProgressPayload, "lessons">[], nowMs: number): Week {
	const now = new Date(nowMs);
	const monday = now.getDate() - ((now.getDay() + 6) % 7);
	const dates = Array.from({ length: 7 }, (_, i) => new Date(now.getFullYear(), now.getMonth(), monday + i));
	const answersOn = new Map(dates.map((date) => [localDay(date), 0]));
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
	const today = localDay(nowMs);
	const days = dates.map((date): WeekDay => {
		const day = localDay(date);
		return { day, name: date.toLocaleDateString("en-US", { weekday: "long" }), studied: answersOn.get(day)! > 0, today: day === today };
	});
	const studied = days.filter((d) => d.studied);
	const answers = [...answersOn.values()].reduce((sum, n) => sum + n, 0);
	if (answers === 0) return { days, sentence: "No studying yet this week.", label: "No days studied yet this week." };
	return {
		days,
		sentence: `You studied ${plural(studied.length, "day")} this week and answered ${plural(answers, "question")}.`,
		label: `You studied on ${joinAnd(studied.map((d) => d.name))}.`,
	};
}
