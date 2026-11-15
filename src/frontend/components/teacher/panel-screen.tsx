import { useEffect } from "react";
import { terminalFooter, type TerminalRole } from "@/frontend/components/terminal/terminal-model";
import { TerminalPane } from "@/frontend/components/terminal/terminal-pane";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import { StartTeacher } from "./start-teacher";

/**
 * The panel's screen: the agent's live screen (the teacher's, or the
 * helper's when the switch in the panel's head picks it) with its sentence
 * and buttons under it. Before godspeed has started an agent: what shows
 * here and the start buttons, or where an agent started outside godspeed
 * shows its screen.
 */
export function PanelScreen({ name, role, focus }: { name: string; role: TerminalRole; focus: boolean }) {
	const api = useTerminals();
	const facts = api?.facts[role] ?? null;
	const setOnScreen = api?.setOnScreen;
	const showing = facts ? role : null;
	// What shows here counts as seen.
	useEffect(() => {
		if (!setOnScreen || !showing) return;
		setOnScreen(showing);
		return () => setOnScreen(null);
	}, [setOnScreen, showing]);

	if (!api) return null;
	if (!facts)
		return (
			<div data-testid="terminal-none" className="flex flex-col items-start gap-3.5 px-5 py-[18px]">
				<p className="text-[15px] leading-[22px] text-ink">
					{api.outsideHere ? "Your agent was started outside godspeed, so its screen is in its own window." : `${name}'s screen shows here once it starts.`}
				</p>
				{!api.outsideHere && <StartTeacher />}
			</div>
		);
	return <TerminalPane api={api} role={role} foot={terminalFooter(facts, name, true)} focusOnOpen={focus} />;
}
