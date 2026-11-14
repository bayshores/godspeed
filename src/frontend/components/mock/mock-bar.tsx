import type { ReactNode } from "react";
import { Link } from "react-router";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";

/** A mock's own bar, in place of the app's top bar (so it is the window's
 *  drag band too): the way back to its prep, its name, then what the
 *  screen under it adds. */
export function MockBar({ prepName, n, children }: { prepName: string; n: number; children?: ReactNode }) {
	return (
		<div data-testid="mock-bar" className="lh-own-bar lh-drag lh-lights-gutter lh-wco-gutter flex h-12 shrink-0 select-none items-center gap-4 bg-bar px-6 text-bar-ink">
			<Link to="/space" data-testid="page-back" className="lh-btn lh-btn-bar max-w-[28ch] px-3">
				<PixelIcon name="chevron" className="-scale-x-100" />
				<span className="truncate">{prepName}</span>
			</Link>
			<h1 className="shrink-0 text-lg font-medium">Mock {n}</h1>
			{children ?? <div className="flex-1" aria-hidden />}
		</div>
	);
}
