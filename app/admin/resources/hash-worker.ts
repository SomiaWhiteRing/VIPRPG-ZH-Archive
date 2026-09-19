self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await event.data.arrayBuffer(),
    );
    self.postMessage({
      sha256: Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""),
    });
  } catch {
    self.postMessage({ error: "无法计算文件校验值，请重新选择文件" });
  }
};
export {};
