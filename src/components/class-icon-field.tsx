import { memo } from "react";
import { CLASS_ICONS, type ClassIcon as ClassIconName } from "@/core";
import { ClassIcon } from "@/components/class-icon";
import { cn } from "@/lib/utils";

/** Edit class's Icon field: the subject icons in a grid, the picked one outlined. */

const NAMES = Object.keys(CLASS_ICONS) as ClassIconName[];

export const ClassIconField = memo(function ClassIconField({
	icon,
	disabled,
	labelClass,
	onChange,
}: {
	icon: ClassIconName | undefined;
	disabled: boolean;
	labelClass: string;
	onChange: (icon: ClassIconName) => void;
}) {
	return (
		<div className="mt-2.5 flex flex-col gap-1.5">
			<span className={labelClass}>Icon</span>
			<div role="radiogroup" aria-label="Icon" data-testid="class-icon" className="grid grid-cols-8 gap-2">
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
								"lh-press flex h-11 items-center justify-center border disabled:opacity-60",
								picked ? "border-ink bg-tone-2 text-ink" : "border-transparent bg-tone text-ink-2 hover:text-ink",
							)}
						>
							<ClassIcon icon={name} className="size-5" />
						</button>
					);
				})}
			</div>
			<span className="text-xs text-ink-3">Your agent picks one when it sets up the class. Pick another here any time.</span>
		</div>
	);
});
