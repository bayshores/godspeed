/** The Graph tab before the space has any facts. In a space, "add files" opens its Files tab. */
import { Link } from "react-router";
import { Pane } from "@/frontend/components/ui/pane";

export function GraphEmpty({ inSpace }: { inSpace: boolean }) {
	return (
		<Pane data-testid="graph-empty" className="lh-card flex-1 text-center text-[15px] text-ink-2">
			{inSpace ? (
				<span>
					Start a lesson or{" "}
					<Link to="/space/files" data-testid="graph-empty-add-files" className="text-ink underline hover:text-ink-max">
						add files
					</Link>{" "}
					to build your graph.
				</span>
			) : (
				"Start a lesson or add files to build your graph."
			)}
		</Pane>
	);
}
