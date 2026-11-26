import type { HTMLAttributes, ReactNode, Ref } from "react";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { useNotice } from "./notice-store";
import type { NoticeKind } from "./notice-stack-model";

/**
 * The one frame every notice shares, a section of the strip's peek: a
 * title line, an optional close button, a body, and buttons on the right.
 * It waits folded on the strip; an error first shows by itself for a while.
 */
export function NoticeCard({
	title,
	kind = null,
	timed = false,
	close,
	actions,
	className,
	children,
	...rest
}: {
	title: string;
	kind?: NoticeKind | null;
	/** It closes by itself after a while, so it never folds into the strip. */
	timed?: boolean;
	close?: { onClick: () => void; testId: string };
	actions?: ReactNode;
	children?: ReactNode;
	ref?: Ref<HTMLDivElement>;
} & Omit<HTMLAttributes<HTMLDivElement>, "title" | "role">) {
	const shown = useNotice(title, kind, timed);
	return (
		<div {...rest} role={kind === "error" ? "alert" : "status"} hidden={!shown} className={cn("lh-notice flex flex-col gap-2 py-3.5 pr-4 pl-[18px] font-ui", className)}>
			<div className="flex gap-3">
				<p className="min-w-0 flex-1 text-[17px] text-ink">{title}</p>
				{close && (
					<button
						type="button"
						data-testid={close.testId}
						aria-label="Close"
						// The click stops here: a card may open something on its whole surface.
						onClick={(e) => {
							e.stopPropagation();
							close.onClick();
						}}
						className="lh-press pt-[5px] text-ink-2 hover:text-ink"
					>
						<PixelIcon name="close" />
					</button>
				)}
			</div>
			{children}
			{actions && <div className="flex items-center justify-end gap-2 pt-1">{actions}</div>}
		</div>
	);
}

/** A notice's body text, under its title. */
export function NoticeText({ children, title }: { children: ReactNode; title?: string }) {
	return (
		<p title={title} className="text-[15px] text-ink-2">
			{children}
		</p>
	);
}
