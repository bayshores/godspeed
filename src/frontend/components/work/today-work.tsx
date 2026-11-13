import { useNavigate } from "react-router";
import type { SpaceSummary } from "@/shared/core";
import { spaceColorVar } from "@/frontend/components/space-color";
import { useSpaces } from "@/frontend/components/space-context";
import { Pane } from "@/frontend/components/ui/pane";
import { useWorker } from "./use-worker";
import { todayWorkLine } from "./work-model";

/** On Today: one strip per space with files still to read, with a button
 *  that opens the space. */
export function TodayWork({ spaces }: { spaces: readonly SpaceSummary[] }) {
	const { setActive } = useSpaces();
	const navigate = useNavigate();
	const { worker } = useWorker();
	const strips = spaces.flatMap((space) => {
		const line = todayWorkLine(space, worker);
		return line ? [{ space, line }] : [];
	});
	if (strips.length === 0) return null;
	return (
		<ul data-testid="today-work" className="flex flex-col gap-3">
			{strips.map(({ space, line }) => (
				<li key={space.id}>
					<Pane data-testid={`today-work-${space.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
						<span aria-hidden className="size-3 shrink-0" style={{ background: spaceColorVar(space.color) }} />
						<p title={line} className="min-w-0 flex-1 basis-[260px] truncate text-lg text-ink">
							{line}
						</p>
						<button
							type="button"
							data-testid={`today-work-open-${space.id}`}
							onClick={() => {
								setActive(space.id);
								navigate("/space");
							}}
							className="lh-btn shrink-0"
						>
							Open the space
						</button>
					</Pane>
				</li>
			))}
		</ul>
	);
}
