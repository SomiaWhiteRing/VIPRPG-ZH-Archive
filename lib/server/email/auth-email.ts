import { getEmailFrom } from "@/lib/server/auth/config";
import { getCloudflareEnv } from "@/lib/server/cloudflare/env";

export async function sendRegistrationCodeEmail(input: {
  to: string;
  code: string;
}): Promise<void> {
  await sendAuthEmail({
    to: input.to,
    subject: "VIPRPG 中文归档注册验证码",
    text: [
      "你正在注册 VIPRPG 中文归档账户。",
      "",
      `验证码：${input.code}`,
      "",
      "验证码 10 分钟内有效。若这不是你本人操作，可以忽略这封邮件。",
    ].join("\n"),
  });
}

export async function sendPasswordResetCodeEmail(input: {
  to: string;
  code: string;
}): Promise<void> {
  await sendAuthEmail({
    to: input.to,
    subject: "VIPRPG 中文归档找回密码验证码",
    text: [
      "你正在找回 VIPRPG 中文归档账户密码。",
      "",
      `验证码：${input.code}`,
      "",
      "验证码 10 分钟内有效。若这不是你本人操作，可以忽略这封邮件。",
    ].join("\n"),
  });
}

async function sendAuthEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  await getCloudflareEnv().EMAIL.send({
    from: getEmailFrom(),
    to: input.to,
    subject: input.subject,
    text: input.text,
  });
}
