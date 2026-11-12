import { useCallback, useMemo, useRef, useState } from "react";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENTS, attachmentType, isPdfType, pickAttachments, type ChatAttachment } from "@/shared/core";

/**
 * The files waiting in a message box (a lesson's, Talk's, a cheat sheet's
 * and the Study page's): paste, drop or "Add pictures or PDFs" add them,
 * small chips show them above the text, and the send carries them.
 */

interface DraftFile {
	id: string;
	attachment: ChatAttachment;
}

export interface AttachmentDraft {
	files: readonly DraftFile[];
	/** Why the last file was refused, until the next change. */
	error: string | null;
	add: (files: readonly File[]) => void;
	remove: (id: string) => void;
	clear: () => void;
	/** Puts back files a refused send took, ahead of any added since. */
	restore: (files: readonly DraftFile[]) => void;
}

let draftSeq = 0;

function readBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const url = String(reader.result);
			resolve(url.slice(url.indexOf(",") + 1));
		};
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

/** Waiting files by box, for this app run: leaving a lesson and coming back
 *  keeps them. Never stored on disk (they can be large); a reload drops them. */
const waitingFiles = new Map<string, DraftFile[]>();

/** `key` names the box (a lesson's writing box), so its files outlive
 *  the box's component. Without one they live and go with it. */
export function useAttachmentDraft(key?: string): AttachmentDraft {
	const [files, showFiles] = useState(() => (key && waitingFiles.get(key)) || []);
	const filesRef = useRef(files);
	const [error, setError] = useState<string | null>(null);
	// Files still being read count toward the limit; a clear drops reads in flight.
	const countRef = useRef(files.length);
	const generationRef = useRef(0);

	// The store is written at once, so a send that settles after the box
	// is gone (an answer) still clears or keeps its files.
	const setFiles = useCallback(
		(next: (prev: DraftFile[]) => DraftFile[]) => {
			const value = next(filesRef.current);
			filesRef.current = value;
			if (key) {
				if (value.length > 0) waitingFiles.set(key, value);
				else waitingFiles.delete(key);
			}
			showFiles(value);
		},
		[key],
	);

	const add = useCallback((incoming: readonly File[]) => {
		const { accepted, refusal } = pickAttachments(countRef.current, incoming);
		setError(refusal);
		if (accepted.length === 0) return;
		countRef.current += accepted.length;
		const generation = generationRef.current;
		void Promise.allSettled(accepted.map(readBase64)).then((results) => {
			if (generation !== generationRef.current) return;
			const read: DraftFile[] = [];
			results.forEach((result, i) => {
				const file = accepted[i]!;
				if (result.status === "fulfilled") {
					read.push({
						id: `f${draftSeq++}`,
						attachment: { name: file.name, mimeType: attachmentType(file.name, file.type), data: result.value },
					});
				} else {
					countRef.current -= 1;
					setError(`Can't read ${file.name}.`);
				}
			});
			setFiles((prev) => [...prev, ...read]);
		});
	}, [setFiles]);

	const remove = useCallback((id: string) => {
		countRef.current -= 1;
		setFiles((prev) => prev.filter((f) => f.id !== id));
		setError(null);
	}, [setFiles]);

	const clear = useCallback(() => {
		countRef.current = 0;
		generationRef.current += 1;
		setFiles(() => []);
		setError(null);
	}, [setFiles]);

	const restore = useCallback((back: readonly DraftFile[]) => {
		const kept = back.slice(0, Math.max(0, MAX_ATTACHMENTS - countRef.current));
		countRef.current += kept.length;
		setFiles((prev) => [...kept, ...prev]);
	}, [setFiles]);

	return useMemo(() => ({ files, error, add, remove, clear, restore }), [files, error, add, remove, clear, restore]);
}

/** Paste and drop handlers for the form that holds the box. */
export function attachmentInputProps(draft: AttachmentDraft) {
	return {
		onPaste: (e: React.ClipboardEvent) => {
			const files = Array.from(e.clipboardData.files);
			if (files.length === 0) return;
			e.preventDefault();
			draft.add(files);
		},
		onDragOver: (e: React.DragEvent) => {
			if (e.dataTransfer.types.includes("Files")) e.preventDefault();
		},
		onDrop: (e: React.DragEvent) => {
			const files = Array.from(e.dataTransfer.files);
			if (files.length === 0) return;
			e.preventDefault();
			draft.add(files);
		},
	};
}

/** The waiting files above the text, each with "Remove", and the last refusal. */
export function AttachmentTray({ draft, note }: { draft: AttachmentDraft; note?: string }) {
	if (draft.files.length === 0 && !draft.error) return null;
	return (
		<div data-testid="attachment-tray" className="flex shrink-0 flex-col gap-2 pt-3">
			{draft.files.length > 0 && (
				<div className="flex flex-wrap gap-2">
					{draft.files.map((f) => (
						<DraftChip key={f.id} file={f.attachment} onRemove={() => draft.remove(f.id)} />
					))}
				</div>
			)}
			{note && <p data-testid="attachment-note" className="text-base text-ink-2">{note}</p>}
			{draft.error && <p data-testid="attachment-error" className="text-base text-ink-2">{draft.error}</p>}
		</div>
	);
}

/** One waiting file: a picture's small preview, the file's name, "Remove". */
function DraftChip({ file, onRemove }: { file: ChatAttachment; onRemove: () => void }) {
	const pdf = isPdfType(file.mimeType);
	return (
		<div data-testid={pdf ? "draft-pdf" : "draft-image"} className={cn("flex h-[47px] max-w-72 items-center gap-1.5 overflow-hidden rounded border-[1.5px] border-ink bg-panel pr-1.5", pdf && "pl-3")}>
			{!pdf && (
				<img src={`data:${file.mimeType};base64,${file.data}`} alt="" className="size-11 shrink-0 object-cover" />
			)}
			<span className="min-w-0 truncate text-base text-ink" title={file.name}>{file.name}</span>
			<button type="button" aria-label={`Remove ${file.name}`} onClick={onRemove} className="lh-btn lh-btn-quiet h-7 shrink-0 text-[15px]">
				Remove
			</button>
		</div>
	);
}

/** "Add pictures or PDFs": opens the file picker. A quiet word with a
 *  plus; `outlined` where it sits in a row of outlined buttons. */
export function AttachButton({ draft, outlined }: { draft: AttachmentDraft; outlined?: boolean }) {
	const inputRef = useRef<HTMLInputElement>(null);
	return (
		<>
			<input
				ref={inputRef}
				type="file"
				multiple
				hidden
				accept={ATTACHMENT_ACCEPT}
				data-testid="attachment-input"
				onChange={(e) => {
					draft.add(Array.from(e.target.files ?? []));
					e.target.value = "";
				}}
			/>
			<button type="button" data-testid="attach-button" onClick={() => inputRef.current?.click()} className={cn("lh-btn shrink-0 text-[15px]", !outlined && "lh-btn-quiet")}>
				{!outlined && <PixelIcon name="plus" />}
				Add pictures or PDFs
			</button>
		</>
	);
}
