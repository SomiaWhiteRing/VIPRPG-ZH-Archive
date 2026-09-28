import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export async function adaptAndroidRuntime(root, directory) {
  const checkedSource = (text, name) => ({
    replace(before, after) {
      if (!text.includes(before)) throw new Error(`Android runtime adapter anchor missing in ${name}: ${before}`);
      return checkedSource(text.replace(before, after), name);
    },
    replaceAll(before, after) {
      if (!text.includes(before)) throw new Error(`Android runtime adapter anchor missing in ${name}: ${before}`);
      return checkedSource(text.replaceAll(before, after), name);
    },
    toString: () => text,
  });
  const edit = async (name, change) => {
    const path = resolve(directory, name);
    const original = await readFile(path, 'utf8');
    const updated = String(change(checkedSource(original, name)));
    if (original === updated) throw new Error(`Android runtime adapter did not match ${name}`);
    await writeFile(path, updated);
  };
  await copyFile(resolve(root, 'android/web/native-storage.js'), resolve(directory, 'native-storage.js'));
  for (const worker of ['player-worker.js', 'player-audio-worker.js']) await edit(worker, source => source
    .replace("importScripts(new URL('player-files.js'", "importScripts(new URL('native-storage.js', data.runtimeBase).href);\n      if (data.nativeResources) data.packages = self.nativePackages(data.nativeResources);\n      importScripts(new URL('player-files.js'")
    .replace("  try {\n    if (data.type", "  try {\n    if (data.type === 'native-saved') { self.nativeSaveReplies?.get(data.id)?.(data.error); self.nativeSaveReplies?.delete(data.id); return; }\n    if (data.type"));
  await edit('easyrpg-player.js', source => source
    .replace('if(!(node.contents instanceof Blob))', 'if(!(node.contents instanceof Blob)&&!node.contents.nativeUrl)')
    .replace('FS.mount(IDBFS,{},savePath)', 'if(!self.nativeResources)FS.mount(IDBFS,{},savePath)')
    .replace('FS.mount(IDBFS,{},"/home/web_user/.config")', 'if(self.nativeResources)self.installNativeSaves(FS,Module.workId);else FS.mount(IDBFS,{},"/home/web_user/.config")'));
  await edit('player-files.js', source => source.replace('new Uint8Array(reader.readAsArrayBuffer(node.contents.slice(start, end)))', 'node.contents.nativeUrl ? self.nativeRead(node.contents, start, end) : new Uint8Array(reader.readAsArrayBuffer(node.contents.slice(start, end)))'));
  await edit('index.js', source => source
    .replaceAll('packages: options.packages,', 'packages: options.packages, nativeResources: options.nativeResources,')
    .replace("    if (data.type === 'ready') {", "    if (data.type === 'native-save') {\n      Promise.resolve().then(() => options.saveNative(data.files)).then(() => send({type: 'native-saved', id: data.id})).catch(error => send({type: 'native-saved', id: data.id, error: String(error)}));\n    } else if (data.type === 'ready') {")
);
  await edit('player-movie.js', source => source.replace('this.url = URL.createObjectURL(blob);',
    "this.url = blob.nativeUrl ? blob.nativeUrl + '?start=' + blob.start + '&size=' + blob.size + '&media=1' : URL.createObjectURL(blob);"));
  await edit('player-files.js', source => source
    .replace('budget = 32 * 1024 * 1024)', "budget = 32 * 1024 * 1024, root = '/game')")
    .replace("FS.lookupPath('/game')", 'FS.lookupPath(root)'));
  await edit('player-movie-worker.js', source => source
    .replace("importScripts(new URL('movie-decoder.js'", "importScripts(new URL('native-storage.js', self.location.href).href, new URL('player-files.js', self.location.href).href);\n      importScripts(new URL('movie-decoder.js'")
    .replace("      if (decoder.ccall('movie_open'", "      if (data.blob.nativeUrl) self.installPlayerFileCache(decoder.FS, 32 * 1024 * 1024, '/movie');\n      if (decoder.ccall('movie_open'"));
}
