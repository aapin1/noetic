import { handleRoute, parseJson } from "@/lib/api";
import { tokenSchema } from "@/server/contracts";
import { createTokenFromCredentials } from "@/server/services/token";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const input = await parseJson(request, tokenSchema);
    return createTokenFromCredentials(input.email, input.password);
  });
}
