import type { ReactNode } from "react";
import { Link } from "react-router";
import type { MockView } from "@/shared/core";
import { deadlineHref } from "@/frontend/components/overview/overview-model";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";

/** A mock's own bar, in place of the app's top bar (so it is the window's
 *  drag band too): the way back to its deadline, its name, then what the
 *  screen under it adds. */
export function MockBar({ view, children }: { view: MockView; children?: ReactNode }) {
	return (
		<div data-testid="mock-bar" className="lh-own-bar lh-drag lh-lights-gutter lh-wco-gutter flex h-12 shrink-0 select-none items-center gap-4 bg-bar px-6 text-bar-ink">
			<Link to={deadlineHref(view.deadlineId)} data-testid="page-back" aria-label={view.deadlineName === null ? "Back" : undefined} className="lh-btn lh-btn-bar max-w-[28ch] px-3">
				<PixelIcon name="chevron" className="-scale-x-100" />
				{view.deadlineName !== null && <span className="truncate">{view.deadlineName}</span>}
			</Link>
			<h1 className="shrink-0 text-lg font-medium">Mock {view.mock.n}</h1>
			{children ?? <div className="flex-1" aria-hidden />}
		</div>
	);
}
