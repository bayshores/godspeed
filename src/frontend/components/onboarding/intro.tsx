import { useEffect, useState } from "react";
import { useSound } from "@/frontend/components/sounds";
import { BIG_BUTTON } from "@/frontend/components/ui/big-button";
import { cn } from "@/frontend/lib/utils";
import { useReturn } from "./use-return";
import { Wordmark } from "./wordmark";

/** How long the intro runs before Return / the button continue. */
const INTRO_MS = 2500;

/** The first screen: the logo and "Get started", rising in as the sky draws. */
export function Intro({ skipped, onSkip, onDone }: { skipped: boolean; onSkip: () => void; onDone: () => void }) {
	const [played, setPlayed] = useState(false);
	const play = useSound();
	useEffect(() => {
		play("intro");
		const timer = setTimeout(() => setPlayed(true), INTRO_MS);
		return () => clearTimeout(timer);
	}, [play]);
	// Return during the animation jumps to its end; after it, continues.
	useReturn(played || skipped ? onDone : onSkip);
	return (
		<div data-testid="onboarding-intro" className="flex w-full flex-col items-center justify-center">
			<div className="ob-rise flex flex-col items-center gap-[30px]">
				<Wordmark />
				<button type="button" data-testid="onboarding-start" className={cn("lh-btn lh-btn-main", BIG_BUTTON)} onClick={onDone}>
					Get started
				</button>
			</div>
		</div>
	);
}
