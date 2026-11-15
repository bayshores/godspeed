/**
 * Ask the teacher from anywhere in the window, as a window event, because
 * the asking button and whoever answers live in different subtrees. The
 * panel no longer has a chat, so nothing listens for it in the window.
 */
const ASK_TEACHER_EVENT = "lh:ask-teacher";

export function askTeacher(text: string): void {
	window.dispatchEvent(new CustomEvent(ASK_TEACHER_EVENT, { detail: { text } }));
}
