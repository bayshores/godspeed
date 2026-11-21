/** The transcript anchor of an answered question (the step bar's jump). */
export function answerAnchorSelector(toolCallId: string): string {
	return `[data-answer-call="${toolCallId.replace(/["\\]/g, "\\$&")}"]`;
}

/** The transcript anchor of a tool's card (a Concluded card). */
export function toolCardSelector(toolCallId: string): string {
	return `[data-tool-call="${toolCallId.replace(/["\\]/g, "\\$&")}"]`;
}
