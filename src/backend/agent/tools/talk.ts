import { Type, type TSchema } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import { CLASS_ICONS, SIGNATURE_MAX } from "../../../shared/core/contracts.ts";
import { CLASS_ARG_TEXT, CLASS_TOOL_TEXT, DEADLINE_KINDS, FILE_KINDS, type ClassActions, type ClassToolName, type ToolOutcome } from "../../../shared/core/class-tools.ts";

/**
 * The Talk chat's tools: the learner's classes, their files and deadlines,
 * the same actions the outside agent's MCP tools run (server/class-actions.ts,
 * passed in). Nothing here deletes a class or a file. Each result's details
 * carry the changes it made, which the Talk thread shows as rows.
 */

const classId = Type.String();
const signature = Type.Optional(
	Type.Object(
		{ kind: Type.Union([Type.Literal("math"), Type.Literal("code"), Type.Literal("text")]), value: Type.String({ minLength: 1, maxLength: SIGNATURE_MAX }) },
		{ description: CLASS_ARG_TEXT.signature },
	),
);
const icon = Type.Union(
	Object.keys(CLASS_ICONS).map((i) => Type.Literal(i)),
	{ description: CLASS_ARG_TEXT.icon },
);
const fileKind = Type.Union(FILE_KINDS.map((k) => Type.Literal(k)), { description: CLASS_ARG_TEXT.fileKind });
const deadlineKind = Type.Union(DEADLINE_KINDS.map((k) => Type.Literal(k)), { description: CLASS_ARG_TEXT.deadlineKind });

const SCHEMAS: Record<ClassToolName, TSchema> = {
	list_classes: Type.Object({}),
	read_class: Type.Object({ class_id: classId, files: Type.Optional(Type.Boolean({ description: CLASS_ARG_TEXT.files })) }),
	search_class_files: Type.Object({
		class_id: classId,
		query: Type.String({ minLength: 1, description: CLASS_ARG_TEXT.query }),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: CLASS_ARG_TEXT.limit })),
	}),
	read_passage: Type.Object({
		class_id: classId,
		passage_id: Type.Optional(Type.String({ description: CLASS_ARG_TEXT.passageId })),
		file_id: Type.Optional(Type.String({ description: CLASS_ARG_TEXT.fileId })),
		range: Type.Optional(Type.String({ description: CLASS_ARG_TEXT.range })),
	}),
	create_class: Type.Object({
		name: Type.String({ minLength: 1, description: CLASS_ARG_TEXT.name }),
		description: Type.Optional(Type.String({ description: CLASS_ARG_TEXT.description })),
		signature,
		icon,
	}),
	update_class: Type.Object({
		class_id: classId,
		name: Type.Optional(Type.String({ minLength: 1 })),
		description: Type.Optional(Type.String()),
		signature,
		icon: Type.Optional(icon),
		archived: Type.Optional(Type.Boolean()),
	}),
	add_class_file: Type.Object({ class_id: classId, path: Type.String({ description: CLASS_ARG_TEXT.filePath }), kind: fileKind }),
	set_class_file_kind: Type.Object({
		class_id: classId,
		file_ids: Type.Array(Type.String(), { minItems: 1, description: CLASS_ARG_TEXT.fileIds }),
		kind: fileKind,
	}),
	add_class_deadline: Type.Object({
		class_id: classId,
		deadlines: Type.Array(
			Type.Object({
				kind: deadlineKind,
				name: Type.String({ minLength: 1, description: CLASS_ARG_TEXT.deadlineName }),
				date: Type.String({ description: CLASS_ARG_TEXT.date }),
				time: Type.Optional(Type.String({ description: CLASS_ARG_TEXT.time })),
				file_ids: Type.Optional(Type.Array(Type.String(), { description: CLASS_ARG_TEXT.coveredFiles })),
				left_out_ids: Type.Optional(Type.Array(Type.String(), { description: CLASS_ARG_TEXT.leftOutFiles })),
				source: Type.Optional(Type.String({ description: CLASS_ARG_TEXT.source })),
			}),
			{ minItems: 1 },
		),
	}),
	update_class_deadline: Type.Object({
		class_id: classId,
		deadline_id: Type.String(),
		kind: Type.Optional(deadlineKind),
		name: Type.Optional(Type.String({ minLength: 1 })),
		date: Type.Optional(Type.String({ description: "YYYY-MM-DD." })),
		time: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: CLASS_ARG_TEXT.newTime })),
		file_ids: Type.Optional(Type.Array(Type.String(), { description: CLASS_ARG_TEXT.coveredFiles })),
		left_out_ids: Type.Optional(Type.Array(Type.String(), { description: CLASS_ARG_TEXT.leftOutFiles })),
		source: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: CLASS_ARG_TEXT.source })),
		done: Type.Optional(Type.Boolean()),
	}),
	remove_class_deadline: Type.Object({ class_id: classId, deadline_id: Type.String() }),
	link_class_folder: Type.Object({ class_id: classId, path: Type.String({ description: CLASS_ARG_TEXT.folderPath }) }),
};

/** An action's outcome as a tool result: the value for the model, the
 *  changes for the thread; a refusal throws, so the model sees an error. */
function toResult(outcome: ToolOutcome) {
	if (!outcome.ok) throw new Error(outcome.error);
	return { text: typeof outcome.value === "string" ? outcome.value : JSON.stringify(outcome.value), details: { changes: outcome.changes } };
}

export function talkTools(actions: ClassActions): Record<string, AgentTool<any>> {
	const tools: Record<string, AgentTool<any>> = {};
	for (const name of Object.keys(SCHEMAS) as ClassToolName[]) {
		const parameters = SCHEMAS[name];
		const run = actions[name] as (args: unknown) => ToolOutcome | Promise<ToolOutcome>;
		tools[name] = {
			name,
			label: name,
			description: CLASS_TOOL_TEXT[name],
			parameters,
			execute: serverExecute(name, parameters, async (args) => toResult(await run(args))),
		};
	}
	return tools;
}
