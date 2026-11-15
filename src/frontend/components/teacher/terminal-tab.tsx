import { useEffect } from "react";
import { terminalFooter, type TerminalRole } from "@/frontend/components/terminal/terminal-model";
import { TerminalPane } from "@/frontend/components/terminal/terminal-pane";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import { TalkNoAgent } from "./talk-no-agent";

/**
 * The Terminal tab: the agent's live screen (the teacher's, or the
 * helper's when the switch on the tab row picks it) with its sentence and
 * buttons under it. Before godspeed has started an agent: the start line,
 * as in Talk, or where an agent started outside godspeed shows its screen.
 */
export function TerminalTab({ name, role, focus }: { name: string; role: TerminalRole; focus: boolean }) {
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
			<div data-testid="terminal-none" className="px-5 py-[18px]">
				{api.outsideHere ? (
					<p className="text-[15px] leading-[22px] text-ink">Your agent was started outside godspeed, so its screen is in its own window.</p>
				) : (
					<TalkNoAgent />
				)}
			</div>
		);
	return <TerminalPane api={api} role={role} foot={terminalFooter(facts, { name, folder: api.folder })} focusOnOpen={focus} />;
}
