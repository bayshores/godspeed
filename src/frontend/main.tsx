import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router/dom";
import "katex/dist/katex.min.css";
import "./fonts/fonts.css";
import "./globals.css";
import { BootProvider, fetchBoot } from "@/frontend/components/boot";
import { router } from "./routes/router";

/** The first page load paints only once /api/boot and the page's own data
 *  are in, so the first paint is complete (the welcome screen at launch). */
const pageRead = new Promise<void>((resolve) => {
	if (router.state.initialized) return resolve();
	const stop = router.subscribe((state) => {
		if (!state.initialized) return;
		stop();
		resolve();
	});
});

void Promise.all([fetchBoot(), pageRead]).then(([boot]) => {
	createRoot(document.getElementById("root")!).render(
		<StrictMode>
			<BootProvider initial={boot}>
				<RouterProvider router={router} />
			</BootProvider>
		</StrictMode>,
	);
});
