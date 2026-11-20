import { useRef, type RefObject } from "react";
import { useAppearance } from "@/frontend/components/settings/appearance";
import { useElementWidth } from "@/frontend/lib/use-element-width";
import { pageSrc, pieceWidth } from "./page-piece-model";

/** The picture of a cited page in the theme's ink, at the width the box it fills needs; null
 *  until the box is measured, so the page is asked for once. A box that later narrows keeps the
 *  picture it has. Put the ref on that box. */
export function usePageSrc<T extends HTMLElement>(fileId: string, page: number): [string | null, RefObject<T | null>] {
	const { bodyInk } = useAppearance();
	const [width, ref] = useElementWidth<T>(0);
	const widest = useRef(0);
	widest.current = Math.max(widest.current, width);
	return [widest.current > 0 ? pageSrc(fileId, page, pieceWidth(widest.current, window.devicePixelRatio || 1), bodyInk) : null, ref];
}
