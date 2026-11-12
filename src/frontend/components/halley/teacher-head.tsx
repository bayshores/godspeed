import type { ClassColor } from "@/shared/core";
import { paleClassColor } from "@/frontend/components/class-color";

/** The top of a teacher side, on the class's pale color: the teacher's
 *  name, what it is doing, then the side's own buttons. */
export function TeacherHead({
	name,
	color,
	doing,
	children,
}: {
	name: string;
	color: ClassColor | undefined;
	doing: string | null;
	children?: React.ReactNode;
}) {
	return (
		<div
			data-testid="teacher-head"
			className="flex shrink-0 items-center gap-3 border-b-2 border-line bg-tone py-3 pr-3.5 pl-5"
			style={color ? { background: paleClassColor(color) } : undefined}
		>
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate text-[18px] leading-snug font-medium text-ink">{name}</span>
				{doing && (
					<span data-testid="teacher-head-doing" className="truncate text-sm text-ink-2">
						{doing}
					</span>
				)}
			</div>
			{children}
		</div>
	);
}
