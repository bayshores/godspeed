import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Cite } from "@/shared/core";
import { DialogSheet, useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";

export type FileCite = Extract<Cite, { kind: "file" }>;
type Passage = { page: number | null; text: string };

/** The place in a space file a source points at: the PDF page as an image,
 *  or the passage text. */
export function CiteDialog({ cite, onClose }: { cite: FileCite | null; onClose: () => void }) {
	const { mounted, state, shown } = useLastWhileClosing(cite);
	if (!mounted || !shown) return null;
	return createPortal(<CiteSheet cite={shown} state={state} onClose={onClose} />, document.body);
}

/** GET /api/cited: null while loading, "gone" when the file or place is missing. */
function usePassage({ fileId, range }: FileCite): Passage | "gone" | null {
	const [got, setGot] = useState<{ key: string; passage: Passage | "gone" } | null>(null);
	const key = `${fileId}/${range}`;
	useEffect(() => {
		let live = true;
		fetch(`/api/cited/${fileId}?range=${encodeURIComponent(range)}`)
			.then((res): Promise<Passage | "gone"> => (res.ok ? res.json() : Promise.resolve("gone")))
			.catch((): "gone" => "gone")
			.then((passage) => {
				if (live) setGot({ key, passage });
			});
		return () => {
			live = false;
		};
	}, [fileId, range, key]);
	return got && got.key === key ? got.passage : null;
}

function CiteSheet({ cite, state, onClose }: { cite: FileCite; state: "open" | "closed"; onClose: () => void }) {
	const passage = usePassage(cite);
	const [brokenImage, setBrokenImage] = useState(false);
	const found = passage === "gone" ? null : passage;
	const showImage = !!found && found.page !== null && !brokenImage;
	return (
		<DialogSheet title={cite.name} state={state} testid="cite-dialog" className="w-[780px]" onClose={onClose}>
			{passage === null ? null : !found || (!showImage && found.text === "") ? (
				<p data-testid="cite-gone" className="text-[15px] text-ink">
					godspeed can&apos;t find this place in your space files anymore.
				</p>
			) : (
				<>
					<p data-testid="cite-place" className="text-[15px] text-ink">
						{cite.range}
					</p>
					{showImage ? (
						// eslint-disable-next-line @next/next/no-img-element -- a page of the learner's own file
						<img
							data-testid="cite-page"
							src={`/api/cited/${cite.fileId}/page/${found.page}`}
							alt={`Page ${found.page} of ${cite.name}`}
							onError={() => setBrokenImage(true)}
							className="w-full border border-line"
						/>
					) : (
						<div data-testid="cite-text" className="border border-line p-3.5 text-[15px] whitespace-pre-wrap text-ink">
							{found.text}
						</div>
					)}
				</>
			)}
		</DialogSheet>
	);
}
