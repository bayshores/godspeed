import { handleChatRequest } from "@/backend/server";

export async function POST(req: Request) {
	return handleChatRequest(req);
}
