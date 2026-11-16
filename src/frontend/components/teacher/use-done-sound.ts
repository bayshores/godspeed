/**
 * Plays the "done" sound when a reply finishes (turn-settled) or the teacher
 * in its terminal finished answering or needs the learner (agent-event),
 * by done-sound-model.ts.
 */
import { useRef } from "react";
import { useServerEvent } from "@/frontend/components/server-events";
import { useSound } from "@/frontend/components/sounds";
import { donePlays, type DoneMoment } from "./done-sound-model";

export function useDoneSound(panelOpen: boolean): void {
	const play = useSound();
	const lastAt = useRef<number | null>(null);
	const open = useRef(panelOpen);
	open.current = panelOpen;
	const moment = (kind: DoneMoment) => {
		const now = Date.now();
		if (!donePlays({ moment: kind, focused: document.hasFocus(), panelOpen: open.current, lastAt: lastAt.current, now })) return;
		lastAt.current = now;
		play("done");
	};
	useServerEvent("turn-settled", () => moment("reply"));
	useServerEvent("agent-event", () => moment("terminal"));
}
