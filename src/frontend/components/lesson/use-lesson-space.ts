import { useLayoutEffect } from "react";
import { useSpaces } from "@/frontend/components/space-context";

/** The bar lights the lesson's own space, even when it was opened from another one, before the lesson is drawn. */
export function useLessonSpace(spaceId: string | undefined): void {
	const { active, setActive } = useSpaces();
	const lessonSpace = spaceId ?? null;
	useLayoutEffect(() => {
		if (lessonSpace !== active) setActive(lessonSpace);
		// Only when the lesson opens: the learner may pick another space after.
	}, [lessonSpace]);
}
