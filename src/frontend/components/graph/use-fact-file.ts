/**
 * The file a fact came from, when it is one of the open space's files:
 * its name, and showing or opening it on the desktop. A source only names
 * its file, so the space's record finds the file and the server its place
 * on this computer.
 */
import { useCallback } from "react";
import { useSpaces } from "@/frontend/components/space-context";
import { useSpaceRecord } from "@/frontend/components/files/space-record";
import { fileShowFor, showSpaceFile, type FileShow } from "@/frontend/components/files/show-space-file";
import { useGuardedAction } from "@/frontend/components/use-guarded-action";

export function useFactFile(born: string | null) {
	const { active } = useSpaces();
	const { record } = useSpaceRecord(active);
	const file = born ? record?.files.find((f) => f.sourceId === born) : undefined;
	const { run, error } = useGuardedAction();
	const fileId = file?.id;
	const show = useCallback(
		(how: FileShow) => {
			if (active && fileId) void run(() => showSpaceFile(active, fileId, how));
		},
		[active, fileId, run],
	);
	const desktop = typeof window !== "undefined" ? window.lh : undefined;
	if (!file || !desktop?.showInFolder) return null;
	return { opens: fileShowFor(file.name) === "open" && !!desktop.openPath, show, error };
}
