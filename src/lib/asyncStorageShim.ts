type StorageValue = string | null;

const memoryStore = new Map<string, string>();

function read(key: string): StorageValue {
  if (typeof window === "undefined" || !window.localStorage) {
    return memoryStore.get(key) ?? null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return memoryStore.get(key) ?? null;
  }
}

function write(key: string, value: string) {
  if (typeof window === "undefined" || !window.localStorage) {
    memoryStore.set(key, value);
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch {
    memoryStore.set(key, value);
  }
}

function remove(key: string) {
  memoryStore.delete(key);
  if (typeof window === "undefined" || !window.localStorage) return;

  try {
    window.localStorage.removeItem(key);
  } catch {}
}

const asyncStorageShim = {
  async getItem(key: string): Promise<StorageValue> {
    return read(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    write(key, value);
  },
  async removeItem(key: string): Promise<void> {
    remove(key);
  },
};

export default asyncStorageShim;
