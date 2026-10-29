/**
 * Preloaded into the packaged backend on every platform, before Next starts.
 *
 * The app's cleanup can't run when its main process is force-quit or
 * crashes. The IPC channel to it closes either way, so the server exits
 * then instead of holding the port and the data dir as an orphan.
 */
if (process.channel) process.once("disconnect", () => process.exit(0));
