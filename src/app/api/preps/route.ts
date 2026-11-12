/**
 * POST /api/preps — make a prep and ask the teacher for its sheet.
 * Multipart: "goal" (what the learner is preparing for), "date"
 * (YYYY-MM-DD, optional) and "files" (the job posting, the email, a
 * resume; optional). → { spaceId }. A file godspeed can't read is a 400.
 */
import { createPrep } from "@/backend/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	let form: FormData;
	try {
		form = await req.formData();
	} catch {
		return Response.json({ error: "Invalid form body" }, { status: 400 });
	}
	const goal = form.get("goal");
	const date = form.get("date");
	if (typeof goal !== "string") return Response.json({ error: "Say what you are preparing for." }, { status: 400 });
	const files = await Promise.all(
		form
			.getAll("files")
			.filter((f): f is File => f instanceof File)
			.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
	);
	const made = createPrep({ goal, ...(typeof date === "string" && date ? { date } : {}), files });
	return made.ok ? Response.json(made.value, { status: 201 }) : Response.json({ error: made.error }, { status: made.status });
}
