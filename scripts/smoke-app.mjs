/**
 * smoke-app.mjs — start the packaged app once and wait for its window.
 *
 * Usage: node scripts/smoke-app.mjs <the app's binary>
 *
 * The other checks build the app and test its parts. This starts the finished app: it reads the
 * app's log on stderr until the "window open" line, gives it a few more seconds to crash, and
 * stops it. Only for CI's throwaway machines: a packaged app uses the real godspeed data of
 * whoever runs it.
 */
import { execFileSync, spawn } from "node:child_process";

const BOOT_TIMEOUT_MS = 120_000;
const SETTLE_MS = 5_000;

const [binary] = process.argv.slice(2);
if (!binary) {
	console.error("usage: node scripts/smoke-app.mjs <the app's binary>");
	process.exit(1);
}
if (!process.env.CI) {
	console.error("[smoke-app] REFUSING: this starts the packaged app on the real godspeed data. It runs in CI only.");
	process.exit(1);
}

const app = spawn(binary, [], { stdio: ["ignore", "inherit", "pipe"] });
let log = "";
let settling = false;

function finish(code, message) {
	app.removeAllListeners("exit");
	if (app.exitCode === null && process.platform === "win32") {
		// The app's server is its child; /T takes it too.
		execFileSync("taskkill", ["/pid", String(app.pid), "/T", "/F"], { stdio: "ignore" });
	} else {
		app.kill("SIGKILL");
	}
	console[code === 0 ? "log" : "error"](`[smoke-app] ${message}`);
	process.exit(code);
}

const timeout = setTimeout(() => finish(1, `no window after ${BOOT_TIMEOUT_MS / 1000} s`), BOOT_TIMEOUT_MS);
app.on("error", (err) => finish(1, `cannot start ${binary}: ${err.message}`));
app.on("exit", (code, signal) => finish(1, `the app quit by itself (${signal ?? code})`));
app.stderr.on("data", (chunk) => {
	process.stderr.write(chunk);
	log += chunk;
	if (log.includes("] uncaught: ")) finish(1, "the app panicked");
	if (!settling && log.includes("] window open: ")) {
		settling = true;
		clearTimeout(timeout);
		setTimeout(() => finish(0, "the window opened and the app kept running"), SETTLE_MS);
	}
});
