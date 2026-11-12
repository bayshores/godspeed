"use client";

import { useState } from "react";
import { MOCK_LANGUAGES, RUN_FILE, type CodeQuestion, type MockLanguage, type RunOutcome } from "@/shared/core";
import { CodeEditor } from "@/frontend/components/lesson/code-editor";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { exampleLine } from "./mock-model";
import { postMock } from "./use-mock";

const LANGUAGES = Object.keys(MOCK_LANGUAGES) as MockLanguage[];

/**
 * A code question's answer: the editor (file name, the language pick and
 * Start over above it) over the Examples panel, whose button runs the code
 * on the question's examples on this computer. Remounted for each
 * question, language and Start over, so the editor starts from `code`.
 */
export function CodeAnswer({
	spaceId,
	mockId,
	question,
	language,
	code,
	teacher,
	onCode,
	onLanguage,
	onStartOver,
}: {
	spaceId: string;
	mockId: string;
	question: CodeQuestion;
	language: MockLanguage;
	code: string;
	teacher: string;
	onCode: (code: string) => void;
	onLanguage: (language: MockLanguage) => void;
	onStartOver: () => void;
}) {
	const [typed, setTyped] = useState(code);
	const [erasing, setErasing] = useState(false);
	const [running, setRunning] = useState(false);
	const [outcome, setOutcome] = useState<RunOutcome | null>(null);

	const run = async () => {
		setRunning(true);
		const { error, body } = await postMock(spaceId, mockId, { action: "run", questionId: question.id, code: typed, language });
		setOutcome(error ? { examples: [], error } : (body as RunOutcome));
		setRunning(false);
	};

	const tools = (
		<span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
			<span className="font-mono text-[12.5px] text-ink-3">{RUN_FILE[language]}</span>
			<span role="group" aria-label="Language" className="flex items-center gap-0.5">
				{LANGUAGES.map((l) => (
					<button
						key={l}
						type="button"
						data-testid={`mock-language-${l}`}
						aria-pressed={l === language}
						onClick={() => l !== language && onLanguage(l)}
						className={cn("lh-press rounded-sm px-2 py-0.5 text-[13px] text-ink", l === language ? "bg-highlight" : "hover:bg-tone")}
					>
						{MOCK_LANGUAGES[l]}
					</button>
				))}
			</span>
			{erasing ? (
				<span className="flex items-center gap-1.5 text-[13px] text-ink">
					Erase your {MOCK_LANGUAGES[language]} code?
					<button type="button" data-testid="mock-start-over-yes" onClick={onStartOver} className="lh-btn h-6 px-2 text-[13px]">
						Erase
					</button>
					<button type="button" onClick={() => setErasing(false)} className="lh-btn lh-btn-quiet h-6 text-[13px]">
						Keep
					</button>
				</span>
			) : (
				<button type="button" data-testid="mock-start-over" onClick={() => setErasing(true)} className="lh-btn lh-btn-quiet h-6 text-[13px]">
					Start over
				</button>
			)}
		</span>
	);

	return (
		<>
			<CodeEditor
				initialCode={code}
				language={language}
				fill
				tools={tools}
				onChange={(next) => {
					setTyped(next);
					onCode(next);
				}}
			/>
			<section data-testid="mock-examples" aria-label="Examples" className="flex max-h-[40%] shrink-0 flex-col gap-2.5 overflow-y-auto border-t-2 border-line bg-panel px-5 py-3.5">
				<div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
					<button type="button" data-testid="mock-run-examples" disabled={running} onClick={() => void run()} className="lh-btn shrink-0 bg-background text-[15px]">
						<PixelIcon name="play" />
						{running ? "Running" : "Run examples"}
					</button>
					<p className="min-w-0 flex-1 basis-[260px] text-[15px] leading-snug text-ink-3">
						Your code runs on your own computer. {teacher} checks more cases when the mock ends.
					</p>
				</div>
				{outcome?.error && (
					<pre role="alert" data-testid="mock-run-error" className="overflow-x-auto font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-ans-wrong">
						{outcome.error}
					</pre>
				)}
				{outcome && outcome.examples.length > 0 && (
					<ul data-testid="mock-run-results" className="flex flex-col">
						{outcome.examples.map((e, i) => (
							<li key={i} className="flex items-baseline gap-3.5 border-b border-dotted border-edge py-1.5 text-[15px] last:border-b-0">
								<span className="w-[86px] shrink-0 text-ink">Example {i + 1}</span>
								<span className="min-w-0 flex-1 font-mono text-[13.5px] break-words text-ink-2">{exampleLine(e, question.examples[i]?.expected ?? "")}</span>
								<span className={cn("shrink-0", e.passed ? "text-ans-right" : "text-ans-wrong")}>{e.passed ? "passed" : "not right yet"}</span>
							</li>
						))}
					</ul>
				)}
				{outcome?.printed && (
					<div className="flex flex-col gap-1">
						<p className="text-[15px] text-ink-2">What your code printed</p>
						<pre data-testid="mock-run-printed" className="overflow-x-auto font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-ink">
							{outcome.printed}
						</pre>
					</div>
				)}
			</section>
		</>
	);
}
