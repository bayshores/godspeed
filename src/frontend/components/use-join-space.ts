import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useSpaces } from "@/frontend/components/space-context";

/** A page of one space (a deadline, its mock or cheat sheet) switches the
 *  window to that space when it opens; once the learner switches to
 *  another space, it gives way to that space's own page. */
export function useJoinSpace(spaceId: string): void {
	const navigate = useNavigate();
	const { active, setActive } = useSpaces();
	const [joined, setJoined] = useState(active === spaceId);
	useEffect(() => {
		if (!joined) {
			if (active === spaceId) setJoined(true);
			else setActive(spaceId);
		} else if (active !== spaceId) navigate("/space", { replace: true });
	}, [active, spaceId, joined, setActive, navigate]);
}

/** Switch the window to a space, then go to one of its pages. */
export function useOpenInSpace(): (spaceId: string, href: string) => void {
	const { setActive } = useSpaces();
	const navigate = useNavigate();
	return useCallback(
		(spaceId: string, href: string) => {
			setActive(spaceId);
			void navigate(href);
		},
		[setActive, navigate],
	);
}
