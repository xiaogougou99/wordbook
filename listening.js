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
  let listeningStarted = false;

  function createText(tag, className, value) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = value || "";
    return element;
  }

  function render() {
    const knownTotal = words.filter((word) => statuses[word.id] === "known").length;
    const unknownTotal = words.length - knownTotal;
    unknownCount.textContent = String(unknownTotal);
    knownCount.textContent = String(knownTotal);

    const visible = words.filter((word) => statuses[word.id] === learningView);
    const fragment = document.createDocumentFragment();

    for (const word of visible) {
      const originalNumber = words.indexOf(word) + 1;
      const row = document.createElement("article");
      row.className = "listening-row";
      row.dataset.listeningId = word.id;

      const primary = document.createElement("div");
      primary.className = "listening-primary";
      primary.append(
        createText("span", "listening-number", originalNumber + "."),
        createText("span", "listening-word", word.word)
      );

      const details = document.createElement("div");
      details.className = "listening-details";
      details.append(
        createText("span", "listening-pos", word.part_of_speech),
        createText("span", "listening-meaning", word.meaning)
      );

      const audio = createText("button", "listening-action listening-audio", "🔊");
      audio.type = "button";
      audio.dataset.audioId = word.id;
      audio.setAttribute("aria-label", "播放 " + word.word + " 的美式发音");

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
        createText("div", "listening-phonetic", word.phonetic),
        details,
        audio,
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
      if (!listeningStarted) listeningStarted = true;
      window.ListeningStatusSync.start();
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

    if (button.dataset.statusId) {
      window.ListeningStatusSync.setStatus(button.dataset.statusId, button.dataset.nextStatus);
      return;
    }

    if (button.dataset.audioId) {
      const word = words.find((entry) => entry.id === button.dataset.audioId);
      if (!word) return;
      button.setAttribute("aria-busy", "true");
      await window.WordbookAudio.play(word.word, word.audio);
      button.removeAttribute("aria-busy");
    }
  });

  window.addEventListener("wordbook:listening-state", (event) => {
    statuses = event.detail.statuses;
    render();
  });
  window.addEventListener("hashchange", () => showRoute(location.hash.slice(1)));

  setLearningView("unknown");
  showRoute(location.hash.slice(1));
})();
