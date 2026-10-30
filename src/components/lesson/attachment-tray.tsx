import { useCallback, useMemo, useRef, useState } from "react";
import { FileTextIcon, ImagePlusIcon, XIcon } from "lucide-react";
import { Hint } from "@/components/ui/hint";
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENTS, attachmentType, isPdfType, pickAttachments, type ChatAttachment } from "@/core";

/**
 * The files waiting in a message box (the lesson composer and the practice
 * panel): paste, drop or the picture button add them, small previews show
 * them above the box, and the send carries them.
 */

export interface DraftFile {
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

export function useAttachmentDraft(): AttachmentDraft {
	const [files, setFiles] = useState<DraftFile[]>([]);
	const [error, setError] = useState<string | null>(null);
	// Files still being read count toward the limit; a clear drops reads in flight.
	const countRef = useRef(0);
	const generationRef = useRef(0);

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
	}, []);

	const remove = useCallback((id: string) => {
		countRef.current -= 1;
		setFiles((prev) => prev.filter((f) => f.id !== id));
		setError(null);
	}, []);

	const clear = useCallback(() => {
		countRef.current = 0;
		generationRef.current += 1;
		setFiles([]);
		setError(null);
	}, []);

	const restore = useCallback((back: readonly DraftFile[]) => {
		const kept = back.slice(0, Math.max(0, MAX_ATTACHMENTS - countRef.current));
		countRef.current += kept.length;
		setFiles((prev) => [...kept, ...prev]);
	}, []);

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

/** The waiting files above the box, each with an ✕, and the last refusal. */
export function AttachmentTray({ draft, note }: { draft: AttachmentDraft; note?: string }) {
	if (draft.files.length === 0 && !draft.error) return null;
	return (
		<div data-testid="attachment-tray" className="flex shrink-0 flex-col gap-2 pt-3">
			{draft.files.length > 0 && (
				<div className="flex flex-wrap gap-2">
					{draft.files.map((f) => (
						<DraftPreview key={f.id} file={f.attachment} onRemove={() => draft.remove(f.id)} />
					))}
				</div>
			)}
			{note && <p data-testid="attachment-note" className="text-xs text-ink-3">{note}</p>}
			{draft.error && <p data-testid="attachment-error" className="text-xs text-ink-2">{draft.error}</p>}
		</div>
	);
}

function DraftPreview({ file, onRemove }: { file: ChatAttachment; onRemove: () => void }) {
	const remove = (
		<button
			type="button"
			aria-label={`Remove ${file.name}`}
			onClick={onRemove}
			className="lh-press absolute top-0.5 right-0.5 flex size-5 items-center justify-center bg-background/80 text-ink-2 hover:text-ink"
		>
			<XIcon aria-hidden className="size-3" />
		</button>
	);
	if (isPdfType(file.mimeType)) {
		return (
			<div data-testid="draft-pdf" className="relative flex h-14 max-w-48 items-center gap-2 border border-tone-2 bg-tone pr-8 pl-3 text-[13px] text-ink">
				<FileTextIcon aria-hidden className="size-4 shrink-0 text-ink-2" />
				<span className="truncate">{file.name}</span>
				{remove}
			</div>
		);
	}
	return (
		<div data-testid="draft-image" className="relative size-14 shrink-0 border border-tone-2 bg-background">
			{/* eslint-disable-next-line @next/next/no-img-element -- a local data URL, nothing to optimize */}
			<img src={`data:${file.mimeType};base64,${file.data}`} alt={file.name} className="size-full object-cover" />
			{remove}
		</div>
	);
}

/** The picture button beside Send: opens the file picker. */
export function AttachButton({ draft }: { draft: AttachmentDraft }) {
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
			<Hint label="Add images or PDFs">
				<button
					type="button"
					aria-label="Add images or PDFs"
					data-testid="attach-button"
					onClick={() => inputRef.current?.click()}
					className="lh-press flex size-14 shrink-0 items-center justify-center border-r border-tone-2 bg-tone text-ink-2 hover:text-ink"
				>
					<ImagePlusIcon aria-hidden className="size-5" />
				</button>
			</Hint>
		</>
	);
}
