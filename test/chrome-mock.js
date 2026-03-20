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
  },
  contextMenus: {
    create: () => {},
    onClicked: createEventTarget(),
  },
  tabs: {
    sendMessage: async () => ({}),
    onRemoved: createEventTarget(),
  },
  downloads: {
    download: async () => 1,
    show: () => {},
  },
  notifications: {
    create: () => {},
  },
  permissions: {
    contains: async () => false,
  },
  webRequest: {
    onCompleted: createEventTarget(),
  },
  scripting: {
    executeScript: async () => [],
  },
};
