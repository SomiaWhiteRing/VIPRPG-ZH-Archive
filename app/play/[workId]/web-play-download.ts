import { ApiResponseError, requestOk } from "@/lib/ui/api-response";

type ByteChunk = Uint8Array<ArrayBufferLike>;

const networkWaitLimitMs = 15_000;
const maxReconnects = 2;

class DownloadNetworkError extends Error {}
class DownloadResponseError extends Error {}

/** A single ZIP transfer. Reconnecting retains the caller's ZIP and pack buffers. */
export class WebPlayDownload {
  private controller: AbortController | null = null;
  private reader: ReadableStreamDefaultReader<ByteChunk> | null = null;
  private etag: string | null = null;
  private resumable = false;
  private downloadedBytes = 0;
  private reconnects = 0;
  private finished = false;
  private readonly abort = () => this.controller?.abort(new Error("安装已取消。"));
  totalBytes: number | null = null;

  constructor(private readonly url: string, private readonly signal: AbortSignal) {
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
      try {
        if (!this.reader) await this.connect();
        const result = await this.waitForNetwork(this.reader!.read());

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
        // A slow transfer that keeps producing bytes must not consume reconnects.
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
    const response = await this.waitForNetwork(requestOk(this.url, {
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
    if (!isNetworkFailure(error)) throw error;
    // Without a byte validator, the caller may perform its existing safe full restart.
    if (this.downloadedBytes > 0 && !this.resumable) throw error;
    if (this.reconnects >= maxReconnects) {
      // A transfer that exhausted its resume budget must not restart all completed packs again.
      throw new Error("请求失败：无法连接服务器，请检查网络后重试。");
    }
    this.reconnects += 1;
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
