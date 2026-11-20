import { lessonHref } from "@/frontend/components/overview/overview-model";
import type { TeacherChat } from "@/frontend/components/terminal/terminal-model";

/** Where a press on the chat the teacher runs now leads: its lesson, or
 *  nowhere when that lesson is the page already open or it taught none.
 *  Either way the list closes, back to the terminal. Pure. */
export function openChatGoesTo(chat: TeacherChat, pathname: string): string | null {
	if (!chat.lesson) return null;
	const href = lessonHref(chat.lesson);
	return pathname === href ? null : href;
}
