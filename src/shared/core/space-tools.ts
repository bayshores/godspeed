/**
 * The space tools both the outside agent's MCP server and the Talk chat
 * offer: their names, descriptions, argument shapes and outcome. The
 * server runs them (server/space-actions.ts); each side declares the
 * schemas in its own library with this text.
 */

/** One change an action made, as the window shows it (a recorded agent action). */
export interface SpaceChange {
	label: string;
	page: string;
}

