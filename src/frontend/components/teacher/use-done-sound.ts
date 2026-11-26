/** Plays the "done" sound when a reply finishes (turn-settled), by done-sound-model.ts. */
import { useRef } from "react";
import { useServerEvent } from "@/frontend/components/server-events";
import { useSound } from "@/frontend/components/sounds";
import { donePlays } from "./done-sound-model";

export function useDoneSound(): void {
	const play = useSound();
	const lastAt = useRef<number | null>(null);
	useServerEvent("turn-settled", () => {
		const now = Date.now();
		if (!donePlays({ focused: document.hasFocus(), lastAt: lastAt.current, now })) return;
		lastAt.current = now;
		play("done");
	});
}
