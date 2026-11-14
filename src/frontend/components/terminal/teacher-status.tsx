import { cn } from "@/frontend/lib/utils";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { teacherStatusLine } from "./terminal-model";
import { useTerminals } from "./use-terminals";

/** The teacher's status line under its name. While godspeed runs the
 *  teacher's terminal, it says when the teacher starts or needs the
 *  learner, and a click shows the screen; otherwise it is the usual line,
 *  as plain text. */
export function TeacherStatus({ name, line, testid, className }: {
	name: string;
	/** The usual line, used while the terminal has nothing to say. */
	line: string | null;
	testid: string;
	className?: string;
}) {
	const api = useTerminals();
	const text = teacherStatusLine(api?.facts.teacher ?? null, name) ?? line;
	if (!text) return null;
	if (!api?.teacher)
		return (
			<span data-testid={testid} className={className}>
				{text}
			</span>
		);
	return (
		<button
			type="button"
			data-testid={testid}
			onClick={() => api.show("teacher")}
			className={cn("lh-press inline-flex max-w-full items-center gap-1.5 text-left hover:text-ink hover:underline", className)}
		>
			<span className="truncate">{text}</span>
			<PixelIcon name="window" />
		</button>
	);
}
