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
  },
  notifications: {
    create: () => {},
  },
};
