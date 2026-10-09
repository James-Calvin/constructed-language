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
  let words = [];
  let ready = false;
  let loading = false;
  let adding = false;

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
    const grouped = new Map();
    for (const item of raw) {
      if (!item.word || !item.pronunciation) continue;
      const previous = grouped.get(item.word);
      const time = Number(item.meaningUpdatedTimestamp || item.updatedTimestamp || item.timestamp);
      if (!previous || time > previous.time) grouped.set(item.word, { ...item, time });
    }
    return [...grouped.values()].sort((a, b) => a.word.localeCompare(b.word, undefined, { sensitivity: "base" }));
  }
  function populateWords(select) {
    const selected = select.value;
    select.replaceChildren();
    const placeholder = element("option", "", "Choose an existing word (optional)");
    placeholder.value = "";
    select.append(placeholder);
    for (const word of words) {
      const option = element("option", "", `${word.word} /${word.pronunciation}/`);
      option.value = word.word;
      select.append(option);
    }
    select.value = selected;
  }
  function createCard(request) {
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
    const details = element("details", "concept-assignment");
    details.append(element("summary", "", "Assign a word"));
    const form = element("form", "concept-assignment-form");
    const existing = element("select");
    populateWords(existing);
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
    form.append(labeled("Existing word", existing), generation,
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
      view.busy = true;
      const controls = [...form.querySelectorAll("input, select, button")];
      controls.forEach(control => { control.disabled = true; });
      message.textContent = "Saving assignment…";
      try {
        const assigned = await requests.assign(view.request, spelling.value, ipa.value);
        words = availableWords([...words, assigned]);
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
  function render() {
    const all = requests.list();
    const ids = new Set(all.map(item => item.conceptData.id));
    for (const [id, view] of cards) if (!ids.has(id)) { view.card.remove(); cards.delete(id); }
    for (const request of all) {
      const id = request.conceptData.id;
      const signature = JSON.stringify(request);
      let view = cards.get(id);
      if (!view || view.signature !== signature) {
        const next = createCard(request);
        next.signature = signature;
        if (view) view.card.replaceWith(next.card);
        view = next;
        cards.set(id, view);
      } else if (view.existing && !view.busy) populateWords(view.existing);
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
  async function refresh() {
    if (loading || adding || [...cards.values()].some(view => view.busy)) return;
    loading = true;
    refreshButton.disabled = true;
    status.textContent = "Loading shared concepts…";
    try {
      if (!runtime.isHeartsConfigured || !await runtime.ensureAwsCredentials()) throw new Error("Could not initialize database access.");
      const raw = [];
      let lastKey;
      do {
        const response = await runtime.getHeartsTableClient().scan({ TableName: runtime.awsConfig.heartsTableName,
          ConsistentRead: true, ExclusiveStartKey: lastKey }).promise();
        raw.push(...(response.Items || []));
        lastKey = response.LastEvaluatedKey;
      } while (lastKey);
      requests.load(raw);
      words = availableWords(raw);
      render();
      ready = true;
      status.textContent = "Shared list up to date. Unassigned concepts stay above; fulfilled concepts are below.";
    } catch (error) { status.textContent = `Could not load concepts: ${error.message}`; console.error(error); }
    finally { loading = false; refreshButton.disabled = false; addButton.disabled = !ready || adding; }
  }
  addForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!ready || loading || adding) return;
    const text = addText.value;
    adding = true;
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
  void refresh();
})();
