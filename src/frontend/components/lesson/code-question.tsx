import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { buildCodeAnswer, codeLanguage, type QuestionAnswerData, type QuestionFormDraft, type WriteCodeInput } from "@/shared/core";
import type { QuestionHandle } from "@/frontend/components/question-dock";
import { CodeEditor } from "./code-editor";
import { QuestionText } from "./question-parts";

/**
 * A write_code question above the lesson's writing row: the task and the
 * code editor (starting with the teacher's starter code), which fills the room left. The writing box
 * under it holds the reasoning. Nothing is graded
 * here: the code goes to the teacher, who grades it in the next reply.
 */
export function CodeQuestion({
	toolName,
	tag,
	input,
	onSubmit,
	initialDraft,
	onSaveDraft,
	onReady,
	boxText,
	busy = false,
	ref,
}: {
	toolName: string;
	/** The question's kind in a word, set after its text. */
	tag: string | null;
	input: WriteCodeInput;
	onSubmit: (output: QuestionAnswerData) => void;
	/** The form as the learner left it (`code` is empty while it is still the starter code). */
	initialDraft?: QuestionFormDraft;
	/** Called on every change, so the code survives leaving the lesson. */
	onSaveDraft?: (draft: QuestionFormDraft) => void;
	/** Whether there is code to submit. */
	onReady: (ready: boolean) => void;
	/** The reasoning in the writing box. */
	boxText: string;
	busy?: boolean;
	ref?: React.Ref<QuestionHandle>;
}) {
	const language = codeLanguage(input.language);
	const starter = input.starter ?? "";
	const [initialCode] = useState(() => initialDraft?.code || starter);
	const [code, setCode] = useState(initialCode);
	const canSubmit = code.trim().length > 0;

	// Every change is saved; untouched starter code is not a draft.
	const saveDraftRef = useRef(onSaveDraft);
	saveDraftRef.current = onSaveDraft;
	useEffect(() => {
		saveDraftRef.current?.({ selection: { selected: new Set() }, code: code === starter ? "" : code });
	}, [code, starter]);

	const readyRef = useRef(onReady);
	readyRef.current = onReady;
	useEffect(() => {
		readyRef.current(canSubmit);
		return () => readyRef.current(false);
	}, [canSubmit]);

	useImperativeHandle(ref, () => ({
		submit() {
			if (!canSubmit || busy) return;
			onSubmit(buildCodeAnswer(input, { code, dontKnow: false, thinking: boxText }, toolName));
		},
		dontKnow() {
			if (!busy) onSubmit(buildCodeAnswer(input, { code, dontKnow: true, thinking: boxText }, toolName));
		},
		// The editor never folds away.
		fold() {},
		picked: () => [],
	}));

	return (
		<div data-testid="question-dock" data-kind="code" className="flex flex-1 flex-col gap-6">
			<QuestionText tag={tag}>{input.question}</QuestionText>
			{/* The editor takes the room the page has left (globals.css), and never less than a few lines. */}
			<div className="flex min-h-[260px] flex-1 flex-col">
				<CodeEditor initialCode={initialCode} language={language} onChange={setCode} />
			</div>
		</div>
	);
}
