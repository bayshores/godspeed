import { CARD } from "@/frontend/components/ui/card-parts";
import { cn } from "@/frontend/lib/utils";
import type { StopAction, StopCardView } from "./stop-card-model";

/** A place to stop, in Your turn: what just finished, what is next, and
 *  the buttons (one of them dark), right-aligned inside the card. */
export function StopCard({ view, onAction }: { view: StopCardView; onAction: (action: StopAction) => void }) {
	return (
		<div data-testid="stop-card" className={cn(CARD, "flex shrink-0 flex-col")}>
			<p className="font-prose text-[18px] leading-[26px] text-ink">{view.lead}</p>
			{view.next && <p className="mt-2 text-[15px] leading-[22px] text-ink-2">{view.next}</p>}
			<div className="mt-3 flex flex-wrap justify-end gap-2">
				{view.buttons.map((b) => (
					<button key={b.action} type="button" data-testid={`stop-${b.action}`} onClick={() => onAction(b.action)} className={cn("lh-btn", b.dark && "lh-btn-main")}>
						{b.label}
					</button>
				))}
			</div>
		</div>
	);
}
