import { DEFAULT_TEACHER_NAME } from "@/shared/core";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { workerName } from "./work-model";

/** Who does the background work right now (null: no agent takes work),
 *  and the teacher's name. */
export function useWorker(): { worker: string | null; teacher: string } {
	const teacher = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	return { worker: workerName(useAgentStatus(), teacher), teacher };
}
