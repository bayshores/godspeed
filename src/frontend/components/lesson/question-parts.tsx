import { ToolContentResponse } from "@/frontend/components/ai-elements/message";

/** Lesson prose at a given size (the markdown renderer reads these
 *  variables), in the full text color or the quieter one. */
export function proseVars(size: number, leading: number, quiet = false): React.CSSProperties {
	const ink = quiet ? "var(--muted-foreground)" : "var(--foreground)";
	return { "--lh-prose-size": `${size}px`, "--lh-prose-leading": `${leading / size}`, "--lh-ink-body": ink, "--lh-ink-strong": ink, "--lh-ink-italic": ink } as React.CSSProperties;
}

/** Longer than this, a question is a paragraph and is set at the size of one. */
const SHORT_QUESTION = 140;

/** A question's own text, in reading type: the largest text on the lesson page while it is short enough
 *  to be a headline, with its kind (`tag`) as a small tag under it. Quiet once answered. */
export function QuestionText({ children, quiet = false, tag = null }: { children: string; quiet?: boolean; tag?: string | null }) {
	const big = children.length <= SHORT_QUESTION;
	return (
		<div className="flex flex-col items-start gap-3">
			<div data-session-find-root="" style={big ? proseVars(28, 38, quiet) : proseVars(22, 31, quiet)}>
				<ToolContentResponse>{children}</ToolContentResponse>
			</div>
			{tag && <h2 className="lh-kind">{tag}</h2>}
		</div>
	);
}

/** A row of the answer list; a picked one sits on the space's pale color. */
export const ANSWER_ROW = "lh-press flex w-full gap-3 text-left outline-none transition-colors duration-(--lh-dur) ease-(--lh-ease-out)";
export const PICKED = "bg-(--lh-pale)";
