import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import { classCardText, type ClassCardDetails } from "../../core/native-messages.ts";

/**
 * read_class (classes wave, owner-approved 2026-10-26): the CURRENT class
 * card of the lesson's class — name, the learner's description, and the
 * class files with the paths to open them (text with `read`, PDFs with the
 * pdf job). The lesson's opening card is a snapshot from when it started;
 * this is the live version (new files, an edited description).
 *
 * Registered only for lessons in a class (the composition root passes the
 * reader). How to USE class context is doctrine
 * (prompts/shared/12-class-context.md), not this tool's business.
 */
export interface ClassToolContext {
	/** The lesson's class card as it stands now; null = the class is gone. */
	classCard: () => ClassCardDetails | null;
}

const readClassInput = Type.Object({});

export function classTools(ctx: ClassToolContext): Record<string, AgentTool<any>> {
	return {
		read_class: {
			name: "read_class",
			label: "read_class",
			description:
				"Read the current card of this lesson's class: the class name, the learner's description of the course, and its files (study material and course info) with the paths to open them. " +
				"Use it when you need class details the opening [Class context] card may not have (files added since the lesson started, an edited description).",
			parameters: readClassInput,
			execute: serverExecute("read_class", readClassInput, async (): Promise<string> => {
				const card = ctx.classCard();
				return card ? classCardText(card) : "This lesson's class no longer exists.";
			}),
		},
	};
}
