/** The backend exits when the app's main process goes away or soon after SIGTERM, using plain Node children. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const guard = fileURLToPath(new URL("../electron/server-parent-guard.cjs", import.meta.url));

describe("server parent guard", () => {
	it("exits with code 0 when the parent's IPC channel closes", { timeout: 10_000 }, async () => {
		// Stands in for the server: stays alive until something ends it.
		const child = spawn(process.execPath, ["--require", guard, "-e", "setInterval(() => {}, 1000); process.send('up');"], {
			stdio: ["ignore", "ignore", "ignore", "ipc"],
		});
		await once(child, "message");
		child.disconnect();
		const [code, signal] = await once(child, "exit");
		assert.equal(code, 0);
		assert.equal(signal, null);
	});

	it("exits within about 2 s of SIGTERM while a shutdown handler still waits", { timeout: 10_000 }, async () => {
		// The empty handler stands in for Next waiting on an open long-poll.
		const child = spawn(process.execPath, ["--require", guard, "-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.send('up');"], {
			stdio: ["ignore", "ignore", "ignore", "ipc"],
		});
		await once(child, "message");
		const sent = Date.now();
		child.kill("SIGTERM");
		const [code] = await once(child, "exit");
		const waited = Date.now() - sent;
		assert.equal(code, 143);
		assert.ok(waited >= 1_900 && waited < 4_000, `exited after ${waited} ms`);
	});

	it("does nothing in a process without an IPC channel", async () => {
		const child = spawn(process.execPath, ["--require", guard, "-e", "setTimeout(() => process.exit(7), 50)"], { stdio: "ignore" });
		const [code] = await once(child, "exit");
		assert.equal(code, 7);
	});
});
