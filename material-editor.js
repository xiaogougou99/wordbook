(function () {
  "use strict";

  const article = document.querySelector(".material-document");
  if (!article) return;

  const storageKey = `toefl-material-editor:${location.pathname}:v1`;
  const originalMarkup = article.innerHTML;
  let editing = false;
  let dirty = false;

  function sanitizeMarkup(markup) {
    const template = document.createElement("template");
    template.innerHTML = markup;
    template.content
      .querySelectorAll("script, style, iframe, object, embed, form, .material-delete-button")
      .forEach((element) => element.remove());
    template.content.querySelectorAll("*").forEach((element) => {
      [...element.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        if (name.startsWith("on") || name === "contenteditable" || name === "spellcheck") {
          element.removeAttribute(attribute.name);
        }
      });
    });
    return template.innerHTML;
  }

  function readSavedMarkup() {
    try {
      return localStorage.getItem(storageKey);
    } catch (_error) {
      return null;
    }
  }

  const savedMarkup = readSavedMarkup();
  if (savedMarkup) article.innerHTML = sanitizeMarkup(savedMarkup);

  const toolbar = document.createElement("div");
  toolbar.className = "material-editor-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "材料编辑工具");
  toolbar.innerHTML = `
    <div class="material-editor-actions">
      <button type="button" data-action="edit">开始编辑</button>
      <button type="button" data-action="save" disabled>保存修改</button>
      <button type="button" data-action="discard" disabled>撤销本次</button>
      <button type="button" class="danger" data-action="reset">恢复网站原版</button>
    </div>
    <p class="material-editor-status" aria-live="polite">修改只保存在当前浏览器，不会改变其他人的页面。</p>
  `;
  document.body.insertBefore(toolbar, article);

  const editButton = toolbar.querySelector('[data-action="edit"]');
  const saveButton = toolbar.querySelector('[data-action="save"]');
  const discardButton = toolbar.querySelector('[data-action="discard"]');
  const resetButton = toolbar.querySelector('[data-action="reset"]');
  const status = toolbar.querySelector(".material-editor-status");

  function setStatus(message, state) {
    status.textContent = message;
    status.dataset.state = state || "";
  }

  function markDirty() {
    dirty = true;
    saveButton.disabled = false;
    discardButton.disabled = false;
    setStatus("有未保存修改。点击“保存修改”后会保留在当前浏览器。", "dirty");
  }

  function getEditableRoots() {
    return [...article.querySelectorAll("h1, h2, h3, p, .priority-note, .closing-rule, .memorize-map > section")]
      .filter((element) => !element.parentElement.closest('[contenteditable="true"]'));
  }

  function removeEditingControls() {
    article.querySelectorAll("[contenteditable]").forEach((element) => {
      element.removeAttribute("contenteditable");
      element.removeAttribute("spellcheck");
    });
    article.querySelectorAll(".material-delete-button").forEach((button) => button.remove());
    article.classList.remove("material-editor-mode");
  }

  function addDeleteButtons() {
    article
      .querySelectorAll(".material-card, .example-card, .engine-card, .memorize-map > section, .closing-rule")
      .forEach((card) => {
        if (card.querySelector(":scope > .material-delete-button")) return;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "material-delete-button";
        button.textContent = "删除此卡片";
        button.setAttribute("aria-label", "删除此卡片");
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          card.remove();
          markDirty();
        });
        card.appendChild(button);
      });
  }

  function startEditing() {
    editing = true;
    article.classList.add("material-editor-mode");
    addDeleteButtons();
    getEditableRoots().forEach((element) => {
      element.setAttribute("contenteditable", "true");
      element.setAttribute("spellcheck", "true");
    });
    editButton.textContent = "结束编辑";
    saveButton.disabled = false;
    discardButton.disabled = !dirty;
    setStatus("正在编辑：点击文字直接修改；使用卡片右上角按钮删除整张卡片。", "editing");
  }

  function stopEditing() {
    editing = false;
    removeEditingControls();
    editButton.textContent = "开始编辑";
    saveButton.disabled = !dirty;
    discardButton.disabled = !dirty;
    setStatus(
      dirty ? "修改尚未保存。" : "修改只保存在当前浏览器，不会改变其他人的页面。",
      dirty ? "dirty" : ""
    );
  }

  function currentCleanMarkup() {
    const clone = article.cloneNode(true);
    clone.classList.remove("material-editor-mode");
    clone.querySelectorAll(".material-delete-button").forEach((button) => button.remove());
    clone.querySelectorAll("[contenteditable]").forEach((element) => {
      element.removeAttribute("contenteditable");
      element.removeAttribute("spellcheck");
    });
    return sanitizeMarkup(clone.innerHTML);
  }

  function saveChanges() {
    try {
      localStorage.setItem(storageKey, currentCleanMarkup());
      dirty = false;
      stopEditing();
      saveButton.disabled = true;
      discardButton.disabled = true;
      setStatus("修改已保存到当前浏览器。", "saved");
    } catch (_error) {
      setStatus("保存失败：浏览器不允许本地存储，请检查隐私或存储设置。", "error");
    }
  }

  function restoreSavedOrOriginal() {
    const stored = readSavedMarkup();
    article.innerHTML = sanitizeMarkup(stored || originalMarkup);
    dirty = false;
    stopEditing();
    saveButton.disabled = true;
    discardButton.disabled = true;
    setStatus(stored ? "已撤销本次未保存的修改。" : "已恢复到网站原版。", "saved");
  }

  function resetToOriginal() {
    if (!window.confirm("确定恢复网站原版吗？当前浏览器里已经保存的删改会被清除。")) return;
    try {
      localStorage.removeItem(storageKey);
    } catch (_error) {
      setStatus("无法清除本地修改，请检查浏览器存储设置。", "error");
      return;
    }
    article.innerHTML = sanitizeMarkup(originalMarkup);
    dirty = false;
    stopEditing();
    saveButton.disabled = true;
    discardButton.disabled = true;
    setStatus("已恢复网站原版。", "saved");
  }

  editButton.addEventListener("click", () => {
    if (editing) stopEditing();
    else startEditing();
  });
  saveButton.addEventListener("click", saveChanges);
  discardButton.addEventListener("click", restoreSavedOrOriginal);
  resetButton.addEventListener("click", resetToOriginal);
  article.addEventListener("input", markDirty);
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && editing) {
      event.preventDefault();
      saveChanges();
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
})();
