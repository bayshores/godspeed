import type { ReactNode } from "react";
import { BarSlotsProvider, useBarHosts } from "../src/frontend/components/top-bar/bar-slots.tsx";

/** The two places the top bar gives a page (its crumb and its words), without the rest of the bar, for tests of a page's bar content. */
function Hosts() {
	const { crumbRef, actionsRef } = useBarHosts();
	return (
		<div data-testid="bar-hosts">
			<span data-testid="bar-crumb" ref={crumbRef} />
			<span data-testid="bar-actions" ref={actionsRef} />
		</div>
	);
}

export function BarHost({ children }: { children: ReactNode }) {
	return (
		<BarSlotsProvider>
			<Hosts />
			{children}
		</BarSlotsProvider>
	);
}
