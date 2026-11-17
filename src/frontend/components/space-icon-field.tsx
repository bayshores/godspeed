import { memo } from "react";
import { DEFAULT_TEACHER_NAME, SPACE_ICONS, type SpaceIcon as SpaceIconName } from "@/shared/core";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { SpaceIcon } from "@/frontend/components/space-icon";
import { cn } from "@/frontend/lib/utils";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";

/** Edit space's Icon field: the subject icons in rows, the picked one
 *  marked. */

const NAMES = Object.keys(SPACE_ICONS) as SpaceIconName[];

export const SpaceIconField = memo(function SpaceIconField({
	icon,
	disabled,
	onChange,
}: {
	icon: SpaceIconName | undefined;
	disabled: boolean;
	onChange: (icon: SpaceIconName) => void;
}) {
	const teacher = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	return (
		<div className="flex flex-col gap-1.5">
			<span className={LABEL_TEXT}>Icon</span>
			<div role="radiogroup" aria-label="Icon" data-testid="space-icon" className="flex flex-wrap gap-2">
				{NAMES.map((name) => {
					const picked = name === icon;
					return (
						<button
							key={name}
							type="button"
							role="radio"
							aria-checked={picked}
							aria-label={SPACE_ICONS[name]}
							data-testid={`space-icon-${name}`}
							disabled={disabled}
							onClick={() => onChange(name)}
							className={cn(
								"lh-press flex size-11 items-center justify-center rounded-sm text-ink-2 disabled:opacity-60",
								picked ? "bg-highlight text-ink" : "lh-well hover:text-ink",
							)}
						>
							<SpaceIcon icon={name} className="size-[22px]" />
						</button>
					);
				})}
			</div>
			<span className="text-base text-ink-2">{teacher} picks one when it sets up the space. Pick another here any time.</span>
		</div>
	);
});
