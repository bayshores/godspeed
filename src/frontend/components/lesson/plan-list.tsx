import type { ReactNode } from "react";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import type { Tone } from "./plan-row-model";

/** The numbered list inside the plan and problems dialogs: ink rules on top and bottom. */
export function PlanList({ label, children }: { label: string; children: ReactNode }) {
	return (
		<ol aria-label={label} className="flex flex-col border-y-[1.5px] border-ink">
			{children}
		</ol>
	);
}

/**
 * One row: a check for a done one, an arrow for the current one, then its
 * number and name. A row with `onClick` is a button.
 */
export function PlanListRow({
	testid,
	status,
	tone,
	number,
	name,
	note,
	onClick,
}: {
	testid: string;
	status: string;
	tone: Tone;
	number: string;
	name: string;
	/** A quiet note at the right, like "2 of 2 right". */
	note?: string | null;
	onClick?: () => void;
}) {
	const row = (
		<>
			<span aria-hidden className="flex w-[18px] shrink-0 items-center">
				{tone === "done" && <PixelIcon name="check" />}
				{tone === "current" && <PixelIcon name="chevron" />}
			</span>
			<span className="shrink-0 font-count text-lg">{number}</span>
			<span title={name} className="min-w-0 flex-1 truncate text-lg">
				{name}
			</span>
			{note && <span className="shrink-0 text-[14px] text-ink-2">{note}</span>}
		</>
	);
	const cls = cn("flex w-full items-center gap-3 py-2.5 text-left", tone === "done" ? "text-ink-2" : "text-ink");
	return (
		<li data-testid={testid} data-status={status} className="border-b border-dotted border-edge last:border-b-0">
			{onClick ? (
				<button type="button" onClick={onClick} className={cn(cls, "hover:text-ink")}>
					{row}
				</button>
			) : (
				<div className={cls}>{row}</div>
			)}
		</li>
	);
}
