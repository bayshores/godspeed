import { useState, type ComponentProps } from "react";
import dynamic from "next/dynamic";
import type { ChainTableOverlay as Overlay } from "@/frontend/components/chain-table-overlay.tsx";

/**
 * "All facts", loaded on its first open: it pulls in KaTeX for its logic
 * glyphs, which the Graph tab and the Study page only need once someone
 * opens it. After that it stays mounted, so its search and sort survive
 * closing and reopening.
 */
const ChainTableOverlay = dynamic(() => import("@/frontend/components/chain-table-overlay.tsx").then((m) => m.ChainTableOverlay), { ssr: false });

export function LazyChainTableOverlay(props: ComponentProps<typeof Overlay>) {
	const [wanted, setWanted] = useState(props.open);
	if (props.open && !wanted) setWanted(true);
	return wanted ? <ChainTableOverlay {...props} /> : null;
}
