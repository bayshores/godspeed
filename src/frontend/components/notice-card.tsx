import type { HTMLAttributes, ReactNode } from "react";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";

/**
 * The one frame every corner notice shares: a sheet with a title line, an
 * optional close button, a body, and buttons on the right.
 */
export function NoticeCard({
	title,
	close,
	actions,
	className,
	children,
	...rest
}: {
	title: ReactNode;
	close?: { onClick: () => void; testId: string };
	actions?: ReactNode;
	children?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "title">) {
	return (
		<div {...rest} className={cn("lh-rise lh-popup flex w-[380px] max-w-full flex-col gap-2 py-3.5 pr-4 pl-[18px] font-ui", className)}>
			<div className="flex gap-3">
				<p className="min-w-0 flex-1 text-[17px] text-ink">{title}</p>
				{close && (
					<button type="button" data-testid={close.testId} aria-label="Close" onClick={close.onClick} className="lh-press pt-[5px] text-ink-2 hover:text-ink">
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
