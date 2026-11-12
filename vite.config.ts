import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string; homepage: string };

// `npm run dev`: the UI on PORT (3000), the API server 1000 above it.
const uiPort = Number(process.env.PORT ?? 3000);
const api = `http://localhost:${uiPort + 1000}`;

/** The window's UI as static files (dist-ui/). The Next server only answers /api and /pdfjs. */
export default defineConfig({
	root: "src/frontend",
	publicDir: "../../public",
	plugins: [react(), tailwindcss()],
	resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
	// Public build metadata only (Settings, What's new, the welcome screen).
	define: {
		"process.env.LH_VERSION": JSON.stringify(pkg.version),
		"process.env.LH_HOMEPAGE": JSON.stringify(pkg.homepage),
	},
	server: { port: uiPort, strictPort: true, proxy: { "/api": api, "/pdfjs": api } },
	// The same browser targets Next built for, so the CSS comes out the same.
	build: { outDir: "../../dist-ui", emptyOutDir: true, target: ["chrome111", "edge111", "firefox111", "safari16.4"] },
});
