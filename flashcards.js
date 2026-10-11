(function (root) {
  "use strict";
  const deck = root.SECRET_FLASHCARD_DECK;
  const runtime = root.LOVE_LANGUAGE_SHARED.createAwsRuntime();
  const store = root.SECRET_DICTIONARY_CACHE.forRuntime(runtime);
  const service = root.SECRET_FLASHCARD_SERVICE.create({
    client: runtime.getHeartsTableClient, table: runtime.awsConfig.heartsTableName,
    user: () => root.SECRET_CURRENT_USER?.id, ensure: runtime.ensureAwsCredentials
  });
  const el = id => document.getElementById(id);
  const addForm = el("flashcardAdd");
  let rows = [], groupedWords = [], loaded = false, currentRound = [], position = 0, flipped = false;
  let roundSignature = "", editing = null, saving = false, revision = 0;
  const fingerprint = root.SECRET_COOPERATIVE_REFRESH.fingerprint;
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function button(text, action) {
    const element = node("button", text, "dictionary-toggle-btn");
    element.type = "button";
    element.addEventListener("click", action);
    return element;
  }
  function available() {
    return deck.cards(rows, { words: el("flashcardWords").checked,
      sentences: el("flashcardSentences").checked, groupedWords });
  }
  function loadSnapshot(snapshot) {
    rows = snapshot;
    // A scan may finish while refresh is deferred for editing. Keep this view's
    // word and sentence sources on the same applied revision, not the newer cache.
    groupedWords = store?.peek() === snapshot ? store.words() : root.SECRET_MEANING_REQUESTS.groupWords(snapshot);
    loaded = true; service.load(rows);
  }
  function renderStudy() {
    const card = currentRound[position];
    el("flashcardFlip").hidden = !card;
    el("flashcardNext").hidden = !card;
    el("flashcardAgain").hidden = !currentRound.length || Boolean(card);
    el("flashcardProgress").textContent = card ? `Card ${position + 1} of ${currentRound.length}` : "";
    const face = card ? deck.face(card, flipped) : null;
    el("flashcardSide").textContent = face?.label || "";
    el("flashcardIpa").textContent = face?.pronunciation || "";
    el("flashcardIpa").hidden = !face?.pronunciation;
    el("flashcardText").textContent = face ? face.text : !loaded ? "Loading cards…"
      : !el("flashcardWords").checked && !el("flashcardSentences").checked ? "Select Words or Sentences to start a round."
      : currentRound.length ? "Round complete! Ready for another?"
      : "No cards in this selection yet. Define words in the dictionary or add a shared sentence below.";
  }
  function startRound() {
    const cards = available();
    currentRound = deck.round(cards);
    roundSignature = fingerprint(cards);
    position = 0; flipped = false;
    el("flashcardUpdates").textContent = "";
    renderStudy();
  }
  function actionButton(text, row, action) {
    const control = button(text, action);
    control.dataset.cardId = row.flashcardData.id;
    control.dataset.action = text;
    control.disabled = saving || Boolean(editing);
    return control;
  }
  function renderManagement() {
    const active = document.activeElement;
    const focus = el("flashcardList").contains(active) ? { id: active.dataset.cardId, action: active.dataset.action } : null;
    const scroll = [root.scrollX, root.scrollY];
    const list = el("flashcardList");
    list.replaceChildren();
    const cards = service.list();
    if (!cards.length) list.append(node("p", loaded ? "No shared sentence cards yet." : "Loading shared cards…"));
    for (const row of cards) {
      const card = row.flashcardData;
      const article = node("article", undefined, "flashcard-saved");
      article.append(node("h3", card.sentence), node("p", card.translation, "flashcard-translation"));
      const created = new Date(card.createdAt).toLocaleString();
      const edited = new Date(card.editedAt).toLocaleString();
      article.append(node("p", `Created by ${card.author} · ${created}. Last edited by ${card.editor} · ${edited}.`, "flashcard-attribution"));
      const controls = node("div", undefined, "flashcard-actions");
      controls.append(actionButton("Edit", row, () => openEditor(row, article)),
        actionButton("Delete", row, () => openDelete(row, article)));
      article.append(controls);
      list.append(article);
    }
    if (focus?.id) [...list.querySelectorAll("button")].find(control =>
      control.dataset.cardId === focus.id && control.dataset.action === focus.action)?.focus({ preventScroll: true });
    root.scrollTo(...scroll);
  }
  function updateControls() {
    addForm.querySelectorAll("textarea, button").forEach(control => { control.disabled = saving || Boolean(editing) || !loaded; });
    el("flashcardList").querySelectorAll("button[data-card-id]").forEach(control => { control.disabled = saving || Boolean(editing); });
  }
  function cancelEditor(row, action) {
    editing = null; revision++;
    renderManagement(); updateControls();
    [...el("flashcardList").querySelectorAll("button")].find(control =>
      control.dataset.cardId === row.flashcardData.id && control.dataset.action === action)?.focus({ preventScroll: true });
  }
  function openEditor(row, article) {
    if (saving || editing) return;
    editing = { row, kind: "edit" }; revision++;
    const form = node("form", undefined, "flashcard-form");
    const fields = ["sentence", "translation"].map(key => {
      const label = node("label", key === "sentence" ? "Sentence" : "Translation");
      const field = node("textarea");
      field.rows = 3; field.required = true; field.maxLength = 4000;
      field.value = row.flashcardData[key];
      label.append(field); form.append(label);
      return field;
    });
    const controls = node("div", undefined, "flashcard-actions");
    const save = node("button", "Save", "dictionary-toggle-btn"); save.type = "submit";
    const cancel = button("Cancel", () => cancelEditor(row, "Edit"));
    const error = node("p", "", "flashcard-error"); error.setAttribute("role", "status");
    controls.append(save, cancel); form.append(controls, error); article.append(form);
    updateControls(); fields[0].focus();
    form.addEventListener("submit", event => {
      event.preventDefault();
      void mutate(() => service.edit(row, fields[0].value, fields[1].value), form, error);
    });
  }
  function openDelete(row, article) {
    if (saving || editing) return;
    editing = { row, kind: "delete" }; revision++;
    const confirmation = node("div", undefined, "flashcard-confirmation");
    confirmation.append(node("p", "Delete this shared sentence card for both users?"));
    const error = node("p", "", "flashcard-error"); error.setAttribute("role", "status");
    const confirm = button("Confirm delete", () => { void mutate(() => service.remove(row), confirmation, error, row); });
    confirmation.append(confirm, button("Cancel", () => cancelEditor(row, "Delete")), error);
    article.append(confirmation); updateControls(); confirm.focus();
  }
  async function mutate(operation, form, error, removed) {
    if (saving) return;
    const active = document.activeElement;
    const selection = active?.tagName?.toLowerCase() === "textarea"
      ? { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection,
        top: active.scrollTop, left: active.scrollLeft } : null;
    saving = true; revision++; error.textContent = "";
    const controls = [...form.querySelectorAll("button, textarea")];
    controls.forEach(control => { control.disabled = true; }); updateControls();
    let succeeded = false;
    try {
      const result = await operation();
      if (result && store?.row(result)?.flashcardData?.revision !== result.flashcardData.revision) store?.upsert(result);
      if (removed && store?.row(removed)) store.remove(removed);
      editing = null;
      if (form === addForm) addForm.reset();
      loadSnapshot(store?.peek() || service.list());
      startRound(); renderManagement(); succeeded = true;
    } catch (failure) { error.textContent = failure.message; }
    finally {
      saving = false; revision++;
      controls.forEach(control => { control.disabled = false; }); updateControls();
      if (!succeeded && form.contains(active) && (document.activeElement === document.body || document.activeElement === active)) {
        active.focus({ preventScroll: true });
        if (selection) {
          active.setSelectionRange(selection.start, selection.end, selection.direction || "none");
          active.scrollTop = selection.top; active.scrollLeft = selection.left;
        }
      }
    }
    if (succeeded) {
      el("flashcardStatus").textContent = "Saved. Started a new round with the current cards.";
      // Only restore focus if it was lost with the removed editor; never steal it.
      if (document.activeElement === document.body) el("flashcardManage").querySelector("summary").focus({ preventScroll: true });
    }
  }
  function busy() {
    return saving || Boolean(editing) || Boolean(el("flashcardSentence").value || el("flashcardTranslation").value) ||
      document.activeElement?.matches(".flashcard-manage textarea");
  }
  function applySnapshot(snapshot) {
    const first = !loaded;
    loadSnapshot(snapshot);
    renderManagement(); updateControls();
    if (first || !currentRound.length) startRound();
    else el("flashcardUpdates").textContent = fingerprint(available()) !== roundSignature
      ? "Cards have changed. Your current round stays the same; changes appear in the next round." : "";
  }
  const sync = root.SECRET_COOPERATIVE_REFRESH.start({
    read: async () => {
      if (!store) throw new Error("Database access is unavailable.");
      return store.refresh();
    },
    apply: applySnapshot, isBusy: busy, version: () => revision,
    nextDelay: () => store?.remaining() || 30000,
    onSuccess() { el("flashcardStatus").textContent = "Up to date. Refreshes while visible and focused."; },
    onError() { el("flashcardStatus").textContent = loaded
      ? "Could not refresh. Using the last successful data. Press Refresh / Retry to try again."
      : "Could not load cards. Press Refresh / Retry to try again."; }
  });
  el("flashcardWords").addEventListener("change", startRound);
  el("flashcardSentences").addEventListener("change", startRound);
  el("flashcardFlip").addEventListener("click", () => { flipped = !flipped; renderStudy(); });
  el("flashcardNext").addEventListener("click", () => {
    position++; flipped = false; renderStudy();
    if (position >= currentRound.length) el("flashcardAgain").focus({ preventScroll: true });
  });
  el("flashcardAgain").addEventListener("click", () => {
    startRound();
    el(currentRound.length ? "flashcardFlip" : "flashcardWords").focus({ preventScroll: true });
  });
  el("flashcardRetry").addEventListener("click", () => {
    if (busy()) { el("flashcardStatus").textContent = "Save, cancel, or clear your draft before refreshing."; return; }
    store?.invalidate(); void sync.request();
  });
  el("flashcardClear").addEventListener("click", () => { addForm.reset(); addForm.querySelector(".flashcard-error").textContent = ""; revision++; });
  addForm.addEventListener("submit", event => {
    event.preventDefault();
    if (!loaded || editing) return;
    void mutate(() => service.add(el("flashcardSentence").value, el("flashcardTranslation").value),
      addForm, addForm.querySelector(".flashcard-error"));
  });
  root.addEventListener("beforeunload", () => sync.stop());
  const cached = store?.peek();
  if (cached !== null && cached !== undefined) {
    applySnapshot(cached); sync.seed(cached);
    el("flashcardStatus").textContent = store.fresh() ? "Using recently verified cards." : "Showing cached cards; refreshing…";
  } else { renderStudy(); renderManagement(); updateControls(); }
  if (!store?.fresh()) void sync.request();
})(window);
