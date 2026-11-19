import type { ReactNode } from "react";
import { cn } from "@/frontend/lib/utils";

export interface Frame {
	text: string;
	/** Beside the text: how far the work is ("6 of 17 files"). */
	count: string;
}

/**
 * A page that is being worked on sits in a striped frame, with a tag in
 * its top band saying who works on it and how far it is. The tag stays
 * inside the band, so the page never scrolls over it. The page inside
 * stays as it is and stays usable. With no frame the page is drawn the
 * same way, so it keeps its state when work starts or ends. `onPage`: the
 * frame hugs the page's column (.lh-page) instead of the whole room.
 */
export function WorkFrame({ frame, onPage, children }: { frame: Frame | null; onPage?: boolean; children: ReactNode }) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			{frame && (
				<div className={cn("shrink-0 pt-(--lh-gap)", onPage ? "lh-page" : "w-full")}>
					<div data-testid="work-frame" className="lh-work-stripes flex h-10 justify-end border-2 border-b-0 border-line pr-[22px]">
						{/* Its right edge lines up with the page's column, where the space head ends its tabs. */}
						<div data-testid="work-frame-tag" className="flex min-w-0 items-center gap-3 border-x-2 border-line bg-highlight px-3.5 text-ink">
							<span title={frame.text} className="truncate text-[15px]">
								{frame.text}
							</span>
							<span className="shrink-0 font-count text-base">{frame.count}</span>
						</div>
					</div>
				</div>
			)}
			<div className="relative min-h-0 flex-1">
				{children}
				{frame && <div aria-hidden data-testid="work-frame-sides" className={cn(
						"pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 border-2 border-t-0 border-line",
						onPage ? "w-[min(100%-2*var(--lh-page-side),var(--lh-page-w))]" : "w-full",
					)} />}
			</div>
		</div>
	);
}
