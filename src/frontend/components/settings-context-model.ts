import { DEFAULT_TEACHER_NAME, type BootInfo, type UserSettings } from "@/shared/core";

/** What boot says about these settings before the record is read. */
export type BootGeneral = Pick<BootInfo, "teacherName" | "sounds" | "startupSound">;

/** The settings the whole window reads, with their defaults filled in. */
export interface LiveGeneral {
	teacherName: string;
	sounds: boolean;
	startupSound: boolean;
}

/** From the record once it is read, from boot until then (or when the read
 *  failed), so the first paint matches what boot said. */
export function liveGeneral(record: UserSettings | null | undefined, boot: BootGeneral): LiveGeneral {
	const general = record ? record.general : boot;
	return {
		teacherName: general?.teacherName?.trim() || DEFAULT_TEACHER_NAME,
		sounds: general?.sounds !== false,
		startupSound: general?.startupSound !== false,
	};
}
