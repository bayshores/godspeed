/**
 * The godspeed folder's classes/: shortcuts to every class file, so the
 * learner (and their agent) can find them next to CLAUDE.md. Where each one
 * goes is core/class-shortcuts.ts. A manifest in .godspeed/shortcuts.json
 * lists what this made, and a sync only ever removes those, so anything
 * else in classes/ is left alone. Copies in the app's data folder are made
 * read-only on macOS and Linux (deleting them still works there, since that
 * depends on the folder, not the file).
 */
import fs from "node:fs";
import path from "node:path";
import { README_NAME, readmeText, shortcutLayout, type ShortcutClass } from "../../shared/core/class-shortcuts.ts";
import { subscribe } from "../../shared/core/events.ts";
import { stores } from "./stores.ts";
import { classFilePath } from "./class-card.ts";
import { writeFileAtomic } from "../store/write-file-atomic.ts";

interface Made {
	path: string;
	target: string;
	/** Set for a hard link (Windows without symlinks): the inode it shares. */
	ino?: number;
}

interface Manifest {
	links: Made[];
	dirs: string[];
}

const manifestPath = (folder: string) => path.join(folder, ".godspeed", "shortcuts.json");

function readManifest(folder: string): Manifest {
	try {
		const m = JSON.parse(fs.readFileSync(manifestPath(folder), "utf8")) as Partial<Manifest>;
		return { links: Array.isArray(m.links) ? m.links : [], dirs: Array.isArray(m.dirs) ? m.dirs : [] };
	} catch {
		return { links: [], dirs: [] };
	}
}

function lstat(p: string): fs.Stats | null {
	try {
		return fs.lstatSync(p);
	} catch {
		return null;
	}
}

/** Still the link this made (not something the learner put there since). */
function stillOurs(made: Made): boolean {
	const st = lstat(made.path);
	if (!st) return false;
	if (st.isSymbolicLink()) return true;
	return made.ino !== undefined && st.isFile() && st.ino === made.ino;
}

/** A hard link whose target was replaced (an edited linked file) is stale. */
function upToDate(made: Made): boolean {
	if (made.ino === undefined) return fs.readlinkSync(made.path) === made.target;
	try {
		return fs.statSync(made.target).ino === made.ino;
	} catch {
		return false;
	}
}

function link(target: string, at: string): Made | null {
	try {
		fs.symlinkSync(target, at, "file");
		return { path: at, target };
	} catch (err) {
		if (process.platform !== "win32") throw err;
	}
	try {
		fs.linkSync(target, at);
		return { path: at, target, ino: fs.statSync(at).ino };
	} catch {
		return null;
	}
}

function readOnly(file: string): void {
	if (process.platform === "win32") return;
	const st = fs.statSync(file);
	if (st.mode & 0o222) fs.chmodSync(file, st.mode & ~0o222);
}

/** The classes as shortcuts see them, with each file's real location. */
function currentClasses(): { classes: ShortcutClass[]; targets: Map<string, { path: string; copied: boolean }> } {
	const classes: ShortcutClass[] = [];
	const targets = new Map<string, { path: string; copied: boolean }>();
	for (const summary of stores.classStore.listClasses()) {
		const record = stores.classStore.getClass(summary.id);
		if (!record) continue;
		const files = record.files.filter((f) => {
			const p = classFilePath(record, f);
			if (!p || !fs.existsSync(p)) return false;
			targets.set(f.id, { path: p, copied: f.origin === "copied" });
			return true;
		});
		classes.push({ id: record.id, name: record.name, archived: record.archived, files });
	}
	return { classes, targets };
}

/**
 * Make `<folder>/classes` match the classes now: add missing shortcuts,
 * replace changed ones, and remove the ones this made that are gone, then
 * any folder it made that is left empty. `clear` empties it (the folder
 * moved away).
 */
export function syncShortcuts(folder: string, opts: { clear?: boolean } = {}): void {
	const root = path.join(folder, "classes");
	const old = readManifest(folder);
	const { classes, targets } = opts.clear ? { classes: [], targets: new Map() } : currentClasses();
	const want = new Map<string, { path: string; copied: boolean }>();
	for (const s of shortcutLayout(classes)) want.set(path.join(root, ...s.at), targets.get(s.fileId)!);

	const links: Made[] = [];
	for (const made of old.links) {
		if (!stillOurs(made)) continue;
		if (want.get(made.path)?.path === made.target && upToDate(made)) links.push(made);
		else fs.rmSync(made.path, { force: true });
	}
	const kept = new Set(links.map((l) => l.path));

	const dirs = new Set(old.dirs.filter((d) => fs.existsSync(d)));
	const ensureDir = (dir: string) => {
		if (fs.existsSync(dir)) return;
		ensureDir(path.dirname(dir));
		fs.mkdirSync(dir);
		dirs.add(dir);
	};
	const skipped: string[] = [];
	if (want.size > 0) ensureDir(root);
	for (const [at, target] of want) {
		if (target.copied) readOnly(target.path);
		if (kept.has(at)) continue;
		// Something the learner put at this spot stays.
		if (lstat(at)) continue;
		ensureDir(path.dirname(at));
		const made = link(target.path, at);
		if (made) links.push(made);
		else skipped.push(path.relative(root, at));
	}

	const readme = path.join(root, README_NAME);
	if (want.size > 0) {
		writeFileAtomic(readme, readmeText(skipped));
	} else if (fs.existsSync(readme)) {
		fs.rmSync(readme, { force: true });
	}
	// Deepest first, so a class folder empties before classes/ itself.
	for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
		const needed = [...want.keys()].some((p) => p.startsWith(dir + path.sep));
		if (needed) continue;
		try {
			if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
			dirs.delete(dir);
		} catch {
			dirs.delete(dir);
		}
	}
	const manifest: Manifest = { links, dirs: [...dirs] };
	fs.mkdirSync(path.dirname(manifestPath(folder)), { recursive: true });
	writeFileAtomic(manifestPath(folder), `${JSON.stringify(manifest, null, "\t")}\n`);
}

/** Sync without ever throwing: shortcuts are a convenience. */
export function syncShortcutsSafely(folder: string, opts?: { clear?: boolean }): void {
	try {
		syncShortcuts(folder, opts);
	} catch (err) {
		console.error("[class-shortcuts] sync failed:", err);
	}
}

// On globalThis: /api/boot and the folder route are separate module
// instances under Next, and two watchers would sync every change twice.
const G = globalThis as typeof globalThis & { __lhShortcutWatch?: boolean };

/** Re-sync about 2 s after classes change (a burst of changes syncs once).
 *  `folder` is read on each sync, so moving the folder needs no restart. */
export function watchShortcuts(folder: () => string | null): void {
	if (G.__lhShortcutWatch) return;
	G.__lhShortcutWatch = true;
	let timer: ReturnType<typeof setTimeout> | null = null;
	subscribe((e) => {
		if (e.type !== "classes-changed") return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			const f = folder();
			if (f) syncShortcutsSafely(f);
		}, 2000);
		timer.unref?.();
	});
}
