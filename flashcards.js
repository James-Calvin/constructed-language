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
  const motion = root.SECRET_FLASHCARD_MOTION.create({ element: el("flashcardCard") });
  const stateStore = root.SECRET_FLASHCARD_STATE.create({ scope: [runtime.awsConfig.region,
    runtime.awsConfig.identityPoolId, runtime.awsConfig.heartsTableName, root.SECRET_CURRENT_USER?.id] });
  let pronunciationAudio = null, audioVersion = 0;
  function setStatus(text = "") {
    el("flashcardStatus").textContent = text;
    el("flashcardStatus").hidden = !text;
  }
  function stopAudio() {
    audioVersion++;
    pronunciationAudio?.stop();
    el("flashcardPlay").disabled = false;
    el("flashcardPlay").removeAttribute("aria-busy");
    el("flashcardAudioStatus").textContent = "";
    el("flashcardAudioStatus").hidden = true;
  }
  let rows = [], groupedWords = [], loaded = false, currentRound = [], position = 0, flipped = false;
  let roundSelections = null, dataSignature = "", latestDataSignature = "", dataChanged = false;
  let initialized = false, editing = null, saving = false, revision = 0;
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
  function selections() {
    return { words: el("flashcardWords").checked, candidates: el("flashcardCandidates").checked,
      sentences: el("flashcardSentences").checked };
  }
  function available() {
    return deck.cards(rows, { ...selections(), groupedWords });
  }
  function persistState() {
    if (!initialized) return;
    stateStore.save({ round: currentRound, selections: selections(), roundSelections,
      position, flipped, dataSignature, dataChanged });
  }
  function updateWarnings() {
    if (initialized && loaded) dataChanged = latestDataSignature !== dataSignature;
    const selectionChanged = initialized && fingerprint([selections()]) !== fingerprint([roundSelections]);
    const pending = dataChanged || selectionChanged;
    el("flashcardShuffle").textContent = pending ? "⚠️ Shuffle" : "Shuffle";
    el("flashcardShuffle").classList.toggle("flashcard-shuffle-pending", Boolean(pending));
    el("flashcardUpdates").textContent = dataChanged ? "Words or definitions have changed. Shuffle to update."
      : selectionChanged ? "Your selection has changed. Shuffle the deck for it to take effect." : "";
    persistState();
  }
  function loadSnapshot(snapshot) {
    rows = snapshot;
    // A scan may finish while refresh is deferred for editing. Keep this view's
    // word and sentence sources on the same applied revision, not the newer cache.
    groupedWords = store?.peek() === snapshot ? store.words() : root.SECRET_MEANING_REQUESTS.groupWords(snapshot);
    const categories = new Map(groupedWords.map(word => [word.word, word.definitionReview?.status === "candidate" ? "candidate" : "defined"]));
    latestDataSignature = fingerprint(deck.cards(rows, { candidates: true, groupedWords }).map(card =>
      card.type === "word" ? { ...card, category: categories.get(card.front) } : card));
    loaded = true; service.load(rows);
  }
  function renderStudy() {
    stopAudio();
    const card = currentRound[position];
    el("flashcardFace").disabled = !card;
    el("flashcardShuffle").disabled = !loaded;
    el("flashcardAgain").disabled = !loaded;
    el("flashcardBack").hidden = !currentRound.length;
    el("flashcardBack").disabled = position === 0;
    el("flashcardNext").hidden = !card;
    el("flashcardAgain").hidden = !currentRound.length || Boolean(card);
    el("flashcardProgress").textContent = card ? `Card ${position + 1} of ${currentRound.length}` : "";
    const face = card ? deck.face(card, flipped) : null;
    el("flashcardPlay").hidden = face?.label !== "Word" || !face.pronunciation;
    el("flashcardSoundBuffer").hidden = el("flashcardPlay").hidden;
    el("flashcardPlay").disabled = !runtime.isPlaybackConfigured;
    el("flashcardPlay").title = runtime.isPlaybackConfigured ? "Play pronunciation" : "Pronunciation playback is unavailable";
    el("flashcardSide").textContent = face?.label || "";
    el("flashcardIpa").textContent = face?.pronunciation || "";
    el("flashcardIpa").hidden = !face?.pronunciation;
    el("flashcardText").textContent = face ? face.text : !loaded && !initialized ? "Loading cards…"
      : currentRound.length ? "Round complete! Go again to shuffle a fresh deck."
      : roundSelections && !Object.values(roundSelections).some(Boolean)
        ? "Select Defined words, Candidates, or Sentences, then Shuffle to start a round."
      : "No cards in this round. Change your selections or add cards, then Shuffle to update.";
    persistState();
  }
  function startRound() {
    if (!loaded) return;
    motion.cancel();
    const cards = available();
    currentRound = deck.round(cards);
    initialized = true;
    roundSelections = selections(); dataSignature = latestDataSignature; dataChanged = false;
    position = 0; flipped = false;
    renderStudy(); updateWarnings();
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
      updateWarnings(); renderManagement(); succeeded = true;
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
      setStatus();
      // Only restore focus if it was lost with the removed editor; never steal it.
      if (document.activeElement === document.body) el("flashcardManage").querySelector("summary").focus({ preventScroll: true });
    }
  }
  function busy() {
    return saving || Boolean(editing) || Boolean(el("flashcardSentence").value || el("flashcardTranslation").value) ||
      document.activeElement?.matches(".flashcard-manage textarea");
  }
  function applySnapshot(snapshot) {
    loadSnapshot(snapshot);
    renderManagement(); updateControls();
    if (!initialized) startRound();
    else {
      el("flashcardShuffle").disabled = false;
      el("flashcardAgain").disabled = false;
      updateWarnings();
    }
  }
  const sync = root.SECRET_COOPERATIVE_REFRESH.start({
    read: async () => {
      if (!store) throw new Error("Database access is unavailable.");
      return store.refresh();
    },
    apply: applySnapshot, isBusy: busy, version: () => revision,
    nextDelay: () => store?.remaining() || 30000,
    onSuccess() { setStatus(); },
    onError() { setStatus(loaded
      ? "Could not refresh. Using the last successful data; retrying automatically while visible and focused."
      : "Could not load cards. Retrying automatically while visible and focused."); }
  });
  el("flashcardWords").addEventListener("change", updateWarnings);
  el("flashcardCandidates").addEventListener("change", updateWarnings);
  el("flashcardSentences").addEventListener("change", updateWarnings);
  function flipCard() {
    if (!currentRound[position]) return;
    stopAudio();
    void motion.flip(() => { flipped = !flipped; renderStudy(); });
  }
  el("flashcardFace").addEventListener("click", flipCard);
  el("flashcardPlay").addEventListener("click", async event => {
    event.stopPropagation();
    const card = currentRound[position];
    if (!card || deck.face(card, flipped).label !== "Word" || !runtime.isPlaybackConfigured) return;
    pronunciationAudio ||= root.SECRET_FLASHCARD_AUDIO.create({ runtime, utils: root.LOVE_LANGUAGE_SHARED.utils });
    const version = ++audioVersion;
    el("flashcardPlay").disabled = true;
    el("flashcardPlay").setAttribute("aria-busy", "true");
    el("flashcardAudioStatus").hidden = true;
    try { await pronunciationAudio.play(card.front, card.pronunciation); }
    catch {
      if (version === audioVersion) {
        el("flashcardAudioStatus").textContent = "Could not play pronunciation. Please try again.";
        el("flashcardAudioStatus").hidden = false;
      }
    } finally {
      if (version === audioVersion) {
        el("flashcardPlay").disabled = false;
        el("flashcardPlay").removeAttribute("aria-busy");
      }
    }
  });
  function previousCard() {
    if (position <= 0) return;
    motion.slide(() => { position--; flipped = false; renderStudy(); }, -1);
    if (position === 0) el("flashcardFace").focus({ preventScroll: true });
  }
  function nextCard() {
    if (!currentRound[position]) return;
    motion.slide(() => { position++; flipped = false; renderStudy(); });
    if (position >= currentRound.length) el("flashcardAgain").focus({ preventScroll: true });
  }
  el("flashcardBack").addEventListener("click", previousCard);
  el("flashcardNext").addEventListener("click", nextCard);
  function keyboardControl(event) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat ||
      event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || editing || saving) return;
    const target = event.target;
    if (el("flashcardManage").contains(target) || target?.isContentEditable ||
      target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='combobox'], [role='slider']")) return;
    if (!currentRound.length) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      if (event.key === "ArrowLeft") previousCard(); else nextCard();
    } else if ((event.key === " " || event.key === "Spacebar") && currentRound[position]) {
      // Native buttons/links retain their Space activation. In particular, the
      // sound button must play audio rather than also triggering a card flip.
      if (target?.closest?.("button, a, summary, [role='button'], [role='link']")) return;
      event.preventDefault(); flipCard();
    }
  }
  document.addEventListener("keydown", keyboardControl);
  el("flashcardSoundBuffer").addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); });
  const gestures = root.SECRET_FLASHCARD_GESTURES.bind({ element: el("flashcardCard"), next: nextCard, back: previousCard,
    exclude: target => el("flashcardSoundBuffer").contains(target) || el("flashcardPlay").contains(target) });
  el("flashcardAgain").addEventListener("click", () => {
    startRound();
    el(currentRound.length ? "flashcardFace" : "flashcardWords").focus({ preventScroll: true });
  });
  el("flashcardShuffle").addEventListener("click", startRound);
  el("flashcardClear").addEventListener("click", () => { addForm.reset(); addForm.querySelector(".flashcard-error").textContent = ""; revision++; });
  addForm.addEventListener("submit", event => {
    event.preventDefault();
    if (!loaded || editing) return;
    void mutate(() => service.add(el("flashcardSentence").value, el("flashcardTranslation").value),
      addForm, addForm.querySelector(".flashcard-error"));
  });
  root.addEventListener("pagehide", persistState);
  root.addEventListener("beforeunload", () => {
    persistState(); sync.stop(); gestures.stop(); motion.cancel(); pronunciationAudio?.dispose();
    document.removeEventListener("keydown", keyboardControl);
  });
  const restored = stateStore.load();
  if (restored) {
    ({ round: currentRound, position, flipped, roundSelections, dataSignature, dataChanged } = restored);
    initialized = true;
    el("flashcardWords").checked = restored.selections.words;
    el("flashcardCandidates").checked = restored.selections.candidates;
    el("flashcardSentences").checked = restored.selections.sentences;
    renderStudy(); updateWarnings();
  }
  const cached = store?.peek();
  if (cached !== null && cached !== undefined) {
    applySnapshot(cached); sync.seed(cached);
    setStatus();
  } else { renderStudy(); renderManagement(); updateControls(); }
  if (!store?.fresh()) void sync.request();
})(window);
