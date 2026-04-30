import { getTurnstileSecretKey } from "@/lib/server/auth/config";

type TurnstileResponse = {
  success: boolean;
  "error-codes"?: string[];
};

export async function verifyTurnstile(input: {
  token: string;
  request: Request;
}): Promise<void> {
  if (!input.token) {
    throw new Error("请先完成人机验证");
  }

  const body = new FormData();
  body.set("secret", getTurnstileSecretKey());
  body.set("response", input.token);

  const remoteIp = input.request.headers.get("cf-connecting-ip");

  if (remoteIp) {
    body.set("remoteip", remoteIp);
  }

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body,
    },
  );
  const payload = (await response.json()) as TurnstileResponse;

  if (!payload.success) {
    throw new Error("人机验证失败，请刷新后重试");
  }
}
