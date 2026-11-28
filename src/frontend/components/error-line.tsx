import { useState, type ComponentProps } from "react";
import { riseMotion } from "@/frontend/components/motion";
import { useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";

/** An error line under a form or a key. It rises in when it comes, and again with new words; cleared,
 *  it keeps its last words while it fades out. Words there at the first drawing are simply there. */
export function ErrorLine({ error, className, ...rest }: Omit<ComponentProps<"p">, "children" | "role"> & { error: string | null | undefined }) {
	const { mounted, state, shown } = useLastWhileClosing(error || null);
	const [still, setStill] = useState(error || null);
	if (still !== null && still !== (error || null)) setStill(null);
	if (!mounted) return null;
	const motion = riseMotion(state, className);
	return (
		<p key={shown} role="alert" {...rest} {...motion} className={still ? className : motion.className}>
			{shown}
		</p>
	);
}
