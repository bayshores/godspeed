import { useState } from "react";
import { DEFAULT_TEACHER_NAME, MOCK_LANGUAGES, localDay, longDay, minutesUsed, pauseTotal, questionResult, solvedCount, type MockQuestion, type MockView } from "@/shared/core";
import { MessageResponse } from "@/frontend/components/ai-elements/message";
import { useTeacher } from "@/frontend/components/teacher/teacher-provider";
import { useLessonStart } from "@/frontend/components/study-page/use-lesson-start";
import { Key } from "@/frontend/components/ui/key";
import { Pane } from "@/frontend/components/ui/pane";
import { useFold } from "@/frontend/components/use-fold";
import { cn } from "@/frontend/lib/utils";
import { MockBar } from "./mock-bar";
import { RESULT_WORD, pauseLine, spentText, usedLine } from "./mock-model";

/**
 * A GRADED MOCK: each question with how it went, the teacher's feedback
 * and what was written, and "Go over it", which opens a study session on
 * that question. Beside them: how many were right, in how long, and how
 * often it was paused.
 */
export function MockResults({ view }: { view: MockView }) {
	const { spaceId, mock } = view;
	const teacher = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	const lesson = useLessonStart();
	const used = minutesUsed(mock);
	const paused = pauseLine(pauseTotal(mock));
	return (
		<div data-testid="mock-results" className="flex h-full flex-col">
			<MockBar view={view} />
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="lh-page flex flex-wrap items-start gap-(--lh-gap) pt-(--lh-gap) pb-(--lh-page-end)">
					<section className="flex min-w-0 flex-1 basis-[460px] flex-col gap-2">
						<div className="lh-card-head">
							<h2 className="lh-card-title">How Mock {mock.n} went</h2>
							{mock.endedAt && <p className="text-ui text-ink-2">{longDay(localDay(new Date(mock.endedAt)))}</p>}
						</div>
						<ol className="flex flex-col">
							{mock.questions.map((q, i) => (
								<QuestionRow key={q.id} n={i + 1} question={q} view={view} teacher={teacher} busyOn={lesson.busyOn} onGoOver={() => void lesson.goOverMock(mock.id, q.id, spaceId)} />
							))}
						</ol>
					</section>

					<Pane className="lh-card w-full shrink-0 gap-1 sm:sticky sm:top-6 sm:w-[292px]">
						<p data-testid="mock-solved" className="font-count text-3xl leading-tight text-ink">
							{solvedCount(mock)} of {mock.questions.length} right
						</p>
						{used !== null && <p className="text-ui text-ink-2">{usedLine(used, mock.format)}</p>}
						{paused && (
							<p data-testid="mock-pauses" className="text-ui text-ink-2">
								{paused}
							</p>
						)}
						{lesson.error && (
							<p role="alert" className="pt-3 text-ui text-ans-wrong">
								{lesson.error}
							</p>
						)}
					</Pane>
				</div>
			</div>
		</div>
	);
}

/** One question: its number, title, how it went and the time it took;
 *  under them the feedback, what was written, and Go over it. */
function QuestionRow({ n, question: q, view, teacher, busyOn, onGoOver }: { n: number; question: MockQuestion; view: MockView; teacher: string; busyOn: string | null; onGoOver: () => void }) {
	const { mock } = view;
	const result = questionResult(mock, q.id) ?? "blank";
	const answer = mock.answers[q.id];
	const grade = mock.grades?.[q.id];
	const [wroteOpen, setWroteOpen] = useState(false);
	const wrote = useFold(wroteOpen);
	return (
		<li data-testid={`mock-result-${q.id}`} className="flex gap-3.5 px-1 py-4">
			<span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-sm border-[1.5px] border-ink font-count text-lg leading-none text-ink">
				{n}
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-2">
				<div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-0.5">
					<h3 className="min-w-0 flex-1 basis-[200px] text-lg leading-snug text-ink">{q.title}</h3>
					<span data-testid="mock-result-word" className={cn("shrink-0 text-ui", result === "right" ? "text-ans-right" : result === "blank" ? "text-ink-2" : "text-ans-wrong")}>
						{RESULT_WORD[result]}
					</span>
					{answer && answer.seconds > 0 && <span className="shrink-0 text-ui text-ink-2">{spentText(answer.seconds)}</span>}
				</div>
				{grade && (
					<div data-testid="mock-feedback" className="max-w-(--lh-measure) font-prose text-lg leading-relaxed text-ink">
						<MessageResponse>{grade.feedback}</MessageResponse>
					</div>
				)}
				{grade && answer && (
					<div className="text-ui text-ink-2">
						<button type="button" aria-expanded={wroteOpen} onClick={() => setWroteOpen((v) => !v)} className="lh-press cursor-pointer select-none text-left hover:text-ink">
							What you wrote{q.kind === "code" && answer.language ? ` in ${MOCK_LANGUAGES[answer.language]}` : ""}
						</button>
						{wrote.mounted && (
							<div className="lh-collapse" data-state={wrote.state}>
								<div>
									<pre className={cn("mt-1.5 overflow-x-auto lh-well rounded-sm px-3 py-2 leading-relaxed whitespace-pre-wrap text-ink", q.kind === "code" ? "font-mono text-(length:--text-sm)" : "font-prose text-ui")}>{answer.text}</pre>
								</div>
							</div>
						)}
					</div>
				)}
				<Key data-testid="mock-go-over" busy={busyOn === q.id} disabled={busyOn !== null} onClick={onGoOver} className="self-start text-ui">
					Go over it with {teacher}
				</Key>
			</div>
		</li>
	);
}
