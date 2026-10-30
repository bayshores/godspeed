/**
 * The universal argument heal, wired at every tool. A heal wired only to
 * the tool where a bad argument once landed misses the next tool (a quiz
 * once looped on `type: "\"predict\""` because only practice was healed).
 * So every tool heals what is mechanically recognizable (a JSON-encoded
 * stand-in for the schema-expected shape; the membership-value debris
 * strip lives in core/value-debris) and validation rejects the rest.
 *
 * The pure function lives in core/argument-heal (the display seam needs
 * it too — the tool-parts law); this module is the per-tool/registry
 * wiring at pi's prepareArguments seam — BEFORE TypeBox validation.
 * Well-formed args pass through UNTOUCHED (same reference); heals are
 * idempotent, so a per-tool heal composed under the record-level
 * wrapper is a harmless second pass.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { healEncodedArguments } from "../../core/argument-heal.ts";

export { healEncodedArguments };

/** Wrap ONE tool with the standard heal: the tool's own prepareArguments
 *  (options-unwrap, target normalization, …) runs first, then the heal
 *  against the tool's declared schema. Spread-safe (these are plain
 *  object literals) and idempotent. */
function withArgumentHeal(tool: AgentTool<any>): AgentTool<any> {
	const inner = tool.prepareArguments;
	return {
		...tool,
		prepareArguments: (args: unknown) => healEncodedArguments(inner ? inner(args) : args, tool.parameters),
	};
}

/** The registry-wide form: wrap every tool in a tool record. Applied at
 *  the registry-assembly points — createProberTools, createTeacherTools, practiceTools,
 *  bareQuestionTools, the subagent sets — so no tool can ship unwrapped. */
export function healToolRecord(tools: Record<string, AgentTool<any>>): Record<string, AgentTool<any>> {
	return Object.fromEntries(Object.entries(tools).map(([name, tool]) => [name, withArgumentHeal(tool)]));
}
