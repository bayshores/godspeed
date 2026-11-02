"use client";

/**
 * The corner notice when a class's linked folder brings new files (say,
 * a new lecture landing in a synced Google Drive folder): "3 new files in
 * CSE 21", with See files and a close button. It stays until one is clicked.
 * With no agent connected, it says the study material waits for one.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { FolderInputIcon, XIcon } from "lucide-react";
import { useAgentStatus } from "@/components/agent-status";
import { useClasses } from "@/components/class-context";
import { NOTICE_STACK_ID } from "@/components/notice-stack";
import { useServerEvent } from "@/components/server-events";
import { addedNames, addedTitle, mergeAdded, type AddedFiles } from "./files-notice-model";

export function FilesNotice() {
	const [added, setAdded] = useState<AddedFiles[]>([]);
	const { classes, setActive } = useClasses();
	const agent = useAgentStatus();
	const router = useRouter();
	useServerEvent("files-added", (next) => setAdded((list) => mergeAdded(list, next)));
	const dismiss = (classId: string) => setAdded((list) => list.filter((e) => e.classId !== classId));
	if (typeof document === "undefined") return null;
	return createPortal(
		<FilesNoticeView
			added={added}
			agentConnected={agent?.connected !== false}
			nameOf={(id) => classes.find((c) => c.id === id)?.name ?? null}
			onSee={(classId) => {
				dismiss(classId);
				setActive(classId);
				router.push("/class/files");
			}}
			onDismiss={dismiss}
		/>,
		document.getElementById(NOTICE_STACK_ID) ?? document.body,
	);
}

export function FilesNoticeView({
	added,
	agentConnected,
	nameOf,
	onSee,
	onDismiss,
}: {
	added: readonly AddedFiles[];
	/** False while no agent is connected (unknown counts as connected). */
	agentConnected: boolean;
	/** The class's name; null hides its entry (the class was deleted). */
	nameOf: (classId: string) => string | null;
	onSee: (classId: string) => void;
	onDismiss: (classId: string) => void;
}) {
	return (
		<>
			{added.map((entry) => {
				const name = nameOf(entry.classId);
				if (!name) return null;
				return (
					<div key={entry.classId} data-testid="files-notice" role="status" className="lh-rise lh-popup flex w-[340px] max-w-full items-start gap-3 px-4 py-3 font-ui text-[13.5px] text-ink">
						<FolderInputIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
						<div className="flex min-w-0 flex-1 flex-col gap-1">
							<p className="font-bold">{addedTitle(entry, name, agentConnected)}</p>
							<p className="truncate text-xs text-ink-3" title={entry.files.map((f) => f.name).join("\n")}>
								{addedNames(entry.files)}
							</p>
							<div className="pt-1.5">
								<button
									type="button"
									data-testid="files-notice-see"
									onClick={() => onSee(entry.classId)}
									className="lh-press border border-tone-2 px-3 py-1 text-[13px] font-bold hover:bg-tone"
								>
									See files
								</button>
							</div>
						</div>
						<button type="button" data-testid="files-notice-close" aria-label="Close" onClick={() => onDismiss(entry.classId)} className="lh-press text-ink-3 hover:text-ink">
							<XIcon className="size-3.5" aria-hidden />
						</button>
					</div>
				);
			})}
		</>
	);
}
