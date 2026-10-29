/**
 * Preloaded into the packaged backend on every platform, before Next starts.
 *
 * The app's cleanup can't run when its main process is force-quit or
 * crashes. The IPC channel to it closes either way, so the server exits
 * then instead of holding the port and the data dir as an orphan.
 *
 * On SIGTERM Next waits for open requests to finish, and an agent's
 * wait_for_work long-poll can hold that up for most of a minute after the
 * app has quit. The server gets 2 s to close cleanly, then exits anyway.
 */
const FORCE_EXIT_MS = 2000;
if (process.channel) process.once("disconnect", () => process.exit(0));
process.once("SIGTERM", () => setTimeout(() => process.exit(143), FORCE_EXIT_MS).unref());
