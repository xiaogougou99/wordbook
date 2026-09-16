(() => {
  "use strict";

  const items = Array.isArray(window.RED_CLOZE_ITEMS) ? window.RED_CLOZE_ITEMS : [];
  const storageKey = "wordbook-red-cloze-progress-v1";
  const elements = {
    totalCount: document.getElementById("total-count"),
    sourceCount: document.getElementById("source-count"),
    uniqueCount: document.getElementById("unique-count"),
    masteredCount: document.getElementById("mastered-count"),
    wrongCount: document.getElementById("wrong-count"),
    position: document.getElementById("position"),
    progressBar: document.getElementById("progress-bar"),
    poolMode: document.getElementById("pool-mode"),
    sourceFilter: document.getElementById("source-filter"),
    questionCard: document.getElementById("question-card"),
    emptyState: document.getElementById("empty-state"),
    questionDate: document.getElementById("question-date"),
    questionSource: document.getElementById("question-source"),
    questionPhrase: document.getElementById("question-phrase"),
    letterHint: document.getElementById("letter-hint"),
    answerForm: document.getElementById("answer-form"),
    answerInput: document.getElementById("answer-input"),
    feedback: document.getElementById("feedback"),
    fullPhrase: document.getElementById("full-phrase"),
    revealButton: document.getElementById("reveal-button"),
    shuffleButton: document.getElementById("shuffle-button"),
    nextButton: document.getElementById("next-button"),
    resetButton: document.getElementById("reset-button"),
    referenceList: document.getElementById("reference-list")
  };

  let progress = loadProgress();
  let pool = [];
  let currentIndex = 0;

  function loadProgress() {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || "{}");
      return {
        mastered: Array.isArray(parsed.mastered) ? parsed.mastered : [],
        wrong: parsed.wrong && typeof parsed.wrong === "object" ? parsed.wrong : {}
      };
    } catch (_) {
      return { mastered: [], wrong: {} };
    }
  }

  function saveProgress() {
    localStorage.setItem(storageKey, JSON.stringify(progress));
  }

  function normalize(value) {
    return String(value || "").trim().toLocaleLowerCase("en-US");
  }

  function sources() {
    const seen = new Map();
    for (const item of items) {
      const key = item.date + "|" + item.source;
      if (!seen.has(key)) seen.set(key, { key, date: item.date, source: item.source });
    }
    return [...seen.values()];
  }

  function buildSourceFilter() {
    for (const source of sources()) {
      const option = document.createElement("option");
      option.value = source.key;
      option.textContent = source.date + " · " + source.source;
      elements.sourceFilter.append(option);
    }
  }

  function filteredItems() {
    const mastered = new Set(progress.mastered);
    const mode = elements.poolMode.value;
    const source = elements.sourceFilter.value;
    return items.filter((item) => {
      if (source !== "all" && source !== item.date + "|" + item.source) return false;
      if (mode === "unmastered" && mastered.has(item.id)) return false;
      if (mode === "wrong" && !progress.wrong[item.id]) return false;
      return true;
    });
  }

  function maskedAnswer(answer) {
    const chars = [...answer];
    if (!chars.length) return "";
    return chars[0] + chars.slice(1).map((char) => /[a-z]/i.test(char) ? "_" : char).join("");
  }

  function splitPhrase(item) {
    const marker = "{{answer}}";
    const index = item.phrase.indexOf(marker);
    return index === -1
      ? [item.phrase, ""]
      : [item.phrase.slice(0, index), item.phrase.slice(index + marker.length)];
  }

  function fillPhraseNode(node, item, reveal) {
    const [before, after] = splitPhrase(item);
    node.replaceChildren();
    node.append(document.createTextNode(before));
    const target = document.createElement(reveal ? "strong" : "span");
    target.className = reveal ? "" : "blank";
    target.textContent = reveal ? item.answer : "?";
    node.append(target, document.createTextNode(after));
  }

  function currentItem() {
    return pool[currentIndex] || null;
  }

  function updateStats() {
    const knownIds = new Set(items.map((item) => item.id));
    const mastered = progress.mastered.filter((id) => knownIds.has(id)).length;
    const wrong = Object.keys(progress.wrong).filter((id) => knownIds.has(id)).length;
    elements.totalCount.textContent = items.length;
    elements.sourceCount.textContent = sources().length;
    elements.uniqueCount.textContent = new Set(items.map((item) => normalize(item.answer))).size;
    elements.masteredCount.textContent = mastered;
    elements.wrongCount.textContent = wrong;
  }

  function clearFeedback() {
    elements.feedback.textContent = "";
    elements.feedback.className = "feedback";
    elements.fullPhrase.hidden = true;
    elements.fullPhrase.replaceChildren();
    elements.answerInput.value = "";
  }

  function renderQuestion() {
    updateStats();
    const item = currentItem();
    const hasItem = Boolean(item);
    elements.questionCard.hidden = !hasItem;
    elements.emptyState.hidden = hasItem;
    if (!item) {
      elements.position.textContent = "0 / 0";
      elements.progressBar.style.width = "0%";
      return;
    }

    elements.position.textContent = (currentIndex + 1) + " / " + pool.length;
    elements.progressBar.style.width = (((currentIndex + 1) / pool.length) * 100).toFixed(1) + "%";
    elements.questionDate.textContent = item.date;
    elements.questionSource.textContent = item.source;
    fillPhraseNode(elements.questionPhrase, item, false);
    elements.letterHint.textContent = "首字母提示：" + maskedAnswer(item.answer);
    clearFeedback();
    elements.answerInput.focus({ preventScroll: true });
  }

  function rebuildPool(keepId) {
    pool = filteredItems();
    const keptIndex = keepId ? pool.findIndex((item) => item.id === keepId) : -1;
    currentIndex = keptIndex >= 0 ? keptIndex : 0;
    renderQuestion();
  }

  function revealAnswer(message, className) {
    const item = currentItem();
    if (!item) return;
    elements.feedback.textContent = message;
    elements.feedback.className = "feedback " + className;
    fillPhraseNode(elements.fullPhrase, item, true);
    elements.fullPhrase.hidden = false;
  }

  function checkAnswer() {
    const item = currentItem();
    if (!item) return;
    const response = normalize(elements.answerInput.value);
    if (!response) {
      elements.feedback.textContent = "请先输入答案。";
      elements.feedback.className = "feedback is-wrong";
      return;
    }

    if (response === normalize(item.answer)) {
      if (!progress.mastered.includes(item.id)) progress.mastered.push(item.id);
      saveProgress();
      updateStats();
      revealAnswer("正确。记住整个搭配，不只记这个单词。", "is-correct");
      return;
    }

    progress.mastered = progress.mastered.filter((id) => id !== item.id);
    progress.wrong[item.id] = (progress.wrong[item.id] || 0) + 1;
    saveProgress();
    updateStats();
    elements.feedback.textContent = "还不对，请结合首字母和搭配再试一次。";
    elements.feedback.className = "feedback is-wrong";
    elements.answerInput.select();
  }

  function nextQuestion() {
    if (!pool.length) return;
    currentIndex = (currentIndex + 1) % pool.length;
    renderQuestion();
  }

  function randomQuestion() {
    if (pool.length < 2) return;
    let next = currentIndex;
    while (next === currentIndex) next = Math.floor(Math.random() * pool.length);
    currentIndex = next;
    renderQuestion();
  }

  function renderReference() {
    const groups = new Map();
    for (const item of items) {
      const key = item.date + "|" + item.source;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    const fragment = document.createDocumentFragment();
    for (const groupItems of groups.values()) {
      const first = groupItems[0];
      const details = document.createElement("details");
      details.className = "source-group";
      const summary = document.createElement("summary");
      const date = document.createElement("span");
      date.className = "source-group-date";
      date.textContent = first.date;
      const title = document.createElement("span");
      title.textContent = first.source;
      const count = document.createElement("span");
      count.className = "source-group-count";
      count.textContent = groupItems.length + "词";
      summary.append(date, title, count);

      const list = document.createElement("div");
      list.className = "source-items";
      for (const item of groupItems) {
        const row = document.createElement("div");
        row.className = "source-item";
        const word = document.createElement("span");
        word.className = "red-word";
        word.textContent = item.answer;
        const phrase = document.createElement("span");
        phrase.className = "source-phrase";
        const [before, after] = splitPhrase(item);
        phrase.append(document.createTextNode(before));
        const mark = document.createElement("mark");
        mark.textContent = item.answer;
        phrase.append(mark, document.createTextNode(after));
        row.append(word, phrase);
        list.append(row);
      }
      details.append(summary, list);
      fragment.append(details);
    }
    elements.referenceList.replaceChildren(fragment);
  }

  function keepParentFrameInSync() {
    const frame = window.frameElement;
    if (!frame || typeof ResizeObserver === "undefined") return;
    const resize = () => {
      const height = Math.max(
        document.documentElement.scrollHeight,
        document.documentElement.offsetHeight,
        document.body.scrollHeight,
        document.body.offsetHeight
      );
      if (height && Math.abs(frame.offsetHeight - height) > 1) frame.style.height = height + "px";
    };
    new ResizeObserver(() => requestAnimationFrame(resize)).observe(document.body);
    requestAnimationFrame(resize);
  }

  elements.answerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    checkAnswer();
  });
  elements.nextButton.addEventListener("click", nextQuestion);
  elements.shuffleButton.addEventListener("click", randomQuestion);
  elements.revealButton.addEventListener("click", () => {
    const item = currentItem();
    if (!item) return;
    progress.mastered = progress.mastered.filter((id) => id !== item.id);
    progress.wrong[item.id] = (progress.wrong[item.id] || 0) + 1;
    saveProgress();
    updateStats();
    revealAnswer("答案已显示；这一题已加入错题记录。", "is-wrong");
  });
  elements.poolMode.addEventListener("change", () => rebuildPool());
  elements.sourceFilter.addEventListener("change", () => rebuildPool());
  elements.resetButton.addEventListener("click", () => {
    if (!window.confirm("确定清空已答对和错题记录吗？词表本身不会删除。")) return;
    progress = { mastered: [], wrong: {} };
    saveProgress();
    rebuildPool();
  });

  buildSourceFilter();
  renderReference();
  rebuildPool();
  keepParentFrameInSync();
})();
