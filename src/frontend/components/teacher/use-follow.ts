/** Follow: whether the window goes where the agent works. The learner's
 *  choice is kept in browser storage; while it is on, typing or an open
 *  dialog makes it wait. */

import { useCallback, useEffect, useRef, useState } from "react";
import { readStorage, writeStorage } from "@/frontend/lib/storage";
import { FOLLOW_DEFAULT, FOLLOW_KEY, followReducer, parseFollow, type FollowEvent, type FollowState } from "./follow";
import { dialogOpen } from "./dom";

export function useFollow() {
	// The tour reads the state between renders, so it lives in a ref.
	const followRef = useRef<FollowState>(FOLLOW_DEFAULT);
	const [followOn, setFollowOn] = useState(FOLLOW_DEFAULT.on);
	const dispatchFollow = useCallback((e: FollowEvent) => {
		const next = followReducer(followRef.current, e);
		followRef.current = next;
		setFollowOn(next.on);
	}, []);
	useEffect(() => {
		if (!parseFollow(readStorage(FOLLOW_KEY))) dispatchFollow({ type: "toggle", on: false });
	}, [dispatchFollow]);
	const setFollow = useCallback(
		(on: boolean) => {
			writeStorage(FOLLOW_KEY, on ? "1" : "0");
			dispatchFollow({ type: "toggle", on });
		},
		[dispatchFollow],
	);
	// While Follow is on, note when the learner types or has a dialog open.
	useEffect(() => {
		if (!followOn) return;
		const busy = () => dispatchFollow({ type: "busy", at: Date.now() });
		document.addEventListener("input", busy, true);
		const t = setInterval(() => {
			if (dialogOpen()) busy();
		}, 250);
		return () => {
			document.removeEventListener("input", busy, true);
			clearInterval(t);
		};
	}, [followOn, dispatchFollow]);
	return { followRef, followOn, dispatchFollow, setFollow };
}
