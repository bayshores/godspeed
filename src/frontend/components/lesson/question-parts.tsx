import { ToolContentResponse } from "@/frontend/components/ai-elements/message";
import { cn } from "@/frontend/lib/utils";

/** Lesson prose at a given size (the markdown renderer reads these
 *  variables), in the full text color or the quieter one. */
export function proseVars(size: number, leading: number, quiet = false): React.CSSProperties {
	const ink = quiet ? "var(--muted-foreground)" : "var(--foreground)";
	return { "--lh-prose-size": `${size}px`, "--lh-prose-leading": `${leading / size}`, "--lh-ink-body": ink, "--lh-ink-strong": ink, "--lh-ink-italic": ink } as React.CSSProperties;
}

/** A waiting question's own text, in reading type. */
export function QuestionText({ children }: { children: string }) {
	return (
		<div data-session-find-root="" className="shrink-0" style={proseVars(18, 26)}>
			<ToolContentResponse>{children}</ToolContentResponse>
		</div>
	);
}

/** A row of the answer list; a picked one sits on the space's pale color. */
export const ANSWER_ROW = "lh-press flex w-full gap-3 text-left outline-none transition-colors duration-(--lh-dur) ease-(--lh-ease-out)";
export const PICKED = "bg-(--lh-pale)";

/** "I don't know", the last row under a question's answers. */
export function DontKnowRow({ picked, onClick, className, ...rest }: { picked: boolean; onClick: () => void; className?: string | false; "data-kbdrow"?: number }) {
	return (
		<button
			type="button"
			data-testid="dont-know-option"
			aria-pressed={picked}
			onClick={onClick}
			className={cn(ANSWER_ROW, "items-center px-3 py-2.5 font-prose text-[17px]", picked ? cn(PICKED, "text-ink") : "text-ink-2 hover:bg-tone", className)}
			{...rest}
		>
			I don't know
		</button>
	);
}
