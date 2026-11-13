import type { ReactNode } from "react";
import { cn } from "@/frontend/lib/utils";

export interface Frame {
	/** working: stripes slide. waiting: grey and still, no agent takes the work. done: a plain band. */
	state: "working" | "waiting" | "done";
	text: string;
	/** Beside the text: how far the work is ("6 of 17 files"). */
	count?: string | null;
	/** Buttons at the end of the tag. */
	actions?: ReactNode;
}

/**
 * A page that is being worked on sits in a striped frame, with a tag on
 * its top edge saying who works on it and how far it is. The page inside
 * stays as it is and stays usable. With no frame the page is drawn the
 * same way, so it keeps its state when work starts or ends. `column`: the
 * frame hugs the page's 908px column.
 */
export function WorkFrame({ frame, column = false, children }: { frame: Frame | null; column?: boolean; children: ReactNode }) {
	const width = column ? "mx-auto w-full max-w-[908px]" : "w-full";
	return (
		<div className="flex h-full min-h-0 flex-col">
			{frame && (
				<div className={cn(width, "shrink-0 pt-[18px]")}>
					<div data-testid="work-frame" data-state={frame.state} className="lh-work-stripes relative h-3.5 border-2 border-b-0 border-line">
						<div
							data-testid="work-frame-tag"
							className={cn("absolute -top-4 right-4 flex h-11 max-w-[calc(100%-32px)] items-center gap-3 border-2 border-line px-3.5 text-ink", frame.state === "waiting" ? "bg-tone" : "bg-highlight")}
						>
							<span title={frame.text} className="truncate text-[15px]">
								{frame.text}
							</span>
							{frame.count && <span className="shrink-0 font-count text-base">{frame.count}</span>}
							{frame.actions}
						</div>
					</div>
				</div>
			)}
			<div className="relative min-h-0 flex-1">
				{children}
				{frame && <div aria-hidden className={cn("pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 border-2 border-t-0 border-line", column ? "w-full max-w-[908px]" : "w-full")} />}
			</div>
		</div>
	);
}
