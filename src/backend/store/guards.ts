/** Shape guards the stores use when reading JSON files. */

export function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null;
}

export const isString = (v: unknown): v is string => typeof v === "string";
