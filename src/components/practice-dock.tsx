import { useRef, useState } from "react";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { useEnterSubmits } from "@/components/enter-submits";
import { ActionBar, FieldLabel, KindChip, PANEL_FIELD, PanelBody, PanelHeader } from "@/components/lesson/panel-parts";

/**
 * THE PRACTICE PANEL (redesign, practice lesson): an active problem fills
 * the Your-turn panel — "Your turn" with "Problem 3", the statement, and
 * "Your thinking" with one Send (Enter sends, Shift+Enter is a newline).
 * Whether a submission claims an answer is read from the thinking by the
 * agent; one problem may take many submissions, each starting a turn.
 *
 * The commitment (modelSolution, …) rides the call's arguments and never
 * renders here — only the statement is the learner's. Esc dismisses the
 * problem through the page's layered-Esc chain, not here.
 */
interface PracticeDockProps {
	/** The active problem's tool-call id (submissions target it). */
	problemCallId: string;
	/** The pose's arguments — only the statement is the learner's. */
	input: { statement: string };
	/** The problem's number in this lesson ("Problem 3"). */
	number?: number | null;
	/** text — POST {type:"thinking"} (one lane). */
	onSubmit: (text: string) => void;
	/** Compaction is running: the POST would block on the server's gate. */
	compactionRunning?: boolean;
	/** A quiet row under the field (the lesson's stats). */
	footer?: React.ReactNode;
}

export function PracticeDock({ problemCallId, input, number, onSubmit, compactionRunning = false, footer }: PracticeDockProps) {
	const [thinking, setThinking] = useState("");
	// The ref mirrors the field: the window-level Enter reads the current trace.
	const thinkingRef = useRef("");

	const submit = () => {
		if (compactionRunning) return;
		const text = thinkingRef.current.trim();
		if (text.length === 0) return;
		thinkingRef.current = "";
		setThinking("");
		onSubmit(text);
	};

	// Enter submits from anywhere outside a typing surface (owner round 6).
	useEnterSubmits(submit);

	return (
		<form
			data-testid="practice-dock"
			data-problem={problemCallId}
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
						<KindChip testId="problem-number">
							<span className="text-[12.5px] font-bold text-ink-2">{number ? `Problem ${number}` : "Problem"}</span>
						</KindChip>
					}
				/>
				<div
					data-session-find-root=""
					data-testid="practice-statement"
					className="mt-3 shrink-0 font-bold text-ink"
					style={{ "--lh-prose-size": "18px", "--lh-prose-leading": `${25 / 18}`, "--lh-ink-body": "var(--foreground)" } as React.CSSProperties}
				>
					<ToolContentResponse>{input.statement}</ToolContentResponse>
				</div>
				<div data-testid="practice-thinking-field" className="mt-5 flex min-h-0 flex-1 flex-col">
					<FieldLabel>Your thinking</FieldLabel>
					<textarea
						value={thinking}
						onChange={(e) => {
							thinkingRef.current = e.target.value;
							setThinking(e.target.value);
						}}
						onKeyDown={(e) => {
							// Esc stays in the field so the window chain doesn't fire.
							if (e.key === "Escape") {
								e.preventDefault();
								e.stopPropagation();
								return;
							}
							if (e.key === "Enter" && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
								e.preventDefault();
								submit();
							}
						}}
						placeholder="Work here, think out loud."
						aria-label="Your thinking"
						className={PANEL_FIELD}
					/>
				</div>
				{footer}
			</PanelBody>
			<ActionBar
				type="submit"
				testId="practice-send"
				label={compactionRunning ? "Compacting the lesson…" : "Send"}
				disabled={thinking.trim().length === 0 || compactionRunning}
			/>
		</form>
	);
}
