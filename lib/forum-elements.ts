// Source stays inside an atomic text token, so drafts, revisions and image offsets
// use the existing forum body protocol without introducing a second document.
export const FORUM_ELEMENT_PATTERN = /:html_[A-Za-z0-9_.~%!'()*-]+:/g;
export const FORUM_ELEMENT_SOURCE_LENGTH = 12_000;
export const FORUM_ELEMENT_COUNT = 5;

export function forumElementToken(source: string): string {
  return `:html_${encodeURIComponent(source)}:`;
}

export function readForumElement(token: string): string | null {
  const match = new RegExp(`^(?:${FORUM_ELEMENT_PATTERN.source})$`).exec(token);
  if (!match) return null;
  try {
    const source = decodeURIComponent(token.slice(6, -1));
    return source.trim() && source.length <= FORUM_ELEMENT_SOURCE_LENGTH ? source : null;
  } catch {
    return null;
  }
}

export function forumElementText(body: string): string {
  return body.replace(FORUM_ELEMENT_PATTERN, "[互动内容]");
}

export function canInsertForumElements(user: { status: string; isBootstrapAdmin: boolean } | null): boolean {
  return user?.status === "active" && user.isBootstrapAdmin;
}

export const BROWSER_INFO_ELEMENT = `<style>
  body { margin: 0; font: 15px/1.7 system-ui, sans-serif; color: #444; }
  button { font: inherit; padding: 8px 16px; border: 1px solid #47886b; border-radius: 6px; background: #47886b; color: white; cursor: pointer; }
  button:disabled { opacity: .6; cursor: wait; }
  button:focus-visible { outline: 2px solid #47886b; outline-offset: 3px; }
  p { margin: 8px 0 0; }
</style>
<button type="button" id="copy">复制浏览器信息</button>
<p>点击后复制浏览器与兼容性信息，请将它粘贴到回复中，并描述遇到的问题。</p>
<p id="status" role="status"></p>
<script>
  document.getElementById('copy').addEventListener('click', async function () {
    this.disabled = true;
    const status = document.getElementById('status');
    status.textContent = '正在读取浏览器信息…';
    try {
      const result = await window.viprpg.copyBrowserInfo();
      status.textContent = result.copied ? '已复制，请粘贴到回复中。' : '浏览器未允许自动复制，请使用下方的文本框手动复制。';
    } catch (error) {
      status.textContent = '读取失败：' + error.message;
    } finally {
      this.disabled = false;
    }
  });
</script>`;
