/**
 * make-icons.mjs — draw every app icon file from one place.
 *
 * The app's icon is the pixel g with its trail on graphite. Settings > Appearance offers it, the
 * same drawing on paper, and the classic paper tile (crates/shell/icons/classic.svg).
 *
 * Writes the Mac icon's layers (crates/shell/icons/icon.icon), icon.icns, icon.ico and icon.png,
 * the pictures the Mac stamps on the app for a picked icon (crates/shell/icons/choices/), the
 * page's own icon (public/icon.png) and the picker's pictures (public/app-icons/). Run it after
 * changing a drawing, and commit what it writes.
 *
 * Needs rsvg-convert (librsvg), magick (ImageMagick) and iconutil (macOS).
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ICONS = path.join(ROOT, "crates", "shell", "icons");

/** The logo's pixel g, one string per row. */
const G = [".####.#", "#....#.", "#....#.", "#....#.", ".####..", "#......", ".#####.", "#.....#", "#.....#", ".#####."];
/** One square of the g, and where the g starts, on the 1024 canvas. */
const CELL = 60;
const LEFT = 528;
const TOP = 212;
/** The trail's dots: five to a square of the g, seven squares long. */
const DOT = CELL / 5;
const TRAIL_DOTS = 35;
/** How e-ink draws grey: a dot is drawn where the wanted share of ink beats its place in this grid. */
const BAYER = [
	[0, 8, 2, 10],
	[12, 4, 14, 6],
	[3, 11, 1, 9],
	[15, 7, 13, 5],
];

const square = (x, y, size) => `M${x},${y}h${size}v${size}h${-size}z`;
const G_PATH = G.flatMap((row, r) => [...row].map((dot, q) => (dot === "#" ? square(LEFT + q * CELL, TOP + r * CELL, CELL) : ""))).join("");

/** Dots behind each row of the g, thinning out to the left. */
function trailPath() {
	let d = "";
	G.forEach((row, r) => {
		const start = LEFT + row.indexOf("#") * CELL;
		for (let k = 0; k < TRAIL_DOTS; k++) {
			const share = 0.8 * (1 - k / TRAIL_DOTS) ** 1.25;
			for (let b = 0; b < 5; b++) {
				if ((BAYER[(r * 5 + b) % 4][k % 4] + 0.5) / 16 < share) d += square(start - (k + 1) * DOT, TOP + r * CELL + b * DOT, DOT);
			}
		}
	});
	return d;
}
const TRAIL_PATH = trailPath();

const layer = (fill, d) => `<path fill="${fill}" d="${d}"/>`;
/** The whole canvas, drawn on: the g and its trail on a field. */
const speed = ({ field, g, trail }) => layer(field, square(0, 0, 1024)) + layer(trail, TRAIL_PATH) + layer(g, G_PATH);

const GRAPHITE = { field: "#161616", g: "#c9c7bd", trail: "#7f7d73" };
const DRAWINGS = {
	graphite: speed(GRAPHITE),
	paper: speed({ field: "#c9c7bd", g: "#24231f", trail: "#8f8d83" }),
	classic: fs.readFileSync(path.join(ICONS, "classic.svg"), "utf8").replace(/<\/?svg[^>]*>/g, ""),
};

const svg = (inner) => `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">${inner}</svg>\n`;
/** The drawing in a rounded square that fills the canvas: Windows, Linux and the page. */
const filled = (drawing) => svg(`<clipPath id="shape"><rect width="1024" height="1024" rx="230"/></clipPath><g clip-path="url(#shape)">${drawing}</g>`);
/** The drawing in the Mac's icon shape, with the Mac's empty margin around it. */
const forMac = (drawing) => svg(`<clipPath id="shape"><rect width="1024" height="1024" rx="230"/></clipPath><g transform="translate(100,100) scale(${824 / 1024})" clip-path="url(#shape)">${drawing}</g>`);

const work = fs.mkdtempSync(path.join(os.tmpdir(), "godspeed-icons-"));
function png(source, size, file) {
	const from = path.join(work, "source.svg");
	fs.writeFileSync(from, source);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), from, "-o", file]);
}
function write(file, text) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, text);
}

// The Mac icon's layers. macOS cuts the shape and adds its own light, dark and tinted looks.
const assets = path.join(ICONS, "icon.icon", "Assets");
write(path.join(assets, "g.svg"), svg(layer(GRAPHITE.g, G_PATH)));
write(path.join(assets, "trail.svg"), svg(layer(GRAPHITE.trail, TRAIL_PATH)));

// icon.icns, for macOS older than 26.
const iconset = path.join(work, "icon.iconset");
for (const points of [16, 32, 128, 256, 512]) {
	png(forMac(DRAWINGS.graphite), points, path.join(iconset, `icon_${points}x${points}.png`));
	png(forMac(DRAWINGS.graphite), points * 2, path.join(iconset, `icon_${points}x${points}@2x.png`));
}
execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(ICONS, "icon.icns")]);

// Windows and Linux.
png(filled(DRAWINGS.graphite), 512, path.join(ICONS, "icon.png"));
const sizes = [16, 24, 32, 48, 64, 128, 256].map((size) => {
	const file = path.join(work, `ico-${size}.png`);
	png(filled(DRAWINGS.graphite), size, file);
	return file;
});
execFileSync("magick", [...sizes, path.join(ICONS, "icon.ico")]);

// What the Mac stamps on the app for a picked icon. Graphite is the app's own icon and needs none.
for (const name of ["paper", "classic"]) png(forMac(DRAWINGS[name]), 1024, path.join(ICONS, "choices", `${name}.png`));

// The page: its own icon, and the picker's pictures.
fs.copyFileSync(path.join(ICONS, "icon.png"), path.join(ROOT, "public", "icon.png"));
for (const [name, drawing] of Object.entries(DRAWINGS)) write(path.join(ROOT, "public", "app-icons", `${name}.svg`), filled(drawing));

fs.rmSync(work, { recursive: true });
console.log("[make-icons] wrote the icon files");
