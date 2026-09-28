// APK-only adapter; the website's versioned runtime remains byte-for-byte unchanged.
self.nativeSaveReplies = new Map();
self.nativePackages = function(resources) {
  self.nativeResources = resources;
  return [{metadata: {files: resources.files.map(file => ({...file, filename: '/' + file.filename}))}, blob: {
    slice(start, end) { return {nativeUrl: resources.url, start, size: end - start}; }
  }}];
};
self.nativeRead = function(node, start, end) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', `${node.nativeUrl}?start=${node.start + start}&size=${end - start}`, false);
  xhr.responseType = 'arraybuffer'; xhr.send();
  if (xhr.status !== 200 || xhr.response.byteLength !== end - start) throw new Error('本地游戏文件读取失败，请检查目录授权。');
  return new Uint8Array(xhr.response);
};
self.installNativeSaves = function(FS, workId) {
  const roots = [`/work-saves/${workId}`, '/home/web_user/.config'];
  const valid = path => roots.some(root => path.startsWith(root + '/')) && !path.split('/').some(p => p === '..' || p === '.');
  FS.syncfs = (populate, callback) => {
    try {
      if (populate) {
        for (const [path, encoded] of Object.entries(self.nativeResources.saves)) {
          if (!valid(path)) throw new Error('本地存档路径无效。');
          FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
          FS.writeFile(path, Uint8Array.from(atob(encoded), c => c.charCodeAt(0)));
        }
        callback(null); return;
      }
      const files = {};
      const visit = path => {
        for (const name of FS.readdir(path)) {
          if (name === '.' || name === '..') continue;
          const child = path + '/' + name;
          if (FS.isDir(FS.stat(child).mode)) visit(child);
          else {
            const bytes = FS.readFile(child); let value = '';
            for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
            files[child] = btoa(value);
          }
        }
      };
      roots.forEach(visit);
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { self.nativeSaveReplies.delete(id); callback(new Error('存档写入超时。')); }, 120000);
      self.nativeSaveReplies.set(id, error => { clearTimeout(timer); callback(error ? new Error(error) : null); });
      postMessage({type: 'native-save', id, files});
    } catch (error) { callback(error); }
  };
};
