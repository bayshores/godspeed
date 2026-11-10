import { useState, type ComponentProps } from "react";
import type { ChainTableOverlay as Overlay } from "@/frontend/components/chain-table.tsx";
import { lazyComponent } from "@/frontend/lib/lazy-component";

/**
 * The fact-chain overlay, loaded on its first open. The overlay pulls in
 * KaTeX for its logic glyphs; Home and Graph only need it once someone
 * opens it. After the first open it stays mounted, so its search and sort
 * survive closing and reopening.
 */
const ChainTableOverlay = lazyComponent(() => import("@/frontend/components/chain-table.tsx").then((m) => m.ChainTableOverlay));

export function LazyChainTableOverlay(props: ComponentProps<typeof Overlay>) {
	const [wanted, setWanted] = useState(props.open);
	if (props.open && !wanted) setWanted(true);
	return wanted ? <ChainTableOverlay {...props} /> : null;
}
