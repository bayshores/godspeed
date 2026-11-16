/**
 * Start lesson and a lesson's send wake the teacher (TerminalsApi.wake);
 * with earlier chats the teacher's panel opens on them instead, for the
 * learner to pick which chat teaches.
 */
import { useMemo } from "react";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import { useTeacher } from "./teacher-context";

export function useWake(): (() => void) | undefined {
	const wake = useTerminals()?.wake;
	const show = useTeacher()?.showTerminal;
	return useMemo(
		() =>
			wake &&
			(() => {
				if (wake()) show?.("teacher");
			}),
		[wake, show],
	);
}
