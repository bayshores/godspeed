import { memo } from "react";
import type { ClassColor } from "@/shared/core";
import { CLASS_COLOR_NAMES, classColorVar } from "@/frontend/components/class-color";
import { cn } from "@/frontend/lib/utils";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";

/** Edit class's Color field: the class colors in a row, the picked one outlined. */
export const ClassColorField = memo(function ClassColorField({
	color,
	disabled,
	onChange,
}: {
	color: ClassColor;
	disabled: boolean;
	onChange: (color: ClassColor) => void;
}) {
	return (
		<div className="mt-2.5 flex flex-col gap-1.5">
			<span className={LABEL_TEXT}>Color</span>
			<div role="radiogroup" aria-label="Color" data-testid="class-color" className="flex gap-2">
				{CLASS_COLOR_NAMES.map((name, i) => {
					const picked = i + 1 === color;
					return (
						<button
							key={name}
							type="button"
							role="radio"
							aria-checked={picked}
							aria-label={name}
							data-testid={`class-color-${i + 1}`}
							disabled={disabled}
							onClick={() => onChange(i + 1)}
							style={{ background: classColorVar(i + 1) }}
							className={cn("lh-press size-8 disabled:opacity-60", picked && "outline outline-2 outline-offset-2 outline-foreground")}
						/>
					);
				})}
			</div>
		</div>
	);
});
