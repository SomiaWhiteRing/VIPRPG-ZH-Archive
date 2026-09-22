import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { unzipSync } from 'fflate';
import { chromium } from 'playwright';
import UPNG from 'upng-js';
/* global engine */
const output = resolve('output/easyrpg/worker');
mkdirSync(output, { recursive: true });
const runtime = JSON.parse(readFileSync('lib/archive/easyrpg-runtime.json', 'utf8'));
writeFileSync(resolve(output, 'report.json'), JSON.stringify({ passed: false, runtime: runtime.version }));
const runtimeRoot = resolve('public/play/runtime/easyrpg', runtime.version);
const files = unzipSync(readFileSync('output/easyrpg/testgame.zip'));
// The focused fixture starts directly on its map, without the official language chooser.
for (const name of Object.keys(files))
    if (name.startsWith('Language/'))
        delete files[name];
// LCF uses big-endian base-128 integers; only the fixture's map is replaced.
function vint(n) {
    const bytes = [n & 127];
    while (n > 127) {
        n >>>= 7;
        bytes.unshift((n & 127) | 128);
    }
    return Buffer.from(bytes);
}
const cat = (...chunks) => Buffer.concat(chunks);
const field = (id, b) => cat(vint(id), vint(b.length), b);
const structure = entries => cat(...entries.map(([id, b]) => field(id, b)), Buffer.from([0]));
const array = items => cat(vint(items.length), ...items.map(([id, b]) => cat(vint(id), b)));
function command(id, text = '', params = []) { const b = Buffer.from(text); return cat(vint(id), vint(0), vint(b.length), b, vint(params.length), ...params.map(vint)); }
const colors = [[220, 40, 40], [40, 220, 40], [40, 160, 224]];
function png(color, w = 320, h = 240) {
    const raw = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const pixel = x < 16 && y < 16 ? [255, 255, 0] : x >= w - 16 && y >= h - 16 ? [255, 0, 255] : color;
            raw.set([...pixel, 255], (y * w + x) * 4);
        }
    return Buffer.from(UPNG.encode([raw.buffer], w, h, 0));
}
const cmds = [command(11410, '', [20]), command(11510, 'tone', [0, 100, 100, 50])];
for (let round = 0; round < 2; round++)
    for (let i = 0; i < 24; i++) {
        const name = i === 0 ? '差替え・絵' : `switch-${i}`;
        files[`Picture/${name.toUpperCase()}.PNG`] = png(colors[i % 3]);
        cmds.push(command(11110, name, [1, 0, 160, 120, 0, 100, 0, 0, 100, 100, 100, 100, 0, 0, 0]), command(11410, '', [1]));
    }
cmds.push(command(11410, '', [9999]), command(10));
const commands = cat(...cmds);
const eventPage = structure([[33, vint(3)], [51, vint(commands.length)], [52, commands]]);
const event = structure([[1, Buffer.from('picture-switch')], [2, vint(0)], [3, vint(0)], [5, array([[1, eventPage]])]]);
files['Map0001.lmu'] = cat(vint(10), Buffer.from('LcfMapUnit'), structure([[1, vint(1)], [2, vint(20)], [3, vint(15)], [71, Buffer.alloc(600)], [72, Buffer.alloc(600)], [81, array([[1, event]])]]));
const pcm = Buffer.alloc(48000 * 2 * 2);
for (let i = 0; i < 48000 * 2; i++)
    pcm.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 48000) * 8000), i * 2);
const wav = Buffer.alloc(44);
wav.write('RIFF');
wav.writeUInt32LE(36 + pcm.length, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(48000, 24);
wav.writeUInt32LE(96000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(pcm.length, 40);
files['Music/tone.wav'] = cat(wav, pcm);
let offset = 0;
const metadata = { files: Object.entries(files).map(([path, bytes]) => { const start = offset; offset += bytes.length; return { filename: `/${path}`, start, end: offset }; }) };
const pack = cat(...Object.values(files));
writeFileSync(resolve(output, 'fixture.pack'), pack);
writeFileSync(resolve(output, 'fixture.json'), JSON.stringify(metadata));
const server = createServer((req, res) => {
    let body;
    let mime = 'application/octet-stream';
    if (req.url === '/') {
        body = Buffer.from('<!doctype html><body style="margin:0;background:#111"><button id="start">Start</button><canvas id="canvas" tabindex="0" style="display:block;width:640px;height:480px;image-rendering:pixelated"></canvas><script src="/runtime/index.js"></script>');
        mime = 'text/html';
    }
    else if (req.url === '/fixture.pack')
        body = pack;
    else if (req.url.startsWith('/runtime/') && !req.url.slice(9).includes('/')) {
        const path = resolve(runtimeRoot, req.url.slice(9));
        try {
            body = readFileSync(path);
            if (req.url.endsWith('/player-audio.js'))
                body = Buffer.from(body.toString() + `
const originalProcess=PlayerAudio.prototype.process;
PlayerAudio.prototype.process=function(inputs,outputs){
 this.stats ||= {type:'test-audio',blocks:0,nonzero:0,underruns:0,active:false};
 const available=this.queue.reduce((total,pcm)=>total+pcm.length/2,0)-this.offset/2;
 if(this.stats.active&&available<outputs[0][0].length)this.stats.underruns++;
 const result=originalProcess.call(this,inputs,outputs);
 if(outputs[0][0].some(value=>Math.abs(value)>0.001)){this.stats.active=true;this.stats.nonzero++;}
 if(++this.stats.blocks%100===0)this.port.postMessage(this.stats);
 return result;
};`);
        }
        catch {
            res.writeHead(404).end();
            return;
        }
        mime = extname(path) === '.js' ? 'text/javascript' : extname(path) === '.wasm' ? 'application/wasm' : 'application/octet-stream';
    }
    else {
        res.writeHead(404).end();
        return;
    }
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': body.length });
    res.end(body);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const logs = [], requests = [];
page.on('console', m => logs.push(m.text()));
page.on('pageerror', e => logs.push('ERROR ' + e.stack));
page.context().on('request', r => requests.push(r.url()));
try {
    await page.addInitScript(() => {
        const AudioNode = window.AudioWorkletNode;
        window.AudioWorkletNode = class extends AudioNode {
            constructor(...args) {
                super(...args);
                this.port.addEventListener('message', event => {
                    if (event.data.type === 'test-audio') {
                        event.stopImmediatePropagation();
                        window.audioStats = event.data;
                    }
                });
            }
        };
    });
    await page.goto(origin);
    await page.evaluate(async (metadata) => {
        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle('fixture.pack', { create: true });
        const out = await handle.createWritable();
        await out.write(await (await fetch('/fixture.pack')).arrayBuffer());
        await out.close();
        const file = await handle.getFile();
        window.packages = [{ blob: file, metadata }];
        document.querySelector('#start').onclick = () => {
            window.runtimePromise = window.createEasyRpgPlayer({
                runtimeBase: '/runtime/', workId: 99991, packages: window.packages,
                // The generated map stores event strings as UTF-8.
                arguments: ['--new-game', '--test-play', '--start-map-id', '1', '--encoding', 'UTF-8'],
            }).then(player => window.player = player);
        };
    }, metadata);
    const workerReady = page.waitForEvent('worker', w => w.url().endsWith('/player-worker.js'));
    await page.locator('#start').click();
    const worker = await workerReady;
    await page.waitForFunction(() => !!window.player, {}, { timeout: 45000 });
    await worker.evaluate(() => {
        globalThis.frames = [];
        const present = engine.present;
        engine.present = (ptr, w, h, pitch) => { const t = performance.now(); const p = ptr + Math.floor(h / 2) * pitch + Math.floor(w / 2) * 4; frames.push({ t, color: Array.from(engine.HEAPU8.subarray(p, p + 3)).reverse() }); return present(ptr, w, h, pitch); };
    });
    const initialRequests = requests.length;
    await page.waitForTimeout(8500);
    const metrics = await worker.evaluate(() => ({ frames, heap: engine.HEAPU8.length, files: engine.FS.readdir('/game/Picture').length }));
    const allowed = c => colors.some(x => x.every((v, i) => v === c[i]));
    await page.screenshot({ path: resolve(output, 'observed.png') });
    writeFileSync(resolve(output, 'frames.json'), JSON.stringify(metrics));
    const first = metrics.frames.findIndex(f => allowed(f.color));
    assert.ok(first >= 0, 'picture event ran');
    const samples = metrics.frames.slice(first);
    const gaps = samples.slice(1).map((f, i) => f.t - samples[i].t);
    const changes = samples.filter((f, i) => i && !f.color.every((v, c) => v === samples[i - 1].color[c]));
    const bad = samples.filter(f => !allowed(f.color));
    const audio = await page.evaluate(() => window.audioStats);
    assert.ok(audio?.nonzero > 100, 'AudioWorklet renders nonzero game PCM');
    const report = { passed: false, testedAt: new Date().toISOString(), audio, runtime: runtime.version, browser: browser.version(), packBytes: pack.length, heapBytes: metrics.heap, sampledFrames: samples.length, pictureChanges: changes.length, missingPictureFrames: bad.length, maxFrameGapMs: Math.max(...gaps), p95FrameGapMs: gaps.sort((a, b) => a - b)[Math.floor(gaps.length * .95)], requestsDuringSwitch: requests.slice(initialRequests) };
    await page.screenshot({ path: resolve(output, 'pictures.png') });
    assert.ok(changes.length >= 47, 'all cold and warm pictures displayed');
    assert.equal(bad.length, 0, 'no missing picture frames');
    assert.deepEqual(report.requestsDuringSwitch, [], 'game reads remain local');
    const screenshot = await page.evaluate(async () => { const result = await window.player.captureScreenshot(); return { width: result.width, height: result.height, bytes: Array.from(new Uint8Array(await result.blob.arrayBuffer())) }; });
    assert.equal(screenshot.width, 320);
    assert.equal(screenshot.height, 240);
    writeFileSync(resolve(output, 'engine.png'), Buffer.from(screenshot.bytes));
    // Both the engine PNG and the rendered canvas must retain channels and orientation.
    function verifyPixels(bytes) {
        const decoded = UPNG.decode(Uint8Array.from(bytes).buffer);
        const rgba = new Uint8Array(UPNG.toRGBA8(decoded)[0]);
        const pixel = (x, y) => Array.from(rgba.slice((y * decoded.width + x) * 4, (y * decoded.width + x) * 4 + 3));
        assert.deepEqual(pixel(2, 2), [255, 255, 0]);
        assert.deepEqual(pixel(decoded.width - 3, decoded.height - 3), [255, 0, 255]);
        assert.deepEqual(pixel(decoded.width / 2, decoded.height / 2), colors[2]);
    }
    verifyPixels(screenshot.bytes);
    verifyPixels(await page.locator('#canvas').screenshot());
    // A failed persistent write must keep the Worker and unsaved bytes alive for retry.
    await worker.evaluate(() => {
        engine.FS.writeFile('/work-saves/99991/retry-check', [17, 29, 43]);
        const sync = engine.FS.syncfs;
        engine.FS.syncfs = (populate, callback) => { engine.FS.syncfs = sync; callback(new Error('injected write failure')); };
    });
    const failure = await page.evaluate(() => window.player.stop().then(() => '', error => error.message));
    assert.match(failure, /injected write failure/);
    assert.deepEqual(await worker.evaluate(() => Array.from(engine.FS.readFile('/work-saves/99991/retry-check'))), [17, 29, 43]);
    const closed = worker.waitForEvent('close');
    await page.evaluate(() => window.player.stop());
    await closed;
    const persisted = await page.evaluate(() => new Promise((resolve, reject) => {
        const open = indexedDB.open('/work-saves/99991');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('FILE_DATA');
            const get = tx.objectStore('FILE_DATA').get('/work-saves/99991/retry-check');
            get.onsuccess = () => resolve(Array.from(get.result.contents));
            get.onerror = () => reject(get.error);
            tx.oncomplete = () => db.close();
        };
    }));
    assert.deepEqual(persisted, [17, 29, 43]);
    report.saveRetry = true;
    report.renderedPixels = true;
    report.passed = true;
    writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
}
finally {
    writeFileSync(resolve(output, 'runtime.log'), logs.join('\n'));
    await browser.close();
    server.close();
}
