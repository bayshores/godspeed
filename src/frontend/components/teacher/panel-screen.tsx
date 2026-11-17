import { useLocation } from "react-router";
import { useSpaces } from "@/frontend/components/space-context";
import { startersFor } from "@/frontend/components/terminal/starter-model";
import { terminalFooter, type TerminalRole } from "@/frontend/components/terminal/terminal-model";
import { TerminalPane } from "@/frontend/components/terminal/terminal-pane";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { StartTeacher } from "./start-teacher";

/**
 * The panel's screen: the agent's live screen (the teacher's, or
 * background work's while it needs the learner) with its sentence and
 * buttons under it, and the starter keys for the page on screen. Before
 * godspeed has started an agent: what shows here and the start buttons,
 * or where an agent started outside godspeed shows its screen.
 */
export function PanelScreen({ name, role, focus }: { name: string; role: TerminalRole; focus: boolean }) {
	const api = useTerminals();
	const { pathname } = useLocation();
	const spaceName = useSpaces().activeSpace?.name ?? null;
	const { deadlines } = useOpenDeadlines();
	const facts = api?.facts[role] ?? null;
	if (!api) return null;
	if (!facts)
		return (
			// Where the screen will be, with what starts it.
			<div data-testid="terminal-none" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-auto px-6 py-8 text-center">
				<PixelIcon name="window" className="h-7 text-ink-2" />
				<p className="max-w-80 text-[15px] leading-[22px] text-ink">
					{api.outsideHere ? "Your agent runs in its own window." : `${name}'s screen shows here.`}
				</p>
				{!api.outsideHere && <StartTeacher />}
			</div>
		);
	return <TerminalPane api={api} role={role} foot={terminalFooter(facts, name, true)} focusOnOpen={focus} starters={startersFor({ path: pathname, spaceName, deadlines: deadlines ?? [] })} />;
}
