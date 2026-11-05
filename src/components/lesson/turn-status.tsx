import { DEFAULT_TEACHER_NAME } from "@/core";
import { useHalley } from "@/components/halley/halley-provider";

/** The Your-turn panel header's status while a turn runs ("<teacher
 *  name> is writing…"). Its own file, since the Halley provider's tree
 *  imports panel-parts. */
export function TurnStatus({ waitingForAgent }: { waitingForAgent: boolean }) {
	const name = useHalley()?.name ?? DEFAULT_TEACHER_NAME;
	return <>{waitingForAgent ? "Waiting for your agent" : `${name} is writing…`}</>;
}
