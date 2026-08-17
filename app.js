(() => {
  "use strict";

  const groups = Array.isArray(window.WORD_GROUPS) ? window.WORD_GROUPS : [];
  const root = document.getElementById("wordbook");
  const summary = document.getElementById("summary");
  const totalEntries = groups.flat().length;

  function textElement(tag, className, value) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = value || "";
    return element;
  }

  function render(deletedIds) {
    const deleted = new Set(deletedIds || []);
    const fragment = document.createDocumentFragment();
    let visibleGroups = 0;
    let visibleEntries = 0;

    for (const group of groups) {
      const visibleRows = group.filter((entry) => !deleted.has(entry.id));
      if (!visibleRows.length) continue;

      visibleGroups += 1;
      const card = document.createElement("section");
      card.className = "word-group";

      for (const entry of visibleRows) {
        visibleEntries += 1;
        const row = document.createElement("article");
        row.className = "word-row" + (entry.main ? " is-main" : "");
        row.dataset.entryId = entry.id;

        const wordCell = document.createElement("div");
        wordCell.className = "word-cell";
        const word = textElement("div", "word", entry.w);
        if (entry.main) {
          const number = textElement("span", "group-number", visibleGroups + ".");
          word.prepend(number);
        }
        wordCell.append(word);
        if (entry.i) wordCell.append(textElement("span", "ipa", entry.i));

        const actions = document.createElement("div");
        actions.className = "row-actions";

        const speak = textElement("button", "action-button speak-button", "🔊 英文");
        speak.type = "button";
        speak.dataset.speak = entry.w;
        speak.setAttribute("aria-label", "朗读 " + entry.w);

        const remove = textElement("button", "action-button delete-button", "×");
        remove.type = "button";
        remove.dataset.deleteId = entry.id;
        remove.setAttribute("aria-label", "删除 " + entry.w);

        actions.append(speak, remove);
        row.append(
          wordCell,
          textElement("div", "part-of-speech", entry.p),
          textElement("div", "meaning", entry.m),
          actions
        );
        card.append(row);
      }
      fragment.append(card);
    }

    root.replaceChildren(fragment);
    summary.textContent = "共 " + visibleGroups + " 组 · 显示 " + visibleEntries + " / " + totalEntries + " 个词条";

    if (!visibleEntries) {
      root.append(textElement("p", "empty-state", "所有词条都已掌握。删除记录仍保存在本地和云端。"));
    }
  }

  root.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.dataset.speak) {
      button.setAttribute("aria-busy", "true");
      await window.WordbookAudio.play(button.dataset.speak);
      button.removeAttribute("aria-busy");
      return;
    }

    if (button.dataset.deleteId) {
      window.WordbookSync.deleteNow(button.dataset.deleteId);
    }
  });

  window.addEventListener("wordbook:state", (event) => render(event.detail.deleted));
  render(window.WordbookSync.getDeleted());
  window.WordbookSync.start();
})();
