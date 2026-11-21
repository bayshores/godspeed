import { useLocation } from "react-router";
import { useSpaces } from "@/frontend/components/space-context";
import { everything, startersFor } from "@/frontend/components/terminal/starter-model";
import { terminalFooter, type TerminalRole } from "@/frontend/components/terminal/terminal-model";
import { TerminalPane } from "@/frontend/components/terminal/terminal-pane";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import { useVault } from "@/frontend/components/vault/vault-context";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { StartTeacher } from "./start-teacher";

/**
 * The panel's screen: the agent's live screen (the teacher's, or
 * background work's while it needs the learner) with its sentence and
 * buttons under it (the teacher's has Pop out too), and what the teacher can be asked on the page on screen. Before
 * godspeed has started an agent: what shows here and the start buttons,
 * or where an agent started outside godspeed shows its screen.
 */
export function PanelScreen({ name, role, focus }: { name: string; role: TerminalRole; focus: boolean }) {
	const api = useTerminals();
	const { pathname } = useLocation();
	const { spaces, activeSpace } = useSpaces();
	const { deadlines } = useOpenDeadlines();
	const { status: vault } = useVault();
	const facts = api?.facts[role] ?? null;
	if (!api) return null;
	if (!facts)
		return (
			// Where the screen will be, with what starts it.
			<div data-testid="terminal-none" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-auto px-6 py-8 text-center">
				<PixelIcon name="window" className="h-7 text-ink-2" />
				<p className="max-w-80 text-[15px] leading-[22px] text-ink">
					{api.outsideHere ? `${name} runs in its own window.` : `${name}'s screen shows here.`}
				</p>
				{!api.outsideHere && <StartTeacher />}
			</div>
		);
	const ideaFacts = {
		path: pathname,
		space: activeSpace && { id: activeSpace.id, name: activeSpace.name, files: activeSpace.fileCount },
		spaces: spaces.filter((s) => !s.closed).length,
		deadlines: deadlines ?? [],
		notesFolder: vault?.folder != null,
	};
	return (
		<TerminalPane
			api={api}
			role={role}
			name={name}
			foot={terminalFooter(facts, name, true)}
			focusOnOpen={focus}
			ideas={role === "teacher" ? { starters: startersFor(ideaFacts), everything: everything(ideaFacts) } : null}
			popOut={role === "teacher" ? api.popOut : null}
		/>
	);
}
