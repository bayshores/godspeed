import { FieldLabel } from "@/components/lesson/panel-parts";
import { MathBox } from "@/components/math-box";

/**
 * The reading-thinking field: thinking WHILE READING the teaching, the same transfer
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
	/** The check waits closed: Enter opens it. Absent = the check is
	 *  open: Enter is a newline. */
	onOpen?: () => void;
}) {
	return (
		<div data-testid="reading-thinking-field" className="flex flex-1 flex-col">
			<FieldLabel>Thinking while reading</FieldLabel>
			<MathBox
				value={value}
				onChange={onChange}
				onEnter={onOpen}
				placeholder="Whatever comes to mind as you read."
				ariaLabel="Thinking while reading"
			/>
		</div>
	);
}
