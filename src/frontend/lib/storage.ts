/** localStorage that never throws: a private window or full storage reads as
 *  empty and a write is dropped, so what's kept lasts for this visit. */
export function readStorage(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

/** `null` removes the key. */
export function writeStorage(key: string, value: string | null): void {
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		/* no storage or full */
	}
}
