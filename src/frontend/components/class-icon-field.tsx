import { memo } from "react";
import { CLASS_ICONS, type ClassIcon as ClassIconName } from "@/shared/core";
import { ClassIcon } from "@/frontend/components/class-icon";
import { cn } from "@/frontend/lib/utils";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";

/** Edit class's Icon field: the subject icons in rows, the picked one marked. */

const NAMES = Object.keys(CLASS_ICONS) as ClassIconName[];

export const ClassIconField = memo(function ClassIconField({
	icon,
	disabled,
	onChange,
}: {
	icon: ClassIconName | undefined;
	disabled: boolean;
	onChange: (icon: ClassIconName) => void;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<span className={LABEL_TEXT}>Icon</span>
			<div role="radiogroup" aria-label="Icon" data-testid="class-icon" className="flex flex-wrap gap-2">
				{NAMES.map((name) => {
					const picked = name === icon;
					return (
						<button
							key={name}
							type="button"
							role="radio"
							aria-checked={picked}
							aria-label={CLASS_ICONS[name]}
							data-testid={`class-icon-${name}`}
							disabled={disabled}
							onClick={() => onChange(name)}
							className={cn(
								"lh-press flex size-11 items-center justify-center rounded-sm border-[1.5px] text-ink-2 disabled:opacity-60",
								picked ? "border-ink bg-highlight text-ink" : "border-border bg-background hover:text-ink",
							)}
						>
							<ClassIcon icon={name} className="size-5" />
						</button>
					);
				})}
			</div>
			<span className="text-base text-ink-2">Your agent picks one when it sets up the class. Pick another here any time.</span>
		</div>
	);
});
