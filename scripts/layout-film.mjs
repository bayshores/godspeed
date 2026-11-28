/**
 * layout-film.mjs — films one move of a screen for `npm run layout` (`LAYOUT_FILM`).
 *
 * A move of 110 ms is over in one or two photographs of the window. So the page's clock is slowed,
 * the move is started, and the window is photographed as fast as it allows; the clip is then played
 * at true speed, and the numbered frames stay beside it to be read one by one.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/** How many times slower the page's clock runs while it is filmed. */
const SLOW = 5;
/** How much of the page's own time a film holds: the longest move (a page's travel) and what follows it. */
const FILM_MS = 1500;

/** Slows what moves a page: its clock, its timers, its frames' time and every animation, those begun later too. */
const SLOWED = `const K = ${SLOW};
const now = performance.now.bind(performance);
const from = now();
performance.now = () => from + (now() - from) / K;
const timeout = window.setTimeout;
window.setTimeout = (run, ms, ...rest) => timeout(run, (ms || 0) * K, ...rest);
const frame = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (run) => frame(() => run(performance.now()));
const animate = Element.prototype.animate;
Element.prototype.animate = function (keyframes, options) {
	const animation = animate.call(this, keyframes, options);
	animation.playbackRate = 1 / K;
	return animation;
};
const slow = () => {
	for (const animation of document.getAnimations()) if (animation.playbackRate === 1) animation.playbackRate = 1 / K;
	frame(slow);
};
frame(slow);`;

/**
 * Films what `action` (a script run in the page) starts, into `<dir>/0000.png` and on, the first
 * frame taken before the move. Answers the clip, `<dir>.mp4`. The page is left slowed: load it
 * again before anything else is done with it.
 */
export async function film(app, dir, action) {
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	const frameFile = (n) => path.join(dir, `${String(n).padStart(4, "0")}.png`);
	await app.run(SLOWED);
	await app.value(`snap ${frameFile(0)}`);
	await app.run(action);
	const started = Date.now();
	let frames = 1;
	while (Date.now() - started < FILM_MS * SLOW) await app.value(`snap ${frameFile(frames++)}`);
	const rate = ((frames - 1) / (Date.now() - started)) * 1000 * SLOW;
	const clip = `${dir}.mp4`;
	execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", rate.toFixed(3), "-i", path.join(dir, "%04d.png"), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-r", "60", "-pix_fmt", "yuv420p", "-crf", "16", clip]);
	return clip;
}
