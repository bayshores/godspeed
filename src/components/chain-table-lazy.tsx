import { useState, type ComponentProps } from "react";
import dynamic from "next/dynamic";
import type { ChainTableOverlay as Overlay } from "@/components/chain-table.tsx";

/**
 * The fact-chain overlay, loaded on its first open. The overlay pulls in
 * KaTeX for its logic glyphs; Home and Graph only need it once someone
 * opens it. After the first open it stays mounted, so its search and sort
 * survive closing and reopening.
 */
const ChainTableOverlay = dynamic(() => import("@/components/chain-table.tsx").then((m) => m.ChainTableOverlay), { ssr: false });

export function LazyChainTableOverlay(props: ComponentProps<typeof Overlay>) {
	const [wanted, setWanted] = useState(props.open);
	if (props.open && !wanted) setWanted(true);
	return wanted ? <ChainTableOverlay {...props} /> : null;
}
