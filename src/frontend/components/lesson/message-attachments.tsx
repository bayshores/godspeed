import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { isAttachmentPart, type LhViewPart } from "@/shared/core";
import { SMALL_BTN } from "@/frontend/components/ui/card-parts";
import { cn } from "@/frontend/lib/utils";
import { useDialogFocus } from "@/frontend/components/use-dialog-focus";

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
							<img data-testid="message-image" src={src} alt="" className="block max-h-[220px] w-auto max-w-full rounded border border-border" />
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
						className={cn(SMALL_BTN, "max-w-64 disabled:cursor-default")}
					>
						<span className="truncate" title={pdf.name}>{pdf.name}</span>
					</button>
				);
			})}
			{open !== null && <PictureOverlay src={open} onClose={() => setOpen(null)} />}
		</div>
	);
}

/** One picture full size over the whole window; a click or Esc closes it. */
function PictureOverlay({ src, onClose }: { src: string; onClose: () => void }) {
	const dialogRef = useDialogFocus<HTMLDivElement>();
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
			ref={dialogRef}
			tabIndex={-1}
			data-testid="picture-overlay"
			role="dialog"
			aria-modal="true"
			aria-label="Picture"
			onClick={onClose}
			className="lh-no-drag fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-background/90 p-8"
		>
			{/* eslint-disable-next-line @next/next/no-img-element -- the learner's picture, stored in the lesson */}
			<img src={src} alt="Your picture" className="max-h-full max-w-full object-contain" />
		</div>,
		document.body,
	);
}
