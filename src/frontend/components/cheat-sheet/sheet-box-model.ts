import type { BoxView } from "@/frontend/components/lesson/lesson-box-model";

/**
 * The cheat sheet's box, the lesson's box with one key: it asks the teacher for the sheet, about
 * it, or for a change. A part pointed at can go alone. `blocked`: the sheet is being worked on, or
 * a newer godspeed saved it.
 */
export function sheetBox(s: { teacher: string; made: boolean; blocked: boolean; hasText: boolean; hasFiles: boolean; pointed: boolean }): BoxView {
	const canAsk = !s.blocked && (s.hasText || s.hasFiles || s.pointed);
	return {
		placeholder: s.made ? "A question or a change" : "Your request",
		keys: [{ action: "send", label: `Ask ${s.teacher}`, filled: canAsk, disabled: !canAsk }],
		enter: canAsk ? "send" : null,
		exit: null,
		attach: true,
		help: null,
	};
}
