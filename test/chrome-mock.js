function createStorageArea() {
  let data = {};
  return {
    get: async (keys) => {
      if (typeof keys === 'string') {
        return { [keys]: data[keys] };
      }
      const result = {};
      for (const [key, defaultValue] of Object.entries(keys)) {
        result[key] = key in data ? data[key] : defaultValue;
      }
      return result;
    },
    set: async (items) => {
      Object.assign(data, items);
    },
    remove: async (keys) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      keyList.forEach((k) => delete data[k]);
    },
    _reset: () => { data = {}; },
    _data: () => ({ ...data }),
  };
}

function createEventTarget() {
  const listeners = [];
  return {
    addListener: (fn) => { listeners.push(fn); },
    removeListener: (fn) => {
      const idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    },
    hasListener: (fn) => listeners.includes(fn),
    _listeners: listeners,
  };
}

globalThis.chrome = {
  storage: {
    sync: createStorageArea(),
    local: createStorageArea(),
    session: createStorageArea(),
  },
  runtime: {
    id: 'test-extension-id',
    getManifest: () => ({ version: '1.0.0' }),
    sendMessage: (_msg, callback) => {
      if (callback) callback({ urls: [] });
    },
    onInstalled: createEventTarget(),
    onStartup: createEventTarget(),
    onMessage: createEventTarget(),
    openOptionsPage: () => {},
    getContexts: async () => [],
  },
  contextMenus: {
    create: () => {},
    removeAll: (cb) => { if (cb) cb(); },
    onClicked: createEventTarget(),
  },
  tabs: {
    sendMessage: async () => ({}),
    onRemoved: createEventTarget(),
  },
  downloads: {
    download: async () => 1,
    show: () => {},
    onChanged: createEventTarget(),
    // Returns no filename by default, which is the real pre-assignment state rather
    // than a convenient one. Tests that need lifecycle state or the final filename
    // override this with a complete DownloadItem-shaped record.
    search: async () => [{}],
    onErased: createEventTarget(),
  },
  notifications: {
    create: () => {},
  },
  permissions: {
    contains: async () => false,
    // Granted by default in tests; a test can override to simulate a denial.
    request: async () => true,
  },
  webRequest: {
    onCompleted: createEventTarget(),
  },
  scripting: {
    executeScript: async () => [],
  },
  offscreen: {
    createDocument: async () => {},
    closeDocument: async () => {},
    hasDocument: async () => false,
  },
};

// URL blob helpers (not present in the jsdom/node test env by default)
if (!globalThis.URL.createObjectURL) {
  globalThis.URL.createObjectURL = () => 'blob:mock/00000000-0000-0000-0000-000000000000';
}
if (!globalThis.URL.revokeObjectURL) {
  globalThis.URL.revokeObjectURL = () => {};
}

// navigator.clipboard
if (!globalThis.navigator) globalThis.navigator = {};
globalThis.navigator.clipboard = { writeText: async () => {} };

// Simple installable fetch mock. Tests call installFetch(map|fn); resetFetch() clears it.
globalThis.__fetchResponses = null;
globalThis.installFetch = (handler) => { globalThis.__fetchResponses = handler; };
globalThis.resetFetch = () => { globalThis.__fetchResponses = null; };
globalThis.fetch = async (url) => {
  const h = globalThis.__fetchResponses;
  const spec = typeof h === 'function' ? h(url) : (h ? h[url] : null);
  if (!spec) return { ok: false, status: 404, json: async () => ({}) };
  return {
    ok: spec.status ? spec.status >= 200 && spec.status < 400 : true,
    status: spec.status || 200,
    json: async () => spec.json,
    blob: async () => spec.blob || new Blob([]),
  };
};
