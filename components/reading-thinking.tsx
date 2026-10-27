"use client";

/**
 * The reading-thinking field (owner design 2026-10-03, "two questions per
 * teaching unit"): a quiet textarea for thinking WHILE READING the
 * teaching prose — the same transfer channel the question dock's "Your
 * thinking" gives the answer, opened one phase earlier. It mounts while a
 * teach-phase check waits behind its reveal (the same cue that collapses
 * the check), rides the check answer as the SEPARATE `readingThinking`
 * channel (never conflated with the quiz thinking), and disappears with
 * the question.
 */
export function ReadingThinkingField({
	value,
	onChange,
	onOpen,
}: {
	value: string;
	onChange: (v: string) => void;
	/** The check waits CLOSED — Enter opens it (owner, keyboard round
	 *  2026-10-06). Absent = the check is open: Enter keeps the dumping
	 *  convention. */
	onOpen?: () => void;
}) {
	return (
		<div
			data-testid="reading-thinking-field"
			className="pointer-events-auto mb-2 rounded-2xl border bg-card/60 px-3 py-2 transition-colors focus-within:border-primary/50"
		>
			<div className="pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				Thinking while reading
			</div>
			<textarea
				value={value}
				onChange={(e) => onChange(e.target.value)}
				/* py-0.5 (owner round, 2026-10-07): the scrollbar fix. Source
				   Sans 3's font box is 22px at 16px; lh-input's 1.25 leading
				   gives a 20px line box — the content area sticks 1px below the
				   line, Chromium counts it in scrollHeight, and a zero-padding
				   textarea turns that into a permanent 1px scroll (the bar shows
				   empty and at every size below max-h). 2px of vertical padding
				   absorbs it — the same absorption the composer and dock fields
				   get implicitly from their py-2. Line-height stays 1.25 (the
				   caret law, typography round 2). */
				onKeyDown={(e) => {
					// Esc in the field is the field's — claimed so the window
					// chain doesn't read it as abort-turn.
					if (e.key === "Escape") {
						e.preventDefault();
						e.stopPropagation();
						return;
					}
					// ENTER OPENS THE WAITING CHECK (owner, keyboard round
					// 2026-10-06): while the check sits closed, plain Enter
					// (and the universal ⌘/Ctrl+Enter) opens it. Shift+Enter
					// stays a newline.
					if (e.key === "Enter" && onOpen !== undefined && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						e.stopPropagation();
						onOpen();
						return;
					}
					// The dock's dumping convention: plain Enter is a newline.
					// No submit button here — the check's own submit is this
					// field's carrier — so ⌘↵ just blurs.
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						e.currentTarget.blur();
					}
				}}
				placeholder="Whatever comes to mind as you read."
				rows={1}
				className="field-sizing-content lh-input max-h-40 w-full resize-none bg-transparent py-0.5 outline-none placeholder:text-muted-foreground/70"
			/>
		</div>
	);
}
