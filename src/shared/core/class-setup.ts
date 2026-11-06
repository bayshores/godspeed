/**
 * What every class should have, so a class made before an app update
 * catches up: the agent's briefing lists what each class is missing.
 * A new class feature that the agent sets adds its check and its "how" here.
 */

import type { ClassRecord } from "./contracts/class.ts";

type SetupFields = Pick<ClassRecord, "description" | "signature" | "icon">;

const CHECKS: [item: string, missing: (cls: SetupFields) => boolean][] = [
	["icon", (c) => !c.icon],
	["signature", (c) => !c.signature],
	["description", (c) => !c.description.trim()],
];

/** How the agent fills in each missing item. */
export const SETUP_HOW = "Fill them in with update_class: set an icon without asking; write a signature or description from the class's files, asking the learner when unsure.";

/** The setup items the class is missing, e.g. ["icon"]. */
export function missingSetup(cls: SetupFields): string[] {
	return CHECKS.filter(([, missing]) => missing(cls)).map(([item]) => item);
}
