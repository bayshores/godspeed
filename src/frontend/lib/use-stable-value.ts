import { useMemo } from "react";

/** `value` as first seen until its `key` changes (by default its JSON), so
 *  a value rebuilt on every streamed message doesn't redraw what holds it. */
export function useStableValue<T>(value: T, key: string | undefined = JSON.stringify(value)): T {
	return useMemo(() => value, [key]);
}
