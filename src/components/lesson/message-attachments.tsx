import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FileTextIcon } from "lucide-react";
import { isAttachmentPart, type LhViewPart } from "@/core";

/**
 * The learner's files under their message: pictures as thumbnails (a click
 * shows one full size) and PDFs as chips (a click opens the file in the
 * computer's PDF app, desktop only).
 */
export function MessageAttachments({ parts }: { parts: readonly LhViewPart[] }) {
	const [open, setOpen] = useState<string | null>(null);
	const files = parts.filter(isAttachmentPart);
	if (files.length === 0) return null;
	const openPath = typeof window !== "undefined" ? window.lh?.openPath : undefined;
	return (
		<div data-testid="message-attachments" className="mt-2 flex flex-wrap items-start gap-2">
			{files.map((part) => {
				if (part.type === "data-image") {
					const { base64, mimeType } = part.data as { base64: string; mimeType: string };
					const src = `data:${mimeType};base64,${base64}`;
					return (
						<button key={part.id} type="button" aria-label="Show picture full size" onClick={() => setOpen(src)} className="lh-press block">
							{/* eslint-disable-next-line @next/next/no-img-element -- the learner's picture, stored in the lesson */}
							<img data-testid="message-image" src={src} alt="" className="block max-h-[220px] w-auto max-w-full border border-tone-2" />
						</button>
					);
				}
				const pdf = part.data as { name: string; path: string };
				return (
					<button
						key={part.id}
						type="button"
						data-testid="message-pdf"
						disabled={!openPath || !pdf.path}
						onClick={() => void openPath?.(pdf.path)}
						className="lh-press flex h-10 max-w-64 items-center gap-2 border border-tone-2 bg-tone px-3 text-[13px] text-ink hover:bg-tone-2 disabled:cursor-default disabled:hover:bg-tone"
					>
						<FileTextIcon aria-hidden className="size-4 shrink-0 text-ink-2" />
						<span className="truncate">{pdf.name}</span>
					</button>
				);
			})}
			{open !== null && <PictureOverlay src={open} onClose={() => setOpen(null)} />}
		</div>
	);
}

/** One picture full size over the whole window; a click or Esc closes it. */
function PictureOverlay({ src, onClose }: { src: string; onClose: () => void }) {
	// Claimed at the document level so Esc never reaches the lesson's stop chain.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			e.stopPropagation();
			onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);
	return createPortal(
		<div
			data-testid="picture-overlay"
			role="dialog"
			aria-label="Picture"
			onClick={onClose}
			className="lh-no-drag fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-background/90 p-8"
		>
			{/* eslint-disable-next-line @next/next/no-img-element -- the learner's picture, stored in the lesson */}
			<img src={src} alt="" className="max-h-full max-w-full object-contain" />
		</div>,
		document.body,
	);
}
