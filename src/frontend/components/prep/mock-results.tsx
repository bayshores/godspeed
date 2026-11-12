"use client";

import { DEFAULT_TEACHER_NAME, MOCK_LANGUAGES, minutesUsed, questionResult, solvedCount, type MockQuestion, type MockView } from "@/shared/core";
import { MessageResponse } from "@/frontend/components/ai-elements/message";
import { useHalley } from "@/frontend/components/halley/halley-provider";
import { longDay } from "@/frontend/components/home-page/home-page-model";
import { useLessonStart } from "@/frontend/components/home/use-lesson-start";
import { TITLE } from "@/frontend/components/overview/styles";
import { BIG_BUTTON } from "@/frontend/components/ui/big-button";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { localDay } from "@/shared/core";
import { cn } from "@/frontend/lib/utils";
import { MockBar } from "./mock-bar";
import { RESULT_WORD, fixFirst, spentText } from "./mock-model";
import { useTakeMock } from "./use-mock";

/**
 * A GRADED MOCK: each question with how it went, the teacher's feedback
 * and what was written, and "Go over it", which opens a study session on
 * that question. Beside them: how many were solved, the topics to fix
 * first with the button that studies them, and Take another mock.
 */
export function MockResults({ view }: { view: MockView }) {
	const { spaceId, mock } = view;
	const teacher = useHalley()?.name ?? DEFAULT_TEACHER_NAME;
	const lesson = useLessonStart();
	const another = useTakeMock(spaceId);
	const fix = fixFirst(mock, view.topics);
	const used = minutesUsed(mock);
	const failed = lesson.error ?? another.error;
	return (
		<div data-testid="mock-results" className="flex h-full flex-col">
			<MockBar prepName={view.prepName} n={mock.n} />
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto flex w-full max-w-[908px] flex-wrap items-start gap-x-10 gap-y-8 px-6 pt-7 pb-16">
					<section className="flex min-w-0 flex-1 basis-[460px] flex-col gap-2">
						<div className={cn(TITLE, "flex flex-wrap items-baseline justify-between gap-x-4")}>
							<h2>How Mock {mock.n} went</h2>
							{mock.endedAt && <p className="text-[15px] text-ink-2">{longDay(localDay(new Date(mock.endedAt)))}</p>}
						</div>
						<ol className="flex flex-col">
							{mock.questions.map((q, i) => (
								<QuestionRow key={q.id} n={i + 1} question={q} view={view} teacher={teacher} busy={lesson.busy} onGoOver={() => void lesson.goOverMock(mock.id, q.id, spaceId)} />
							))}
						</ol>
					</section>

					<Pane className="flex w-full shrink-0 flex-col gap-5 px-5 py-5 sm:sticky sm:top-6 sm:w-[292px]">
						<div className="flex flex-col gap-1">
							<p data-testid="mock-solved" className="font-count text-[34px] leading-tight text-ink">
								{solvedCount(mock)} of {mock.questions.length} solved
							</p>
							{used !== null && (
								<p className="text-[15px] text-ink-2">
									in {used} of {mock.format.minutes} minutes
								</p>
							)}
						</div>
						{fix.length > 0 ? (
							<div className="flex flex-col gap-2.5">
								<div className="flex flex-col gap-1">
									<p className="text-[17px] text-ink">Fix these first</p>
									<ul data-testid="mock-fix-first" className="flex flex-col text-[15px] leading-snug text-ink-2">
										{fix.map((t) => (
											<li key={t.id}>{t.name}</li>
										))}
									</ul>
								</div>
								<button type="button" data-testid="mock-study" disabled={lesson.busy} onClick={() => void lesson.studyPrep(fix.map((t) => t.id), spaceId)} className={cn("lh-btn lh-btn-main justify-center", BIG_BUTTON)}>
									<PixelIcon name="play" />
									Study these
								</button>
							</div>
						) : (
							<p className="text-[15px] leading-snug text-ink-2">Nothing on the sheet to fix from this one.</p>
						)}
						<button type="button" data-testid="mock-another" disabled={another.busy} onClick={() => void another.take()} className="lh-btn justify-center text-[15px]">
							Take another mock
						</button>
						{failed && (
							<p role="alert" className="text-[15px] text-ans-wrong">
								{failed}
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
function QuestionRow({ n, question: q, view, teacher, busy, onGoOver }: { n: number; question: MockQuestion; view: MockView; teacher: string; busy: boolean; onGoOver: () => void }) {
	const { mock } = view;
	const result = questionResult(mock, q.id) ?? "blank";
	const answer = mock.answers[q.id];
	const grade = mock.grades?.[q.id];
	return (
		<li data-testid={`mock-result-${q.id}`} className="flex gap-3.5 border-b border-dotted border-edge px-1 py-4 last:border-b-0">
			<span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-sm border-[1.5px] border-ink font-count text-lg leading-none text-ink">
				{n}
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-2">
				<div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-0.5">
					<h3 className="min-w-0 flex-1 basis-[200px] text-lg leading-snug text-ink">{q.title}</h3>
					<span data-testid="mock-result-word" className={cn("shrink-0 text-[15px]", result === "right" ? "text-ans-right" : result === "blank" ? "text-ink-2" : "text-ans-wrong")}>
						{RESULT_WORD[result]}
					</span>
					{answer && answer.seconds > 0 && <span className="shrink-0 text-[15px] text-ink-2">{spentText(answer.seconds)}</span>}
				</div>
				{grade && (
					<div data-testid="mock-feedback" className="font-prose text-[16px] leading-relaxed text-ink">
						<MessageResponse>{grade.feedback}</MessageResponse>
					</div>
				)}
				{grade && answer && (
					<details className="text-[15px] text-ink-2">
						<summary className="lh-press cursor-pointer select-none hover:text-ink">What you wrote{q.kind === "code" && answer.language ? ` in ${MOCK_LANGUAGES[answer.language]}` : ""}</summary>
						<pre className={cn("mt-1.5 overflow-x-auto rounded-sm border border-border bg-background px-3 py-2 leading-relaxed whitespace-pre-wrap text-ink", q.kind === "code" ? "font-mono text-[13.5px]" : "font-prose text-[15px]")}>{answer.text}</pre>
					</details>
				)}
				<button type="button" data-testid="mock-go-over" disabled={busy} onClick={onGoOver} className="lh-btn self-start text-[15px]">
					Go over it with {teacher}
				</button>
			</div>
		</li>
	);
}
