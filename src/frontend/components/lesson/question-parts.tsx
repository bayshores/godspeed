import { ToolContentResponse } from "@/frontend/components/ai-elements/message";

/** Lesson prose at a given size (the markdown renderer reads these
 *  variables), in the full text color or the quieter one. */
export function proseVars(size: number, leading: number, quiet = false): React.CSSProperties {
	const ink = quiet ? "var(--muted-foreground)" : "var(--foreground)";
	return { "--lh-prose-size": `${size}px`, "--lh-prose-leading": `${leading / size}`, "--lh-ink-body": ink, "--lh-ink-strong": ink, "--lh-ink-italic": ink } as React.CSSProperties;
}

/** A question's own text, in reading type, the biggest text under "Your turn"; quiet once answered. */
export function QuestionText({ children, quiet = false }: { children: string; quiet?: boolean }) {
	return (
		<div data-session-find-root="" style={proseVars(22, 31, quiet)}>
			<ToolContentResponse>{children}</ToolContentResponse>
		</div>
	);
}

/** A row of the answer list; a picked one sits on the space's pale color. */
export const ANSWER_ROW = "lh-press flex w-full gap-3 text-left outline-none transition-colors duration-(--lh-dur) ease-(--lh-ease-out)";
export const PICKED = "bg-(--lh-pale)";
