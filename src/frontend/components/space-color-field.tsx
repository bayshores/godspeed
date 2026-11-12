import { memo } from "react";
import type { SpaceColor } from "@/shared/core";
import { SPACE_COLOR_NAMES, spaceColorVar } from "@/frontend/components/space-color";
import { cn } from "@/frontend/lib/utils";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";

/** Edit space's Color field: the space colors in a row, the picked one outlined in ink. */
export const SpaceColorField = memo(function SpaceColorField({
	color,
	disabled,
	onChange,
}: {
	color: SpaceColor;
	disabled: boolean;
	onChange: (color: SpaceColor) => void;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<span className={LABEL_TEXT}>Color</span>
			<div role="radiogroup" aria-label="Color" data-testid="space-color" className="flex gap-2">
				{SPACE_COLOR_NAMES.map((name, i) => {
					const picked = i + 1 === color;
					return (
						<button
							key={name}
							type="button"
							role="radio"
							aria-checked={picked}
							aria-label={name}
							data-testid={`space-color-${i + 1}`}
							disabled={disabled}
							onClick={() => onChange(i + 1)}
							style={{ background: spaceColorVar(i + 1) }}
							className={cn("lh-press size-8 border-[1.5px] disabled:opacity-60", picked ? "border-ink outline-2 outline-offset-2 outline-ink" : "border-border")}
						/>
					);
				})}
			</div>
		</div>
	);
});
