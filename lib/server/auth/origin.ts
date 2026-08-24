import { getAppOrigin } from "@/lib/server/auth/config";

export class SameOriginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SameOriginError";
  }
}

export function assertSameOrigin(request: Request): void {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return;
  const source = request.headers.get("origin");
  if (!source) throw new SameOriginError("Missing request origin");
  let origin: string;
  try {
    origin = new URL(source).origin;
  } catch {
    throw new SameOriginError("Invalid request origin");
  }
  if (origin !== getAppOrigin()) throw new SameOriginError("Cross-origin request denied");
}
