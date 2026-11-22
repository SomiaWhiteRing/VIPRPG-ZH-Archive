const fetchAsset = self.fetch.bind(self);

self.easyRpgStorage = {
  packages(data) {
    self.toyGyokuroReplay = { endpoint: data.endpoint, token: data.token };
    self.fetch = (resource, options) => {
      // Kai's recording outbox uses a site-relative path. Keep its grants and retry logic.
      if (resource === "/api/netplay-recordings/upload") {
        return fetchAsset(`${data.endpoint}/recording`, { ...options, credentials: "omit" });
      }
      if (resource instanceof URL && resource.origin === self.location.origin &&
          (resource.pathname === "/icon/alex.png" || /^\/api\/media\/blobs\/[0-9a-f]{64}$/.test(resource.pathname))) {
        return fetchAsset(new URL("alex.png", self.location.href), options);
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
