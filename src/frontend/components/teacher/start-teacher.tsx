import { OtherAppSetup } from "@/frontend/components/agent-folder/agent-launcher";
import { StartAgentButton } from "@/frontend/components/agent-folder/start-agent-button";
import { useAgentChoice, useAgentFolder } from "@/frontend/components/agent-folder/use-agent-folder";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import { TeacherChats } from "./teacher-chats";

/** In the panel before any start (in a browser, above Activity while no
 *  agent is connected): "Start Claude Code" (the agent last started here)
 *  and "Use another agent", or, with earlier chats in godspeed's terminal,
 *  New chat and the chats to go back to. The panel's status line says it is
 *  not connected; the way around a failed start shows only once a start
 *  failed. */
export function StartTeacher() {
	const { busy, error, manual, open } = useAgentFolder();
	const [choice, setChoice] = useAgentChoice();
	const chats = useTerminals()?.chats ?? [];
	return (
		<div data-testid="no-agent" className="lh-rise flex flex-col items-start gap-3.5">
			{chats.length > 0 ? (
				<div className="w-full max-w-[420px]">
					<TeacherChats
						chats={chats}
						choice={choice}
						onChoose={setChoice}
						onNew={() => choice !== "other" && void open(choice)}
						onResume={(chat) => void open(chat.agent, chat.id)}
						busy={busy}
					/>
				</div>
			) : (
				<StartAgentButton choice={choice} onChoose={setChoice} onStart={() => choice !== "other" && void open(choice)} busy={busy} />
			)}
			{choice === "other" && <OtherAppSetup />}
			{error && (
				<div role="alert" className="flex flex-col gap-1 text-[15px]">
					<p className="text-ans-wrong">{error}</p>
					<p className="text-ink-2">If that does not work, run the command from Settings, Connection in your terminal.</p>
				</div>
			)}
			{manual && <p className="text-[15px] text-ink-2">Run the command from Settings, Connection in your terminal.</p>}
		</div>
	);
}
