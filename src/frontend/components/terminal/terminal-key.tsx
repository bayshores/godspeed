import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { useTerminals } from "./use-terminals";

/** On a page that asks the learner to write in the teacher's terminal: opens it (or brings its
 *  window forward), while godspeed runs that terminal and it is not on screen. */
export function TerminalKey() {
	const teacher = useTeacher();
	const terminals = useTerminals();
	const running = !!terminals?.teacher;
	// The open panel shows no terminal while it is in a window of its own.
	if (!teacher || (teacher.panelOpen && !terminals?.popped) || !running) return null;
	return (
		<button type="button" data-testid="terminal-key" onClick={() => teacher.showTerminal()} className="lh-btn lh-btn-main text-[15px]">
			Open the terminal
		</button>
	);
}
