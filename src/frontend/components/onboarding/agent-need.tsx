import { useEffect } from "react";
import { AGENT_LABEL } from "@/frontend/components/agent-folder/agent-folder-model";
import { FirstRunScreen } from "@/frontend/components/terminal/first-run-screen";
import { teacherStatusLine, teacherTerminalState } from "@/frontend/components/terminal/terminal-model";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";

/** The steps after the agent step: when the agent started there needs the
 *  learner, one line says what, and its button shows the agent's screen
 *  here, as the agent step does. The line counts as heard, so the panel
 *  does not open for it again after onboarding. */
export function AgentNeed({ open, onOpen }: { open: boolean; onOpen: () => void }) {
	const api = useTerminals();
	const facts = api?.facts.teacher ?? null;
	const line = teacherTerminalState(facts) === "needsYou" ? teacherStatusLine(facts, AGENT_LABEL[facts!.term.agent]) : null;
	const calling = api?.calling;
	const heard = api?.heard;
	useEffect(() => {
		if (line && calling?.role === "teacher") heard?.(calling.key);
	}, [line, calling, heard]);

	if (open)
		return (
			<div className="w-[812px] max-w-full">
				<FirstRunScreen />
			</div>
		);
	if (!line) return null;
	return (
		<div data-testid="onboarding-agent-need" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[17px] text-ink">
			<p>{line}</p>
			<button type="button" data-testid="onboarding-agent-need-show" onClick={onOpen} className="lh-btn text-[15px]">
				Show its screen
			</button>
		</div>
	);
}
