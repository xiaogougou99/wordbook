(() => {
  "use strict";

  const audioPlayer = new Audio();
  audioPlayer.preload = "auto";
  const resolvedAudio = new Map();
  const readyRecordings = new Set();
  const preloadingRecordings = new Map();
  let preferredVoice = null;
  let preloadStarted = false;

  function availableVoices() {
    try {
      return window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    } catch {
      return [];
    }
  }

  function chooseNaturalAmericanVoice() {
    const voices = availableVoices();
    if (!voices.length) return null;
    const preferredNames = [
      /Microsoft Aria.*Natural/i,
      /Microsoft Jenny.*Natural/i,
      /Microsoft Guy.*Natural/i,
      /Google US English/i,
      /^Samantha$/i,
      /^Ava/i,
      /^Allison$/i,
      /^Alex$/i,
      /English.*United States/i
    ];
    for (const pattern of preferredNames) {
      const voice = voices.find(
        (candidate) => pattern.test(candidate.name) && /^en(?:-|_)US/i.test(candidate.lang || "en-US")
      );
      if (voice) return voice;
    }
    return voices.find((voice) => /^en(?:-|_)US/i.test(voice.lang || ""))
      || voices.find((voice) => /^en/i.test(voice.lang || ""))
      || null;
  }

  function refreshVoice() {
    preferredVoice = chooseNaturalAmericanVoice();
  }

  if ("speechSynthesis" in window) {
    refreshVoice();
    window.speechSynthesis.addEventListener?.("voiceschanged", refreshVoice);
  }

  function normalizedUrl(url) {
    if (!url) return "";
    return url.startsWith("//") ? "https:" + url : url;
  }

  function isSameOriginUrl(url) {
    try {
      return new URL(normalizedUrl(url), window.location.href).origin === window.location.origin;
    } catch {
      return false;
    }
  }

  function stopCurrentAudio() {
    try {
      audioPlayer.pause();
      audioPlayer.currentTime = 0;
    } catch {
      // Ignore media cleanup errors.
    }
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // Ignore speech cleanup errors.
    }
  }

  async function preloadRecording(url) {
    const normalized = normalizedUrl(url);
    if (!normalized || readyRecordings.has(normalized)) return Boolean(normalized);
    if (preloadingRecordings.has(normalized)) return preloadingRecordings.get(normalized);

    const task = fetch(normalized, { cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error("audio preload failed");
        await response.arrayBuffer();
        readyRecordings.add(normalized);
        return true;
      })
      .catch(() => false)
      .finally(() => preloadingRecordings.delete(normalized));
    preloadingRecordings.set(normalized, task);
    return task;
  }

  async function playReadyRecording(url) {
    const normalized = normalizedUrl(url);
    if (!normalized || !readyRecordings.has(normalized)) return false;
    try {
      audioPlayer.src = normalized;
      audioPlayer.currentTime = 0;
      await audioPlayer.play();
      return true;
    } catch {
      return false;
    }
  }

  async function playSameOriginRecording(url) {
    const normalized = normalizedUrl(url);
    if (!normalized || !isSameOriginUrl(normalized)) return false;
    try {
      audioPlayer.src = normalized;
      audioPlayer.currentTime = 0;
      await audioPlayer.play();
      return true;
    } catch {
      return false;
    }
  }

  async function resolveDictionaryAudio(text) {
    const lookup = text.trim().toLowerCase();
    if (!/^[a-z][a-z'-]*$/.test(lookup)) return "";
    if (resolvedAudio.has(lookup)) return resolvedAudio.get(lookup);
    try {
      const response = await fetch(
        "https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(lookup),
        { cache: "force-cache" }
      );
      if (!response.ok) throw new Error("dictionary lookup failed");
      const entries = await response.json();
      const phonetics = entries.flatMap((entry) => entry.phonetics || []).filter((item) => item.audio);
      const american = phonetics.find((item) => /(?:-us|_us|\/us\/)/i.test(item.audio));
      const url = normalizedUrl((american || phonetics[0] || {}).audio || "");
      resolvedAudio.set(lookup, url);
      return url;
    } catch {
      resolvedAudio.set(lookup, "");
      return "";
    }
  }

  function speakFallback(text) {
    if (!("speechSynthesis" in window)) return false;
    try {
      refreshVoice();
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume?.();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = 0.9;
      utterance.pitch = 1;
      utterance.volume = 1;
      const voice = preferredVoice || chooseNaturalAmericanVoice();
      if (voice) utterance.voice = voice;
      window.speechSynthesis.speak(utterance);
      return true;
    } catch {
      return false;
    }
  }

  function prepare(text, providedUrl = "") {
    const normalized = normalizedUrl(providedUrl);
    if (normalized) {
      preloadRecording(normalized);
      return;
    }
    const lookup = text.trim().toLowerCase();
    const cached = resolvedAudio.get(lookup);
    if (cached) {
      preloadRecording(cached);
      return;
    }
    resolveDictionaryAudio(text).then((url) => {
      if (url) preloadRecording(url);
    });
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

  function preload(entries = []) {
    refreshVoice();
    if (preloadStarted) return;
    preloadStarted = true;

    const direct = entries
      .flatMap((entry) => [
        entry,
        ...(Array.isArray(entry?.pronunciations) ? entry.pronunciations : [])
      ])
      .filter((entry) => entry?.audio);
    runWithConcurrency(direct, 4, (entry) => preloadRecording(entry.audio));

    const firstSingleWords = entries
      .filter((entry) => !entry?.audio && /^[a-z][a-z'-]*$/i.test(entry?.word || ""))
      .slice(0, 48);
    const startBackgroundLookup = () => {
      runWithConcurrency(firstSingleWords, 2, async (entry) => {
        const url = await resolveDictionaryAudio(entry.word);
        if (url) await preloadRecording(url);
      });
    };
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(startBackgroundLookup, { timeout: 1800 });
    } else {
      setTimeout(startBackgroundLookup, 700);
    }
  }

  async function play(text, providedUrl = "") {
    stopCurrentAudio();
    const direct = normalizedUrl(providedUrl);
    if (direct && await playReadyRecording(direct)) return "dictionary";
    if (direct && await playSameOriginRecording(direct)) return "local-recording";

    const lookup = text.trim().toLowerCase();
    const cached = resolvedAudio.get(lookup);
    if (cached && await playReadyRecording(cached)) return "dictionary";

    // Never wait for a network lookup after the user taps. Start speech now and
    // prepare a real dictionary recording in the background for the next tap.
    prepare(text, direct);
    return speakFallback(text) ? "speech-fallback" : "unavailable";
  }

  window.WordbookAudio = Object.freeze({
    play,
    prepare,
    preload,
    stop: stopCurrentAudio
  });
})();
