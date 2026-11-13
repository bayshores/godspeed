import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_TEACHER_NAME, secondsLeft, starterCode, type Mock, type MockLanguage, type MockQuestion, type MockView } from "@/shared/core";
import { MessageResponse } from "@/frontend/components/ai-elements/message";
import { useHalley } from "@/frontend/components/halley/halley-provider";
import { TITLE } from "@/frontend/components/overview/styles";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { CodeAnswer } from "./mock-answer";
import { MockBar } from "./mock-bar";
import { MOCK_LANGUAGE_KEY, answerOf, clockText, exampleCall, nextOpen, parseMockLanguage, workOf, type Work } from "./mock-model";
import { postMock } from "./use-mock";

/** How often what is typed is saved. */
const SAVE_EVERY_MS = 4000;

function readLanguage(): MockLanguage {
	try {
		return parseMockLanguage(localStorage.getItem(MOCK_LANGUAGE_KEY));
	} catch {
		return "javascript";
	}
}

/**
 * THE MOCK WHILE ITS CLOCK RUNS: the question on the left, the answer on
 * the right (an editor with Run examples, or a writing box). The bar holds
 * the questions, the time left and End mock. What is typed is saved every
 * few seconds and on every move; the teacher is not asked anything until
 * the mock ends, by the button or the clock.
 */
export function MockRun({ view }: { view: MockView }) {
	const { spaceId, mock } = view;
	const questions = mock.questions;
	const teacher = useHalley()?.name ?? DEFAULT_TEACHER_NAME;
	const [works, setWorks] = useState<Record<string, Work>>(() => {
		const preferred = readLanguage();
		return Object.fromEntries(questions.map((q) => [q.id, workOf(q, mock.answers[q.id], preferred)]));
	});
	const [at, setAt] = useState(() => Math.max(0, questions.findIndex((q) => !mock.answers[q.id]?.submitted)));
	const [resets, setResets] = useState(0);
	const [confirmEnd, setConfirmEnd] = useState(false);
	const [ending, setEnding] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const worksRef = useRef(works);
	const atRef = useRef(at);
	const openedAt = useRef(Date.now());
	const dirty = useRef(false);

	const question = questions[at]!;
	const work = works[question.id]!;

	/** Change the open question's work; `patch` is saved with the time
	 *  spent on it since it was last counted. */
	const save = useCallback(
		async (patch: Partial<Work> = {}) => {
			const q = questions[atRef.current]!;
			const now = Date.now();
			const before = worksRef.current[q.id]!;
			const next: Work = { ...before, ...patch, seconds: before.seconds + (now - openedAt.current) / 1000 };
			openedAt.current = now;
			worksRef.current = { ...worksRef.current, [q.id]: next };
			setWorks(worksRef.current);
			dirty.current = false;
			const sent = await postMock(spaceId, mock.id, { action: "answer", questionId: q.id, ...answerOf(q, next) });
			setError(sent.error ? `Your answer wasn't saved: ${sent.error}` : null);
		},
		[spaceId, mock.id, questions],
	);

	const change = (patch: Partial<Work>) => {
		worksRef.current = { ...worksRef.current, [question.id]: { ...worksRef.current[question.id]!, ...patch } };
		setWorks(worksRef.current);
		dirty.current = true;
	};

	useEffect(() => {
		const timer = setInterval(() => {
			if (dirty.current) void save();
		}, SAVE_EVERY_MS);
		return () => {
			clearInterval(timer);
			// Leaving the page: keep what was typed since the last save.
			if (dirty.current) void save();
		};
	}, [save]);

	const go = (i: number) => {
		void save();
		atRef.current = i;
		setAt(i);
	};

	const submitted = questions.map((q) => works[q.id]!.submitted);
	const notSubmitted = submitted.filter((s) => !s).length;

	const submit = () => {
		void save({ submitted: true });
		const next = nextOpen(submitted.map((s, i) => s || i === at), at);
		if (next === null) setConfirmEnd(true);
		else {
			atRef.current = next;
			setAt(next);
		}
	};

	const end = useCallback(async () => {
		setEnding(true);
		await save();
		const ended = await postMock(spaceId, mock.id, { action: "end" });
		// On success the page reads the mock again and leaves this screen.
		if (ended.error) {
			setEnding(false);
			setError(`The mock didn't end: ${ended.error}`);
		}
	}, [spaceId, mock.id, save]);

	const pickLanguage = (language: MockLanguage) => {
		try {
			localStorage.setItem(MOCK_LANGUAGE_KEY, language);
		} catch {
			/* private window: not remembered */
		}
		change({ language });
	};

	return (
		<div data-testid="mock-run" className="flex h-full flex-col">
			<MockBar prepName={view.prepName} n={mock.n}>
				<ol data-testid="mock-questions" className="flex min-w-0 items-center gap-1.5">
					{questions.map((q, i) => (
						<li key={q.id}>
							<button
								type="button"
								data-testid={`mock-question-${i + 1}`}
								aria-current={i === at || undefined}
								aria-label={`Question ${i + 1}${submitted[i] ? ", submitted" : ""}`}
								title={q.title}
								onClick={() => go(i)}
								className={cn(
									"lh-press flex h-8 min-w-8 items-center justify-center gap-1 rounded-sm border-[1.5px] border-bar-ink px-1.5 font-count text-lg leading-none",
									i === at ? "bg-bar-ink text-bar" : "text-bar-ink hover:bg-bar-ink/15",
								)}
							>
								{i + 1}
								{submitted[i] && <PixelIcon name="check" className="h-[7px]" />}
							</button>
						</li>
					))}
				</ol>
				<div className="flex-1" aria-hidden />
				<Clock mock={mock} onTimeUp={end} />
				<button type="button" data-testid="mock-end" disabled={ending} onClick={() => setConfirmEnd(true)} className="lh-btn lh-btn-bar">
					End mock
				</button>
			</MockBar>
			{confirmEnd && (
				<div role="alertdialog" aria-label="End the mock" data-testid="mock-end-confirm" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b-2 border-line bg-highlight px-6 py-2.5 text-[15px] text-ink">
					<p className="min-w-0 flex-1">
						{notSubmitted === 0 ? `All ${questions.length} are submitted.` : `${notSubmitted} of ${questions.length} ${notSubmitted === 1 ? "is" : "are"} not submitted.`} End Mock {mock.n} now? {teacher} grades
						what you have written.
					</p>
					<button type="button" data-testid="mock-end-keep" onClick={() => setConfirmEnd(false)} className="lh-btn text-[15px]">
						Keep going
					</button>
					<button type="button" data-testid="mock-end-yes" disabled={ending} onClick={() => void end()} className="lh-btn lh-btn-main text-[15px]">
						End mock
					</button>
				</div>
			)}
			<div className="flex min-h-0 flex-1">
				<QuestionPanel key={question.id} question={question} n={at + 1} teacher={teacher} />
				<div className="flex min-w-0 flex-1 flex-col bg-background">
					{question.kind === "code" ? (
						<CodeAnswer
							key={`${question.id}-${work.language}-${resets}`}
							spaceId={spaceId}
							mockId={mock.id}
							question={question}
							language={work.language}
							code={work.code[work.language]}
							teacher={teacher}
							onCode={(code) => change({ code: { ...worksRef.current[question.id]!.code, [work.language]: code } })}
							onLanguage={pickLanguage}
							onStartOver={() => {
								change({ code: { ...work.code, [work.language]: starterCode(question.fn, work.language) } });
								setResets((n) => n + 1);
							}}
						/>
					) : (
						<textarea
							key={question.id}
							data-testid="mock-text-answer"
							aria-label="Your answer"
							value={work.text}
							onChange={(e) => change({ text: e.target.value })}
							placeholder="Write your answer here."
							className="min-h-0 flex-1 resize-none bg-background px-7 py-6 font-prose text-[17px] leading-relaxed text-ink placeholder:text-ink-3 focus:outline-none"
						/>
					)}
					<div className="flex shrink-0 flex-wrap items-center justify-end gap-2.5 border-t-2 border-line bg-panel px-5 py-3">
						{error && (
							<p role="alert" className="min-w-0 flex-1 text-[15px] text-ans-wrong">
								{error}
							</p>
						)}
						{questions.length > 1 && (
							<button type="button" data-testid="mock-skip" onClick={() => go(nextOpen(submitted, at) ?? (at + 1) % questions.length)} className="lh-btn text-[15px]">
								{work.submitted ? "Next question" : "Skip for now"}
							</button>
						)}
						<button type="button" data-testid="mock-submit" disabled={work.submitted} onClick={submit} className="lh-btn lh-btn-main text-[15px]">
							{work.submitted ? "Submitted" : "Submit answer"}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

/** The time left, counted each second; calls `onTimeUp` once at zero. */
function Clock({ mock, onTimeUp }: { mock: Mock; onTimeUp: () => void }) {
	const [left, setLeft] = useState(() => secondsLeft(mock, Date.now()));
	const fired = useRef(false);
	useEffect(() => {
		const tick = () => {
			const now = secondsLeft(mock, Date.now());
			setLeft(now);
			if (now === 0 && !fired.current) {
				fired.current = true;
				onTimeUp();
			}
		};
		tick();
		const timer = setInterval(tick, 1000);
		return () => clearInterval(timer);
	}, [mock, onTimeUp]);
	return (
		<span data-testid="mock-clock" role="timer" className="shrink-0 font-count text-xl">
			{clockText(left)} left
		</span>
	);
}

/** The question: its number and title, the statement, and a code
 *  question's examples as calls. */
function QuestionPanel({ question: q, n, teacher }: { question: MockQuestion; n: number; teacher: string }) {
	return (
		<section data-testid="mock-question" className="flex w-[42%] max-w-[520px] min-w-[320px] shrink-0 flex-col gap-4 overflow-y-auto border-r-2 border-line px-7 py-6">
			<h2 className={TITLE}>
				Question {n}: {q.title}
			</h2>
			<div className="font-prose text-[17px] leading-relaxed text-ink">
				<MessageResponse>{q.statement}</MessageResponse>
			</div>
			{q.kind === "code" &&
				q.examples.map((e, i) => (
					<div key={i} className="flex flex-col gap-1">
						<p className="text-[15px] text-ink-2">Example {i + 1}</p>
						<pre className="overflow-x-auto rounded-sm border border-border bg-background px-3 py-2 font-mono text-[13.5px] leading-relaxed text-ink">
							{exampleCall(q.fn, e.args)}
							{"\n"}returns {e.expected}
						</pre>
					</div>
				))}
			<p className="mt-auto pt-4 text-[15px] text-ink-3">{teacher} stays quiet until the mock ends.</p>
		</section>
	);
}
