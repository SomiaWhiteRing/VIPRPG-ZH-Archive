const fetchAsset = self.fetch.bind(self);

self.easyRpgStorage = {
  packages(data) {
    self.toyGyokuroReplay = { endpoint: data.endpoint, token: data.token };
    self.fetch = (resource, options) => {
      // Kai's recording outbox uses a site-relative path. Keep its grants and retry logic.
      if (resource === "/api/netplay-recordings/upload") {
        return fetchAsset(`${data.endpoint}/recording`, { ...options, credentials: "omit" });
      }
      if (resource instanceof URL && resource.origin === self.location.origin) {
        if (resource.pathname === "/icon/alex.png") return fetchAsset(new URL("alex.png", self.location.href), options);
        const avatar = /^\/api\/media\/blobs\/([0-9a-f]{64})$/.exec(resource.pathname);
        if (avatar) return fetchAsset(`${data.endpoint}/avatar/${avatar[1]}`, { ...options, credentials: "omit" });
      }
      return fetchAsset(resource, options);
    };
    return data.packages;
  },
  mountSaves(FS, paths) {
    for (const path of paths) FS.mount(FS.filesystems.IDBFS, {}, path);
  },
  movieUrl() {},
};
