(() => {
  "use strict";

  const config = window.LISTENING_CONFIG;
  const words = Array.isArray(window.LISTENING_WORDS) ? window.LISTENING_WORDS : [];
  const wordIds = new Set(words.map((word) => word.id));
  const statusBox = document.getElementById("meaning-sync-status");
  const statusText = document.getElementById("meaning-sync-text");
  const channel = "BroadcastChannel" in window ? new BroadcastChannel("wordbook-listening-meaning-v1") : null;

  let overrides = readObject(config.meaningCacheKey);
  let pending = readObject(config.meaningPendingKey);
  let started = false;
  let refreshing = false;
  let refreshAgain = false;

  function readObject(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function writeObject(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // In-memory edits remain usable if local storage is restricted.
    }
  }

  function sanitize() {
    const cleanOverrides = {};
    for (const [id, meaning] of Object.entries(overrides)) {
      if (wordIds.has(id) && typeof meaning === "string") cleanOverrides[id] = meaning;
    }
    overrides = cleanOverrides;

    const cleanPending = {};
    for (const [id, operation] of Object.entries(pending)) {
      if (
        wordIds.has(id)
        && operation
        && typeof operation.meaning === "string"
        && Number.isFinite(operation.clientUpdatedAt)
      ) {
        cleanPending[id] = operation;
      }
    }
    pending = cleanPending;
  }

  function snapshot() {
    return { ...overrides };
  }

  function emitState() {
    window.dispatchEvent(
      new CustomEvent("wordbook:listening-meanings", { detail: { meanings: snapshot() } })
    );
  }

  function setSyncStatus(message, kind = "syncing") {
    statusText.textContent = message;
    statusBox.className = "meaning-sync-status is-" + kind;
  }

  function cloudKey(id) {
    return config.meaningKeyPrefix + "-" + id;
  }

  function parseJson(value) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function responseValue(text) {
    const trimmed = String(text || "").trim();
    const parsed = parseJson(trimmed);
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed.val === "string") return parsed.val;
    return /^v1\|/.test(trimmed) ? trimmed : null;
  }

  function parseRemoteMeaning(value) {
    const match = /^v1\|(\d+)\|([\s\S]*)$/.exec(value || "");
    if (!match) return null;
    const meaning = parseJson(match[2]);
    return typeof meaning === "string"
      ? { meaning, updatedAt: Number(match[1]) }
      : null;
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

  async function readRemote(id) {
    try {
      const url = config.cloudApi + "/get/" + encodeURIComponent(cloudKey(id)) + "?t=" + Date.now();
      const response = await fetchWithTimeout(url);
      if (response.status === 404) return { ok: true, hasOverride: false, updatedAt: 0 };
      if (!response.ok) return { ok: false };
      const parsed = parseRemoteMeaning(responseValue(await response.text()));
      return parsed
        ? { ok: true, hasOverride: true, ...parsed }
        : { ok: true, hasOverride: false, updatedAt: 0 };
    } catch {
      return { ok: false };
    }
  }

  async function writeRemote(id, operation) {
    try {
      const value = "v1|" + operation.clientUpdatedAt + "|" + JSON.stringify(operation.meaning);
      const url = config.cloudApi
        + "/set/"
        + encodeURIComponent(cloudKey(id))
        + "/"
        + encodeURIComponent(value)
        + "?t="
        + Date.now();
      const response = await fetchWithTimeout(url);
      if (!response.ok) return false;
      const parsed = parseJson(await response.text());
      return !parsed || !parsed.status || parsed.status === "SUCCESS";
    } catch {
      return false;
    }
  }

  function applyServerMeaning(id, remote) {
    if (!remote?.ok || pending[id]) return;
    if (remote.hasOverride) overrides[id] = remote.meaning;
    else delete overrides[id];
  }

  async function flushOne(id) {
    const operation = pending[id];
    if (!operation || !navigator.onLine) return false;
    if (!(await writeRemote(id, operation))) return false;

    const current = pending[id];
    if (current && current.clientUpdatedAt === operation.clientUpdatedAt) {
      delete pending[id];
      writeObject(config.meaningPendingKey, pending);
    }

    await new Promise((resolve) => setTimeout(resolve, 220));
    const verified = await readRemote(id);
    if (verified.ok && !pending[id]) {
      applyServerMeaning(id, verified);
      writeObject(config.meaningCacheKey, overrides);
      emitState();
      channel?.postMessage({
        type: "server-meaning",
        id,
        hasOverride: verified.hasOverride,
        meaning: verified.meaning
      });
    }
    return verified.ok;
  }

  async function runWithConcurrency(items, limit, worker) {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await worker(items[index], index);
      }
    });
    await Promise.all(runners);
  }

  async function flushPending() {
    const ids = Object.entries(pending)
      .sort((left, right) => left[1].clientUpdatedAt - right[1].clientUpdatedAt)
      .map(([id]) => id);
    if (!ids.length || !navigator.onLine) return ids.length === 0;
    let allOk = true;
    await runWithConcurrency(ids, 4, async (id) => {
      if (!(await flushOne(id))) allOk = false;
    });
    return allOk;
  }

  async function refreshFromServer() {
    if (!started) return;
    if (refreshing) {
      refreshAgain = true;
      return;
    }

    refreshing = true;
    setSyncStatus("正在同步自定义中文释义…", "syncing");
    try {
      await flushPending();
      let successCount = 0;
      const results = new Map();
      await runWithConcurrency(words, config.readConcurrency, async (word) => {
        const remote = await readRemote(word.id);
        if (remote.ok) {
          successCount += 1;
          results.set(word.id, remote);
        }
      });

      for (const [id, remote] of results) applyServerMeaning(id, remote);
      writeObject(config.meaningCacheKey, overrides);
      emitState();

      if (successCount === words.length && Object.keys(pending).length === 0) {
        setSyncStatus("中文释义已与云端同步 · 点击 ✎ 可编辑", "ok");
      } else if (successCount > 0) {
        setSyncStatus("部分释义云端状态暂不可用；本地编辑会自动重试", "warn");
      } else {
        setSyncStatus("释义云端暂不可用；编辑会先保存在本机并自动重试", "warn");
      }
    } finally {
      refreshing = false;
      if (refreshAgain) {
        refreshAgain = false;
        setTimeout(refreshFromServer, 250);
      }
    }
  }

  function setMeaning(id, nextMeaning) {
    if (!wordIds.has(id)) return false;
    const normalized = String(nextMeaning ?? "").trim().slice(0, config.meaningMaxLength);
    const operation = { meaning: normalized, clientUpdatedAt: Date.now() };
    overrides[id] = normalized;
    pending[id] = operation;
    writeObject(config.meaningCacheKey, overrides);
    writeObject(config.meaningPendingKey, pending);
    emitState();
    channel?.postMessage({ type: "optimistic-meaning", id, operation });
    setSyncStatus("释义已立即更新；正在写入云端…", "syncing");
    flushOne(id).then((ok) => {
      if (ok) setSyncStatus("释义已保存到云端", "ok");
      else setSyncStatus("释义云端暂不可用；已在本机排队等待同步", "warn");
    });
    return true;
  }

  function start() {
    if (started) {
      refreshFromServer();
      return;
    }
    started = true;
    sanitize();
    writeObject(config.meaningCacheKey, overrides);
    writeObject(config.meaningPendingKey, pending);
    emitState();
    refreshFromServer();
    setInterval(() => {
      if (!document.hidden && navigator.onLine) refreshFromServer();
    }, config.refreshIntervalMs);
    window.addEventListener("online", refreshFromServer);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && navigator.onLine) refreshFromServer();
    });
  }

  window.addEventListener("storage", (event) => {
    if (event.key === config.meaningCacheKey || event.key === config.meaningPendingKey) {
      overrides = readObject(config.meaningCacheKey);
      pending = readObject(config.meaningPendingKey);
      sanitize();
      emitState();
    }
  });

  channel?.addEventListener("message", (event) => {
    if (event.data?.type === "optimistic-meaning") {
      const { id, operation } = event.data;
      if (wordIds.has(id) && operation && typeof operation.meaning === "string") {
        pending[id] = operation;
        overrides[id] = operation.meaning;
        writeObject(config.meaningCacheKey, overrides);
        writeObject(config.meaningPendingKey, pending);
        emitState();
      }
    }
    if (event.data?.type === "server-meaning") {
      const { id, hasOverride, meaning } = event.data;
      if (!pending[id]) {
        if (hasOverride && typeof meaning === "string") overrides[id] = meaning;
        else delete overrides[id];
        writeObject(config.meaningCacheKey, overrides);
        emitState();
      }
    }
  });

  sanitize();
  window.ListeningMeaningSync = Object.freeze({
    start,
    refresh: refreshFromServer,
    setMeaning,
    getMeanings: snapshot
  });
})();
