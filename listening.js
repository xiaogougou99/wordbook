(() => {
  "use strict";

  const words = Array.isArray(window.LISTENING_WORDS) ? window.LISTENING_WORDS : [];
  const list = document.getElementById("listening-list");
  const unknownCount = document.getElementById("unknown-count");
  const knownCount = document.getElementById("known-count");
  const routeButtons = [...document.querySelectorAll("[data-route]")];
  const pageViews = [...document.querySelectorAll(".page-view")];
  const learningTabs = [...document.querySelectorAll("[data-learning-view]")];

  let learningView = "unknown";
  let statuses = window.ListeningStatusSync.getStatuses();
  let meaningOverrides = window.ListeningMeaningSync.getMeanings();
  let editingMeaningId = "";
  const meaningDrafts = new Map();
  let listeningStarted = false;

  function createText(tag, className, value) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = value || "";
    return element;
  }

  function meaningFor(word) {
    return Object.prototype.hasOwnProperty.call(meaningOverrides, word.id)
      ? meaningOverrides[word.id]
      : word.meaning;
  }

  function createMeaningEditor(word) {
    const wrapper = document.createElement("div");
    wrapper.className = "listening-meaning-wrap";
    const currentMeaning = meaningFor(word);

    if (editingMeaningId === word.id) {
      const editor = document.createElement("div");
      editor.className = "meaning-editor";

      const input = document.createElement("input");
      input.type = "text";
      input.className = "meaning-input";
      input.dataset.meaningInput = word.id;
      input.maxLength = window.LISTENING_CONFIG.meaningMaxLength;
      input.value = meaningDrafts.has(word.id) ? meaningDrafts.get(word.id) : currentMeaning;
      input.setAttribute("aria-label", "编辑 " + word.word + " 的中文释义");
      input.placeholder = "输入中文释义；可添加、删除或清空";

      const save = createText("button", "meaning-editor-button meaning-save", "保存");
      save.type = "button";
      save.dataset.meaningSave = word.id;

      const cancel = createText("button", "meaning-editor-button meaning-cancel", "取消");
      cancel.type = "button";
      cancel.dataset.meaningCancel = word.id;

      editor.append(input, save, cancel);
      wrapper.append(editor);
      return wrapper;
    }

    const meaning = createText(
      "span",
      "listening-meaning" + (currentMeaning ? "" : " is-empty"),
      currentMeaning || "（暂无释义）"
    );
    const edit = createText("button", "meaning-edit-button", "✎");
    edit.type = "button";
    edit.dataset.meaningEdit = word.id;
    edit.setAttribute("aria-label", "编辑 " + word.word + " 的中文释义");
    edit.title = "添加或删除中文释义";
    wrapper.append(meaning, edit);
    return wrapper;
  }

  function pronunciationOptions(word) {
    return Array.isArray(word.pronunciations) && word.pronunciations.length
      ? word.pronunciations
      : [{ text: word.word, phonetic: word.phonetic, audio: word.audio || "" }];
  }

  function createPhonetic(word) {
    const phonetic = document.createElement("div");
    phonetic.className = "listening-phonetic";
    const options = pronunciationOptions(word);

    if (!Array.isArray(word.pronunciations) || !word.pronunciations.length) {
      phonetic.textContent = word.phonetic || "";
      return phonetic;
    }

    phonetic.classList.add("has-variants");
    for (const option of options) {
      const line = document.createElement("span");
      line.className = "pronunciation-line";
      line.append(
        createText(
          "span",
          "pronunciation-label",
          option.label + (option.part_of_speech ? " " + option.part_of_speech : "")
        ),
        createText("span", "pronunciation-ipa", option.phonetic)
      );
      phonetic.append(line);
    }
    return phonetic;
  }

  function createAudioControls(word) {
    const group = document.createElement("div");
    group.className = "listening-audio-group";
    const options = pronunciationOptions(word);
    const labeled = options.length > 1;

    for (const option of options) {
      const audio = createText(
        "button",
        "listening-action listening-audio" + (labeled ? " is-labeled" : ""),
        labeled ? "🔊 " + option.label : "🔊"
      );
      audio.type = "button";
      audio.dataset.audioId = word.id;
      audio.dataset.audioText = option.text || word.word;
      audio.dataset.audioUrl = option.audio || "";
      audio.setAttribute(
        "aria-label",
        "播放 " + word.word + (option.label ? "（" + option.label + "）" : "") + " 的美式发音"
      );
      group.append(audio);
    }
    return group;
  }

  function render() {
    const knownTotal = words.filter((word) => statuses[word.id] === "known").length;
    const unknownTotal = words.length - knownTotal;
    unknownCount.textContent = String(unknownTotal);
    knownCount.textContent = String(knownTotal);

    const visible = words.filter((word) => statuses[word.id] === learningView);
    const fragment = document.createDocumentFragment();

    for (const [visibleIndex, word] of visible.entries()) {
      const displayNumber = visibleIndex + 1;
      const row = document.createElement("article");
      row.className = "listening-row";
      row.dataset.listeningId = word.id;

      const primary = document.createElement("div");
      primary.className = "listening-primary";
      primary.append(
        createText("span", "listening-number", displayNumber + "."),
        createText("span", "listening-word", word.word)
      );

      const details = document.createElement("div");
      details.className = "listening-details";
      details.classList.toggle("is-editing", editingMeaningId === word.id);
      details.append(
        createText("span", "listening-pos", word.part_of_speech),
        createMeaningEditor(word)
      );

      const audioControls = createAudioControls(word);

      const statusAction = document.createElement("button");
      statusAction.type = "button";
      statusAction.className = "listening-action listening-status-action";
      statusAction.dataset.statusId = word.id;
      if (learningView === "unknown") {
        statusAction.textContent = "×";
        statusAction.dataset.nextStatus = "known";
        statusAction.setAttribute("aria-label", "将 " + word.word + " 标记为已会");
        statusAction.title = "标记为已会";
      } else {
        statusAction.textContent = "↩ 恢复";
        statusAction.dataset.nextStatus = "unknown";
        statusAction.setAttribute("aria-label", "将 " + word.word + " 恢复为未会");
        statusAction.title = "恢复为未会";
      }

      row.append(
        primary,
        createPhonetic(word),
        details,
        audioControls,
        statusAction
      );
      fragment.append(row);
    }

    list.replaceChildren(fragment);
    if (!visible.length) {
      list.append(
        createText(
          "p",
          "empty-state listening-empty",
          learningView === "unknown" ? "未会列表已经清空。" : "还没有标记为已会的词。"
        )
      );
    }
  }

  function setLearningView(nextView) {
    learningView = nextView === "known" ? "known" : "unknown";
    for (const tab of learningTabs) {
      const active = tab.dataset.learningView === learningView;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    }
    render();
  }

  function showRoute(route) {
    const selected = route === "listening" ? "listening" : "wordbook";
    for (const view of pageViews) view.hidden = view.dataset.view !== selected;
    for (const button of routeButtons) {
      const active = button.dataset.route === selected;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    if (selected === "listening") {
      if (!listeningStarted) {
        listeningStarted = true;
        window.WordbookAudio.preload(words);
      }
      window.ListeningStatusSync.start();
      window.ListeningMeaningSync.start();
    }
  }

  routeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const route = button.dataset.route;
      history.replaceState(null, "", "#" + route);
      showRoute(route);
    });
  });

  learningTabs.forEach((tab) => {
    tab.addEventListener("click", () => setLearningView(tab.dataset.learningView));
  });

  list.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.dataset.meaningEdit) {
      editingMeaningId = button.dataset.meaningEdit;
      const word = words.find((entry) => entry.id === editingMeaningId);
      if (word && !meaningDrafts.has(editingMeaningId)) {
        meaningDrafts.set(editingMeaningId, meaningFor(word));
      }
      render();
      requestAnimationFrame(() => {
        const input = list.querySelector('[data-meaning-input="' + editingMeaningId + '"]');
        input?.focus();
        input?.select();
      });
      return;
    }

    if (button.dataset.meaningCancel) {
      meaningDrafts.delete(button.dataset.meaningCancel);
      editingMeaningId = "";
      render();
      return;
    }

    if (button.dataset.meaningSave) {
      const id = button.dataset.meaningSave;
      const input = list.querySelector('[data-meaning-input="' + id + '"]');
      const nextMeaning = input ? input.value : meaningDrafts.get(id) || "";
      window.ListeningMeaningSync.setMeaning(id, nextMeaning);
      meaningDrafts.delete(id);
      editingMeaningId = "";
      render();
      return;
    }

    if (button.dataset.statusId) {
      window.ListeningStatusSync.setStatus(button.dataset.statusId, button.dataset.nextStatus);
      return;
    }

    if (button.dataset.audioId) {
      const word = words.find((entry) => entry.id === button.dataset.audioId);
      if (!word) return;
      button.setAttribute("aria-busy", "true");
      await window.WordbookAudio.play(
        button.dataset.audioText || word.word,
        button.dataset.audioUrl || word.audio
      );
      button.removeAttribute("aria-busy");
    }
  });

  list.addEventListener("pointerdown", (event) => {
    const button = event.target.closest("[data-audio-id]");
    if (!button) return;
    const word = words.find((entry) => entry.id === button.dataset.audioId);
    if (word) {
      window.WordbookAudio.prepare(
        button.dataset.audioText || word.word,
        button.dataset.audioUrl || word.audio
      );
    }
  });

  list.addEventListener("input", (event) => {
    if (event.target.dataset.meaningInput) {
      meaningDrafts.set(event.target.dataset.meaningInput, event.target.value);
    }
  });

  list.addEventListener("keydown", (event) => {
    const id = event.target.dataset.meaningInput;
    if (!id) return;
    if (event.key === "Enter") {
      event.preventDefault();
      list.querySelector('[data-meaning-save="' + id + '"]')?.click();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      list.querySelector('[data-meaning-cancel="' + id + '"]')?.click();
    }
  });

  window.addEventListener("wordbook:listening-state", (event) => {
    statuses = event.detail.statuses;
    render();
  });
  window.addEventListener("wordbook:listening-meanings", (event) => {
    meaningOverrides = event.detail.meanings;
    render();
  });
  window.addEventListener("hashchange", () => showRoute(location.hash.slice(1)));

  setLearningView("unknown");
  showRoute(location.hash.slice(1));
})();
