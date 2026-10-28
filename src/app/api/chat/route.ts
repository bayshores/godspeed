import { handleChatRequest } from "@/server";

export async function POST(req: Request) {
	return handleChatRequest(req);
}
