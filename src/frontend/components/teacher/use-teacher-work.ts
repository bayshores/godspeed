/** The teacher's round of work, read once for the window (TeacherProvider owns it). Null until
 *  the first read. */
import { useMemo } from "react";
import { readTeacherWork, type TeacherWork } from "@/shared/core";
import { useServerResource } from "@/frontend/components/use-server-resource";

export function useTeacherWork(): TeacherWork | null {
	const { value } = useServerResource<unknown>("/api/teacher-work", { on: { "teacher-work": true } });
	return useMemo(() => (value === null ? null : readTeacherWork(value)), [value]);
}
