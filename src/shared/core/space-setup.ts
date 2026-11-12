/**
 * What every space should have, so a space made before an app update
 * catches up: the agent's briefing lists what each space is missing.
 * A new space feature that the agent sets adds its check and its "how" here.
 */

import type { SpaceRecord } from "./contracts/space.ts";

type SetupFields = Pick<SpaceRecord, "description" | "signature" | "icon">;

const CHECKS: [item: string, missing: (space: SetupFields) => boolean][] = [
	["icon", (c) => !c.icon],
	["signature", (c) => !c.signature],
	["description", (c) => !c.description.trim()],
];

/** How the agent fills in each missing item. */
export const SETUP_HOW = "Fill them in with update_space: set an icon without asking; write a signature or description from the space's files, asking the learner when unsure.";

/** The setup items the space is missing, e.g. ["icon"]. */
export function missingSetup(space: SetupFields): string[] {
	return CHECKS.filter(([, missing]) => missing(space)).map(([item]) => item);
}
