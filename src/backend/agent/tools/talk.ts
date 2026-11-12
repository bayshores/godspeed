import { Type, type TSchema } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import { SPACE_ICONS, SIGNATURE_MAX } from "../../../shared/core/contracts.ts";
import { SPACE_ARG_TEXT, SPACE_TOOL_TEXT, DEADLINE_KINDS, FILE_KINDS, type SpaceActions, type SpaceToolName, type ToolOutcome } from "../../../shared/core/space-tools.ts";

/**
 * The Talk chat's tools: the learner's spaces, their files and deadlines,
 * the same actions the outside agent's MCP tools run (server/space-actions.ts,
 * passed in). Nothing here deletes a space or a file. Each result's details
 * carry the changes it made, which the Talk thread shows as rows.
 */

const spaceId = Type.String();
const signature = Type.Optional(
	Type.Object(
		{ kind: Type.Union([Type.Literal("math"), Type.Literal("code"), Type.Literal("text")]), value: Type.String({ minLength: 1, maxLength: SIGNATURE_MAX }) },
		{ description: SPACE_ARG_TEXT.signature },
	),
);
const icon = Type.Union(
	Object.keys(SPACE_ICONS).map((i) => Type.Literal(i)),
	{ description: SPACE_ARG_TEXT.icon },
);
const fileKind = Type.Union(FILE_KINDS.map((k) => Type.Literal(k)), { description: SPACE_ARG_TEXT.fileKind });
const deadlineKind = Type.Union(DEADLINE_KINDS.map((k) => Type.Literal(k)), { description: SPACE_ARG_TEXT.deadlineKind });

const SCHEMAS: Record<SpaceToolName, TSchema> = {
	list_spaces: Type.Object({}),
	read_space: Type.Object({ space_id: spaceId, files: Type.Optional(Type.Boolean({ description: SPACE_ARG_TEXT.files })) }),
	search_space_files: Type.Object({
		space_id: spaceId,
		query: Type.String({ minLength: 1, description: SPACE_ARG_TEXT.query }),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: SPACE_ARG_TEXT.limit })),
	}),
	read_passage: Type.Object({
		space_id: spaceId,
		passage_id: Type.Optional(Type.String({ description: SPACE_ARG_TEXT.passageId })),
		file_id: Type.Optional(Type.String({ description: SPACE_ARG_TEXT.fileId })),
		range: Type.Optional(Type.String({ description: SPACE_ARG_TEXT.range })),
	}),
	create_space: Type.Object({
		name: Type.String({ minLength: 1, description: SPACE_ARG_TEXT.name }),
		description: Type.Optional(Type.String({ description: SPACE_ARG_TEXT.description })),
		signature,
		icon,
	}),
	update_space: Type.Object({
		space_id: spaceId,
		name: Type.Optional(Type.String({ minLength: 1 })),
		description: Type.Optional(Type.String()),
		signature,
		icon: Type.Optional(icon),
		archived: Type.Optional(Type.Boolean()),
	}),
	add_space_file: Type.Object({ space_id: spaceId, path: Type.String({ description: SPACE_ARG_TEXT.filePath }), kind: fileKind }),
	set_space_file_kind: Type.Object({
		space_id: spaceId,
		file_ids: Type.Array(Type.String(), { minItems: 1, description: SPACE_ARG_TEXT.fileIds }),
		kind: fileKind,
	}),
	add_space_deadline: Type.Object({
		space_id: spaceId,
		deadlines: Type.Array(
			Type.Object({
				kind: deadlineKind,
				name: Type.String({ minLength: 1, description: SPACE_ARG_TEXT.deadlineName }),
				date: Type.String({ description: SPACE_ARG_TEXT.date }),
				time: Type.Optional(Type.String({ description: SPACE_ARG_TEXT.time })),
				file_ids: Type.Optional(Type.Array(Type.String(), { description: SPACE_ARG_TEXT.coveredFiles })),
				left_out_ids: Type.Optional(Type.Array(Type.String(), { description: SPACE_ARG_TEXT.leftOutFiles })),
				source: Type.Optional(Type.String({ description: SPACE_ARG_TEXT.source })),
				assignment_file_id: Type.Optional(Type.String({ description: SPACE_ARG_TEXT.assignmentFile })),
			}),
			{ minItems: 1 },
		),
	}),
	update_space_deadline: Type.Object({
		space_id: spaceId,
		deadline_id: Type.String(),
		kind: Type.Optional(deadlineKind),
		name: Type.Optional(Type.String({ minLength: 1 })),
		date: Type.Optional(Type.String({ description: "YYYY-MM-DD." })),
		time: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: SPACE_ARG_TEXT.newTime })),
		file_ids: Type.Optional(Type.Array(Type.String(), { description: SPACE_ARG_TEXT.coveredFiles })),
		left_out_ids: Type.Optional(Type.Array(Type.String(), { description: SPACE_ARG_TEXT.leftOutFiles })),
		source: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: SPACE_ARG_TEXT.source })),
		assignment_file_id: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: SPACE_ARG_TEXT.assignmentFile })),
		done: Type.Optional(Type.Boolean()),
	}),
	remove_space_deadline: Type.Object({ space_id: spaceId, deadline_id: Type.String() }),
	link_space_folder: Type.Object({ space_id: spaceId, path: Type.String({ description: SPACE_ARG_TEXT.folderPath }) }),
	start_lesson: Type.Object({
		topic: Type.String({ minLength: 1, description: SPACE_ARG_TEXT.topic }),
		space_id: Type.Optional(Type.String({ description: SPACE_ARG_TEXT.lessonSpace })),
	}),
};

/** An action's outcome as a tool result: the value for the model, the
 *  changes for the thread; a refusal throws, so the model sees an error. */
function toResult(outcome: ToolOutcome) {
	if (!outcome.ok) throw new Error(outcome.error);
	return { text: typeof outcome.value === "string" ? outcome.value : JSON.stringify(outcome.value), details: { changes: outcome.changes } };
}

/** What a lesson adds to its own space tools: the deadline changes a
 *  learner asks for mid-lesson ("add HW 4, due Friday"). Each tool's
 *  definition costs the agent tokens, so the rest stays in Talk. */
const LESSON_CHANGES: readonly SpaceToolName[] = ["list_spaces", "add_space_deadline", "update_space_deadline", "remove_space_deadline"];

export function lessonSpaceChangeTools(actions: SpaceActions): Record<string, AgentTool<any>> {
	return talkTools(actions, LESSON_CHANGES);
}

export function talkTools(actions: SpaceActions, names: readonly SpaceToolName[] = Object.keys(SCHEMAS) as SpaceToolName[]): Record<string, AgentTool<any>> {
	const tools: Record<string, AgentTool<any>> = {};
	for (const name of names) {
		const parameters = SCHEMAS[name];
		const run = actions[name] as (args: unknown) => ToolOutcome | Promise<ToolOutcome>;
		tools[name] = {
			name,
			label: name,
			description: SPACE_TOOL_TEXT[name],
			parameters,
			execute: serverExecute(name, parameters, async (args) => toResult(await run(args))),
		};
	}
	return tools;
}
