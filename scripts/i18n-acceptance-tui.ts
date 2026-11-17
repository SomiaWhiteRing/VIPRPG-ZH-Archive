import { emitKeypressEvents } from "node:readline";

export type CaseStatus = "pending" | "running" | "passed" | "failed" | "blocked" | "skipped";
export type AcceptanceCase = {
  id: string;
  name: string;
  group: string;
  locale: string;
  viewport: string;
  path?: string;
  persona: "guest" | "member" | "admin";
  status: CaseStatus;
  reason?: string;
  durationMs?: number;
  screenshot?: string;
};

const names: Record<CaseStatus, string> = {
  pending: "等待", running: "运行", passed: "通过", failed: "失败", blocked: "阻塞", skipped: "跳过",
};
const colors: Record<CaseStatus, number> = { pending: 90, running: 36, passed: 32, failed: 31, blocked: 33, skipped: 90 };
const segmenter = new Intl.Segmenter("zh", { granularity: "grapheme" });
function fit(text: string, width: number) {
  let result = "", used = 0;
  // Strip terminal control bytes from diagnostics before drawing the TUI.
  // eslint-disable-next-line no-control-regex
  for (const { segment } of segmenter.segment(text.replace(/[\x00-\x1f\x7f]/g, " "))) {
    const size = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff01-\uff60\p{Extended_Pictographic}]/u.test(segment) ? 2 : 1;
    if (used + size > width) break;
    result += segment;
    used += size;
  }
  return result + " ".repeat(Math.max(0, width - used));
}

export class AcceptanceTui {
  phase = "准备";
  target = "本地隔离环境";
  paused = false;
  canceled = false;
  finished = false;
  onCancel?: () => void;
  private selected = -1;
  private onlyProblems = false;
  private logs: string[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private close?: () => void;
  private started = Date.now();
  private interactive: boolean;

  constructor(readonly cases: AcceptanceCase[], readonly reportDirectory: string, plain = false) {
    this.interactive = Boolean(process.stdout.isTTY && process.stdin.isTTY && !plain);
    if (this.interactive) {
      emitKeypressEvents(process.stdin);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("keypress", this.onKey);
      process.stdout.write("\x1b[?1049h\x1b[?25l\x1b]0;VIPRPG i18n 浏览器验收\x07");
      this.timer = setInterval(() => this.render(), 250);
    }
    this.render();
  }

  private onKey = (_text: string, key: { name: string; ctrl?: boolean }) => {
    if (key.name === "q" || key.name === "c" && key.ctrl) {
      this.canceled = true;
      this.paused = false;
      if (!this.finished) this.onCancel?.();
      if (this.finished) this.close?.();
    } else if (key.name === "p" && !this.finished) this.paused = !this.paused;
    else if (key.name === "f") { this.onlyProblems = !this.onlyProblems; this.selected = -1; }
    else if (key.name === "up") this.selected = Math.max(0, (this.selected < 0 ? this.visible().length - 1 : this.selected) - 1);
    else if (key.name === "down") this.selected = Math.min(this.visible().length - 1, this.selected + 1);
    this.render();
  };

  counts() {
    return Object.fromEntries(Object.keys(names).map(status => [status, this.cases.filter(item => item.status === status).length])) as Record<CaseStatus, number>;
  }

  log(message: string) {
    this.logs.push(message.replace(/[\r\n]+/g, " "));
    this.logs = this.logs.slice(-5);
    if (!this.interactive) console.log(message);
    this.render();
  }

  private visible() {
    return this.onlyProblems ? this.cases.filter(item => item.status === "failed" || item.status === "blocked") : this.cases;
  }

  render() {
    if (!this.interactive) return;
    const width = Math.max(40, process.stdout.columns || 100);
    const height = Math.max(16, process.stdout.rows || 30);
    const counts = this.counts();
    const done = counts.passed + counts.failed + counts.blocked + counts.skipped;
    const percent = this.cases.length ? done / this.cases.length * 100 : 0;
    const current = this.cases.find(item => item.status === "running");
    const list = this.visible();
    const selected = this.selected < 0 ? Math.max(0, current ? list.indexOf(current) : this.finished ? list.length - 1 : 0) : Math.min(this.selected, list.length - 1);
    const rows = Math.max(3, height - 16);
    const start = Math.max(0, Math.min(selected - Math.floor(rows / 2), list.length - rows));
    const lines = [
      "VIPRPG  中 / 日 / 英浏览器验收",
      `目标  ${this.target}`,
      `阶段  ${this.phase}${this.paused ? " [已暂停，P 继续]" : ""}${this.canceled && !this.finished ? " [正在停止]" : ""}   已用 ${Math.floor((Date.now() - this.started) / 1000)} 秒`,
      `完成  ${done} / ${this.cases.length}  (${percent.toFixed(1)}%)    等待 ${counts.pending}    运行 ${counts.running}`,
      `通过 ${counts.passed}    失败 ${counts.failed}    阻塞 ${counts.blocked}    跳过 ${counts.skipped}`,
      "─".repeat(width),
      `   状态   语言 / 屏幕     用例${this.onlyProblems ? " [仅问题]" : ""}`,
    ].map(line => fit(line, width));
    for (const [index, item] of list.slice(start, start + rows).entries()) {
      const text = `${start + index === selected ? ">" : " "}  ${names[item.status]}   ${item.locale.padEnd(7)} ${item.viewport.padEnd(8)} ${item.name}`;
      lines.push(`\x1b[${colors[item.status]}m${fit(text, width)}\x1b[0m`);
    }
    while (lines.length < 7 + rows) lines.push(" ".repeat(width));
    const detail = list[selected];
    lines.push(fit("─".repeat(width), width));
    lines.push(fit(detail ? `详情  ${detail.reason || detail.path || detail.name}` : "详情  暂无问题", width));
    lines.push(fit(`证据  ${detail?.screenshot || this.reportDirectory}`, width));
    lines.push(...this.logs.slice(-3).map(line => fit(line, width)));
    lines.push(fit("P 暂停/继续   ↑↓ 查看详情   F 只看问题   Q 停止/退出", width));
    process.stdout.write("\x1b[H" + lines.slice(0, height - 1).join("\r\n") + "\x1b[J");
  }

  async checkpoint() {
    while (this.paused && !this.canceled) await new Promise(resolve => setTimeout(resolve, 100));
    if (this.canceled) throw new Error("用户停止验收");
  }

  async finish(hold: boolean) {
    this.finished = true;
    this.render();
    if (this.interactive && hold && !this.canceled) await new Promise<void>(resolve => { this.close = resolve; });
    if (this.timer) clearInterval(this.timer);
    if (this.interactive) {
      process.stdin.off("keypress", this.onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\x1b[?25h\x1b[?1049l");
    }
  }
}
