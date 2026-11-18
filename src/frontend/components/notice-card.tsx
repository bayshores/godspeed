import type { HTMLAttributes, ReactNode, Ref } from "react";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { useNotice } from "./notice-store";
import type { NoticeKind } from "./notice-stack-model";

/**
 * The one frame every notice shares, a section of the pill's panel: a
 * title line, an optional close button, a body, and buttons on the right.
 * It shows by itself for a while, then waits folded in the pill. The pill
 * says the title of the notice that just came, so that one shows only what
 * is under it, with its close button at the top right.
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
	/** It closes by itself after a while, so it never folds into the pill. */
	timed?: boolean;
	close?: { onClick: () => void; testId: string };
	actions?: ReactNode;
	children?: ReactNode;
	ref?: Ref<HTMLDivElement>;
} & Omit<HTMLAttributes<HTMLDivElement>, "title">) {
	const bare = !children && !actions;
	const { shown, said } = useNotice(title, kind, bare, timed);
	// With only a title, the pill says all of it. Its time still runs, so it is not `hidden` (use-held.ts).
	const onPill = said && bare;
	// The click stops here: a card may open something on its whole surface.
	const closeKey = close && (
		<button
			type="button"
			data-testid={close.testId}
			aria-label="Close"
			onClick={(e) => {
				e.stopPropagation();
				close.onClick();
			}}
			className="lh-press pt-[5px] text-ink-2 hover:text-ink"
		>
			<PixelIcon name="close" />
		</button>
	);
	return (
		<div {...rest} hidden={!shown} data-shown={shown && !onPill ? "" : undefined} className={cn("lh-notice flex-col gap-2 py-3.5 pr-4 pl-[18px] font-ui", onPill ? "hidden" : "flex", className)}>
			{!said && (
				<div className="flex gap-3">
					<p className="min-w-0 flex-1 text-[17px] text-ink">{title}</p>
					{closeKey}
				</div>
			)}
			{said && closeKey ? (
				<div className="flex gap-3">
					<div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
					{closeKey}
				</div>
			) : (
				children
			)}
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
