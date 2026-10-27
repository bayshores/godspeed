import { FieldLabel, PANEL_FIELD } from "@/components/lesson/panel-parts";

/**
 * The reading-thinking field (owner design 2026-10-03, "two questions per
 * teaching unit"): thinking WHILE READING the teaching, the same transfer
 * channel "Your thinking" gives the answer, opened one step earlier. It
 * fills the Your-turn panel while a teach-phase check waits behind
 * "Check your understanding", rides the check's answer as the separate
 * `readingThinking` channel, and goes with the question.
 */
export function ReadingThinkingField({
	value,
	onChange,
	onOpen,
}: {
	value: string;
	onChange: (v: string) => void;
	/** The check waits closed — Enter opens it (owner, keyboard round
	 *  2026-10-06). Absent = the check is open: Enter is a newline. */
	onOpen?: () => void;
}) {
	return (
		<div data-testid="reading-thinking-field" className="flex min-h-0 flex-1 flex-col">
			<FieldLabel>Thinking while reading</FieldLabel>
			<textarea
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					// Esc stays in the field so the window chain doesn't abort.
					if (e.key === "Escape") {
						e.preventDefault();
						e.stopPropagation();
						return;
					}
					// While the check waits closed, Enter (and ⌘/Ctrl+Enter) opens
					// it; Shift+Enter stays a newline.
					if (e.key === "Enter" && onOpen !== undefined && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						e.stopPropagation();
						onOpen();
						return;
					}
					// No submit of its own: ⌘↵ just blurs.
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						e.currentTarget.blur();
					}
				}}
				placeholder="Whatever comes to mind as you read."
				aria-label="Thinking while reading"
				className={PANEL_FIELD}
			/>
		</div>
	);
}
