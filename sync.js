(() => {
  "use strict";

  const config = window.WORDBOOK_CONFIG;
  const registry = Array.isArray(window.WORD_ID_REGISTRY) ? window.WORD_ID_REGISTRY : [];
  const knownIds = new Set(registry);
  const statusBox = document.getElementById("sync-status");
  const statusText = document.getElementById("sync-text");
  const channel = "BroadcastChannel" in window ? new BroadcastChannel("wordbook-sync-v4") : null;

  let deleted = [];
  let syncing = false;
  let syncAgain = false;
  let started = false;

  function normalize(values) {
    const wanted = new Set(Array.isArray(values) ? values : []);
    return registry.filter((id) => wanted.has(id));
  }

  function union(...collections) {
    const merged = new Set();
    for (const collection of collections) {
      for (const id of collection || []) {
        if (knownIds.has(id)) merged.add(id);
      }
    }
    return registry.filter((id) => merged.has(id));
  }

  function sameIds(left, right) {
    if (left.length !== right.length) return false;
    return left.every((id, index) => id === right[index]);
  }

  function parseJson(value) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function collectKnownIds(value, output, depth = 0) {
    if (depth > 5 || value == null) return;
    if (typeof value === "string") {
      if (knownIds.has(value)) output.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectKnownIds(item, output, depth + 1);
      return;
    }
    if (typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        if (knownIds.has(key) && item !== false && item != null) output.add(key);
        collectKnownIds(item, output, depth + 1);
      }
    }
  }

  function readLocalArray(key) {
    try {
      const parsed = parseJson(localStorage.getItem(key) || "[]");
      return normalize(Array.isArray(parsed) ? parsed : []);
    } catch {
      return [];
    }
  }

  function migrateLegacyLocalState() {
    const migrated = new Set(readLocalArray(config.localDeletedKey));
    try {
      const candidateKeys = new Set(config.knownLegacyStorageKeys);
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && /(?:word|vocab|yihun|deleted|remove)/i.test(key)) candidateKeys.add(key);
      }

      for (const key of candidateKeys) {
        if (!key || key === config.deviceIdKey) continue;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = parseJson(raw);
        if (parsed != null) collectKnownIds(parsed, migrated);
      }
      localStorage.setItem(config.migrationMarkerKey, "1");
    } catch {
      // Storage can be unavailable in strict privacy modes; the in-memory state still works.
    }
    return normalize([...migrated]);
  }

  function saveLocal(next, emit = true) {
    const merged = union(deleted, next);
    const changed = !sameIds(merged, deleted);
    deleted = merged;
    try {
      localStorage.setItem(config.localDeletedKey, JSON.stringify(deleted));
    } catch {
      // Keep the in-memory copy when storage is unavailable.
    }

    if (emit && changed) {
      window.dispatchEvent(new CustomEvent("wordbook:state", { detail: { deleted: [...deleted] } }));
      channel?.postMessage({ type: "deleted", ids: deleted });
    }
    return changed;
  }

  function setStatus(message, state = "syncing") {
    statusText.textContent = message;
    statusBox.className = "sync-status is-" + state;
  }

  function bytesToBase64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function encode(ids) {
    const removed = new Set(normalize(ids));
    const bytes = new Uint8Array(Math.ceil(registry.length / 8));
    registry.forEach((id, index) => {
      if (removed.has(id)) bytes[index >> 3] |= 1 << (index & 7);
    });
    return "v2." + bytesToBase64Url(bytes);
  }

  function decode(value) {
    try {
      if (typeof value !== "string" || !/^v[12]\./.test(value)) return [];
      let payload = value.replace(/^v[12]\./, "").replace(/-/g, "+").replace(/_/g, "/");
      while (payload.length % 4) payload += "=";
      const binary = atob(payload);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const ids = [];
      registry.forEach((id, index) => {
        if ((bytes[index >> 3] || 0) & (1 << (index & 7))) ids.push(id);
      });
      return ids;
    } catch {
      return [];
    }
  }

  function responseValue(text) {
    const trimmed = String(text || "").trim();
    const parsed = parseJson(trimmed);
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed.val === "string") return parsed.val;
    return /^v[12]\./.test(trimmed) ? trimmed : null;
  }

  async function fetchWithTimeout(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      return await fetch(url, { cache: "no-store", signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function readCloudKey(key) {
    try {
      const url = config.cloudApi + "/get/" + encodeURIComponent(key) + "?t=" + Date.now();
      const response = await fetchWithTimeout(url);
      if (response.status === 404) return { ok: true, ids: [] };
      if (!response.ok) return { ok: false, ids: [] };
      return { ok: true, ids: decode(responseValue(await response.text())) };
    } catch {
      return { ok: false, ids: [] };
    }
  }

  async function writeCloudKey(key, ids) {
    try {
      const value = encode(ids);
      if (value.length > 300) return false;
      const url = config.cloudApi + "/set/" + encodeURIComponent(key) + "/" + encodeURIComponent(value) + "?t=" + Date.now();
      const response = await fetchWithTimeout(url);
      if (!response.ok) return false;
      const text = await response.text();
      const parsed = parseJson(text);
      return !parsed || !parsed.status || parsed.status === "SUCCESS";
    } catch {
      return false;
    }
  }

  function getDeviceId() {
    try {
      let id = localStorage.getItem(config.deviceIdKey);
      if (!id) {
        id = crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random();
        localStorage.setItem(config.deviceIdKey, id);
      }
      return id;
    } catch {
      return navigator.userAgent;
    }
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  const deviceSlot = hashString(getDeviceId()) % config.slotCount;
  const slotKeys = Array.from(
    { length: config.slotCount },
    (_, index) => config.deviceSlotPrefix + "-" + String(index).padStart(2, "0")
  );
  const ownSlotKey = slotKeys[deviceSlot];

  async function readCloudState() {
    const keys = [config.legacyCloudKey, ...slotKeys];
    const results = await Promise.all(keys.map((key) => readCloudKey(key)));
    const available = results.some((result) => result.ok);
    const complete = results.every((result) => result.ok);
    const ids = union(...results.filter((result) => result.ok).map((result) => result.ids));
    return {
      available,
      complete,
      ids,
      ownSlotIds: results[deviceSlot + 1]?.ids || [],
      ownSlotAvailable: Boolean(results[deviceSlot + 1]?.ok)
    };
  }

  async function writeOwnSlotWithVerification(target, initialRemote) {
    let desired = union(target, initialRemote);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!(await writeCloudKey(ownSlotKey, desired))) return false;
      await new Promise((resolve) => setTimeout(resolve, 180 + attempt * 140));
      const verified = await readCloudKey(ownSlotKey);
      if (!verified.ok) continue;
      saveLocal(verified.ids);
      const missing = desired.some((id) => !verified.ids.includes(id));
      if (!missing) return true;
      desired = union(desired, verified.ids);
    }
    return false;
  }

  async function synchronize() {
    if (syncing) {
      syncAgain = true;
      return;
    }

    syncing = true;
    setStatus("正在合并本地与云端删除记录…", "syncing");
    try {
      const cloud = await readCloudState();
      if (!cloud.available) {
        setStatus("云端暂时不可用；本机删除记录已安全保留，联网后会自动重试", "warn");
        return;
      }

      saveLocal(cloud.ids);
      const desired = union(deleted, cloud.ids);
      const ownHasAll = desired.every((id) => cloud.ownSlotIds.includes(id));
      let writeOk = true;
      if (desired.length && (!cloud.ownSlotAvailable || !ownHasAll)) {
        writeOk = await writeOwnSlotWithVerification(desired, cloud.ownSlotIds);
      }

      if (!writeOk) {
        setStatus("本机已保存；云端写入未确认，稍后会自动重试", "warn");
      } else if (!cloud.complete) {
        setStatus("已完成可用云端记录的合并；部分副本暂时离线", "warn");
      } else {
        setStatus("已同步 " + deleted.length + " 条删除记录 · 手机和电脑共用", "ok");
      }
    } finally {
      syncing = false;
      if (syncAgain) {
        syncAgain = false;
        setTimeout(synchronize, 200);
      }
    }
  }

  function deleteNow(id) {
    if (!knownIds.has(id)) return;
    saveLocal([id]);
    setStatus("已立即删除；正在后台同步…", "syncing");
    setTimeout(synchronize, 0);
  }

  function start() {
    if (started) return;
    started = true;
    window.dispatchEvent(new CustomEvent("wordbook:state", { detail: { deleted: [...deleted] } }));
    synchronize();
    setInterval(() => {
      if (!document.hidden && navigator.onLine) synchronize();
    }, config.syncIntervalMs);
    window.addEventListener("online", synchronize);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && navigator.onLine) synchronize();
    });
    window.addEventListener("storage", (event) => {
      if (event.key === config.localDeletedKey && event.newValue) {
        const incoming = parseJson(event.newValue);
        if (Array.isArray(incoming)) saveLocal(incoming);
      }
    });
    channel?.addEventListener("message", (event) => {
      if (event.data?.type === "deleted" && Array.isArray(event.data.ids)) saveLocal(event.data.ids, true);
    });
  }

  deleted = migrateLegacyLocalState();
  saveLocal(deleted, false);

  window.WordbookSync = Object.freeze({
    start,
    synchronize,
    deleteNow,
    getDeleted: () => [...deleted]
  });
})();
