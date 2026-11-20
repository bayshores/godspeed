import { useState } from "react";
import { createPortal } from "react-dom";
import { DialogSheet, useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";
import { CodeLines, MarkedText, PageMarks } from "./page-excerpt";
import type { CitedPassage, FileCite, PassageCite } from "./page-excerpt-model";
import { useCited } from "./use-cited";
import { usePageSrc } from "./use-page-src";

/** The place in a space file a source or a passage id points at: the PDF
 *  page as an image, or the passage text, with the words the source quotes marked. */
export function CiteDialog({ cite, onClose }: { cite: FileCite | PassageCite | null; onClose: () => void }) {
	const { mounted, state, shown } = useLastWhileClosing(cite);
	if (!mounted || !shown) return null;
	return createPortal(<CiteSheet cite={shown} state={state} onClose={onClose} />, document.body);
}

function CiteSheet({ cite, state, onClose }: { cite: FileCite | PassageCite; state: "open" | "closed"; onClose: () => void }) {
	const passage = useCited(cite);
	const [brokenImage, setBrokenImage] = useState(false);
	const found = passage === "gone" ? null : passage;
	const showImage = !!found && found.page !== null && !brokenImage;
	const marks = found?.marks ?? null;
	return (
		<DialogSheet title={cite.name} state={state} testid="cite-dialog" className="w-[780px]" onClose={onClose}>
			{passage === null ? null : !found || (!showImage && found.text === "") ? (
				<p data-testid="cite-gone" className="text-[15px] text-ink">
					godspeed can&apos;t find this place in your space files anymore.
				</p>
			) : (
				<>
					<p data-testid="cite-place" className="text-[15px] text-ink">
						{"range" in cite ? cite.range : found.range}
					</p>
					{showImage ? (
						<CitePage cite={cite} page={found.page!} marks={marks} onBroken={() => setBrokenImage(true)} />
					) : marks?.kind === "lines" ? (
						<CodeLines name={cite.name} marks={marks} />
					) : (
						<div data-testid="cite-text" className="lh-well rounded p-3.5 text-[15px] whitespace-pre-wrap text-ink">
							{marks?.kind === "passage" ? <MarkedText before={found.text.slice(0, marks.start)} marked={found.text.slice(marks.start, marks.end)} after={found.text.slice(marks.end)} /> : found.text}
						</div>
					)}
				</>
			)}
		</DialogSheet>
	);
}

function CitePage({ cite, page, marks, onBroken }: { cite: FileCite | PassageCite; page: number; marks: CitedPassage["marks"] | null; onBroken: () => void }) {
	const [src, frameRef] = usePageSrc<HTMLDivElement>(cite.fileId, page);
	return (
		<div ref={frameRef} className="relative shrink-0 border border-line">
			{src && (
				<img
					data-testid="cite-page"
					src={src}
					alt={`Page ${page} of ${cite.name}`}
					// Scrolled to the marked words once the page has its height.
					onLoad={(e) => e.currentTarget.parentElement?.querySelector('[data-testid="page-mark"]')?.scrollIntoView({ block: "center" })}
					onError={onBroken}
					className="block w-full"
				/>
			)}
			{marks?.kind === "page" && <PageMarks boxes={marks.boxes} />}
		</div>
	);
}
