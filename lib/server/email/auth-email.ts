import { getEmailFrom } from "@/lib/server/auth/config";
import { getCloudflareEnv } from "@/lib/server/cloudflare/env";

export async function sendRegistrationCodeEmail(input: {
  to: string;
  code: string;
  callbackUrl: string;
}): Promise<void> {
  await sendAuthEmail({
    to: input.to,
    subject: "VIPRPG 中文归档注册验证码",
    html: renderAuthEmailHtml({
      title: "注册验证码",
      intro: "你正在注册 VIPRPG 中文归档账户。",
      code: input.code,
      callbackUrl: input.callbackUrl,
      actionLabel: "继续注册",
    }),
    text: [
      "你正在注册 VIPRPG 中文归档账户。",
      "",
      `验证码：${input.code}`,
      `继续注册：${input.callbackUrl}`,
      "",
      "验证码 10 分钟内有效。若这不是你本人操作，可以忽略这封邮件。",
    ].join("\n"),
  });
}

export async function sendPasswordResetCodeEmail(input: {
  to: string;
  code: string;
  callbackUrl: string;
}): Promise<void> {
  await sendAuthEmail({
    to: input.to,
    subject: "VIPRPG 中文归档找回密码验证码",
    html: renderAuthEmailHtml({
      title: "找回密码验证码",
      intro: "你正在找回 VIPRPG 中文归档账户密码。",
      code: input.code,
      callbackUrl: input.callbackUrl,
      actionLabel: "继续重置密码",
    }),
    text: [
      "你正在找回 VIPRPG 中文归档账户密码。",
      "",
      `验证码：${input.code}`,
      `继续重置密码：${input.callbackUrl}`,
      "",
      "验证码 10 分钟内有效。若这不是你本人操作，可以忽略这封邮件。",
    ].join("\n"),
  });
}

async function sendAuthEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  try {
    await getCloudflareEnv().EMAIL.send({
      from: getEmailFrom(),
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
  } catch (error) {
    throw normalizeEmailSendError(error);
  }
}

function normalizeEmailSendError(error: unknown): Error {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";

  if (message.toLowerCase().includes("destination address is not a verified address")) {
    return new Error(
      "当前 Cloudflare 邮件配置只能发送到已验证目标地址，不能用于公开注册验证码。请启用 Cloudflare Email Service 的 Email Sending，或切换到 Resend/Postmark 等事务邮件服务。",
    );
  }

  if (message) {
    return new Error(`验证码邮件发送失败：${message}`);
  }

  return new Error("验证码邮件发送失败，请稍后重试");
}

function renderAuthEmailHtml(input: {
  title: string;
  intro: string;
  code: string;
  callbackUrl: string;
  actionLabel: string;
}): string {
  const title = escapeHtml(input.title);
  const intro = escapeHtml(input.intro);
  const code = escapeHtml(input.code);
  const callbackUrl = escapeHtml(input.callbackUrl);
  const actionLabel = escapeHtml(input.actionLabel);

  return [
    '<div style="font-family:Arial,Microsoft YaHei,sans-serif;line-height:1.7;color:#1c1f22">',
    `<h1 style="font-size:20px;margin:0 0 16px">${title}</h1>`,
    `<p style="margin:0 0 12px">${intro}</p>`,
    `<p style="margin:0 0 16px">验证码 10 分钟内有效。</p>`,
    `<p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:0 0 20px">${code}</p>`,
    `<p style="margin:0 0 20px"><a href="${callbackUrl}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:6px;font-weight:700">${actionLabel}</a></p>`,
    `<p style="margin:0 0 16px">如果按钮无法打开，请复制这个地址到浏览器：<br><a href="${callbackUrl}">${callbackUrl}</a></p>`,
    '<p style="margin:0;color:#667085">若这不是你本人操作，可以忽略这封邮件。</p>',
    "</div>",
  ].join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
