"use client";

import { useEffect } from "react";

/** Sent when a bar the teacher must rest above comes or goes. */
export const HALLEY_AVOID_EVENT = "lh:halley-avoid";

/** For a bottom action bar marked data-halley-avoid: the teacher moves
 *  above it when it appears and back down when it goes. */
export function useHalleyAvoid(): void {
	useEffect(() => {
		const notify = () => {
			window.dispatchEvent(new CustomEvent(HALLEY_AVOID_EVENT));
		};
		notify();
		return notify;
	}, []);
}
