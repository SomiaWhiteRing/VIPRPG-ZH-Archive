import { ApiResponseError, requestOk } from "@/lib/ui/api-response";

type ByteChunk = Uint8Array<ArrayBufferLike>;

const networkWaitLimitMs = 15_000;
const slowWindowMs = 30_000;
const minimumBytesPerSecond = 16 * 1024;
const maxReconnects = 2;

class DownloadNetworkError extends Error {}
class DownloadResponseError extends Error {}

/** A single ZIP transfer. Reconnecting retains the caller's ZIP and pack buffers. */
export class WebPlayDownload {
  private controller: AbortController | null = null;
  private reader: ReadableStreamDefaultReader<ByteChunk> | null = null;
  private alternateUrl: string | null = null;
  private currentUrl: string;
  private etag: string | null = null;
  private resumable = false;
  private downloadedBytes = 0;
  private reconnects = 0;
  private networkReadMs = 0;
  private networkReadBytes = 0;
  private reconnectBeforeRead = false;
  private finished = false;
  private readonly abort = () => this.controller?.abort(new Error("安装已取消。"));
  totalBytes: number | null = null;

  constructor(private readonly url: string, private readonly signal: AbortSignal) {
    this.currentUrl = url;
    this.alternateUrl = defaultDownloadAlternate(url);
    signal.addEventListener("abort", this.abort);
  }

  async open(): Promise<void> {
    while (true) {
      try {
        await this.connect();
        return;
      } catch (error) {
        await this.reconnect(error);
      }
    }
  }

  async read(): Promise<ReadableStreamReadResult<ByteChunk>> {
    if (this.finished) return { done: true, value: undefined };

    while (true) {
      this.assertNotCanceled();
      if (this.reconnectBeforeRead) {
        this.reconnectBeforeRead = false;
        await this.reconnect(new DownloadNetworkError("ZIP 文件不完整。"));
      }
      try {
        if (!this.reader) await this.connect();
        const startedAt = performance.now();
        const result = await this.waitForNetwork(this.reader!.read());
        const elapsedMs = performance.now() - startedAt;

        if (result.done) {
          if (this.totalBytes !== null && this.downloadedBytes !== this.totalBytes) {
            throw new DownloadNetworkError("ZIP 文件不完整。");
          }
          this.finished = true;
          return result;
        }

        if (this.totalBytes !== null && this.downloadedBytes + result.value.byteLength > this.totalBytes) {
          throw new DownloadResponseError("游戏压缩包中的文件大小异常。");
        }
        this.downloadedBytes += result.value.byteLength;
        // Only awaited network reads count: ZIP parsing, IDB and OPFS cannot trigger a reconnect.
        this.networkReadMs += elapsedMs;
        this.networkReadBytes += result.value.byteLength;
        if (this.networkReadMs >= slowWindowMs) {
          this.reconnectBeforeRead = this.networkReadBytes * 1000 / this.networkReadMs < minimumBytesPerSecond &&
            (this.totalBytes === null || this.downloadedBytes < this.totalBytes);
          this.networkReadMs = 0;
          this.networkReadBytes = 0;
        }
        return result;
      } catch (error) {
        await this.reconnect(error);
      }
    }
  }

  close(): void {
    this.signal.removeEventListener("abort", this.abort);
    this.disconnect();
  }

  private async connect(): Promise<void> {
    this.assertNotCanceled();
    this.controller = new AbortController();
    const headers: Record<string, string> = {};
    if (this.downloadedBytes > 0) {
      headers.Range = `bytes=${this.downloadedBytes}-`;
      headers["If-Range"] = this.etag!;
    }
    const response = await this.waitForNetwork(requestOk(this.currentUrl, {
      credentials: "same-origin",
      cache: "no-store",
      headers,
      signal: this.controller.signal,
    }));
    try {
      const length = positiveInteger(response.headers.get("Content-Length"));
      const etag = strongEtag(response.headers.get("ETag"));
      const encoding = response.headers.get("Content-Encoding");
      if (this.downloadedBytes > 0) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("Content-Range") ?? "");
        if (response.status !== 206 || !range ||
          Number(range[1]) !== this.downloadedBytes || Number(range[2]) !== this.totalBytes! - 1 ||
          Number(range[3]) !== this.totalBytes || etag !== this.etag ||
          (length !== null && length !== this.totalBytes! - this.downloadedBytes) ||
          (encoding !== null && encoding.toLowerCase() !== "identity")) {
          // A 200 response may be a new ZIP version. It must never be appended to old bytes.
          throw new DownloadResponseError("游戏压缩包中的文件大小异常。");
        }
      } else {
        if (response.status !== 200) throw new DownloadResponseError("游戏压缩包中的文件大小异常。");
        this.totalBytes = length;
        this.etag = etag;
        this.resumable = length !== null && etag !== null && (encoding === null || encoding.toLowerCase() === "identity");
        if (this.currentUrl === this.url) {
          this.alternateUrl = downloadAlternate(this.url, response.headers.get("X-Archive-Download-Alternate")) ?? this.alternateUrl;
        }
      }
      if (!response.body) throw new Error("浏览器无法读取下载内容，请重试。");
      this.reader = response.body.getReader();
    } catch (error) {
      this.controller.abort(error);
      throw error;
    }
  }

  private async reconnect(error: unknown): Promise<void> {
    this.assertNotCanceled();
    this.disconnect();
    // A stale alternate route may return 403/404; the original still owns authorization.
    if (!isNetworkFailure(error) && !(this.currentUrl === this.alternateUrl &&
      (error instanceof ApiResponseError || error instanceof DownloadResponseError))) throw error;
    // Without a byte validator, the caller may perform its existing safe full restart.
    if (this.downloadedBytes > 0 && !this.resumable) throw error;
    if (this.reconnects >= maxReconnects) {
      // A transfer that exhausted its resume budget must not restart all completed packs again.
      throw new Error("请求失败：无法连接服务器，请检查网络后重试。");
    }
    this.reconnects += 1;
    this.currentUrl = this.alternateUrl && this.currentUrl === this.url ? this.alternateUrl : this.url;
    this.networkReadMs = 0;
    this.networkReadBytes = 0;
    await this.waitForNetwork(new Promise<void>((resolve) => setTimeout(resolve, 500 * this.reconnects)));
  }

  private disconnect(): void {
    this.controller?.abort();
    void this.reader?.cancel().catch(() => undefined);
    this.reader = null;
    this.controller = null;
  }

  private waitForNetwork<T>(promise: Promise<T>): Promise<T> {
    this.assertNotCanceled();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        this.signal.removeEventListener("abort", abort);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const abort = () => fail(new Error("安装已取消。"));
      const timer = setTimeout(() => {
        const error = new DownloadNetworkError("ZIP 文件不完整。");
        fail(error);
        this.controller?.abort(error);
      }, networkWaitLimitMs);
      this.signal.addEventListener("abort", abort, { once: true });
      promise.then((value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      }, fail);
    });
  }

  private assertNotCanceled(): void {
    if (this.signal.aborted) throw new Error("安装已取消。");
  }
}

function downloadAlternate(originalUrl: string, value: string | null): string | null {
  if (!value || !defaultDownloadAlternate(originalUrl)) return null;
  try {
    const original = new URL(originalUrl, self.location.href);
    const alternate = new URL(value);
    return alternate.origin === "https://download.viprpg.org" && !alternate.username && !alternate.password &&
      !alternate.hash && alternate.pathname === original.pathname && alternate.search === original.search
      ? alternate.href : null;
  } catch {
    return null;
  }
}

function defaultDownloadAlternate(originalUrl: string): string | null {
  try {
    const original = new URL(originalUrl, self.location.href);
    return original.origin === "https://viprpg.org" && !original.username && !original.password &&
      /^\/api\/archive-versions\/\d+\/download\/?$/.test(original.pathname)
      ? `https://download.viprpg.org${original.pathname}${original.search}` : null;
  } catch {
    return null;
  }
}

function positiveInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function strongEtag(value: string | null): string | null {
  return value && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value) ? value : null;
}

function isNetworkFailure(error: unknown): boolean {
  if (error instanceof DownloadNetworkError || error instanceof TypeError) return true;
  if (error instanceof ApiResponseError) {
    return error.status === 0 || error.status === 408 || error.status === 429 || (error.status >= 500 && error.status < 600);
  }
  return error instanceof Error && /network|connection|failed to fetch|load failed|err_http2|err_quic/i.test(error.message);
}
