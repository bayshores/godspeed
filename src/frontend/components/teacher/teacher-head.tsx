import type { SpaceColor } from "@/shared/core";
import { paleSpaceColor } from "@/frontend/components/space-color";
import { TeacherStatus } from "@/frontend/components/terminal/teacher-status";

/** The top of a teacher side, on the space's pale color: the teacher's
 *  name, what it is doing (TeacherStatus), then the side's own buttons. */
export function TeacherHead({
	name,
	color,
	doing,
	children,
}: {
	name: string;
	color: SpaceColor | undefined;
	doing: string | null;
	children?: React.ReactNode;
}) {
	return (
		<div
			data-testid="teacher-head"
			className="flex shrink-0 items-center gap-3 border-b-2 border-line bg-tone py-3 pr-3.5 pl-5"
			style={color ? { background: paleSpaceColor(color) } : undefined}
		>
			<div className="flex min-w-0 flex-1 flex-col items-start">
				<span className="max-w-full truncate text-[18px] leading-snug font-medium text-ink">{name}</span>
				<TeacherStatus name={name} line={doing} testid="teacher-head-doing" className="max-w-full truncate text-sm text-ink-2" />
			</div>
			{children}
		</div>
	);
}
