import type { ReactNode } from "react";
import Link from "next/link";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";

/**
 * A page's own row under the top bar: the way back and the page's name at
 * the left, its buttons at the right.
 */
export function PageBar({
	back,
	title,
	children,
}: {
	back?: { label: string; href: string };
	/** A string is the page's heading; a node is shown as is. */
	title?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div data-testid="page-bar" className="flex min-h-12 shrink-0 flex-wrap items-center gap-3 px-6 py-2">
			<div className="flex min-w-0 flex-1 items-center gap-3">
				{back && (
					<Link href={back.href} prefetch={false} data-testid="page-back" className="lh-btn lh-btn-quiet max-w-[28ch] shrink-0">
						<PixelIcon name="chevron" className="-scale-x-100" />
						<span className="truncate">{back.label}</span>
					</Link>
				)}
				{typeof title === "string" ? <h1 className="min-w-0 truncate text-[17px] font-medium text-ink">{title}</h1> : title}
			</div>
			{children}
		</div>
	);
}
