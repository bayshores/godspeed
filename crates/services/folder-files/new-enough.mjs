#!/usr/bin/env node
/**
 * The Claude Code start scripts' version check: reads `claude --version`
 * on stdin and exits 1 when it names a version older than the one given.
 *
 *   claude --version | node new-enough.mjs 2.1.330
 *
 * Output with no version in it passes, so an unusual install still starts.
 * No dependencies; Node 18+.
 */
let input = "";
for await (const chunk of process.stdin) input += chunk;
const parts = (text) => /(\d+)\.(\d+)\.(\d+)/.exec(text)?.slice(1).map(Number);
const have = parts(input);
const need = parts(process.argv[2] ?? "");
const first = have && need ? have.findIndex((n, i) => n !== need[i]) : -1;
process.exit(first >= 0 && have[first] < need[first] ? 1 : 0);
