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
  [data-forum-browser-element] [data-copy-browser-info] {
    display: inline-flex; align-items: center; justify-content: center;
    min-height: 40px; padding: 8px 12px; border: 0; border-radius: 6px;
    background: var(--color-primary); color: var(--color-primary-foreground);
    font: inherit; font-size: 14px; font-weight: 600; line-height: 20px;
    box-shadow: 0 1px 2px rgb(0 0 0 / 5%); cursor: pointer;
  }
  [data-forum-browser-element] [data-copy-browser-info]:hover { opacity: .9; }
  [data-forum-browser-element] [data-copy-browser-info]:disabled { opacity: .5; cursor: wait; }
  [data-forum-browser-element] [data-copy-browser-info]:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
</style>
<button type="button" data-copy-browser-info aria-live="polite">复制浏览器信息</button>
<script>
  document.currentScript.closest('[data-forum-browser-element]').querySelector('[data-copy-browser-info]').addEventListener('click', async function () {
    this.disabled = true;
    this.textContent = '正在读取…';
    try {
      const result = await window.viprpg.copyBrowserInfo();
      this.textContent = result.copied ? '已复制浏览器信息' : '请在弹窗中手动复制';
    } catch (error) {
      this.textContent = '复制失败，点击重试';
      this.title = error.message;
    } finally {
      this.disabled = false;
    }
  });
</script>`;
