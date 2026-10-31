/** Shown when the access settings can't be read. */
export const ACCESS_ERROR = "Agent access settings are unavailable. Restart godspeed and try again.";

/** The token as dots and its last four characters. */
export function maskToken(token: string): string {
	return token.length <= 4 ? token : `${"•".repeat(12)}${token.slice(-4)}`;
}
