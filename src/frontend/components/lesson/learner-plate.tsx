import type { ReactNode } from "react";
import { cn } from "@/frontend/lib/utils";

/**
 * The learner's words on a soft plate at the right, as wide as its words up to 82% of the row, in
 * the lesson text and in the teacher's threads alike. Plain text, since the learner's words never
 * go through the model's LaTeX pipeline. `over`: what the words were about (the part of a cheat
 * sheet pointed at); `children`: the learner's files under the words.
 */
export function LearnerPlate({ text, over, children, className }: { text: string; over?: ReactNode; children?: ReactNode; className?: string }) {
	return (
		<div className={cn("my-2 flex w-full justify-end", className)}>
			<div data-testid="user-message" className="flex w-fit max-w-[82%] min-w-0 flex-col gap-2 lh-well px-4 py-2.5">
				{over}
				{text && (
					<div className="whitespace-pre-wrap break-words font-prose text-ink" style={{ fontSize: "var(--lh-prose-size)" }}>
						{text}
					</div>
				)}
				{children}
			</div>
		</div>
	);
}
