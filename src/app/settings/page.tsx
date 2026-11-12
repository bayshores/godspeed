import type { Metadata } from "next";
import { SettingsPage } from "@/frontend/components/settings/settings-page";

export const metadata: Metadata = { title: "Settings" };

/** Settings ("/settings"); "?section=teaching" opens on that tab. */
export default async function Settings({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
	const { section } = await searchParams;
	return <SettingsPage section={section} />;
}
