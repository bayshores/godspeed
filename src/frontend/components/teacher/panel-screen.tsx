import { useEffect } from "react";
import { terminalFooter, type TerminalRole } from "@/frontend/components/terminal/terminal-model";
import { TerminalPane } from "@/frontend/components/terminal/terminal-pane";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
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
			// The outline of the screen to come, with what starts it.
			<div data-testid="terminal-none" className="mx-3 mb-3 flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-auto rounded-[10px] border border-dashed border-edge px-6 py-8 text-center">
				<PixelIcon name="window" className="h-7 text-ink-2" />
				<p className="max-w-80 text-[15px] leading-[22px] text-ink">
					{api.outsideHere ? "Your agent was started outside godspeed, so its screen is in its own window." : `${name}'s screen shows here once it starts.`}
				</p>
				{!api.outsideHere && <StartTeacher />}
			</div>
		);
	return <TerminalPane api={api} role={role} foot={terminalFooter(facts, name, true)} focusOnOpen={focus} />;
}
