import { useEffect, useRef, useState } from "react";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { useEnterSubmits } from "@/components/enter-submits";
import { cn } from "@/lib/utils";
import { buildCodeAnswer, codeLanguage, type QuestionAnswerData, type QuestionFormDraft, type WriteCodeInput } from "@/core";
import { CodeEditor } from "./code-editor";
import { ActionBar, FieldLabel, KindChip, PANEL_FIELD, PanelBody, PanelHeader, HeaderChip, fieldKeys, skipExit } from "./panel-parts";

/** The task in lesson prose, 18px in the full text color (the question
 *  panel's size). */
const TASK_PROSE = {
	"--lh-prose-size": "18px",
	"--lh-prose-leading": `${25 / 18}`,
	"--lh-ink-body": "var(--foreground)",
	"--lh-ink-strong": "var(--foreground)",
	"--lh-ink-italic": "var(--foreground)",
} as React.CSSProperties;

/**
 * A write_code question in the Your-turn panel: the task, the code editor
 * (starting with the teacher's starter code), "I don't know", the
 * learner's thinking, and Submit. Nothing is graded here: the code goes
 * to the teacher, who grades it in the next reply.
 */
export function CodeQuestion({
	toolName,
	input,
	onSubmit,
	initialDraft,
	onSaveDraft,
	onSkip,
	compactionRunning = false,
	footer,
}: {
	toolName: string;
	input: WriteCodeInput;
	onSubmit: (output: QuestionAnswerData) => void;
	/** The form as the learner left it: the code rides `text` (empty while it is still the starter code). */
	initialDraft?: QuestionFormDraft;
	/** Called on every change, so the code survives leaving the lesson. */
	onSaveDraft?: (draft: QuestionFormDraft) => void;
	onSkip?: () => void;
	compactionRunning?: boolean;
	footer?: React.ReactNode;
}) {
	const language = codeLanguage(input.language);
	const starter = input.starter ?? "";
	const [initialCode] = useState(() => initialDraft?.text || starter);
	const [code, setCode] = useState(initialCode);
	const [dontKnow, setDontKnow] = useState(initialDraft?.selection.dontKnow ?? false);
	const [thinking, setThinking] = useState(initialDraft?.thinking ?? "");
	const canSubmit = dontKnow || code.trim().length > 0;

	// Every change is saved; untouched starter code is not a draft.
	const saveDraftRef = useRef(onSaveDraft);
	saveDraftRef.current = onSaveDraft;
	useEffect(() => {
		saveDraftRef.current?.({ selection: { selected: new Set(), otherSelected: false, dontKnow }, thinking, other: "", text: code === starter ? "" : code });
	}, [code, dontKnow, thinking, starter]);

	const submit = () => {
		if (!canSubmit || compactionRunning) return;
		onSubmit(buildCodeAnswer(input, { code, dontKnow, thinking }, toolName));
	};
	// Enter outside the editor and the fields submits, like every question.
	useEnterSubmits(submit);

	return (
		<form
			data-testid="question-dock"
			data-kind="code"
			className="flex min-h-0 flex-1 flex-col"
			onSubmit={(e) => {
				e.preventDefault();
				submit();
			}}
		>
			<PanelBody>
				<PanelHeader
					eyebrow="Your turn"
					right={
						<HeaderChip exit={skipExit(onSkip)}>
							<KindChip testId="question-kind">Code</KindChip>
						</HeaderChip>
					}
				/>
				<div data-session-find-root="" className="mt-3 shrink-0 font-bold text-ink" style={TASK_PROSE}>
					<ToolContentResponse>{input.question}</ToolContentResponse>
				</div>
				<div className="mt-4 shrink-0">
					<CodeEditor
						initialCode={initialCode}
						language={language}
						dimmed={dontKnow}
						onChange={(next) => {
							setCode(next);
							// Writing code means he's trying after all.
							setDontKnow(false);
						}}
					/>
				</div>
				<button
					type="button"
					data-testid="dont-know-option"
					aria-pressed={dontKnow}
					onClick={() => setDontKnow((v) => !v)}
					className={cn(
						"lh-press mt-2 flex w-full shrink-0 items-center gap-3 px-3.5 py-2.5 text-left outline-none transition-colors duration-(--lh-dur) ease-(--lh-ease-out)",
						dontKnow ? "bg-ink font-bold text-background" : "text-ink-2 hover:bg-tone",
					)}
				>
					<span aria-hidden className={cn("size-6 shrink-0", dontKnow ? "bg-background" : "outline outline-1 -outline-offset-1 outline-tone-2")} />
					<span className="text-[15px]">I don't know</span>
				</button>
				<div className="mt-[18px] flex min-h-0 flex-1 flex-col" data-testid="thinking-field">
					<FieldLabel>Your thinking</FieldLabel>
					<textarea
						value={thinking}
						onChange={(e) => setThinking(e.target.value)}
						onKeyDown={(e) => fieldKeys(e, submit)}
						placeholder="Why this answer? Whatever comes to mind."
						aria-label="Your thinking"
						className={PANEL_FIELD}
					/>
				</div>
				{footer}
			</PanelBody>
			<ActionBar
				type="submit"
				testId="question-submit"
				label={compactionRunning ? "Summarizing the lesson…" : "Submit answer"}
				disabled={!canSubmit || compactionRunning}
			/>
		</form>
	);
}
