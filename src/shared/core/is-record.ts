/** A plain object: not null, not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A non-empty string. */
export const isText = (v: unknown): v is string => typeof v === "string" && v !== "";

/** `v` if it is one of `names`, else null. */
export const oneOf = <T extends string>(names: readonly T[], v: unknown): T | null => (names.includes(v as T) ? (v as T) : null);
