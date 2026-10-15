import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the shipped console functions, not a second implementation of their logic.
const runtime = JSON.parse(readFileSync(new URL('../lib/archive/easyrpg-runtime.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL(`../public/play/runtime/easyrpg/${runtime.version}/index.js`, import.meta.url), 'utf8');
class Node {
  constructor(kind = 'span', value = '') { this.kind = kind; this.value = value; this.childNodes = []; this.style = {}; this.dataset = {}; }
  get children() { return this.childNodes.filter(node => node.kind !== '#text'); }
  get firstChild() { return this.childNodes[0]; }
  get firstElementChild() { return this.children[0]; }
  get lastElementChild() { return this.children.at(-1); }
  get nextSibling() { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1]; }
  get textContent() { return this.kind === '#text' ? this.value : this.childNodes.map(node => node.textContent).join(''); }
  append(...nodes) { for (const node of nodes) { if (node.kind === '#fragment') { this.append(...[...node.childNodes]); continue; } node.remove(); node.parentNode = this; this.childNodes.push(node); } }
  appendData(value) { this.value += value; }
  remove() { if (this.parentNode) { const list = this.parentNode.childNodes; list.splice(list.indexOf(this), 1); this.parentNode = undefined; } }
  cloneNode() { const copy = new Node(this.kind); copy.style = {...this.style}; copy.dataset = {...this.dataset}; return copy; }
  replaceChildren(...nodes) { for (const node of [...this.childNodes]) node.remove(); this.append(...nodes); }
  animate() {}
  focus() {}
  addEventListener() {}
  removeEventListener() {}
  get scrollHeight() { ++this.layoutReads; return this.childNodes.length; }
}
const frames = new Map();
let sequence = 0, styleReads = 0;
const context = vm.createContext({
  document: { createElement: kind => new Node(kind), createTextNode: value => new Node('#text', value), createDocumentFragment: () => new Node('#fragment') },
  Intl, console, closed: false, stopping: false, consoleWindow: undefined,
  consolePalette: Array.from({length: 16}, (_, i) => `color-${i}`),
  getComputedStyle: () => { ++styleReads; return {fontSize: '12px', fontFamily: 'monospace'}; },
  requestAnimationFrame: fn => { frames.set(++sequence, fn); return sequence; },
  cancelAnimationFrame: id => frames.delete(id),
  cancelConsoleInput: () => {}, canvas: {focus() {}}, send: () => {},
});
vm.runInContext(source.slice(source.indexOf('  function closeConsoleWindow('), source.indexOf('  function setConsoleColor(')) + '\n' + source.slice(source.indexOf('  function consoleInputDialog('), source.indexOf('  function requestConsoleInput(')), context);
function panel(columns = 80, segmenter = true) {
  const output = new Node('pre'), row = new Node(); output.append(row); output.clientWidth = columns; output.layoutReads = 0;
  return context.consoleWindow = {output, row, cursor: 0, rowLength: 0, column: 0, textLength: 0, scrollFrame: 0,
    dialog: new Node('dialog'), form: new Node('form'), caption: new Node(), input: new Node('input'), cancel: new Node('button'),
    foreground: 7, background: 0,
    segmenter: segmenter ? new Intl.Segmenter(undefined, {granularity: 'grapheme'}) : null,
    measure: {measureText: text => ({width: [...text].reduce((n, c) => n + (/\p{Mark}|\u200d/u.test(c) ? 0 : /[界😀]/u.test(c) ? 2 : 1), 0)})}};
}
const write = (text, fg = 7, bg = 0) => context.appendConsoleText(text, fg, bg);
function bounded(p) {
  assert.ok(p.output.children.length <= 1000);
  assert.ok(p.output.textContent.length <= 128 * 1024);
  assert.equal(p.textLength, p.output.textContent.length);
  assert.equal(p.row, p.output.children.at(-1));
  assert.ok(p.output.children.every(row => row.textContent.length <= 4096));
}
function flush() { for (const [id, fn] of [...frames]) { frames.delete(id); fn(); } }
let p = panel();
for (let i = 0; i < 20000; i++) write(`line-${i}\n`);
bounded(p); assert.equal(p.output.children.length, 1000); assert.ok(p.output.textContent.startsWith('line-19001\n'));
assert.equal(frames.size, 1); assert.equal(p.output.layoutReads, 0); assert.equal(styleReads, 1);
flush(); assert.equal(p.output.layoutReads, 1);
write('tail'); write('\rTAIL'); assert.equal(p.row.textContent, 'TAIL');
write('\b!', 12, 1); assert.equal(p.row.textContent, 'TAI!'); assert.equal(p.row.lastElementChild.dataset.color, '12:1'); bounded(p);
context.closeConsoleWindow(); assert.equal(frames.size, 0); flush(); assert.equal(p.output.layoutReads, 1);
p = panel(1024); write('x'.repeat(400000)); bounded(p); assert.ok(p.output.children.length < 1000); assert.ok(p.textLength > 120000);
context.closeConsoleWindow();
p = panel(80); write('界A', 4, 2); write('\rX', 12, 1); assert.equal(p.row.textContent, 'X A'); assert.equal(p.row.children[1].dataset.color, '4:2');
write('\bZ'); assert.equal(p.row.textContent, 'Z A');
write('\r\tQ'); assert.equal(p.row.textContent, 'Z A     Q'); bounded(p);
context.closeConsoleWindow();
p = panel(4); write('abcd'); assert.equal(p.output.children.length, 1); write('界'); assert.equal(p.output.children.length, 2); assert.equal(p.row.textContent, '界');
write('\b好'); assert.equal(p.row.textContent, '好 '); // A narrow mock glyph replaces half of the wide glyph.
context.closeConsoleWindow();
p = panel(1024); write(('a' + '\u0301'.repeat(100)).repeat(2000)); bounded(p);
write('a' + '\u0301'.repeat(20000)); bounded(p); assert.ok(p.row.textContent.endsWith('\uFFFD'));
context.closeConsoleWindow();
p = panel(1024); write('\t'.repeat(125)); write('a' + '\u0301'.repeat(4095)); bounded(p);
assert.equal(p.row.textContent.length, 4096);
context.closeConsoleWindow();
for (const control of ['\r', '\b']) {
  p = panel(1024); write('a' + '\u0301'.repeat(4095), 4, 2);
  const row = p.row;
  write(control + 'X', 12, 1);
  assert.equal(p.output.children.length, 1);
  assert.equal(p.row, row);
  assert.equal(p.row.textContent, 'X');
  assert.equal(p.column, 1); assert.equal(p.cursor, 1);
  assert.equal(p.row.firstElementChild.dataset.color, '12:1'); bounded(p);
  context.closeConsoleWindow();
}
p = panel(); write('one\ntwo\n'.repeat(10000)); bounded(p); assert.equal(p.output.children.length, 1000);
context.closeConsoleWindow();
p = panel(80, false); write('😀'.repeat(100000)); bounded(p); assert.ok(!/[\uD800-\uDBFF]$/.test(p.row.textContent));
context.closeConsoleWindow();
p = panel(); write('prompt> ');
const controller = new AbortController(); const result = context.consoleInputDialog('input', controller.signal);
p.input.value = 'answer'; p.form.onsubmit({preventDefault() {}});
assert.equal(await result, 'answer'); assert.equal(p.output.textContent, 'prompt> answer\n'); assert.equal(frames.size, 1);
context.closeConsoleWindow();
p = panel(); write('cancel> ');
const cancelled = new AbortController(); const cancelledResult = context.consoleInputDialog('input', cancelled.signal);
cancelled.abort(); assert.equal(await cancelledResult, null); assert.equal(p.output.textContent, 'cancel> ');
context.closeConsoleWindow();
p = panel(); write('last'); context.stopping = true; flush(); assert.equal(p.output.layoutReads, 0); context.closeConsoleWindow();
console.log('Console scrollback: row/text budgets, long lines/graphemes, CR/backspace/wide glyph/color/tab, input order, scroll coalescing and close/stop checks passed.');
