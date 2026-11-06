/**
 * CLUSTER PRESENTATION RULES (vision §1). DETECTION is birth-session
 * clustering (core/session-clusters.ts). What remains here is the one
 * presentation rule the snapshot and the renderer share.
 *
 * Browser-safe pure logic (no node builtins, no fs).
 */

/** Communities below this size are not rendered, not named: a region of
 *  the world model needs at
 *  least three propositions to be worth a hull and a label. */
export const MIN_CLUSTER_SIZE = 3;