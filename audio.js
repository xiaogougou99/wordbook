(() => {
  "use strict";

  const audioPlayer = new Audio();
  audioPlayer.preload = "none";
  const resolvedAudio = new Map();
  let preferredVoice = null;

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

  async function playRecording(url) {
    if (!url) return false;
    try {
      audioPlayer.src = url.startsWith("//") ? "https:" + url : url;
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
      const url = (american || phonetics[0] || {}).audio || "";
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
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = 0.88;
      utterance.pitch = 1;
      utterance.volume = 1;
      const voice = chooseNaturalAmericanVoice() || preferredVoice;
      if (voice) utterance.voice = voice;
      window.speechSynthesis.speak(utterance);
      return true;
    } catch {
      return false;
    }
  }

  async function play(text, providedUrl = "") {
    stopCurrentAudio();
    if (await playRecording(providedUrl)) return "dictionary";
    const resolved = await resolveDictionaryAudio(text);
    if (await playRecording(resolved)) return "dictionary";
    return speakFallback(text) ? "speech-fallback" : "unavailable";
  }

  window.WordbookAudio = Object.freeze({ play, stop: stopCurrentAudio });
})();
