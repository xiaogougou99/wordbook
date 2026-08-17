(() => {
  "use strict";

  const config = window.LISTENING_CONFIG;
  const words = Array.isArray(window.LISTENING_WORDS) ? window.LISTENING_WORDS : [];
  const wordById = new Map(words.map((word) => [word.id, word]));
  const idByNormalizedWord = new Map(words.map((word) => [normalizeWord(word.word), word.id]));
  const statusBox = document.getElementById("listening-sync-status");
  const statusText = document.getElementById("listening-sync-text");
  const channel = "BroadcastChannel" in window ? new BroadcastChannel("wordbook-listening-v1") : null;

  let state = readObject(config.localCacheKey);
  let pending = readObject(config.localPendingKey);
  let started = false;
  let refreshing = false;
  let refreshAgain = false;

  function normalizeWord(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\.$/, "");
  }

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
      // In-memory state remains usable when browser storage is restricted.
    }
  }

  function sanitizeState() {
    const cleanState = {};
    for (const [id, status] of Object.entries(state)) {
      if (wordById.has(id) && status === "known") cleanState[id] = "known";
    }
    state = cleanState;

    const cleanPending = {};
    for (const [id, operation] of Object.entries(pending)) {
      if (
        wordById.has(id)
        && operation
        && (operation.status === "known" || operation.status === "unknown")
      ) {
        cleanPending[id] = operation;
      }
    }
    pending = cleanPending;
  }

  function statusFor(id) {
    if (pending[id]) return pending[id].status;
    return state[id] === "known" ? "known" : "unknown";
  }

  function snapshot() {
    const statuses = {};
    for (const word of words) statuses[word.id] = statusFor(word.id);
    return statuses;
  }

  function emitState() {
    window.dispatchEvent(
      new CustomEvent("wordbook:listening-state", { detail: { statuses: snapshot() } })
    );
  }

  function setSyncStatus(message, kind = "syncing") {
    statusText.textContent = message;
    statusBox.className = "sync-status is-" + kind;
  }

  function cloudKey(id) {
    return config.stateKeyPrefix + "-" + id;
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

  function parseRemoteStatus(value) {
    const match = /^v1\|(known|unknown)\|(\d+)$/.exec(value || "");
    return match ? { status: match[1], updatedAt: Number(match[2]) } : null;
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
      if (response.status === 404) return { ok: true, status: "unknown", updatedAt: 0 };
      if (!response.ok) return { ok: false };
      const parsed = parseRemoteStatus(responseValue(await response.text()));
      return parsed ? { ok: true, ...parsed } : { ok: true, status: "unknown", updatedAt: 0 };
    } catch {
      return { ok: false };
    }
  }

  async function writeRemote(id, operation) {
    try {
      const value = "v1|" + operation.status + "|" + operation.clientUpdatedAt;
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

  function applyServerStatus(id, remote) {
    if (!remote?.ok || pending[id]) return;
    if (remote.status === "known") state[id] = "known";
    else delete state[id];
  }

  async function flushOne(id) {
    const operation = pending[id];
    if (!operation || !navigator.onLine) return false;
    if (!(await writeRemote(id, operation))) return false;

    const current = pending[id];
    if (current && current.clientUpdatedAt === operation.clientUpdatedAt) {
      delete pending[id];
      writeObject(config.localPendingKey, pending);
    }

    await new Promise((resolve) => setTimeout(resolve, 220));
    const verified = await readRemote(id);
    if (verified.ok && !pending[id]) {
      applyServerStatus(id, verified);
      writeObject(config.localCacheKey, state);
      emitState();
      channel?.postMessage({ type: "server-state", id, status: verified.status });
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
    const operations = Object.entries(pending)
      .sort((left, right) => left[1].clientUpdatedAt - right[1].clientUpdatedAt)
      .map(([id]) => id);
    if (!operations.length || !navigator.onLine) return operations.length === 0;
    let allOk = true;
    await runWithConcurrency(operations, 4, async (id) => {
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
    setSyncStatus("正在从云端读取听力学习状态…", "syncing");
    try {
      await flushPending();
      let successCount = 0;
      const remoteResults = new Map();
      await runWithConcurrency(words, config.readConcurrency, async (word) => {
        const remote = await readRemote(word.id);
        if (remote.ok) {
          successCount += 1;
          remoteResults.set(word.id, remote);
        }
      });

      for (const [id, remote] of remoteResults) applyServerStatus(id, remote);
      writeObject(config.localCacheKey, state);
      emitState();

      if (successCount === words.length && Object.keys(pending).length === 0) {
        setSyncStatus("听力学习状态已与云端同步", "ok");
      } else if (successCount > 0) {
        setSyncStatus("部分云端状态暂时不可用；已保留本地缓存并会自动重试", "warn");
      } else {
        setSyncStatus("云端暂时不可用；操作会先缓存，联网后自动提交", "warn");
      }
    } finally {
      refreshing = false;
      if (refreshAgain) {
        refreshAgain = false;
        setTimeout(refreshFromServer, 250);
      }
    }
  }

  function migrateLegacyKnownWords() {
    try {
      if (localStorage.getItem(config.migrationMarkerKey) === "1") return;
      const legacy = JSON.parse(localStorage.getItem(config.legacyKnownKey) || "[]");
      if (Array.isArray(legacy)) {
        let timestamp = Date.now();
        for (const word of legacy) {
          const id = idByNormalizedWord.get(normalizeWord(word));
          if (!id) continue;
          state[id] = "known";
          pending[id] = { status: "known", clientUpdatedAt: timestamp };
          timestamp += 1;
        }
      }
      localStorage.setItem(config.migrationMarkerKey, "1");
      writeObject(config.localCacheKey, state);
      writeObject(config.localPendingKey, pending);
    } catch {
      // A failed migration is retried on the next load because the marker is not written.
    }
  }

  function setStatus(id, nextStatus) {
    if (!wordById.has(id) || !["known", "unknown"].includes(nextStatus)) return;
    const operation = { status: nextStatus, clientUpdatedAt: Date.now() };
    pending[id] = operation;
    if (nextStatus === "known") state[id] = "known";
    else delete state[id];
    writeObject(config.localCacheKey, state);
    writeObject(config.localPendingKey, pending);
    emitState();
    channel?.postMessage({ type: "optimistic", id, operation });
    setSyncStatus("状态已立即更新；正在写入云端…", "syncing");
    flushOne(id).then((ok) => {
      if (ok) setSyncStatus("状态已保存到云端", "ok");
      else setSyncStatus("云端暂时不可用；状态已缓存，联网后自动提交", "warn");
    });
  }

  function start() {
    if (started) {
      refreshFromServer();
      return;
    }
    started = true;
    migrateLegacyKnownWords();
    sanitizeState();
    writeObject(config.localCacheKey, state);
    writeObject(config.localPendingKey, pending);
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
    if (event.key === config.localCacheKey || event.key === config.localPendingKey) {
      state = readObject(config.localCacheKey);
      pending = readObject(config.localPendingKey);
      sanitizeState();
      emitState();
    }
  });

  channel?.addEventListener("message", (event) => {
    if (event.data?.type === "optimistic") {
      const { id, operation } = event.data;
      if (wordById.has(id) && operation) {
        pending[id] = operation;
        if (operation.status === "known") state[id] = "known";
        else delete state[id];
        writeObject(config.localCacheKey, state);
        writeObject(config.localPendingKey, pending);
        emitState();
      }
    }
    if (event.data?.type === "server-state") {
      const { id, status } = event.data;
      if (!pending[id]) {
        if (status === "known") state[id] = "known";
        else delete state[id];
        writeObject(config.localCacheKey, state);
        emitState();
      }
    }
  });

  sanitizeState();
  window.ListeningStatusSync = Object.freeze({
    start,
    refresh: refreshFromServer,
    setStatus,
    getStatuses: snapshot
  });
})();
