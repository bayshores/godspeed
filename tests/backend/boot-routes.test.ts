/**
 * What the window reads before it paints, against a real temp data dir:
 *  - GET /api/boot does a page load's work once (onboarding decided, the
 *    MCP token made, the version recorded, the welcome screen used up) and
 *    reads the active space, the spaces, the teacher's name, sounds and the
 *    saved look;
 *  - GET /api/deadlines/[id] finds a deadline's space;
 *  - GET /api/spaces/[id]/deadlines/[deadlineId]/homework is a homework
 *    lesson's view of its deadline.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-boot-routes-"));
const dataDir = path.join(scratch, "data");
const originalEnv = { ...process.env };
// The godspeed folder lives in the scratch dir, never the real ~/godspeed.
process.env.HOME = path.join(scratch, "home");
process.env.LH_DATA_DIR = dataDir;
const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
process.env.LH_VERSION = pkg.version;
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, "agent-folder.json"), JSON.stringify({ folder: path.join(scratch, "home", "godspeed") }));
after(() => {
	process.env = originalEnv;
	fs.rmSync(scratch, { recursive: true, force: true });
});

const bootRoute = await import("../../src/app/api/boot/route.ts");
const deadlineByIdRoute = await import("../../src/app/api/deadlines/[id]/route.ts");
const homeworkRoute = await import("../../src/app/api/spaces/[id]/deadlines/[deadlineId]/homework/route.ts");
const { addSpaceDeadline, createSpace, deleteSpace } = await import("../../src/backend/server/index.ts");
const { readSettings, writeSettings } = await import("../../src/backend/store/settings.ts");
const { readMcpToken } = await import("../../src/backend/store/mcp-token.ts");
const { CURRENT_SETTINGS_VERSION } = await import("../../src/shared/core/settings.ts");

const ctx = <T extends Record<string, unknown>>(p: T) => ({ params: Promise.resolve(p) });
const get = (url: string) => new Request(`http://localhost${url}`);
const boot = async () => {
	const res = bootRoute.GET();
	assert.equal(res.headers.get("cache-control"), "no-store");
	return res.json();
};

describe("GET /api/boot", () => {
	it("a fresh install: the onboarding, the welcome screen once, the token made and the version recorded", async () => {
		const first = await boot();
		assert.deepEqual(first, { onboarding: true, firstLoad: "welcome", whatsNewSince: null, folderNotice: null, activeSpace: null, spaces: [], sounds: true });
		assert.equal(readSettings()?.general?.onboarded, false);
		assert.equal(readSettings()?.general?.lastSeenVersion, pkg.version);
		assert.ok(readMcpToken(), "the outside-agent token is made");
		// A reload mid-onboarding keeps it, and the welcome screen is used up.
		const again = await boot();
		assert.equal(again.onboarding, true);
		assert.equal(again.firstLoad, null);
	});

	it("an existing user: the active space, the spaces, the teacher's name, sounds, the saved look and What's new", async () => {
		const space = createSpace({ name: "Geology" });
		const general = { onboarded: true, activeSpace: space.id, teacherName: "Ada", sounds: false, lastSeenVersion: "0.4.0" };
		writeSettings({ version: CURRENT_SETTINGS_VERSION, general, appearance: { background: "#1b1b19" } });
		const read = await boot();
		assert.equal(read.onboarding, false);
		assert.equal(read.activeSpace, space.id);
		assert.deepEqual(read.spaces.map((c: { name: string }) => c.name), ["Geology"]);
		assert.deepEqual(read.appearance, { background: "#1b1b19" });
		assert.equal(read.teacherName, "Ada");
		assert.equal(read.sounds, false);
		assert.equal(read.whatsNewSince, "0.4.0");
		assert.equal((await boot()).whatsNewSince, null, "the notes show once");
		// A space deleted behind the app's back reads as No space.
		await deleteSpace(space.id);
		assert.equal((await boot()).activeSpace, null);
	});
});

describe("deadline reads", () => {
	it("GET /api/deadlines/[id]: the deadline with its space; 404 once gone", async () => {
		const space = createSpace({ name: "Astronomy" });
		const added = addSpaceDeadline(space.id, { kind: "exam", name: "Midterm", date: "2026-11-20" });
		assert.ok(added.ok);
		const res = await deadlineByIdRoute.GET(get("/x"), ctx({ id: added.value.id }));
		assert.equal(res.status, 200);
		const body = await res.json();
		assert.equal(body.spaceId, space.id);
		assert.equal(body.deadline.name, "Midterm");
		const gone = await deadlineByIdRoute.GET(get("/x"), ctx({ id: "ddl_nope" }));
		assert.equal(gone.status, 404);
		assert.deepEqual(await gone.json(), { error: "No such deadline" });
	});

	it("GET .../homework: name, problems and assignment; 404 for an unknown space or deadline", async () => {
		const space = createSpace({ name: "Botany" });
		const added = addSpaceDeadline(space.id, { kind: "homework", name: "HW 3", date: "2026-11-12" });
		assert.ok(added.ok);
		const res = await homeworkRoute.GET(get("/x"), ctx({ id: space.id, deadlineId: added.value.id }));
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), { homework: { name: "HW 3", problems: [], assignment: null } });
		const unknown: [string, string][] = [[space.id, "ddl_nope"], ["../etc", added.value.id], ["spc_nope", added.value.id]];
		for (const [id, deadlineId] of unknown) {
			const missing = await homeworkRoute.GET(get("/x"), ctx({ id, deadlineId }));
			assert.equal(missing.status, 404, `${id} ${deadlineId}`);
		}
	});
});
