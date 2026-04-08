import { handleRoute, parseJson } from "@/lib/api";
import { registerSchema } from "@/server/contracts";
import { registerUser } from "@/server/services/accounts";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const input = await parseJson(request, registerSchema);
    return registerUser(input);
  }, 201);
}
