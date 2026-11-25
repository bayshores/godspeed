import { useAgentStatus } from "@/frontend/components/agent-status";
import { useSettings } from "@/frontend/components/settings-context";
import { PanelHead } from "@/frontend/components/teacher/panel-head";
import { PanelScreen } from "@/frontend/components/teacher/panel-screen";
import { agentLine } from "@/frontend/components/teacher/teacher-panel";
import { screenStatusLine, teacherTerminalState } from "./terminal-model";
import { useTerminals } from "./use-terminals";

/**
 * The page of the terminal window the shell opens (pop out, in the screen's bottom row): the
 * teacher's screen with its head, which has the status line and Put back and nothing else. It
 * has no teacher provider, so the head shows no Follow or Chats. On the Mac the head is
 * the window's title bar: it drags the window and leaves the traffic lights their gutter.
 */
export function TerminalWindow() {
	const name = useSettings().teacherName;
	const agent = useAgentStatus();
	const terminals = useTerminals();
	const facts = terminals?.facts ?? null;
	return (
		// The teacher panel's colors on a whole window: no pop-up corners, no edge line.
		<main data-testid="terminal-window" style={{ borderRadius: 0, boxShadow: "none" }} className="lh-popup flex h-dvh min-w-0 flex-col overflow-hidden font-ui">
			<div className="lh-drag lh-lights-gutter shrink-0 select-none">
				<PanelHead
					status={screenStatusLine(facts, name) ?? agentLine(agent, name)}
					lit={teacherTerminalState(facts) === "needsYou"}
					working={false}
					list={null}
					putBack={() => terminals?.putBack()}
				/>
			</div>
			<div className="flex min-h-0 flex-1 flex-col">
				<PanelScreen name={name} focus />
			</div>
		</main>
	);
}
