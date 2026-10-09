(function () {
  "use strict";
  const runtime = LOVE_LANGUAGE_SHARED.createAwsRuntime();
  const user = () => window.SECRET_CURRENT_USER && window.SECRET_CURRENT_USER.id;
  const requests = SECRET_MEANING_REQUESTS.create({ client: runtime.getHeartsTableClient,
    table: runtime.awsConfig.heartsTableName, user });
  const rules = LOVE_LANGUAGE_RULES;
  const pending = document.getElementById("conceptPending");
  const fulfilledList = document.getElementById("conceptFulfilled");
  const status = document.getElementById("conceptStatus");
  const search = document.getElementById("conceptSearch");
  const addForm = document.getElementById("conceptAddForm");
  const addText = document.getElementById("conceptText");
  const addButton = document.getElementById("conceptAddButton");
  const refreshButton = document.getElementById("conceptRefresh");
  const cards = new Map();
  const generated = new Set();
  const wordFilters = new Map();
  let rawDictionaryItems = [];
  let words = [];
  let ready = false;
  let loading = false;
  let adding = false;
  let meaningsRevision = 0;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function labeled(labelText, input) {
    const label = element("label", "concept-field");
    label.append(element("span", "", labelText), input);
    return label;
  }
  function button(text) {
    const node = element("button", "dictionary-word-action", text);
    node.type = "button";
    return node;
  }
  function availableWords(raw) {
    return SECRET_MEANING_REQUESTS.groupWords(raw);
  }
  function populateWords(select, onlyUndefined = true) {
    const selected = select.value;
    select.replaceChildren();
    const placeholder = element("option", "", "Choose an existing word (optional)");
    placeholder.value = "";
    select.append(placeholder);
    for (const word of words) {
      if (onlyUndefined && word.hasDefinition) continue;
      const definitions = word.definitions.map(definition => definition.meaning).join("; ");
      const option = element("option", "", `${word.word} /${word.pronunciation}/${definitions ? ` — ${definitions}` : ""}`);
      option.value = word.word;
      select.append(option);
    }
    select.value = [...select.children].some(option => option.value === selected) ? selected : "";
  }
  function updateMatches(view) {
    if (!view.matches) return;
    const matches = SECRET_MEANING_REQUESTS.matchesForConcept(view.request.conceptData.text, words);
    view.matches.replaceChildren();
    view.matches.hidden = matches.length === 0;
    if (!matches.length) return;
    view.matches.append(element("p", "concept-help", "Existing definitions that may fit:"));
    const list = element("ul", "concept-match-list");
    for (const word of matches) {
      const li = element("li");
      const link = element("a", "page-nav-link", word.word);
      link.href = `dictionary.html?word=${encodeURIComponent(word.word)}`;
      li.append(link);
      for (const definition of word.definitions) {
        li.append(element("p", "concept-match-definition", `/${definition.pronunciation}/ — ${definition.meaning} (${definition.category})`));
      }
      list.append(li);
    }
    view.matches.append(list);
  }
  function createCard(request, previous) {
    const card = element("li", "dictionary-card concept-card");
    card.dataset.conceptId = request.conceptData.id;
    card.append(element("h3", "concept-title", request.conceptData.text));
    const metadata = element("p", "concept-help",
      `Requested by ${request.conceptData.author} · ${new Date(request.conceptData.createdAt).toLocaleDateString()}`);
    card.append(metadata);
    const view = { card, request, busy: false };
    if (SECRET_MEANING_REQUESTS.fulfilled(request)) {
      card.append(element("p", "", `Assigned to ${request.word} /${request.pronunciation}/`));
      const category = request.definitionReview && request.definitionReview.status === "candidate" ? "Candidate — awaiting approval" : "Defined";
      card.append(element("p", "concept-help", category));
      const link = element("a", "page-nav-link", "View in dictionary");
      link.href = `dictionary.html?word=${encodeURIComponent(request.word)}`;
      card.append(link);
      return view;
    }
    view.matches = element("section", "concept-matches");
    // Suggestions belong directly below the concept, before its author/date.
    card.insertBefore(view.matches, metadata);
    updateMatches(view);
    if (request.conceptData.author === user()) createManagement(view);
    const details = element("details", "concept-assignment");
    view.details = details;
    details.append(element("summary", "", "Assign a word"));
    const form = element("form", "concept-assignment-form");
    const existing = element("select");
    const undefinedFilter = element("input");
    undefinedFilter.type = "checkbox";
    undefinedFilter.checked = wordFilters.get(request.conceptData.id) !== false;
    view.undefinedFilter = undefinedFilter;
    const filterLabel = labeled("Only undefined words", undefinedFilter);
    filterLabel.className = "concept-checkbox";
    populateWords(existing, undefinedFilter.checked);
    undefinedFilter.addEventListener("change", () => {
      wordFilters.set(request.conceptData.id, undefinedFilter.checked);
      populateWords(existing, undefinedFilter.checked);
    });
    view.existing = existing;
    const spelling = element("input");
    spelling.type = "text";
    spelling.required = true;
    spelling.autocomplete = "off";
    spelling.spellcheck = false;
    const ipa = element("input");
    ipa.type = "text";
    ipa.required = true;
    ipa.autocomplete = "off";
    view.spelling = spelling;
    view.ipa = ipa;
    if (previous?.spelling) {
      spelling.value = previous.spelling.value;
      ipa.value = previous.ipa.value;
      details.open = previous.details.open;
    }
    const warning = element("p", "concept-help");
    warning.setAttribute("role", "status");
    const message = element("p", "concept-assignment-status");
    message.setAttribute("role", "status");
    const generate = button("Generate suggestion");
    const min = element("input");
    const max = element("input");
    for (const input of [min, max]) { input.type = "number"; input.min = "1"; input.max = "12"; input.required = true; }
    min.value = "1";
    max.value = "3";
    const generation = element("div", "concept-generation");
    generation.append(labeled("Min syllables", min), labeled("Max syllables", max), generate);
    const save = button("Assign as candidate");
    save.type = "submit";
    const wordChoice = element("div", "concept-word-choice");
    wordChoice.append(labeled("Existing word", existing), filterLabel);
    form.append(wordChoice, generation,
      labeled("Spelling (or type a new word)", spelling), labeled("IPA pronunciation", ipa), warning,
      element("p", "concept-help", "Periods and hyphens mark syllables while editing and are removed from the saved spelling. Existing definitions are retained; this adds a candidate definition."), save, message);
    details.append(form);
    card.append(details);
    function derive() {
      const result = rules.derivePronunciationFromSpelling({ spelling: spelling.value, config: rules.loadActiveRuleConfig() });
      ipa.value = result.pronunciation || "";
      warning.textContent = result.warnings.join(" ");
    }
    spelling.addEventListener("input", event => { if (!event.isComposing) derive(); });
    spelling.addEventListener("compositionend", derive);
    existing.addEventListener("change", () => {
      const word = words.find(item => item.word === existing.value);
      if (!word) return;
      spelling.value = word.word;
      ipa.value = word.pronunciation;
      warning.textContent = "Using the saved pronunciation for this word.";
    });
    generate.addEventListener("click", () => {
      if (!min.checkValidity() || !max.checkValidity() || Number(min.value) > Number(max.value)) {
        message.textContent = "Choose a syllable range from 1 to 12, with minimum no greater than maximum.";
        return;
      }
      const config = rules.loadActiveRuleConfig();
      const compatibility = rules.evaluateRuleConfigCompatibility(config, Number(min.value), Number(max.value));
      if (!compatibility.isReady) {
        message.textContent = "Configure valid sounds and syllable patterns in Settings before generating suggestions.";
        return;
      }
      const excluded = new Set([...words.map(item => item.word), ...generated]);
      const result = SECRET_PREFIX_GENERATOR.search(config, "", Number(min.value), Number(max.value), true, excluded);
      if (!result.candidate) { message.textContent = "No unused suggestion is available for these rules and syllable range."; return; }
      spelling.value = result.candidate.word;
      ipa.value = result.candidate.ipa;
      generated.add(result.candidate.word);
      existing.value = "";
      warning.textContent = "Generated using the active language rules.";
      message.textContent = "Suggestion only — choose Assign as candidate to save it.";
    });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (view.busy) return;
      meaningsRevision++;
      view.busy = true;
      const controls = [...form.querySelectorAll("input, select, button")];
      controls.forEach(control => { control.disabled = true; });
      message.textContent = "Saving assignment…";
      try {
        const assigned = await requests.assign(view.request, spelling.value, ipa.value);
        rawDictionaryItems = rawDictionaryItems.filter(item => item.rowId !== assigned.rowId || item.timestamp !== assigned.timestamp);
        rawDictionaryItems.push(assigned);
        words = availableWords(rawDictionaryItems);
        render();
        status.textContent = `Assigned “${assigned.word}” as a Candidate. Another user can approve it in the dictionary.`;
      } catch (error) {
        console.error(error);
        message.textContent = error.code === "ConditionalCheckFailedException"
          ? "Someone changed this concept. Refresh the shared list before assigning it."
          : `Could not assign: ${error.message}`;
      } finally {
        view.busy = false;
        controls.forEach(control => { control.disabled = false; });
      }
    });
    return view;
  }
  function createManagement(view) {
    const controls = element("div", "concept-management");
    const edit = button("Edit request");
    const remove = button("Delete request");
    remove.classList.add("is-danger");
    const editForm = element("form", "concept-edit-form");
    editForm.hidden = true;
    const text = element("textarea");
    text.rows = 3;
    text.required = true;
    text.maxLength = 2000;
    const save = button("Save request"); save.type = "submit";
    const cancelEdit = button("Cancel");
    editForm.append(labeled("Edit requested meaning", text), save, cancelEdit);
    const confirmation = element("div", "concept-delete-confirmation");
    confirmation.hidden = true;
    const confirmDelete = button("Confirm delete");
    const cancelDelete = button("Cancel");
    confirmation.append(element("p", "concept-help", "Delete this request? Any existing dictionary word and its hearts will be kept."), confirmDelete, cancelDelete);
    const message = element("p", "concept-assignment-status");
    message.setAttribute("role", "status");
    controls.append(edit, remove, editForm, confirmation, message);
    view.card.append(controls);
    function sync() {
      edit.hidden = remove.hidden = Boolean(view.editing || view.deleting);
      editForm.hidden = !view.editing;
      confirmation.hidden = !view.deleting;
      if (view.details) view.details.hidden = Boolean(view.editing || view.deleting);
    }
    edit.addEventListener("click", () => {
      if (view.busy) return;
      view.editing = true; text.value = view.request.conceptData.text;
      message.textContent = ""; sync(); text.focus();
    });
    remove.addEventListener("click", () => { if (!view.busy) { view.deleting = true; message.textContent = ""; sync(); } });
    cancelEdit.addEventListener("click", () => { if (!view.busy) { view.editing = false; message.textContent = ""; sync(); } });
    cancelDelete.addEventListener("click", () => { if (!view.busy) { view.deleting = false; message.textContent = ""; sync(); } });
    async function mutate(operation) {
      if (view.busy) return;
      meaningsRevision++;
      view.busy = true;
      const fields = [...view.card.querySelectorAll("input, textarea, select, button")];
      fields.forEach(field => { field.disabled = true; });
      message.textContent = "Saving…";
      try {
        await operation();
        view.editing = view.deleting = false;
        render();
        status.textContent = "Requested meanings updated.";
      } catch (error) {
        message.textContent = error.code === "ConditionalCheckFailedException"
          ? "This request changed. Refresh the shared list and reconfirm."
          : error.message;
        console.error(error);
      } finally {
        view.busy = false;
        fields.forEach(field => { field.disabled = false; });
      }
    }
    editForm.addEventListener("submit", event => { event.preventDefault(); return mutate(() => requests.edit(view.request, text.value)); });
    confirmDelete.addEventListener("click", () => mutate(() => requests.remove(view.request)));
  }
  function render() {
    const all = requests.list();
    const ids = new Set(all.map(item => item.conceptData.id));
    for (const [id, view] of cards) if (!ids.has(id)) { view.card.remove(); cards.delete(id); }
    for (const request of all) {
      const id = request.conceptData.id;
      const signature = JSON.stringify(request);
      let view = cards.get(id);
      if (!view || view.signature !== signature) {
        const next = createCard(request, view);
        next.signature = signature;
        if (view) view.card.replaceWith(next.card);
        view = next;
        cards.set(id, view);
      } else if (view.existing && !view.busy) populateWords(view.existing, view.undefinedFilter.checked);
      updateMatches(view);
      const target = SECRET_MEANING_REQUESTS.fulfilled(request) ? fulfilledList : pending;
      // Retain existing nodes and editors rather than rebuilding on every search.
      if (view.card.parentElement !== target) target.append(view.card);
    }
    filter();
  }
  function filter() {
    const query = search.value.trim().normalize("NFC").toLowerCase();
    let pendingCount = 0;
    let fulfilledCount = 0;
    for (const view of cards.values()) {
      const request = view.request;
      view.card.hidden = !`${request.conceptData.text} ${request.word || ""}`.normalize("NFC").toLowerCase().includes(query);
      if (!view.card.hidden) {
        if (SECRET_MEANING_REQUESTS.fulfilled(request)) fulfilledCount++; else pendingCount++;
      }
    }
    document.getElementById("conceptPendingHeading").textContent = `Needs a word (${pendingCount})`;
    document.getElementById("conceptFulfilledHeading").textContent = `Fulfilled (${fulfilledCount})`;
  }
  async function readSharedConcepts() {
    if (!runtime.isHeartsConfigured || !await runtime.ensureAwsCredentials()) throw new Error("Could not initialize database access.");
    const raw = [];
    let lastKey;
    do {
      const response = await runtime.getHeartsTableClient().scan({ TableName: runtime.awsConfig.heartsTableName,
        ConsistentRead: true, ExclusiveStartKey: lastKey }).promise();
      raw.push(...(response.Items || []));
      lastKey = response.LastEvaluatedKey;
    } while (lastKey);
    return raw;
  }
  function applySharedConcepts(raw, background = false) {
    const x = window.scrollX;
    const y = window.scrollY;
    requests.load(raw);
    rawDictionaryItems = raw;
    words = availableWords(raw);
    render();
    ready = true;
    addButton.disabled = adding;
    if (background) window.scrollTo({ left: x, top: y, behavior: "instant" });
  }
  function sharedConceptsBusy() {
    return loading || adding || [...cards.values()].some(view => view.busy || view.editing || view.deleting || view.details?.open);
  }
  async function refresh() {
    if (loading || adding || [...cards.values()].some(view => view.busy)) return;
    if ([...cards.values()].some(view => view.editing || view.deleting)) {
      status.textContent = "Save or cancel your request edit/delete confirmation before refreshing. Your draft is kept.";
      return;
    }
    loading = true;
    refreshButton.disabled = true;
    status.textContent = "Loading shared concepts…";
    try {
      const revision = meaningsRevision;
      const raw = await readSharedConcepts();
      if (revision !== meaningsRevision) return;
      applySharedConcepts(raw);
      meaningsSync.seed(raw);
      status.textContent = "Shared list up to date. Unassigned concepts stay above; fulfilled concepts are below.";
    } catch (error) { status.textContent = `Could not load concepts: ${error.message}`; console.error(error); }
    finally { loading = false; refreshButton.disabled = false; addButton.disabled = !ready || adding; }
  }
  addForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!ready || loading || adding) return;
    const text = addText.value;
    adding = true;
    meaningsRevision++;
    addButton.disabled = true;
    try {
      await requests.add(text);
      if (addText.value === text) addText.value = "";
      render();
      status.textContent = "Added a shared concept that needs a word.";
    } catch (error) { status.textContent = `Could not add concept: ${error.message}`; console.error(error); }
    finally { adding = false; addButton.disabled = !ready; }
  });
  search.addEventListener("input", filter);
  refreshButton.addEventListener("click", refresh);
  const meaningsSync = SECRET_COOPERATIVE_REFRESH.start({
    read: readSharedConcepts,
    apply: raw => applySharedConcepts(raw, true),
    isBusy: sharedConceptsBusy,
    version: () => meaningsRevision,
    onSuccess: () => {
      if (status.textContent.startsWith("Could not refresh shared concepts.")) status.textContent = "Shared list up to date.";
    },
    onError: error => {
      console.warn("Shared concept refresh failed; keeping the current list and drafts.", error);
      status.textContent = "Could not refresh shared concepts. Your list is kept; automatic refresh will retry.";
    }
  });
  window.addEventListener("beforeunload", () => meaningsSync.stop());
  void refresh();
})();
