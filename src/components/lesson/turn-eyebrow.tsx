import { DEFAULT_TEACHER_NAME } from "@/core";
import { useHalley } from "@/components/halley/halley-provider";

/** The Your-turn panel header's eyebrow: whose turn it is
 *  ("<teacher name> is writing…" while a turn runs). Its own file, since
 *  the Halley provider's tree imports panel-parts. */
export function TurnEyebrow({ busy, waitingForAgent }: { busy: boolean; waitingForAgent: boolean }) {
	const name = useHalley()?.name ?? DEFAULT_TEACHER_NAME;
	return <>{!busy ? "Your turn" : waitingForAgent ? "Waiting for your agent" : `${name} is writing…`}</>;
}
