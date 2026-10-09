const COPY_FEEDBACK_MS = 1200;
const DICTIONARY_BATCH_SIZE = 30;

const FILTERS = {
  CANDIDATE: "candidate",
  DEFINED: "defined",
  UNDEFINED: "undefined",
  ALL: "all"
};

const GROUP_CLASSIFICATIONS = {
  CANDIDATE: "candidate",
  DEFINED: "defined",
  UNDEFINED: "undefined"
};

const EMPTY_STATUS_BY_FILTER = {
  [FILTERS.CANDIDATE]: "No candidates awaiting approval.",
  [FILTERS.DEFINED]: "No defined words yet.",
  [FILTERS.UNDEFINED]: "No undefined saved words yet.",
  [FILTERS.ALL]: "No saved words yet."
};

const dictionaryFilters = document.getElementById("dictionaryFilters");
const dictionarySearch = document.getElementById("dictionarySearch");
const addWordButton = document.getElementById("dictionaryAddWordBtn");
const myHeartsToggle = document.getElementById("dictionaryMyHeartsToggle");
const dictionaryComposer = document.getElementById("dictionaryComposer");
const dictionaryList = document.getElementById("dictionaryList");
const dictionaryStatus = document.getElementById("dictionaryStatus");
const dictionarySentinel = document.getElementById("dictionarySentinel");
const filterButtons = dictionaryFilters
  ? Array.from(dictionaryFilters.querySelectorAll(".dictionary-filter-btn[data-filter]"))
  : [];

const recordsById = new Map();
const audioCache = new Map();
const copyFeedbackTimers = new Map();
const sharedAudio = new Audio();

let groups = [];
let visibleGroups = [];
let activeFilter = FILTERS.DEFINED;
let currentUserId = "";
let wordNotes;
let dictionaryRevision = 0;
let dictionaryLoaded = false;

function getWordNotes() {
  if (!wordNotes) wordNotes = SECRET_WORD_NOTES.create({
    client: getHeartsTableClient, table: awsConfig.heartsTableName, user: () => currentUserId
  });
  return wordNotes;
}
let showOnlyMyHearts = false;
let selectedWord = "";
const linkedWord = new URLSearchParams(window.location.search).get("word");
if (linkedWord && dictionarySearch) {
  dictionarySearch.value = linkedWord;
  activeFilter = FILTERS.ALL;
  selectedWord = linkedWord;
}
let playingRecordId = "";
let renderedGroupCount = 0;
let observer = null;

const sharedApi = window.LOVE_LANGUAGE_SHARED || {};
const sharedUtils = sharedApi.utils || {};
const sharedUi = sharedApi.ui || {};
const awsHelpers = window.LOVE_LANGUAGE_AWS || {};
const rulesApi = window.LOVE_LANGUAGE_RULES || {};

const trimOrEmpty =
  typeof sharedUtils.trimOrEmpty === "function"
    ? sharedUtils.trimOrEmpty
    : (value) => (typeof value === "string" ? value.trim() : "");
const hasMeaningText =
  typeof sharedUtils.hasMeaningText === "function"
    ? sharedUtils.hasMeaningText
    : (value) => typeof value === "string" && value.trim().length > 0;
const toEpochMs =
  typeof sharedUtils.toEpochMs === "function"
    ? sharedUtils.toEpochMs
    : (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
      };
const escapeXml =
  typeof sharedUtils.escapeXml === "function"
    ? sharedUtils.escapeXml
    : (text) =>
        String(text)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&apos;");
const toAudioBlob =
  typeof sharedUtils.toAudioBlob === "function"
    ? sharedUtils.toAudioBlob
    : () => null;
const createActionButton =
  typeof sharedUi.createActionButton === "function"
    ? sharedUi.createActionButton
    : (className, icon, label, action) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `action-btn ${className}`;
        button.dataset.icon = icon;
        button.dataset.action = action;
        button.textContent = icon;
        button.setAttribute("aria-label", label);
        return button;
      };
const copyTextToClipboard =
  typeof sharedUi.copyTextToClipboard === "function"
    ? sharedUi.copyTextToClipboard
    : async () => {};
const buildCopyPayload =
  typeof sharedUi.buildCopyPayload === "function"
    ? sharedUi.buildCopyPayload
    : ({ word, pronunciation, ipa, meaning }) => {
        const normalizedWord = trimOrEmpty(word);
        const normalizedPronunciation = trimOrEmpty(pronunciation) || trimOrEmpty(ipa);
        const normalizedMeaning = trimOrEmpty(meaning);
        const base = `${normalizedWord} /${normalizedPronunciation}/`;
        return normalizedMeaning ? `${base} : ${normalizedMeaning}` : base;
      };
const loadActiveRuleConfig =
  typeof rulesApi.loadActiveRuleConfig === "function"
    ? rulesApi.loadActiveRuleConfig
    : () => null;
const validateRuleConfig =
  typeof rulesApi.validateRuleConfig === "function"
    ? rulesApi.validateRuleConfig
    : () => ({ isValid: false, config: null });
const analyzeEntryAgainstRuleConfig =
  typeof rulesApi.analyzeEntryAgainstRuleConfig === "function"
    ? rulesApi.analyzeEntryAgainstRuleConfig
    : () => ({
        available: false,
        matchesRules: true,
        warnings: [],
        segmentation: [],
        expectedPronunciation: ""
      });
const derivePronunciationFromSpelling =
  typeof rulesApi.derivePronunciationFromSpelling === "function"
    ? rulesApi.derivePronunciationFromSpelling
    : ({ spelling } = {}) => ({
        word: trimOrEmpty(spelling).replace(/[.-]/g, ""),
        pronunciation: "",
        warnings: ["Symbol-to-IPA mapping is unavailable."],
        ambiguous: false,
        complete: false,
        segmentations: []
      });
const activeRulesStorageKey =
  rulesApi.storageKeys && typeof rulesApi.storageKeys.active === "string"
    ? rulesApi.storageKeys.active
    : "";

function createManualComposerValidation() {
  return {
    available: false,
    matchesRules: true,
    warnings: [],
    segmentation: [],
    expectedPronunciation: ""
  };
}

function createManualComposerFieldErrors() {
  return {
    word: "",
    pronunciation: "",
    meaning: ""
  };
}

const manualComposerState = {
  isOpen: false,
  word: "",
  pronunciation: "",
  meaning: "",
  validation: createManualComposerValidation(),
  fieldErrors: createManualComposerFieldErrors(),
  hasAttemptedSave: false,
  openWarningIndex: -1,
  saveStatus: "idle"
};

const wordEditorState = {
  word: "",
  spelling: "",
  pronunciation: "",
  warnings: [],
  saveStatus: "idle",
  error: "",
  deleteConfirmationWord: ""
};

function getActivityTimestamp(record) {
  return Math.max(toEpochMs(record && record.updatedTimestamp), toEpochMs(record && record.timestamp));
}

function buildCanonicalRecordRowId(userId, word) {
  return `${encodeURIComponent(trimOrEmpty(userId))}::${encodeURIComponent(trimOrEmpty(word))}`;
}

function buildEntryId(rowId, timestamp) {
  return `${rowId}|${timestamp}`;
}

function hasDefinedMeaning(record) {
  return hasMeaningText(record && record.meaning);
}

function matchesCurrentUserRecord(record) {
  return Boolean(currentUserId) && Boolean(record) && trimOrEmpty(record.user) === currentUserId;
}

function sortRecordsByActivityDesc(records) {
  return [...records].sort((left, right) => getActivityTimestamp(right) - getActivityTimestamp(left));
}

function getDefinitionTimestamp(record) {
  if (!hasDefinedMeaning(record)) {
    return 0;
  }
  return toEpochMs(record.meaningUpdatedTimestamp) || getActivityTimestamp(record);
}

function sortRecordsByDefinitionDesc(records) {
  return [...records].sort(
    (left, right) => getDefinitionTimestamp(right) - getDefinitionTimestamp(left)
  );
}

function isValidFilter(filter) {
  return Object.values(FILTERS).includes(filter);
}

function getEmptyStatusMessage(filter = activeFilter) {
  return EMPTY_STATUS_BY_FILTER[filter] || EMPTY_STATUS_BY_FILTER[FILTERS.DEFINED];
}

function getGroupStatusLabel(classification) {
  return classification === "candidate" ? "Candidate" : classification === "undefined" ? "Undefined" : "Defined";
}

function getDefinitionAuthorLabel(record) {
  const user = trimOrEmpty(record && record.user);
  if (!user) {
    return "unknown user";
  }

  return user.includes(":") ? "legacy user" : user;
}

function getManualComposerSaveLabel() {
  return manualComposerState.saveStatus === "saving" ? "Saving..." : "Save word";
}

function getManualComposerFieldErrors() {
  const normalizedWord = trimOrEmpty(manualComposerState.word).replace(/[.-]/g, "");
  return {
    word: hasMeaningText(normalizedWord) ? "" : "Word is required.",
    pronunciation: hasMeaningText(manualComposerState.pronunciation) ? "" : "IPA is required.",
    meaning: ""
  };
}

function syncManualComposerFieldErrors() {
  manualComposerState.fieldErrors = manualComposerState.hasAttemptedSave
    ? getManualComposerFieldErrors()
    : createManualComposerFieldErrors();

  return manualComposerState.fieldErrors;
}

function getFirstManualComposerInvalidField(fieldErrors = manualComposerState.fieldErrors) {
  if (trimOrEmpty(fieldErrors.word)) {
    return "word";
  }

  if (trimOrEmpty(fieldErrors.pronunciation)) {
    return "pronunciation";
  }

  if (trimOrEmpty(fieldErrors.meaning)) {
    return "meaning";
  }

  return "";
}

function getManualComposerInputId(fieldName) {
  if (fieldName === "word") {
    return "dictionaryComposerWord";
  }

  if (fieldName === "pronunciation") {
    return "dictionaryComposerPronunciation";
  }

  if (fieldName === "meaning") {
    return "dictionaryComposerMeaning";
  }

  return "";
}

function focusManualComposerField(fieldName) {
  const inputId = getManualComposerInputId(fieldName);
  if (!inputId) {
    return;
  }

  window.requestAnimationFrame(() => {
    const input = document.getElementById(inputId);
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

function getManualComposerWarningMessages(validation = manualComposerState.validation) {
  if (
    !validation ||
    !validation.available ||
    validation.matchesRules ||
    !Array.isArray(validation.warnings)
  ) {
    return [];
  }

  return validation.warnings.map((warning) => trimOrEmpty(warning)).filter(Boolean);
}

function closeManualComposerWarningTooltip() {
  if (manualComposerState.openWarningIndex < 0) {
    return;
  }

  manualComposerState.openWarningIndex = -1;
  syncManualComposerUiState();
}

function syncManualComposerValidation() {
  if (!manualComposerState.isOpen) {
    manualComposerState.validation = createManualComposerValidation();
    return manualComposerState.validation;
  }

  if (!hasMeaningText(manualComposerState.word)) {
    manualComposerState.validation = createManualComposerValidation();
    return manualComposerState.validation;
  }

  const activeRuleConfig = loadActiveRuleConfig();
  const derivation = derivePronunciationFromSpelling({
    spelling: manualComposerState.word,
    config: activeRuleConfig
  });
  const mappingWarnings = Array.isArray(derivation.warnings) ? derivation.warnings : [];
  const activeRuleValidation = validateRuleConfig(activeRuleConfig);
  if (!activeRuleValidation.isValid) {
    manualComposerState.validation = {
      available: true,
      matchesRules: mappingWarnings.length === 0,
      warnings: mappingWarnings,
      segmentation: [],
      expectedPronunciation: derivation.pronunciation || ""
    };
    return manualComposerState.validation;
  }

  const ruleValidation = hasMeaningText(manualComposerState.pronunciation)
    ? analyzeEntryAgainstRuleConfig({
        word: derivation.word,
        pronunciation: manualComposerState.pronunciation,
        config: activeRuleValidation.config
      })
    : createManualComposerValidation();
  const warnings = [
    ...mappingWarnings,
    ...(Array.isArray(ruleValidation.warnings) ? ruleValidation.warnings : [])
  ].filter((warning, index, values) => warning && values.indexOf(warning) === index);

  manualComposerState.validation = {
    ...ruleValidation,
    available: true,
    matchesRules: warnings.length === 0,
    warnings,
    expectedPronunciation: derivation.pronunciation || ruleValidation.expectedPronunciation || ""
  };

  return manualComposerState.validation;
}

const normalizedAwsConfig =
  typeof awsHelpers.normalizeConfig === "function"
    ? awsHelpers.normalizeConfig(window.LOVE_LANGUAGE_AWS_CONFIG)
    : window.LOVE_LANGUAGE_AWS_CONFIG;
const awsRuntime =
  typeof sharedApi.createAwsRuntime === "function"
    ? sharedApi.createAwsRuntime({ awsConfig: normalizedAwsConfig })
    : null;

const awsConfig = (awsRuntime && awsRuntime.awsConfig) || normalizedAwsConfig || {};
const isPlaybackConfigured = Boolean(awsRuntime && awsRuntime.isPlaybackConfigured);
const isDictionaryConfigured = Boolean(awsRuntime && awsRuntime.isHeartsConfigured);

const getPollyClient =
  (awsRuntime && awsRuntime.getPollyClient) ||
  (() => null);
const getHeartsTableClient =
  (awsRuntime && awsRuntime.getHeartsTableClient) ||
  (() => null);
const ensureAwsCredentials =
  (awsRuntime && awsRuntime.ensureAwsCredentials) ||
  (() => Promise.resolve(false));
async function ensureCurrentUserIdentity() {
  const resolvedIdentity = trimOrEmpty(
    window.SECRET_CURRENT_USER && window.SECRET_CURRENT_USER.id
  );
  if (!resolvedIdentity) {
    throw new Error("A signed-in username is required.");
  }

  currentUserId = resolvedIdentity;
  return currentUserId;
}

function setStatus(message, type = "info") {
  if (!dictionaryStatus) {
    return;
  }

  const normalized = trimOrEmpty(message);
  dictionaryStatus.classList.remove("is-hidden", "is-error");

  if (!normalized) {
    dictionaryStatus.textContent = "";
    dictionaryStatus.classList.add("is-hidden");
    return;
  }

  dictionaryStatus.textContent = normalized;
  if (type === "error") {
    dictionaryStatus.classList.add("is-error");
  }
}

function normalizeDictionaryEntry(rawItem) {
  if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
    return null;
  }

  const rowId = trimOrEmpty(rawItem.rowId);
  const word = trimOrEmpty(rawItem.word);
  const pronunciation = trimOrEmpty(rawItem.pronunciation || rawItem.ipa);
  if (!rowId || !word || !pronunciation) {
    return null;
  }

  const timestamp = toEpochMs(rawItem.timestamp) || Date.now();
  const updatedTimestamp = toEpochMs(rawItem.updatedTimestamp) || timestamp;
  const meaningUpdatedTimestamp = hasMeaningText(rawItem.meaning)
    ? toEpochMs(rawItem.meaningUpdatedTimestamp) || updatedTimestamp
    : null;
  const rawUnheartedTimestamp = toEpochMs(rawItem.unheartedTimestamp);

  return {
    id: buildEntryId(rowId, timestamp),
    rowId,
    timestamp,
    updatedTimestamp,
    meaningUpdatedTimestamp,
    definitionReview: rawItem.definitionReview || null,
    conceptData: rawItem.conceptData || null,
    unheartedTimestamp: rawUnheartedTimestamp > 0 ? rawUnheartedTimestamp : null,
    user: trimOrEmpty(rawItem.user),
    word,
    pronunciation,
    meaning: hasMeaningText(rawItem.meaning) ? trimOrEmpty(rawItem.meaning) : null,
    hearted: Boolean(rawItem.hearted),
    copyFlash: false
  };
}

function buildDictionaryTableItem(record) {
  return {
    rowId: record.rowId,
    timestamp: record.timestamp,
    user: record.user || null,
    word: record.word,
    pronunciation: record.pronunciation,
    meaning: record.meaning || null,
    hearted: Boolean(record.hearted),
    updatedTimestamp: record.updatedTimestamp,
    meaningUpdatedTimestamp: record.meaningUpdatedTimestamp ?? null,
    definitionReview: record.definitionReview || null,
    conceptData: record.conceptData || null,
    unheartedTimestamp: record.unheartedTimestamp ?? null
  };
}

async function scanDictionaryEntries() {
  const currentHeartsClient = getHeartsTableClient();
  if (!currentHeartsClient) {
    return [];
  }

  await ensureCurrentUserIdentity();

  const items = [];
  let lastEvaluatedKey = undefined;

  do {
    const response = await currentHeartsClient
      .scan({
        TableName: awsConfig.heartsTableName,
        ConsistentRead: true,
        ExpressionAttributeNames: {
          "#rowId": "rowId",
          "#word": "word",
          "#pronunciation": "pronunciation",
          "#meaning": "meaning",
          "#hearted": "hearted",
          "#timestamp": "timestamp",
          "#updatedTimestamp": "updatedTimestamp",
          "#meaningUpdatedTimestamp": "meaningUpdatedTimestamp",
          "#definitionReview": "definitionReview",
          "#noteData": "noteData",
          "#conceptData": "conceptData",
          "#user": "user",
          "#unheartedTimestamp": "unheartedTimestamp"
        },
        ProjectionExpression:
          "#rowId, #word, #pronunciation, #meaning, #hearted, #timestamp, #updatedTimestamp, #meaningUpdatedTimestamp, #definitionReview, #noteData, #conceptData, #user, #unheartedTimestamp",
        ExclusiveStartKey: lastEvaluatedKey
      })
      .promise();

    if (Array.isArray(response.Items) && response.Items.length > 0) {
      items.push(...response.Items);
    }

    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
}

function getGroupByWord(word) {
  return groups.find((group) => group.word === word) || null;
}

function matchesDictionarySearch(group) {
  const query = dictionarySearch ? dictionarySearch.value.trim().normalize("NFC").toLowerCase() : "";
  if (!query) return true;
  const containsQuery = (value) => typeof value === "string" &&
    value.normalize("NFC").toLowerCase().includes(query);
  return containsQuery(group.word) || group.definitionHistory.some((record) => containsQuery(record.meaning));
}

function isGroupVisible(group) {
  if (!group || !group.isDictionaryVisible) {
    return false;
  }

  if (showOnlyMyHearts && !group.hasCurrentUserHeart) {
    return false;
  }

  if (!matchesDictionarySearch(group)) return false;

  if (activeFilter === FILTERS.UNDEFINED) {
    return group.classification === GROUP_CLASSIFICATIONS.UNDEFINED;
  }

  if (activeFilter === FILTERS.ALL) {
    return true;
  }

  return group.classification === activeFilter;
}

function rebuildGroupsFromEntries() {
  const previousGroupsByWord = new Map(groups.map((group) => [group.word, group]));
  const recordsByWord = new Map();

  for (const record of recordsById.values()) {
    if (!recordsByWord.has(record.word)) {
      recordsByWord.set(record.word, []);
    }

    recordsByWord.get(record.word).push(record);
  }

  const nextGroups = [];
  for (const [word, wordRecords] of recordsByWord.entries()) {
    const sortedRecords = sortRecordsByActivityDesc(wordRecords);
    const definitionHistory = sortRecordsByDefinitionDesc(
      sortedRecords.filter((record) => hasDefinedMeaning(record))
    );
    const currentUserRecord = sortedRecords.find((record) => matchesCurrentUserRecord(record)) || null;
    const hasAnyHeart = sortedRecords.some((record) => record.hearted);
    const isDictionaryVisible = hasAnyHeart || definitionHistory.length > 0;

    if (!isDictionaryVisible) {
      continue;
    }

    const displayRecord = definitionHistory[0] || sortedRecords[0] || null;
    const previousGroup = previousGroupsByWord.get(word);
    const currentUserMeaning = currentUserRecord && hasDefinedMeaning(currentUserRecord)
      ? currentUserRecord.meaning
      : "";
    const draftMeaning =
      previousGroup && previousGroup.hasDraftCache &&
      (previousGroup.isEditing || previousGroup.draftMeaning !== trimOrEmpty(previousGroup.currentUserRecord && previousGroup.currentUserRecord.meaning))
        ? previousGroup.draftMeaning
        : currentUserMeaning;

    nextGroups.push({
      word,
      pronunciation: trimOrEmpty(
        (displayRecord && displayRecord.pronunciation) ||
          (currentUserRecord && currentUserRecord.pronunciation) ||
          (sortedRecords[0] && sortedRecords[0].pronunciation)
      ),
      records: sortedRecords,
      displayRecord,
      definitionHistory,
      currentUserRecord,
      hasCurrentUserHeart: Boolean(currentUserRecord && currentUserRecord.hearted),
      isDictionaryVisible,
      classification: SECRET_DEFINITIONS.classification(definitionHistory[0]),
      sharedHearts: SECRET_DEFINITIONS.sharedHearts(sortedRecords),
      expanded: Boolean(previousGroup && previousGroup.expanded),
      draftMeaning,
      hasDraftCache:
        (previousGroup && previousGroup.hasDraftCache) ||
        hasMeaningText(draftMeaning),
      isEditing: Boolean(previousGroup && previousGroup.isEditing),
      saveStatus: previousGroup ? previousGroup.saveStatus : "idle",
      latestActivityTimestamp: sortedRecords.reduce(
        (maxTimestamp, record) => Math.max(maxTimestamp, getActivityTimestamp(record)),
        0
      )
    });
  }

  nextGroups.sort((left, right) => {
    return left.word.localeCompare(right.word, undefined, {
      sensitivity: "base",
      numeric: true
    });
  });

  groups = nextGroups;
}

function rebuildVisibleGroups() {
  visibleGroups = groups.filter((group) => isGroupVisible(group));
  updateFilterControls();
}

function getFilterCounts() {
  const sourceGroups = showOnlyMyHearts ? groups.filter((group) => group.hasCurrentUserHeart) : groups;
  let definedCount = 0;
  let candidateCount = 0;
  let undefinedCount = 0;

  for (const group of sourceGroups) {
    if (!group.isDictionaryVisible || !matchesDictionarySearch(group)) {
      continue;
    }

    if (group.classification === GROUP_CLASSIFICATIONS.UNDEFINED) {
      undefinedCount += 1;
    } else if (group.classification === GROUP_CLASSIFICATIONS.CANDIDATE) {
      candidateCount += 1;
    } else {
      definedCount += 1;
    }
  }

  return {
    [FILTERS.DEFINED]: definedCount,
    [FILTERS.CANDIDATE]: candidateCount,
    [FILTERS.UNDEFINED]: undefinedCount,
    [FILTERS.ALL]: definedCount + undefinedCount + candidateCount
  };
}

function updateFilterControls() {
  const counts = getFilterCounts();

  for (const button of filterButtons) {
    const filter = button.dataset.filter;
    const isActive = filter === activeFilter;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");

    const count = button.querySelector(".dictionary-filter-count");
    if (count) {
      count.textContent = String(counts[filter] || 0);
    }
  }

  if (myHeartsToggle) {
    myHeartsToggle.classList.toggle("is-active", showOnlyMyHearts);
    myHeartsToggle.setAttribute("aria-pressed", showOnlyMyHearts ? "true" : "false");
  }
}

function updateSentinelVisibility() {
  if (!dictionarySentinel) {
    return;
  }

  const hide = visibleGroups.length === 0 || renderedGroupCount >= visibleGroups.length;
  dictionarySentinel.classList.toggle("is-hidden", hide);
}

function renderManualComposer() {
  if (dictionaryComposer && sharedUi.deferEditorRender(dictionaryComposer, renderManualComposer)) return;
  if (addWordButton) {
    addWordButton.setAttribute("aria-expanded", manualComposerState.isOpen ? "true" : "false");
    addWordButton.classList.toggle("is-active", manualComposerState.isOpen);
    addWordButton.disabled = !isDictionaryConfigured || manualComposerState.saveStatus === "saving";
  }

  if (!dictionaryComposer) {
    return;
  }

  if (!manualComposerState.isOpen) {
    dictionaryComposer.textContent = "";
    dictionaryComposer.classList.add("is-hidden");
    dictionaryComposer.classList.remove("has-rule-warning");
    return;
  }

  dictionaryComposer.classList.remove("is-hidden");
  dictionaryComposer.innerHTML = `
    <div class="dictionary-composer-header">
      <div>
        <h2 class="dictionary-composer-title">Add a Manual Word</h2>
        <p class="dictionary-composer-help">Type configured symbols to fill IPA automatically. Use periods or hyphens as temporary syllable separators.</p>
      </div>
      <p class="dictionary-composer-required-note">
        <span class="dictionary-composer-required-star" aria-hidden="true">*</span> is a required field
      </p>
    </div>
    <div class="dictionary-composer-grid">
      <label class="dictionary-composer-field" data-composer-field="word">
        <span class="dictionary-composer-label">
          Word <span class="dictionary-composer-required-star" aria-hidden="true">*</span>
        </span>
        <input
          id="dictionaryComposerWord"
          class="dictionary-composer-input"
          type="text"
          autocomplete="off"
          aria-required="true"
          aria-describedby="dictionaryComposerWordError"
          value="${escapeXml(manualComposerState.word)}"
          ${manualComposerState.saveStatus === "saving" ? "disabled" : ""}
        >
        <span id="dictionaryComposerWordError" class="dictionary-composer-field-error" aria-live="polite"></span>
      </label>
      <label class="dictionary-composer-field" data-composer-field="pronunciation">
        <span class="dictionary-composer-label">
          IPA <span class="dictionary-composer-required-star" aria-hidden="true">*</span>
        </span>
        <input
          id="dictionaryComposerPronunciation"
          class="dictionary-composer-input"
          type="text"
          autocomplete="off"
          placeholder="Autofilled when mapping is unique"
          aria-required="true"
          aria-describedby="dictionaryComposerPronunciationError"
          value="${escapeXml(manualComposerState.pronunciation)}"
          ${manualComposerState.saveStatus === "saving" ? "disabled" : ""}
        >
        <span id="dictionaryComposerPronunciationError" class="dictionary-composer-field-error" aria-live="polite"></span>
      </label>
      <label class="dictionary-composer-field dictionary-composer-field-wide" data-composer-field="meaning">
        <span class="dictionary-composer-label">
          Meaning <span class="dictionary-composer-optional-label">(optional)</span>
        </span>
        <input
          id="dictionaryComposerMeaning"
          class="dictionary-composer-input"
          type="text"
          autocomplete="off"
          aria-required="false"
          aria-describedby="dictionaryComposerMeaningError"
          value="${escapeXml(manualComposerState.meaning)}"
          ${manualComposerState.saveStatus === "saving" ? "disabled" : ""}
        >
        <span id="dictionaryComposerMeaningError" class="dictionary-composer-field-error" aria-live="polite"></span>
      </label>
    </div>
    <div class="dictionary-composer-actions">
      <button
        id="dictionaryComposerSaveBtn"
        class="dictionary-composer-btn is-primary"
        type="button"
      >
        Save word
      </button>
      <div id="dictionaryComposerWarnings" class="dictionary-composer-warning-list is-hidden" aria-label="Generation rule warnings"></div>
      <button
        id="dictionaryComposerCancelBtn"
        class="dictionary-composer-btn"
        type="button"
      >
        Cancel
      </button>
    </div>
  `;

  syncManualComposerUiState();
}

function syncManualComposerUiState() {
  if (!manualComposerState.isOpen || !dictionaryComposer) {
    return;
  }

  const validation = manualComposerState.validation || createManualComposerValidation();
  const fieldErrors = manualComposerState.fieldErrors || createManualComposerFieldErrors();
  const warningMessages = getManualComposerWarningMessages(validation);
  const hasRuleWarning = warningMessages.length > 0;
  const saveDisabled = manualComposerState.saveStatus === "saving" || !isDictionaryConfigured;

  if (manualComposerState.openWarningIndex >= warningMessages.length) {
    manualComposerState.openWarningIndex = -1;
  }

  dictionaryComposer.classList.toggle("has-rule-warning", hasRuleWarning);

  const saveButton = document.getElementById("dictionaryComposerSaveBtn");
  if (saveButton) {
    saveButton.disabled = saveDisabled;
    saveButton.textContent = getManualComposerSaveLabel();
  }

  const cancelButton = document.getElementById("dictionaryComposerCancelBtn");
  if (cancelButton) {
    cancelButton.disabled = manualComposerState.saveStatus === "saving";
  }

  const warningsNode = document.getElementById("dictionaryComposerWarnings");
  if (warningsNode) {
    warningsNode.classList.toggle("is-hidden", !hasRuleWarning);
    warningsNode.innerHTML = hasRuleWarning
      ? warningMessages
          .map((warning, index) => {
            const isOpen = manualComposerState.openWarningIndex === index;
            return `
              <span class="dictionary-warning-item${isOpen ? " is-open" : ""}" data-warning-item>
                <button
                  type="button"
                  class="dictionary-warning-badge"
                  data-warning-badge
                  data-warning-index="${index}"
                  aria-label="${escapeXml(warning)}"
                  aria-describedby="dictionaryComposerWarningTooltip${index}"
                  aria-expanded="${isOpen ? "true" : "false"}"
                  ${manualComposerState.saveStatus === "saving" ? "disabled" : ""}
                >
                  ⚠
                </button>
                <span
                  id="dictionaryComposerWarningTooltip${index}"
                  class="dictionary-warning-tooltip"
                  role="tooltip"
                >${escapeXml(warning)}</span>
              </span>
            `;
          })
          .join("")
      : "";
  }

  const wordInput = document.getElementById("dictionaryComposerWord");
  const pronunciationInput = document.getElementById("dictionaryComposerPronunciation");
  const meaningInput = document.getElementById("dictionaryComposerMeaning");
  const disableFields = manualComposerState.saveStatus === "saving";

  if (wordInput) {
    wordInput.disabled = disableFields;
    if (wordInput.value !== manualComposerState.word) {
      wordInput.value = manualComposerState.word;
    }
  }

  if (pronunciationInput) {
    pronunciationInput.disabled = disableFields;
    if (pronunciationInput.value !== manualComposerState.pronunciation) {
      pronunciationInput.value = manualComposerState.pronunciation;
    }
  }

  if (meaningInput) {
    meaningInput.disabled = disableFields;
    if (meaningInput.value !== manualComposerState.meaning) {
      meaningInput.value = manualComposerState.meaning;
    }
  }

  syncManualComposerFieldNode("word", wordInput, fieldErrors.word);
  syncManualComposerFieldNode("pronunciation", pronunciationInput, fieldErrors.pronunciation);
  syncManualComposerFieldNode("meaning", meaningInput, fieldErrors.meaning);
}

function syncManualComposerFieldNode(fieldName, input, errorMessage) {
  const field = dictionaryComposer.querySelector(`[data-composer-field="${fieldName}"]`);
  const errorNode = document.getElementById(`${getManualComposerInputId(fieldName)}Error`);
  const hasError = Boolean(trimOrEmpty(errorMessage));

  if (field) {
    field.classList.toggle("is-invalid", hasError);
  }

  if (input) {
    input.setAttribute("aria-invalid", hasError ? "true" : "false");
  }

  if (errorNode) {
    errorNode.textContent = hasError ? errorMessage : "";
  }
}

function getHistoryEntriesForGroup(group) {
  if (!group || group.definitionHistory.length <= 1) {
    return [];
  }

  return group.definitionHistory.slice(1);
}

function getGroupCopyPayload(group, record) {
  return buildCopyPayload({
    word: group.word,
    pronunciation: record.pronunciation,
    ipa: record.pronunciation,
    meaning: hasDefinedMeaning(record) ? record.meaning : ""
  });
}

function renderRecordMeaning(row, group, record, isHistoryEntry) {
  const container = row.querySelector(".row-meaning");
  if (!container) {
    return;
  }

  container.textContent = "";
  if (hasDefinedMeaning(record)) {
    const definition = document.createElement("span");
    definition.className = "meaning-definition";
    definition.textContent = `— ${record.meaning}`;
    container.appendChild(definition);
  }

  if (isHistoryEntry) {
    return;
  }

  if (selectedWord !== group.word) {
    return;
  }

  if (group.isEditing) {
    const editor = document.createElement("div");
    editor.className = "meaning-editor";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "meaning-input";
    input.placeholder = "What does this word mean?";
    input.value = group.draftMeaning;

    const saveButton = createActionButton("meaning-action is-save", "✓", "Save my meaning", "save-meaning");
    const cancelButton = createActionButton(
      "meaning-action",
      "✕",
      "Cancel meaning edit",
      "cancel-meaning"
    );

    if (group.saveStatus !== "idle") {
      input.disabled = true;
      saveButton.disabled = true;
      cancelButton.disabled = true;
    }

    editor.append(input, saveButton, cancelButton);
    container.appendChild(editor);

    return;
  }

  const link = document.createElement("button");
  link.type = "button";
  link.className = "meaning-link";
  link.dataset.action = "open-meaning-editor";
  link.textContent =
    group.currentUserRecord && hasDefinedMeaning(group.currentUserRecord)
      ? "Edit my meaning"
      : hasMeaningText(group.draftMeaning)
        ? "Edit my meaning"
        : "Add my meaning";
  link.disabled = group.saveStatus !== "idle";
  container.appendChild(link);
}

function applyRecordRowState(row, group, record, isHistoryEntry) {
  row.classList.toggle("is-selected", !isHistoryEntry && selectedWord === group.word);

  const heartButton = row.querySelector(".heart-btn");
  if (heartButton) {
    heartButton.classList.toggle("is-hidden", isHistoryEntry);
    heartButton.classList.toggle("is-hearted", group.hasCurrentUserHeart);
    heartButton.classList.toggle("has-shared-hearts", group.sharedHearts);
    heartButton.title = group.sharedHearts ? "Hearted by multiple named users" : "";
    heartButton.textContent = group.hasCurrentUserHeart ? "❤" : "♡";
    heartButton.setAttribute("aria-label", group.hasCurrentUserHeart ? "Remove saved word" : "Save word");
    heartButton.disabled = isHistoryEntry || group.saveStatus !== "idle";
  }

  const copyButton = row.querySelector(".copy-btn");
  if (copyButton) {
    copyButton.classList.toggle("is-success", Boolean(record.copyFlash));
    copyButton.textContent = record.copyFlash ? "✓" : copyButton.dataset.icon;
  }

  const playButton = row.querySelector(".play-btn");
  if (playButton) {
    const isPlaying = playingRecordId === record.id;
    playButton.classList.toggle("is-playing", isPlaying);
    playButton.classList.remove("is-loading");
    playButton.textContent = isPlaying ? "■" : playButton.dataset.icon;
  }

  renderRecordMeaning(row, group, record, isHistoryEntry);
}

function createRecordRowElement(group, record, isHistoryEntry) {
  const row = document.createElement("div");
  row.className = "result-row dictionary-entry";
  if (isHistoryEntry) {
    row.classList.add("dictionary-history-entry");
  }

  row.dataset.word = group.word;
  row.dataset.recordId = record.id;

  const actions = document.createElement("div");
  actions.className = "row-actions";

  const playButton = createActionButton("play-btn", "▶", "Play pronunciation", "play-pronunciation");
  if (!isPlaybackConfigured) {
    playButton.classList.add("is-hidden");
  }

  const heartButton = createActionButton("heart-btn", "♡", "Save word", "toggle-heart");
  const copyButton = createActionButton("copy-btn", "⧉", "Copy word details", "copy-word");

  actions.append(playButton, heartButton);

  const content = document.createElement("div");
  content.className = "row-content";

  const wordSpan = document.createElement("span");
  wordSpan.className = "word";
  wordSpan.textContent = group.word;

  const ipaSpan = document.createElement("span");
  ipaSpan.className = "ipa";
  ipaSpan.textContent = `/${record.pronunciation}/`;

  content.append(wordSpan, ipaSpan);

  const meaning = document.createElement("div");
  meaning.className = "row-meaning";

  const copySlot = document.createElement("div");
  copySlot.className = "row-copy";
  copySlot.append(copyButton);

  row.append(actions, content, meaning, copySlot);
  applyRecordRowState(row, group, record, isHistoryEntry);
  return row;
}

function resetWordEditor() {
  wordEditorState.word = "";
  wordEditorState.spelling = "";
  wordEditorState.pronunciation = "";
  wordEditorState.warnings = [];
  wordEditorState.saveStatus = "idle";
  wordEditorState.error = "";
}

function updateWordEditorDerivation(spelling) {
  wordEditorState.spelling = spelling;
  const derivation = derivePronunciationFromSpelling({
    spelling,
    config: loadActiveRuleConfig()
  });
  wordEditorState.pronunciation = derivation.pronunciation || "";
  wordEditorState.warnings = Array.isArray(derivation.warnings) ? derivation.warnings : [];
  wordEditorState.error = "";
  return derivation;
}

function openWordEditor(word) {
  const group = getGroupByWord(word);
  if (!group) {
    return;
  }

  wordEditorState.word = group.word;
  wordEditorState.saveStatus = "idle";
  wordEditorState.deleteConfirmationWord = "";
  updateWordEditorDerivation(group.word);
  selectedWord = group.word;
  refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: group.word });
  const spellingInput = dictionaryList.querySelector("[data-word-edit-field='spelling']");
  if (spellingInput) spellingInput.focus();
}

function closeWordEditor() {
  const word = wordEditorState.word;
  resetWordEditor();
  refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: word });
}

function createWordEditorElement(group) {
  const editor = document.createElement("section");
  editor.className = "dictionary-word-editor";
  editor.setAttribute("aria-label", `Edit ${group.word}`);

  const fields = document.createElement("div");
  fields.className = "dictionary-word-editor-fields";

  const spellingLabel = document.createElement("label");
  spellingLabel.textContent = "Spelling";
  const spellingInput = document.createElement("input");
  spellingInput.type = "text";
  spellingInput.value = wordEditorState.spelling;
  spellingInput.dataset.wordEditField = "spelling";
  spellingInput.autocomplete = "off";
  spellingInput.disabled = wordEditorState.saveStatus !== "idle";
  spellingLabel.appendChild(spellingInput);

  const pronunciationLabel = document.createElement("label");
  pronunciationLabel.textContent = "IPA sound";
  const pronunciationInput = document.createElement("input");
  pronunciationInput.type = "text";
  pronunciationInput.value = wordEditorState.pronunciation;
  pronunciationInput.placeholder = "Enter IPA when it cannot be determined";
  pronunciationInput.dataset.wordEditField = "pronunciation";
  pronunciationInput.autocomplete = "off";
  pronunciationInput.disabled = wordEditorState.saveStatus !== "idle";
  pronunciationLabel.appendChild(pronunciationInput);

  fields.append(spellingLabel, pronunciationLabel);
  editor.appendChild(fields);

  const help = document.createElement("p");
  help.className = "dictionary-word-editor-help";
  help.textContent = "Use a period or hyphen to mark syllable boundaries. Separators are removed when saved.";
  editor.appendChild(help);

  if (wordEditorState.warnings.length > 0) {
    const warnings = document.createElement("ul");
    warnings.className = "dictionary-word-editor-warnings";
    for (const warning of wordEditorState.warnings) {
      const item = document.createElement("li");
      item.textContent = warning;
      warnings.appendChild(item);
    }
    editor.appendChild(warnings);
  }

  if (wordEditorState.error) {
    const error = document.createElement("p");
    error.className = "dictionary-word-editor-error";
    error.setAttribute("role", "alert");
    error.textContent = wordEditorState.error;
    editor.appendChild(error);
  }

  const actions = document.createElement("div");
  actions.className = "dictionary-word-editor-actions";
  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "dictionary-word-action is-primary";
  saveButton.dataset.action = "save-word-edit";
  saveButton.textContent = wordEditorState.saveStatus === "saving" ? "Saving…" : "Save spelling";
  saveButton.disabled = wordEditorState.saveStatus !== "idle";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "dictionary-word-action";
  cancelButton.dataset.action = "cancel-word-edit";
  cancelButton.textContent = "Cancel";
  cancelButton.disabled = wordEditorState.saveStatus !== "idle";
  actions.append(saveButton, cancelButton);
  editor.appendChild(actions);
  return editor;
}

function createWordManagementActions(group) {
  const actions = document.createElement("div");
  actions.className = "dictionary-word-management";

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "dictionary-word-action";
  editButton.dataset.action = "open-word-editor";
  editButton.textContent = "Edit spelling";
  editButton.disabled = group.saveStatus !== "idle";
  actions.appendChild(editButton);

  if (group.classification !== GROUP_CLASSIFICATIONS.UNDEFINED) {
    const undefineButton = document.createElement("button");
    undefineButton.type = "button";
    undefineButton.className = "dictionary-word-action";
    undefineButton.dataset.action = "undefine-word";
    undefineButton.textContent = "Undefine";
    undefineButton.disabled = group.saveStatus !== "idle";
    actions.appendChild(undefineButton);
  }

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "dictionary-word-action is-danger";
  deleteButton.dataset.action = "delete-word";
  deleteButton.textContent =
    wordEditorState.deleteConfirmationWord === group.word ? "Confirm delete" : "Delete word";
  deleteButton.disabled = group.saveStatus !== "idle";
  actions.appendChild(deleteButton);
  return actions;
}

function createGroupCard(group) {
  const displayRecord = group.displayRecord;
  if (!displayRecord) {
    return null;
  }

  const historyEntries = getHistoryEntriesForGroup(group);
  const card = document.createElement("li");
  card.className = "dictionary-card";
  card.dataset.word = group.word;

  const header = document.createElement("div");
  header.className = "dictionary-card-header";

  const wordMeta = document.createElement("div");
  wordMeta.className = "dictionary-word-meta";

  const title = document.createElement("span");
  title.className = "dictionary-word-title";
  title.textContent = group.word;

  const badge = document.createElement("span");
  badge.className = `dictionary-status-badge is-${group.classification}`;
  badge.textContent = getGroupStatusLabel(group.classification);

  wordMeta.append(title, badge);

  if (group.definitionHistory[0]) {
    const author = document.createElement("span");
    author.className = "dictionary-definition-author";
    author.textContent = `Last defined by ${getDefinitionAuthorLabel(group.definitionHistory[0])}`;
    wordMeta.appendChild(author);
  }
  header.appendChild(wordMeta);

  const headerControls = document.createElement("div");
  headerControls.className = "dictionary-card-header-controls";

  if (group.classification === GROUP_CLASSIFICATIONS.CANDIDATE) {
    const reviewButton = document.createElement("button");
    reviewButton.type = "button";
    reviewButton.className = "dictionary-word-action";
    const ownDefinition = group.definitionHistory[0].user === currentUserId;
    reviewButton.dataset.action = "approve-definition";
    reviewButton.textContent = ownDefinition ? "Awaiting another user's approval" : "Approve definition";
    reviewButton.disabled = group.saveStatus !== "idle" ||
      !SECRET_DEFINITIONS.canApprove(group.definitionHistory[0], currentUserId);
    headerControls.appendChild(reviewButton);
  }

  if (selectedWord === group.word) {
    headerControls.appendChild(createWordManagementActions(group));
  }

  if (historyEntries.length > 0) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "dictionary-history-toggle";
    toggle.dataset.action = "toggle-history";
    toggle.dataset.word = group.word;
    toggle.textContent = group.expanded ? "Hide definitions" : `See more (${historyEntries.length})`;
    headerControls.appendChild(toggle);
  }

  header.appendChild(headerControls);

  const main = document.createElement("div");
  main.className = "dictionary-main";
  main.appendChild(createRecordRowElement(group, displayRecord, false));

  card.appendChild(header);

  if (wordEditorState.deleteConfirmationWord === group.word) {
    const warning = document.createElement("p");
    warning.className = "dictionary-delete-warning";
    warning.setAttribute("role", "alert");
    warning.textContent = "This permanently deletes every saved record, all notes, and every user's heart for this word. Click Confirm delete to continue.";
    card.appendChild(warning);
  }

  if (wordEditorState.word === group.word) {
    card.appendChild(createWordEditorElement(group));
  }

  card.appendChild(main);
  card.appendChild(getWordNotes().render(group.word));

  if (historyEntries.length > 0) {
    const history = document.createElement("div");
    history.className = "dictionary-history";
    history.hidden = !group.expanded;

    for (const historyRecord of historyEntries) {
      history.appendChild(createRecordRowElement(group, historyRecord, true));
    }

    card.appendChild(history);
  }

  return card;
}

function appendGroupCards(targetCount) {
  if (!dictionaryList) {
    return;
  }

  while (renderedGroupCount < targetCount && renderedGroupCount < visibleGroups.length) {
    const group = visibleGroups[renderedGroupCount];
    const card = createGroupCard(group);
    if (card) {
      dictionaryList.appendChild(card);
    }
    renderedGroupCount += 1;
  }

  updateSentinelVisibility();
}

function renderDictionary(preserveCount = 0) {
  if (!dictionaryList) {
    return;
  }
  if (sharedUi.deferEditorRender(dictionaryList, () => renderDictionary(preserveCount))) return;

  const savedEditor = sharedUi.captureEditor(dictionaryList);
  dictionaryList.textContent = "";
  renderedGroupCount = 0;

  if (visibleGroups.length === 0) {
    updateSentinelVisibility();
    return;
  }

  const initialCount =
    preserveCount > 0
      ? Math.min(visibleGroups.length, Math.max(DICTIONARY_BATCH_SIZE, preserveCount))
      : Math.min(visibleGroups.length, DICTIONARY_BATCH_SIZE);

  appendGroupCards(initialCount);
  sharedUi.restoreEditor(dictionaryList, savedEditor);
}

function renderNextGroupBatch() {
  if (renderedGroupCount >= visibleGroups.length) {
    updateSentinelVisibility();
    return;
  }

  const nextCount = Math.min(visibleGroups.length, renderedGroupCount + DICTIONARY_BATCH_SIZE);
  appendGroupCards(nextCount);
}

function setupObserver() {
  if (!dictionarySentinel) {
    return;
  }

  if (observer) {
    observer.disconnect();
    observer = null;
  }

  if (visibleGroups.length === 0) {
    updateSentinelVisibility();
    return;
  }

  if (typeof window.IntersectionObserver !== "function") {
    appendGroupCards(visibleGroups.length);
    return;
  }

  observer = new window.IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) {
        return;
      }

      renderNextGroupBatch();
    },
    {
      root: null,
      rootMargin: "240px 0px"
    }
  );

  observer.observe(dictionarySentinel);
}

function clearCopyFeedback(recordId) {
  const timer = copyFeedbackTimers.get(recordId);
  if (!timer) {
    return;
  }

  window.clearTimeout(timer);
  copyFeedbackTimers.delete(recordId);
}

function isWordVisible(word) {
  return visibleGroups.some((group) => group.word === word);
}

function getVisibleRecordIds() {
  const visibleIds = new Set();

  for (const group of visibleGroups) {
    if (group.displayRecord) {
      visibleIds.add(group.displayRecord.id);
    }

    if (group.expanded) {
      for (const historyRecord of getHistoryEntriesForGroup(group)) {
        visibleIds.add(historyRecord.id);
      }
    }
  }

  return visibleIds;
}

function syncVisibleState(preferredWord = "") {
  if (preferredWord && isWordVisible(preferredWord)) {
    selectedWord = preferredWord;
  } else if (selectedWord && !isWordVisible(selectedWord)) {
    selectedWord = "";
  }

  if (playingRecordId) {
    const visibleIds = getVisibleRecordIds();
    if (!visibleIds.has(playingRecordId)) {
      sharedAudio.pause();
      sharedAudio.currentTime = 0;
      playingRecordId = "";
    }
  }
}

function refreshDictionaryView(options = {}) {
  const preserveCount = Number(options.preserveCount) > 0 ? Number(options.preserveCount) : 0;
  const preferredWord = trimOrEmpty(options.preferredWord);

  rebuildVisibleGroups();
  renderManualComposer();

  if (!dictionaryList) {
    updateSentinelVisibility();
    return;
  }

  if (visibleGroups.length === 0) {
    dictionaryList.textContent = "";
    renderedGroupCount = 0;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    updateSentinelVisibility();
    setStatus(dictionarySearch && dictionarySearch.value.trim()
      ? "No matching words in the current filters. Try All or clear your search."
      : getEmptyStatusMessage());
    syncVisibleState();
    return;
  }

  setStatus("");
  renderDictionary(preserveCount);
  setupObserver();
  syncVisibleState(preferredWord);
}

async function synthesize(word, ipa) {
  const currentPollyClient = getPollyClient();
  if (!isPlaybackConfigured || !currentPollyClient) {
    return null;
  }

  const ready = await ensureAwsCredentials();
  if (!ready) {
    return null;
  }

  const cacheKey = [
    word,
    ipa,
    awsConfig.region,
    awsConfig.voiceId,
    awsConfig.engine,
    awsConfig.outputFormat
  ].join("|");

  if (audioCache.has(cacheKey)) {
    return audioCache.get(cacheKey);
  }

  const ssml = `<speak><phoneme alphabet="ipa" ph="${escapeXml(ipa)}">${escapeXml(
    word
  )}</phoneme></speak>`;

  const data = await currentPollyClient
    .synthesizeSpeech({
      OutputFormat: awsConfig.outputFormat,
      TextType: "ssml",
      Text: ssml,
      VoiceId: awsConfig.voiceId,
      Engine: awsConfig.engine
    })
    .promise();

  const audioBlob = toAudioBlob(data.AudioStream, awsConfig.outputFormat);
  if (!audioBlob) {
    throw new Error("Polly returned an unsupported audio stream payload.");
  }

  const objectUrl = URL.createObjectURL(audioBlob);
  audioCache.set(cacheKey, objectUrl);
  return objectUrl;
}

async function playPronunciation(recordId) {
  if (!isPlaybackConfigured) {
    return;
  }

  const record = recordsById.get(recordId);
  if (!record) {
    return;
  }

  if (playingRecordId === recordId && !sharedAudio.paused) {
    sharedAudio.pause();
    sharedAudio.currentTime = 0;
    playingRecordId = "";
    refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: selectedWord });
    return;
  }

  const previousPlayingRecordId = playingRecordId;

  try {
    const audioUrl = await synthesize(record.word, record.pronunciation);
    if (!audioUrl) {
      return;
    }

    sharedAudio.pause();
    sharedAudio.currentTime = 0;
    sharedAudio.src = audioUrl;
    await sharedAudio.play();

    playingRecordId = recordId;
    refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: selectedWord });
  } catch (error) {
    playingRecordId = previousPlayingRecordId;
    console.error("Failed to synthesize or play pronunciation.", error);
  }
}

function showCopySuccess(recordId) {
  const record = recordsById.get(recordId);
  if (!record) {
    return;
  }

  clearCopyFeedback(recordId);
  record.copyFlash = true;
  refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: selectedWord });

  const timer = window.setTimeout(() => {
    const current = recordsById.get(recordId);
    if (!current) {
      return;
    }

    current.copyFlash = false;
    copyFeedbackTimers.delete(recordId);
    refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: selectedWord });
  }, COPY_FEEDBACK_MS);

  copyFeedbackTimers.set(recordId, timer);
}

function toggleHistory(word) {
  const group = getGroupByWord(word);
  if (!group || getHistoryEntriesForGroup(group).length === 0) {
    return;
  }

  group.expanded = !group.expanded;
  refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: word || selectedWord });
}

function openMeaningEditor(word) {
  const group = getGroupByWord(word);
  if (!group) {
    return;
  }

  if (!group.hasDraftCache) {
    group.draftMeaning =
      group.currentUserRecord && hasDefinedMeaning(group.currentUserRecord)
        ? group.currentUserRecord.meaning
        : "";
    group.hasDraftCache = true;
  }

  group.isEditing = true;
  selectedWord = word;
  refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: word });
  const card = Array.from(dictionaryList.children).find((item) => item.dataset.word === word);
  const input = card && card.querySelector(".meaning-input");
  if (input) input.focus();
}

function closeMeaningEditor(word) {
  const group = getGroupByWord(word);
  if (!group) {
    return;
  }

  group.isEditing = false;
  refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: word });
}

function resetManualComposer() {
  manualComposerState.isOpen = false;
  manualComposerState.word = "";
  manualComposerState.pronunciation = "";
  manualComposerState.meaning = "";
  manualComposerState.validation = createManualComposerValidation();
  manualComposerState.fieldErrors = createManualComposerFieldErrors();
  manualComposerState.hasAttemptedSave = false;
  manualComposerState.openWarningIndex = -1;
  manualComposerState.saveStatus = "idle";
}

function openManualComposer() {
  manualComposerState.isOpen = true;
  manualComposerState.word = "";
  manualComposerState.pronunciation = "";
  manualComposerState.meaning = "";
  manualComposerState.fieldErrors = createManualComposerFieldErrors();
  manualComposerState.hasAttemptedSave = false;
  manualComposerState.openWarningIndex = -1;
  manualComposerState.saveStatus = "idle";
  syncManualComposerValidation();
  syncManualComposerFieldErrors();
  selectedWord = "";
  refreshDictionaryView({ preserveCount: renderedGroupCount });

  window.requestAnimationFrame(() => {
    const input = document.getElementById("dictionaryComposerWord");
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
}

function closeManualComposer() {
  resetManualComposer();
  refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: selectedWord });
}

function findCurrentUserRecordByWord(word) {
  const normalizedWord = trimOrEmpty(word);
  if (!normalizedWord || !currentUserId) {
    return null;
  }

  const matches = [];
  for (const record of recordsById.values()) {
    if (trimOrEmpty(record.word) !== normalizedWord) {
      continue;
    }

    if (!matchesCurrentUserRecord(record)) {
      continue;
    }

    matches.push(record);
  }

  if (matches.length === 0) {
    return null;
  }

  return sortRecordsByActivityDesc(matches)[0] || null;
}

async function handleApproveDefinition(word) {
  dictionaryRevision++;
  const group = getGroupByWord(word);
  const record = group && group.definitionHistory[0];
  if (!record || group.saveStatus !== "idle") return;
  await ensureCurrentUserIdentity();
  if (!SECRET_DEFINITIONS.canApprove(record, currentUserId)) return;
  group.saveStatus = "saving-review";
  refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: word });
  try {
    const client = getHeartsTableClient();
    const key = { rowId: record.rowId, timestamp: record.timestamp };
    const response = await client.get({ TableName: awsConfig.heartsTableName,
      Key: key, ConsistentRead: true }).promise();
    const fresh = response.Item;
    if (!fresh || fresh.meaning !== record.meaning ||
        fresh.meaningUpdatedTimestamp !== record.meaningUpdatedTimestamp ||
        SECRET_DEFINITIONS.classification(fresh) !== group.classification) {
      throw new Error("This definition changed. Refresh the dictionary before reviewing it.");
    }
    if (!SECRET_DEFINITIONS.canApprove(fresh, currentUserId)) return;
    const definitionReview = { status: "defined",
      reviewedBy: currentUserId, reviewedAt: Date.now() };
    const params = { TableName: awsConfig.heartsTableName,
      Item: { ...fresh, definitionReview },
      ConditionExpression: "#updated = :updated AND (attribute_not_exists(#review) OR #review = :review)",
      ExpressionAttributeNames: { "#updated": "updatedTimestamp", "#review": "definitionReview" },
      ExpressionAttributeValues: { ":updated": fresh.updatedTimestamp,
        ":review": fresh.definitionReview || null }
    };
    if (fresh.updatedTimestamp == null) {
      params.ConditionExpression = "attribute_not_exists(#updated) AND (attribute_not_exists(#review) OR #review = :review)";
      delete params.ExpressionAttributeValues[":updated"];
    }
    await client.put(params).promise();
    record.definitionReview = definitionReview;
    activeFilter = FILTERS.DEFINED;
    rebuildGroupsFromEntries();
  } catch (error) {
    console.error("Could not save definition review.", error);
    window.alert(error.code === "ConditionalCheckFailedException"
      ? "This word changed while you were reviewing it. Refresh and try again."
      : `Could not save review: ${error.message}`);
  } finally {
    const current = getGroupByWord(word);
    if (current) current.saveStatus = "idle";
    refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: word });
  }
}

async function putDictionaryRecord(record) {
  dictionaryRevision++;
  const currentHeartsClient = getHeartsTableClient();
  if (!isDictionaryConfigured || !currentHeartsClient) {
    throw new Error("Dictionary persistence is not configured.");
  }

  await ensureCurrentUserIdentity();

  record.definitionReview = await SECRET_DEFINITIONS.save(currentHeartsClient,
    awsConfig.heartsTableName, buildDictionaryTableItem(record));
}

async function deleteDictionaryRecord(record) {
  dictionaryRevision++;
  const currentHeartsClient = getHeartsTableClient();
  if (!isDictionaryConfigured || !currentHeartsClient) {
    throw new Error("Dictionary persistence is not configured.");
  }

  await ensureCurrentUserIdentity();
  if (record.conceptData) {
    // Delete the word and its hearts, but return its desired concept to the wishlist.
    await currentHeartsClient.put({ TableName: awsConfig.heartsTableName,
      Item: { rowId: record.rowId, timestamp: record.timestamp, conceptData: record.conceptData }
    }).promise();
    return;
  }
  await currentHeartsClient
    .delete({
      TableName: awsConfig.heartsTableName,
      Key: {
        rowId: record.rowId,
        timestamp: record.timestamp
      }
    })
    .promise();
}

async function handleSaveWordEdit(word) {
  const group = getGroupByWord(word);
  if (!group || wordEditorState.saveStatus !== "idle") {
    return;
  }

  const derivation = derivePronunciationFromSpelling({
    spelling: wordEditorState.spelling,
    config: loadActiveRuleConfig()
  });
  const nextWord = trimOrEmpty(derivation.word);
  const nextPronunciation = trimOrEmpty(wordEditorState.pronunciation);

  if (!nextWord) {
    wordEditorState.error = "Enter a spelling before saving.";
    refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: word });
    return;
  }

  if (!nextPronunciation) {
    wordEditorState.error = "Enter the IPA sound because it could not be determined automatically.";
    refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: word });
    return;
  }

  const conflictingGroup = getGroupByWord(nextWord);
  if (nextWord !== word && conflictingGroup) {
    wordEditorState.error = `A word spelled "${nextWord}" already exists.`;
    refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: word });
    return;
  }

  const snapshots = group.records.map((record) => ({
    record,
    word: record.word,
    pronunciation: record.pronunciation,
    updatedTimestamp: record.updatedTimestamp
  }));
  wordEditorState.saveStatus = "saving";
  wordEditorState.error = "";
  refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: word });

  try {
    await ensureAwsCredentials();
    const now = Date.now();
    for (const snapshot of snapshots) {
      snapshot.record.word = nextWord;
      snapshot.record.pronunciation = nextPronunciation;
      snapshot.record.updatedTimestamp = now;
    }
    await Promise.all(snapshots.map(({ record }) => putDictionaryRecord(record)));
    await getWordNotes().rename(word, nextWord);

    resetWordEditor();
    wordEditorState.deleteConfirmationWord = "";
    selectedWord = nextWord;
    rebuildGroupsFromEntries();
    refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: nextWord });
  } catch (error) {
    for (const snapshot of snapshots) {
      snapshot.record.word = snapshot.word;
      snapshot.record.pronunciation = snapshot.pronunciation;
      snapshot.record.updatedTimestamp = snapshot.updatedTimestamp;
    }
    wordEditorState.saveStatus = "idle";
    wordEditorState.error = "Could not save the spelling change.";
    refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: word });
    console.error("Failed to update dictionary spelling.", error);
  }
}

async function handleUndefineWord(word) {
  const group = getGroupByWord(word);
  if (!group || group.saveStatus !== "idle") {
    return;
  }

  const recordsToUpdate = group.records.filter((record) => hasDefinedMeaning(record));
  if (recordsToUpdate.length === 0) {
    return;
  }

  const snapshots = recordsToUpdate.map((record) => ({
    record,
    meaning: record.meaning,
    meaningUpdatedTimestamp: record.meaningUpdatedTimestamp,
    updatedTimestamp: record.updatedTimestamp
  }));
  group.saveStatus = "saving-meaning";
  refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: word });

  try {
    await ensureAwsCredentials();
    const now = Date.now();
    for (const snapshot of snapshots) {
      snapshot.record.meaning = null;
      snapshot.record.meaningUpdatedTimestamp = null;
      snapshot.record.updatedTimestamp = now;
    }
    await Promise.all(snapshots.map(({ record }) => putDictionaryRecord(record)));

    group.draftMeaning = "";
    group.hasDraftCache = false;
    group.isEditing = false;
    group.saveStatus = "idle";
    rebuildGroupsFromEntries();
    refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: word });
  } catch (error) {
    for (const snapshot of snapshots) {
      snapshot.record.meaning = snapshot.meaning;
      snapshot.record.meaningUpdatedTimestamp = snapshot.meaningUpdatedTimestamp;
      snapshot.record.updatedTimestamp = snapshot.updatedTimestamp;
    }
    group.saveStatus = "idle";
    refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: word });
    setStatus("Could not remove this word's definition.", "error");
    console.error("Failed to undefine dictionary word.", error);
  }
}

async function handleDeleteWord(word) {
  const group = getGroupByWord(word);
  if (!group) {
    return;
  }

  if (wordEditorState.deleteConfirmationWord !== word) {
    wordEditorState.deleteConfirmationWord = word;
    refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: word });
    return;
  }

  const recordsToDelete = [...group.records];
  group.saveStatus = "deleting";
  refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: word });

  try {
    await ensureAwsCredentials();
    await Promise.all(recordsToDelete.map((record) => deleteDictionaryRecord(record)));
    await getWordNotes().remove(word);
    for (const record of recordsToDelete) {
      clearCopyFeedback(record.id);
      recordsById.delete(record.id);
    }

    wordEditorState.deleteConfirmationWord = "";
    if (wordEditorState.word === word) {
      resetWordEditor();
    }
    selectedWord = "";
    rebuildGroupsFromEntries();
    refreshDictionaryView({ preserveCount: renderedGroupCount });
  } catch (error) {
    wordEditorState.deleteConfirmationWord = "";
    group.saveStatus = "idle";
    refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: word });
    setStatus("Could not delete every saved record for this word.", "error");
    console.error("Failed to delete dictionary word.", error);
  }
}

async function ensureEditableCurrentUserRecord(group, overrides = {}) {
  const identityId = await ensureCurrentUserIdentity();
  const normalizedWord = trimOrEmpty(overrides.word || (group && group.word));
  const normalizedPronunciation = trimOrEmpty(
    overrides.pronunciation || (group && group.pronunciation)
  );
  const existingRecord = findCurrentUserRecordByWord(normalizedWord);

  if (existingRecord) {
    existingRecord.user = identityId;
    return {
      record: existingRecord,
      created: false
    };
  }

  const now = Date.now();
  const rowId = buildCanonicalRecordRowId(identityId, normalizedWord);
  const record = {
    id: buildEntryId(rowId, now),
    rowId,
    timestamp: now,
    updatedTimestamp: now,
    unheartedTimestamp: null,
    user: identityId,
    word: normalizedWord,
    pronunciation: normalizedPronunciation,
    meaning: null,
    meaningUpdatedTimestamp: null,
    hearted: false,
    copyFlash: false
  };

  recordsById.set(record.id, record);
  return {
    record,
    created: true
  };
}

async function handleToggleHeart(word) {
  const group = getGroupByWord(word);
  if (!group || !isDictionaryConfigured) {
    return;
  }

  const previousCount = renderedGroupCount;
  const previousSaveStatus = group.saveStatus;
  group.saveStatus = "saving-heart";
  refreshDictionaryView({ preserveCount: previousCount, preferredWord: word });

  let createdRecordId = "";
  let snapshot = null;

  try {
    const ensured = await ensureEditableCurrentUserRecord(group);
    const record = ensured.record;
    createdRecordId = ensured.created ? record.id : "";
    snapshot = {
      hearted: record.hearted,
      updatedTimestamp: record.updatedTimestamp,
      unheartedTimestamp: record.unheartedTimestamp,
      user: record.user
    };

    const now = Date.now();
    record.user = currentUserId;
    record.hearted = !group.hasCurrentUserHeart;
    record.updatedTimestamp = now;
    record.unheartedTimestamp = record.hearted ? null : now;

    await putDictionaryRecord(record);

    rebuildGroupsFromEntries();
    const nextGroup = getGroupByWord(word);
    if (nextGroup) {
      nextGroup.saveStatus = "idle";
    }
    refreshDictionaryView({ preserveCount: previousCount, preferredWord: word });
  } catch (error) {
    if (createdRecordId) {
      clearCopyFeedback(createdRecordId);
      recordsById.delete(createdRecordId);
    } else if (snapshot) {
      const record = group.currentUserRecord;
      if (record) {
        record.hearted = snapshot.hearted;
        record.updatedTimestamp = snapshot.updatedTimestamp;
        record.unheartedTimestamp = snapshot.unheartedTimestamp;
        record.user = snapshot.user;
      }
    }

    group.saveStatus = previousSaveStatus;
    refreshDictionaryView({ preserveCount: previousCount, preferredWord: word });
    console.error("Failed to toggle dictionary heart.", error);
  }
}

async function handleSaveMeaning(word) {
  const group = getGroupByWord(word);
  if (!group || !isDictionaryConfigured) {
    return;
  }

  const trimmedMeaning = trimOrEmpty(group.draftMeaning);
  if (!trimmedMeaning) {
    closeMeaningEditor(word);
    return;
  }

  const previousCount = renderedGroupCount;
  const previousSaveStatus = group.saveStatus;
  group.saveStatus = "saving-meaning";
  group.isEditing = false;
  refreshDictionaryView({ preserveCount: previousCount, preferredWord: word });

  let createdRecordId = "";
  let snapshot = null;

  try {
    const ensured = await ensureEditableCurrentUserRecord(group);
    const record = ensured.record;
    createdRecordId = ensured.created ? record.id : "";
    snapshot = {
      meaning: record.meaning,
      meaningUpdatedTimestamp: record.meaningUpdatedTimestamp,
      updatedTimestamp: record.updatedTimestamp,
      user: record.user,
      hearted: record.hearted,
      unheartedTimestamp: record.unheartedTimestamp
    };

    record.user = currentUserId;
    record.meaning = trimmedMeaning;
    record.updatedTimestamp = Date.now();
    record.meaningUpdatedTimestamp = record.updatedTimestamp;

    await putDictionaryRecord(record);

    rebuildGroupsFromEntries();
    const nextGroup = getGroupByWord(word);
    if (nextGroup) {
      activeFilter = nextGroup.classification;
      nextGroup.draftMeaning = trimmedMeaning;
      nextGroup.hasDraftCache = true;
      nextGroup.isEditing = false;
      nextGroup.saveStatus = "idle";
    }
    refreshDictionaryView({ preserveCount: previousCount, preferredWord: word });
  } catch (error) {
    if (createdRecordId) {
      clearCopyFeedback(createdRecordId);
      recordsById.delete(createdRecordId);
    } else if (snapshot) {
      const record = group.currentUserRecord;
      if (record) {
        record.meaning = snapshot.meaning;
        record.meaningUpdatedTimestamp = snapshot.meaningUpdatedTimestamp;
        record.updatedTimestamp = snapshot.updatedTimestamp;
        record.user = snapshot.user;
        record.hearted = snapshot.hearted;
        record.unheartedTimestamp = snapshot.unheartedTimestamp;
      }
    }

    group.saveStatus = previousSaveStatus;
    group.isEditing = true;
    refreshDictionaryView({ preserveCount: previousCount, preferredWord: word });
    console.error("Failed to save dictionary meaning.", error);
  }
}

async function handleSaveManualWord() {
  if (!isDictionaryConfigured || manualComposerState.saveStatus === "saving") {
    return;
  }

  const spellingDerivation = derivePronunciationFromSpelling({
    spelling: manualComposerState.word,
    config: loadActiveRuleConfig()
  });
  const word = trimOrEmpty(spellingDerivation.word);
  const pronunciation = trimOrEmpty(manualComposerState.pronunciation);
  const meaning = trimOrEmpty(manualComposerState.meaning);

  manualComposerState.hasAttemptedSave = true;
  manualComposerState.openWarningIndex = -1;
  syncManualComposerFieldErrors();
  syncManualComposerValidation();
  syncManualComposerUiState();

  const firstInvalidField = getFirstManualComposerInvalidField();
  if (firstInvalidField) {
    focusManualComposerField(firstInvalidField);
    return;
  }

  const previousCount = renderedGroupCount;
  const previousFilter = activeFilter;
  manualComposerState.saveStatus = "saving";
  syncManualComposerValidation();
  syncManualComposerUiState();

  let createdRecordId = "";
  let snapshot = null;

  try {
    const ensured = await ensureEditableCurrentUserRecord(null, { word, pronunciation });
    const record = ensured.record;
    createdRecordId = ensured.created ? record.id : "";
    snapshot = {
      word: record.word,
      pronunciation: record.pronunciation,
      meaning: record.meaning,
      meaningUpdatedTimestamp: record.meaningUpdatedTimestamp,
      hearted: record.hearted,
      updatedTimestamp: record.updatedTimestamp,
      unheartedTimestamp: record.unheartedTimestamp,
      user: record.user
    };

    const now = Date.now();
    const hasNewMeaning = hasMeaningText(meaning);
    record.user = currentUserId;
    record.word = word;
    record.pronunciation = pronunciation;
    record.meaning = hasNewMeaning ? meaning : record.meaning;
    record.hearted = true;
    record.updatedTimestamp = now;
    record.meaningUpdatedTimestamp = hasNewMeaning
      ? now
      : record.meaningUpdatedTimestamp ?? null;
    record.unheartedTimestamp = null;

    await putDictionaryRecord(record);

    rebuildGroupsFromEntries();
    const nextGroup = getGroupByWord(word);
    if (nextGroup && !isGroupVisible(nextGroup)) {
      activeFilter =
        nextGroup.classification;
    }

    selectedWord = word;
    resetManualComposer();
    setStatus("");
    refreshDictionaryView({ preserveCount: previousCount, preferredWord: word });
  } catch (error) {
    if (createdRecordId) {
      clearCopyFeedback(createdRecordId);
      recordsById.delete(createdRecordId);
    } else if (snapshot) {
      const record = findCurrentUserRecordByWord(word);
      if (record) {
        record.word = snapshot.word;
        record.pronunciation = snapshot.pronunciation;
        record.meaning = snapshot.meaning;
        record.meaningUpdatedTimestamp = snapshot.meaningUpdatedTimestamp;
        record.hearted = snapshot.hearted;
        record.updatedTimestamp = snapshot.updatedTimestamp;
        record.unheartedTimestamp = snapshot.unheartedTimestamp;
        record.user = snapshot.user;
      }
    }

    activeFilter = previousFilter;
    manualComposerState.saveStatus = "idle";
    syncManualComposerValidation();
    syncManualComposerUiState();
    setStatus("Failed to save manual word.", "error");
    console.error("Failed to save manual dictionary word.", error);
  }
}

function handleMeaningInput(event) {
  const input = event.target.closest(".meaning-input");
  if (!input) {
    return;
  }

  const card = input.closest(".dictionary-card");
  if (!card) {
    return;
  }

  const group = getGroupByWord(card.dataset.word || "");
  if (!group) {
    return;
  }

  group.draftMeaning = input.value;
  group.hasDraftCache = true;
}

function handleWordEditorInput(event) {
  const input = event.target.closest("[data-word-edit-field]");
  if (!input || !wordEditorState.word) {
    return;
  }

  if (input.dataset.wordEditField === "spelling") {
    if (event.isComposing) { wordEditorState.spelling = input.value; return; }
    updateWordEditorDerivation(input.value);
    const editor = input.closest(".dictionary-word-editor");
    editor.querySelector("[data-word-edit-field='pronunciation']").value = wordEditorState.pronunciation;
    let warnings = editor.querySelector(".dictionary-word-editor-warnings");
    if (!warnings) {
      warnings = document.createElement("ul");
      warnings.className = "dictionary-word-editor-warnings";
      editor.appendChild(warnings);
    }
    warnings.replaceChildren(...wordEditorState.warnings.map((message) => {
      const item = document.createElement("li"); item.textContent = message; return item;
    }));
    const error = editor.querySelector(".dictionary-word-editor-error");
    if (error) error.remove();
    return;
  }

  if (input.dataset.wordEditField === "pronunciation") {
    wordEditorState.pronunciation = input.value;
    wordEditorState.error = "";
  }
}

function handleMeaningInputKeydown(event) {
  const input = event.target.closest(".meaning-input");
  if (!input) {
    return;
  }

  const card = input.closest(".dictionary-card");
  if (!card) {
    return;
  }

  const word = trimOrEmpty(card.dataset.word);
  if (!word) {
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    void handleSaveMeaning(word);
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeMeaningEditor(word);
  }
}

function handleManualComposerInput(event) {
  if (!manualComposerState.isOpen || !dictionaryComposer || !dictionaryComposer.contains(event.target)) {
    return;
  }

  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.id === "dictionaryComposerWord") {
    manualComposerState.word = target.value;
    if (event.isComposing) return;
    const derivation = derivePronunciationFromSpelling({
      spelling: manualComposerState.word,
      config: loadActiveRuleConfig()
    });
    manualComposerState.pronunciation = derivation.pronunciation || "";
  } else if (target.id === "dictionaryComposerPronunciation") {
    manualComposerState.pronunciation = target.value;
  } else if (target.id === "dictionaryComposerMeaning") {
    manualComposerState.meaning = target.value;
  } else {
    return;
  }

  syncManualComposerFieldErrors();
  syncManualComposerValidation();
  syncManualComposerUiState();
}

function handleManualComposerKeydown(event) {
  if (!manualComposerState.isOpen || !dictionaryComposer || !dictionaryComposer.contains(event.target)) {
    return;
  }

  if (event.key === "Enter") {
    if (
      event.target instanceof Element &&
      (event.target.closest("[data-warning-badge]") ||
        event.target.closest("#dictionaryComposerCancelBtn"))
    ) {
      return;
    }

    event.preventDefault();
    void handleSaveManualWord();
    return;
  }

  if (event.key === "Escape") {
    if (manualComposerState.openWarningIndex >= 0) {
      event.preventDefault();
      closeManualComposerWarningTooltip();
      return;
    }

    if (manualComposerState.saveStatus !== "saving") {
      event.preventDefault();
      closeManualComposer();
    }
  }
}

function handleManualComposerClick(event) {
  if (!manualComposerState.isOpen || !dictionaryComposer || !dictionaryComposer.contains(event.target)) {
    return;
  }

  const warningBadge = event.target.closest("[data-warning-badge]");
  if (warningBadge) {
    event.preventDefault();
    const nextIndex = Number(warningBadge.dataset.warningIndex);
    if (!Number.isInteger(nextIndex) || nextIndex < 0) {
      return;
    }

    manualComposerState.openWarningIndex =
      manualComposerState.openWarningIndex === nextIndex ? -1 : nextIndex;
    syncManualComposerUiState();
    return;
  }

  const saveButton = event.target.closest("#dictionaryComposerSaveBtn");
  if (saveButton) {
    event.preventDefault();
    void handleSaveManualWord();
    return;
  }

  const cancelButton = event.target.closest("#dictionaryComposerCancelBtn");
  if (cancelButton) {
    event.preventDefault();
    closeManualComposer();
  }
}

async function handleDictionaryListClick(event) {
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (actionButton && actionButton.dataset.action === "toggle-history") {
    toggleHistory(actionButton.dataset.word || "");
    return;
  }

  const actionCard = actionButton && actionButton.closest(".dictionary-card");
  const actionWord = trimOrEmpty(actionCard && actionCard.dataset.word);
  if (actionButton && actionWord) {
    if (actionButton.dataset.action === "approve-definition") {
      await handleApproveDefinition(actionWord);
      return;
    }
    if (actionButton.dataset.action === "open-word-editor") {
      openWordEditor(actionWord);
      return;
    }

    if (actionButton.dataset.action === "cancel-word-edit") {
      closeWordEditor();
      return;
    }

    if (actionButton.dataset.action === "save-word-edit") {
      await handleSaveWordEdit(actionWord);
      return;
    }

    if (actionButton.dataset.action === "undefine-word") {
      await handleUndefineWord(actionWord);
      return;
    }

    if (actionButton.dataset.action === "delete-word") {
      await handleDeleteWord(actionWord);
      return;
    }
  }

  const row = event.target.closest(".dictionary-entry");
  if (!row || !dictionaryList || !dictionaryList.contains(row)) {
    return;
  }

  const card = row.closest(".dictionary-card");
  const word = trimOrEmpty((card && card.dataset.word) || row.dataset.word);
  if (!word) {
    return;
  }

  if (!actionButton) {
    selectedWord = word;
    refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: word });
    return;
  }

  if (actionButton.dataset.action !== "copy-word" && actionButton.dataset.action !== "play-pronunciation") {
    selectedWord = word;
  }

  const recordId = trimOrEmpty(row.dataset.recordId);
  const record = recordId ? recordsById.get(recordId) : null;

  if (actionButton.dataset.action === "toggle-heart") {
    await handleToggleHeart(word);
    return;
  }

  if (actionButton.dataset.action === "copy-word") {
    if (!record) {
      return;
    }

    try {
      const group = getGroupByWord(word);
      if (!group) {
        return;
      }

      await copyTextToClipboard(getGroupCopyPayload(group, record));
      showCopySuccess(record.id);
    } catch (error) {
      console.error("Copy failed.", error);
    }
    return;
  }

  if (actionButton.dataset.action === "play-pronunciation") {
    if (!record) {
      return;
    }

    await playPronunciation(record.id);
    return;
  }

  if (actionButton.dataset.action === "open-meaning-editor") {
    openMeaningEditor(word);
    return;
  }

  if (actionButton.dataset.action === "save-meaning") {
    await handleSaveMeaning(word);
    return;
  }

  if (actionButton.dataset.action === "cancel-meaning") {
    closeMeaningEditor(word);
  }
}

function handleFilterClick(event) {
  const button = event.target.closest(".dictionary-filter-btn[data-filter]");
  if (!button) {
    return;
  }

  const nextFilter = trimOrEmpty(button.dataset.filter);
  if (!isValidFilter(nextFilter) || nextFilter === activeFilter) {
    return;
  }

  activeFilter = nextFilter;
  refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: selectedWord });
}

function handleMyHeartsToggleClick() {
  showOnlyMyHearts = !showOnlyMyHearts;
  refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: selectedWord });
}

function handleAddWordButtonClick() {
  if (!isDictionaryConfigured) {
    return;
  }

  if (manualComposerState.isOpen) {
    closeManualComposer();
    return;
  }

  openManualComposer();
}

function dictionaryRefreshBusy() {
  const field = document.activeElement;
  return !dictionaryLoaded || manualComposerState.isOpen || Boolean(wordEditorState.word) ||
    Boolean(wordEditorState.deleteConfirmationWord) || groups.some(group => group.isEditing || group.saveStatus !== "idle") ||
    getWordNotes().isBusy() || Boolean(field && dictionaryList.contains(field) && field.matches("input, textarea, select"));
}

function applyDictionarySnapshot(rawItems, background = true) {
  const previousCount = renderedGroupCount;
  const scroll = { x: window.scrollX, y: window.scrollY };
  const anchor = background && [...dictionaryList.children].find(card => card.getBoundingClientRect().bottom > 0);
  const anchorWord = anchor && anchor.dataset.word;
  const anchorTop = anchor && anchor.getBoundingClientRect().top;
  getWordNotes().load(rawItems);
  const previousRecords = new Map(recordsById);
  recordsById.clear();
  for (const rawItem of rawItems) {
    const record = normalizeDictionaryEntry(rawItem);
    if (!record) continue;
    record.copyFlash = Boolean(previousRecords.get(record.id)?.copyFlash);
    recordsById.set(record.id, record);
  }
  rebuildGroupsFromEntries();
  const anchorIndex = background ? groups.filter(isGroupVisible).findIndex(group => group.word === anchorWord) : -1;
  refreshDictionaryView({ preserveCount: background ? Math.max(previousCount, anchorIndex + 1) : 0, preferredWord: selectedWord });
  if (background) {
    const nextAnchor = [...dictionaryList.children].find(card => card.dataset.word === anchorWord);
    const offset = nextAnchor ? nextAnchor.getBoundingClientRect().top - anchorTop : 0;
    window.scrollTo({ left: scroll.x, top: scroll.y + offset, behavior: "instant" });
  }
}

async function loadDictionary() {
  if (!dictionaryList || !dictionaryStatus) {
    return;
  }

  if (!isDictionaryConfigured) {
    dictionaryLoaded = true;
    setStatus("Dictionary is unavailable. Configure AWS guest access to load saved words.", "error");
    updateFilterControls();
    updateSentinelVisibility();
    return;
  }

  setStatus("Loading dictionary...");

  const ready = await ensureAwsCredentials();
  if (!ready) {
    dictionaryLoaded = true;
    setStatus("Could not initialize AWS guest credentials.", "error");
    updateFilterControls();
    updateSentinelVisibility();
    return;
  }

  try {
    await ensureCurrentUserIdentity();
    const rawItems = await scanDictionaryEntries();
    applyDictionarySnapshot(rawItems, false);
    dictionarySync.seed(rawItems);
  } catch (error) {
    console.error("Failed to load dictionary entries.", error);
    setStatus("Failed to load dictionary entries.", "error");
    updateFilterControls();
    updateSentinelVisibility();
  } finally {
    dictionaryLoaded = true;
  }
}

updateFilterControls();
renderManualComposer();

sharedAudio.addEventListener("ended", () => {
  playingRecordId = "";
  refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: selectedWord });
});
sharedAudio.addEventListener("error", () => {
  playingRecordId = "";
  refreshDictionaryView({ preserveCount: renderedGroupCount, preferredWord: selectedWord });
});

if (dictionaryFilters) {
  dictionaryFilters.addEventListener("click", handleFilterClick);
}

if (dictionarySearch) {
  dictionarySearch.addEventListener("input", () => {
    refreshDictionaryView({ preferredWord: selectedWord });
  });
}

if (myHeartsToggle) {
  myHeartsToggle.addEventListener("click", handleMyHeartsToggleClick);
}

if (addWordButton) {
  addWordButton.addEventListener("click", handleAddWordButtonClick);
}

if (dictionaryComposer) {
  dictionaryComposer.addEventListener("compositionend", handleManualComposerInput);
  dictionaryComposer.addEventListener("click", handleManualComposerClick);
  dictionaryComposer.addEventListener("input", handleManualComposerInput);
  dictionaryComposer.addEventListener("keydown", handleManualComposerKeydown);
}

if (dictionaryList) {
  dictionaryList.addEventListener("compositionend", handleWordEditorInput);
  dictionaryList.addEventListener("click", (event) => {
    void handleDictionaryListClick(event);
  });

  dictionaryList.addEventListener("input", (event) => {
    handleMeaningInput(event);
    handleWordEditorInput(event);
  });
  dictionaryList.addEventListener("keydown", handleMeaningInputKeydown);
}

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  if (!event.target.closest("[data-warning-item]")) {
    closeManualComposerWarningTooltip();
  }

  if (
    event.target.closest("#dictionaryComposer") ||
    event.target.closest(".dictionary-search") ||
    event.target.closest("#dictionaryAddWordBtn") ||
    event.target.closest(".dictionary-card") ||
    event.target.closest(".dictionary-history-toggle") ||
    event.target.closest(".dictionary-filter-btn") ||
    event.target.closest(".dictionary-toggle-btn")
  ) {
    return;
  }

  selectedWord = "";
  refreshDictionaryView({ preserveCount: renderedGroupCount });
});

window.addEventListener("storage", (event) => {
  if (!event || event.key !== activeRulesStorageKey) {
    return;
  }

  if (!manualComposerState.isOpen) {
    return;
  }

  syncManualComposerValidation();
  syncManualComposerUiState();
});

window.addEventListener("secret-rules-imported", () => {
  if (manualComposerState.isOpen) {
    const derivation = derivePronunciationFromSpelling({
      spelling: manualComposerState.word,
      config: loadActiveRuleConfig()
    });
    manualComposerState.pronunciation = derivation.pronunciation || "";
    syncManualComposerValidation();
    syncManualComposerUiState();
  }

  if (wordEditorState.word) {
    updateWordEditorDerivation(wordEditorState.spelling);
    refreshDictionaryView({
      preserveCount: renderedGroupCount,
      preferredWord: wordEditorState.word
    });
  }
});

window.addEventListener("beforeunload", () => {
  sharedAudio.pause();
  sharedAudio.currentTime = 0;

  for (const url of audioCache.values()) {
    URL.revokeObjectURL(url);
  }

  for (const recordId of copyFeedbackTimers.keys()) {
    clearCopyFeedback(recordId);
  }
});

const dictionarySync = SECRET_COOPERATIVE_REFRESH.start({
  isBusy: dictionaryRefreshBusy,
  version: () => `${dictionaryRevision}:${getWordNotes().version()}`,
  read: async () => {
    if (!isDictionaryConfigured || !await ensureAwsCredentials()) throw new Error("Database access is unavailable.");
    return scanDictionaryEntries();
  },
  apply: applyDictionarySnapshot,
  onSuccess: () => { document.getElementById("dictionarySyncStatus").textContent = ""; },
  onError: error => {
    console.warn("Dictionary refresh failed; retaining the current dictionary and edits.", error);
    document.getElementById("dictionarySyncStatus").textContent = "Could not refresh shared words. Your current view is kept; automatic refresh will retry.";
  }
});
window.addEventListener("beforeunload", () => dictionarySync.stop());
void loadDictionary();
