const MAX_RESULTS = 50;
const RETRY_LIMIT = 100;
const COPY_FEEDBACK_MS = 1200;
const CURRENT_BROWSER_USER_ID =
  window.SECRET_CURRENT_USER && typeof window.SECRET_CURRENT_USER.id === "string"
    ? window.SECRET_CURRENT_USER.id
    : "anonymous";
const LOCAL_STORAGE_ROWS_KEY = `secret.generated-rows.${encodeURIComponent(CURRENT_BROWSER_USER_ID)}.v3`;
const LOCAL_STORAGE_ROWS_VERSION = 2;
const LOCAL_STORAGE_SYLLABLE_SETTINGS_KEY = "secret.syllable-settings.v1";
const PERSIST_SAVE_DEBOUNCE_MS = 250;

const DISPLAY_MEANING_SOURCES = {
  NONE: "",
  OWN: "own",
  IMPORTED: "imported"
};

const SLOT_TYPES = {
  CONSONANT: "C",
  VOWEL: "V"
};

const RELATIONS = {
  SAME_SYLLABLE: "sameSyllable",
  BOUNDARY: "boundary",
  NONE: "none"
};

const minInput = document.getElementById("minSyllables");
const maxInput = document.getElementById("maxSyllables");
const generateBtn = document.getElementById("generateBtn");
const generationStatus = document.getElementById("generationStatus");
const wordPrefixInput = document.getElementById("wordPrefix");
const wordSuffixInput = document.getElementById("wordSuffix");
const prefixStatus = document.getElementById("prefixStatus");
const clearAllBtn = document.getElementById("clearAllBtn");
const resultsList = document.getElementById("results");

const generatedWords = new Set();
let generatorRevision = 0;
let generatorSync;
const generatorConstraints = window.SECRET_GENERATOR_CONSTRAINTS.create({
  document,
  config: () => activeRuleConfig,
  onChange: () => clampSyllables(false),
  requestRefresh: () => { if (generatorSync) void generatorSync.request(); }
});
const rowStateById = new Map();
let generatorDefinitionPicker = null;
let generatorPickerRowId = null;
const audioCache = new Map();
const copyFeedbackTimers = new Map();
const sharedAudio = new Audio();

let selectedRowId = null;
let playingRowId = null;
let persistRowsTimer = null;

const sharedApi = window.LOVE_LANGUAGE_SHARED || {};
const sharedUtils = sharedApi.utils || {};
const sharedUi = sharedApi.ui || {};
const awsHelpers = window.LOVE_LANGUAGE_AWS || {};
const rulesApi = window.LOVE_LANGUAGE_RULES || {};

const trimOrEmpty =
  typeof sharedUtils.trimOrEmpty === "function"
    ? sharedUtils.trimOrEmpty
    : (value) => (typeof value === "string" ? value.trim() : "");
const createRowId =
  typeof sharedUtils.createRowId === "function"
    ? sharedUtils.createRowId
    : () => `row-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
const cloneRuleConfig =
  typeof rulesApi.cloneRuleConfig === "function" ? rulesApi.cloneRuleConfig : (config) => config;
const loadActiveRuleConfig =
  typeof rulesApi.loadActiveRuleConfig === "function"
    ? rulesApi.loadActiveRuleConfig
    : () => ({
        vowels: [],
        consonants: [],
        syllablePatterns: {
          single: [],
          initial: [],
          medial: [],
          final: []
        },
        transitionRules: [],
        wordEndBans: [],
        syllableEndBans: []
      });
const evaluateRuleConfigCompatibility =
  typeof rulesApi.evaluateRuleConfigCompatibility === "function"
    ? rulesApi.evaluateRuleConfigCompatibility
    : () => ({ isReady: true, message: "", errors: [] });
const activeRulesStorageKey =
  rulesApi.storageKeys && typeof rulesApi.storageKeys.active === "string"
    ? rulesApi.storageKeys.active
    : "";

let activeRuleConfig = cloneRuleConfig(loadActiveRuleConfig());
let ruleConfigCompatibility = { isReady: true, message: "", errors: [] };
let poolManager = null;
let ruleEngine = null;

function getActivityTimestamp(item) {
  return Math.max(toEpochMs(item && item.updatedTimestamp), toEpochMs(item && item.timestamp));
}

function getMeaningTimestamp(item) {
  if (!hasMeaningText(item && item.meaning)) {
    return 0;
  }
  return toEpochMs(item.meaningUpdatedTimestamp) || getActivityTimestamp(item);
}

function buildCanonicalRecordRowId(userId, word) {
  return `${encodeURIComponent(trimOrEmpty(userId))}::${encodeURIComponent(trimOrEmpty(word))}`;
}

function hasOwnMeaning(state) {
  return hasMeaningText(state && state.ownMeaning);
}

function getDraftMeaningTimestamp(state) {
  if (!state || !state.hasDraftCache || !hasMeaningText(state.draftMeaning)) {
    return 0;
  }

  return toEpochMs(state.draftUpdatedTimestamp);
}

function getLocalUserStateTimestamp(state) {
  if (
    !state ||
    (!state.hasPersistedRecord &&
      !state.hearted &&
      !hasOwnMeaning(state) &&
      !hasMeaningText(state.draftMeaning))
  ) {
    return 0;
  }

  return Math.max(getActivityTimestamp(state), getDraftMeaningTimestamp(state));
}

function getPreferredOwnMeaning(state) {
  const draftTimestamp = getDraftMeaningTimestamp(state);
  if (draftTimestamp > getActivityTimestamp(state) && hasMeaningText(state.draftMeaning)) {
    return trimOrEmpty(state.draftMeaning);
  }

  return hasOwnMeaning(state) ? trimOrEmpty(state.ownMeaning) : "";
}

function getDisplayedMeaning(state) {
  return state && hasMeaningText(state.displayMeaning) ? trimOrEmpty(state.displayMeaning) : "";
}

function isImportedDisplayMeaning(state) {
  return Boolean(state) && state.displayMeaningSource === DISPLAY_MEANING_SOURCES.IMPORTED;
}

function clearImportedDisplay(state) {
  state.importedSourceRowId = "";
  state.importedSourceTimestamp = null;
}

function syncDisplayMeaning(state, importedMatch = null) {
  if (!state) {
    return;
  }

  const localMeaning = getPreferredOwnMeaning(state);
  const importedMeaning = importedMatch && hasMeaningText(importedMatch.meaning)
    ? trimOrEmpty(importedMatch.meaning)
    : "";

  if (localMeaning) {
    state.displayMeaning = localMeaning;
    state.displayMeaningSource = DISPLAY_MEANING_SOURCES.OWN;
    clearImportedDisplay(state);
    return;
  }

  if (importedMeaning) {
    state.displayMeaning = importedMeaning;
    state.displayMeaningSource = DISPLAY_MEANING_SOURCES.IMPORTED;
    state.importedSourceRowId = trimOrEmpty(importedMatch.rowId);
    state.importedSourceTimestamp = getActivityTimestamp(importedMatch);
    return;
  }

  if (localMeaning) {
    state.displayMeaning = localMeaning;
    state.displayMeaningSource = DISPLAY_MEANING_SOURCES.OWN;
    clearImportedDisplay(state);
    return;
  }

  state.displayMeaning = null;
  state.displayMeaningSource = DISPLAY_MEANING_SOURCES.NONE;
  clearImportedDisplay(state);
}

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

class RuleEngine {
  constructor() {
    this.transitionRules = [];
    this.wordEndBans = new Set();
    this.syllableEndBans = new Set();
  }

  addWordRule(triggerSymbol, blockedNextSymbols) {
    this.addTransitionRule("word", triggerSymbol, blockedNextSymbols);
  }

  addSyllableRule(triggerSymbol, blockedNextSymbols) {
    this.addTransitionRule("syllable", triggerSymbol, blockedNextSymbols);
  }

  addBoundaryRule(triggerSymbol, blockedNextSymbols) {
    this.addTransitionRule("boundary", triggerSymbol, blockedNextSymbols);
  }

  addWordEndBan(symbol) {
    this.wordEndBans.add(symbol);
  }

  addSyllableEndBan(symbol) {
    this.syllableEndBans.add(symbol);
  }

  addTransitionRule(scope, triggerSymbol, blockedNextSymbols) {
    const blocked = Array.isArray(blockedNextSymbols) ? blockedNextSymbols : [blockedNextSymbols];
    this.transitionRules.push({
      scope,
      triggerSymbol,
      blockedNextSymbols: [...new Set(blocked)]
    });
  }

  resolveBlockedNextSymbols(triggerSymbol, relationToNext) {
    const blocked = [];

    for (const rule of this.transitionRules) {
      if (rule.triggerSymbol !== triggerSymbol) {
        continue;
      }

      if (!this.matchesScope(rule.scope, relationToNext)) {
        continue;
      }

      blocked.push(...rule.blockedNextSymbols);
    }

    return [...new Set(blocked)];
  }

  matchesScope(scope, relationToNext) {
    if (relationToNext === RELATIONS.NONE) {
      return false;
    }

    if (scope === "word") {
      return relationToNext === RELATIONS.SAME_SYLLABLE || relationToNext === RELATIONS.BOUNDARY;
    }

    if (scope === "syllable") {
      return relationToNext === RELATIONS.SAME_SYLLABLE;
    }

    if (scope === "boundary") {
      return relationToNext === RELATIONS.BOUNDARY;
    }

    return false;
  }

  isWordEndBanned(symbol) {
    return this.wordEndBans.has(symbol);
  }

  isSyllableEndBanned(symbol) {
    return this.syllableEndBans.has(symbol);
  }
}

class PoolManager {
  constructor(vowelSymbols, consonantSymbols) {
    this.basePools = {
      [SLOT_TYPES.VOWEL]: vowelSymbols.map((symbol) => symbol.symbol),
      [SLOT_TYPES.CONSONANT]: consonantSymbols.map((symbol) => symbol.symbol)
    };

    this.symbolByType = {
      [SLOT_TYPES.VOWEL]: new Map(vowelSymbols.map((entry) => [entry.symbol, entry])),
      [SLOT_TYPES.CONSONANT]: new Map(consonantSymbols.map((entry) => [entry.symbol, entry]))
    };

    this.workingPools = {
      [SLOT_TYPES.VOWEL]: new Set(this.basePools[SLOT_TYPES.VOWEL]),
      [SLOT_TYPES.CONSONANT]: new Set(this.basePools[SLOT_TYPES.CONSONANT])
    };

    this.activeEvents = [];
    this.eventLog = [];
  }

  resetWordAttempt() {
    this.workingPools[SLOT_TYPES.VOWEL] = new Set(this.basePools[SLOT_TYPES.VOWEL]);
    this.workingPools[SLOT_TYPES.CONSONANT] = new Set(this.basePools[SLOT_TYPES.CONSONANT]);
    this.activeEvents = [];
    this.eventLog = [];
  }

  getCandidates(slotType) {
    const entries = this.symbolByType[slotType];
    const symbols = this.workingPools[slotType];
    return [...symbols].map((symbol) => entries.get(symbol));
  }

  applyNextPickRestrictions(slotType, blockedSymbols) {
    if (!blockedSymbols || blockedSymbols.length === 0) {
      return;
    }

    const removedSymbols = [];
    for (const symbol of blockedSymbols) {
      if (this.workingPools[slotType].has(symbol)) {
        this.workingPools[slotType].delete(symbol);
        removedSymbols.push(symbol);
      }
    }

    if (removedSymbols.length === 0) {
      return;
    }

    const event = { slotType, removedSymbols };
    this.activeEvents.push(event);
    this.eventLog.push(event);
  }

  restorePendingRestrictions() {
    for (const event of this.activeEvents) {
      for (const symbol of event.removedSymbols) {
        this.workingPools[event.slotType].add(symbol);
      }
    }

    this.activeEvents = [];
  }
}

function setGenerationStatus(message, isError = true) {
  if (!generationStatus) {
    return;
  }

  const hasMessage = hasMeaningText(message);
  generationStatus.textContent = hasMessage ? trimOrEmpty(message) : "";
  generationStatus.classList.toggle("is-hidden", !hasMessage);
  generationStatus.classList.toggle("is-error", Boolean(hasMessage && isError));
}

function syncGenerationAvailability(min, max) {
  ruleConfigCompatibility = evaluateRuleConfigCompatibility(activeRuleConfig, min, max);
  if (prefixStatus) prefixStatus.textContent = "";
  if (ruleConfigCompatibility.isReady && (wordPrefixInput.value.trim() || wordSuffixInput.value.trim() || generatorConstraints.enabled())) {
    const prefixValidation = window.SECRET_PREFIX_GENERATOR.search(activeRuleConfig, wordPrefixInput.value, min, max,
      false, new Set(), { suffix: wordSuffixInput.value });
    prefixStatus.textContent = prefixValidation.message || "";
    if (!prefixValidation.ready) ruleConfigCompatibility = { isReady: false, message: prefixValidation.message };
  }
  if (ruleConfigCompatibility.isReady && !generatorConstraints.ready()) {
    ruleConfigCompatibility = { isReady: false, message: "Dictionary counts are required for normalization. See Constraints for load status and Retry." };
  }

  if (generateBtn) {
    generateBtn.disabled = !ruleConfigCompatibility.isReady;
  }

  if (ruleConfigCompatibility.isReady) {
    setGenerationStatus("", false);
    return ruleConfigCompatibility;
  }

  setGenerationStatus(ruleConfigCompatibility.message || "Current generation rules are not available.");
  return ruleConfigCompatibility;
}

function applyGeneratorRuleConfig(config) {
  const nextConfig = cloneRuleConfig(config);
  activeRuleConfig = nextConfig;
  ruleEngine = new RuleEngine();
  poolManager = new PoolManager(nextConfig.vowels || [], nextConfig.consonants || []);

  for (const transitionRule of nextConfig.transitionRules || []) {
    ruleEngine.addTransitionRule(
      transitionRule.scope,
      transitionRule.triggerSymbol,
      transitionRule.blockedNextSymbols
    );
  }

  for (const symbol of nextConfig.wordEndBans || []) {
    ruleEngine.addWordEndBan(symbol);
  }

  for (const symbol of nextConfig.syllableEndBans || []) {
    ruleEngine.addSyllableEndBan(symbol);
  }
}

function reloadActiveGeneratorRules() {
  applyGeneratorRuleConfig(loadActiveRuleConfig());
  const { min, max } = clampSyllables(false);
  syncGenerationAvailability(min, max);
}

function getActivePatternOptions(position, total) {
  const patterns =
    activeRuleConfig && activeRuleConfig.syllablePatterns ? activeRuleConfig.syllablePatterns : {};

  if (total === 1) {
    return Array.isArray(patterns.single) ? patterns.single.filter(Boolean) : [];
  }

  if (position === 0) {
    return Array.isArray(patterns.initial) ? patterns.initial.filter(Boolean) : [];
  }

  if (position === total - 1) {
    return Array.isArray(patterns.final) ? patterns.final.filter(Boolean) : [];
  }

  return Array.isArray(patterns.medial) ? patterns.medial.filter(Boolean) : [];
}

function buildSyllablePattern(position, total) {
  const options = getActivePatternOptions(position, total);
  return options.length > 0 ? randomFrom(options) : null;
}

function buildWordSlots(syllablePatterns) {
  const slots = [];

  for (let syllableIndex = 0; syllableIndex < syllablePatterns.length; syllableIndex += 1) {
    const pattern = syllablePatterns[syllableIndex];
    for (const token of pattern) {
      slots.push({
        type: token,
        syllableIndex,
        relationToNext: RELATIONS.NONE
      });
    }
  }

  for (let i = 0; i < slots.length - 1; i += 1) {
    if (slots[i].syllableIndex === slots[i + 1].syllableIndex) {
      slots[i].relationToNext = RELATIONS.SAME_SYLLABLE;
    } else {
      slots[i].relationToNext = RELATIONS.BOUNDARY;
    }
  }

  return slots;
}

function clampSyllables(shouldPersist = true) {
  let min = Number(minInput.value);
  let max = Number(maxInput.value);

  if (!Number.isInteger(min)) {
    min = 1;
  }
  if (!Number.isInteger(max)) {
    max = min;
  }

  min = Math.max(1, Math.min(12, min));
  max = Math.max(1, Math.min(12, max));

  if (min > max) {
    [min, max] = [max, min];
  }

  minInput.value = String(min);
  maxInput.value = String(max);

  if (shouldPersist) {
    saveSyllableSettings({ min, max });
  }

  syncGenerationAvailability(min, max);
  return { min, max };
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
const hasAwsSdk = Boolean(awsRuntime && awsRuntime.hasAwsSdk);
const hasDocumentClient = Boolean(awsRuntime && awsRuntime.hasDocumentClient);
const isPlaybackConfigured = Boolean(awsRuntime && awsRuntime.isPlaybackConfigured);
const isHeartsConfigured = Boolean(awsRuntime && awsRuntime.isHeartsConfigured);

const getPollyClient =
  (awsRuntime && awsRuntime.getPollyClient) ||
  (() => null);
const getHeartsTableClient =
  (awsRuntime && awsRuntime.getHeartsTableClient) ||
  (() => null);
const ensureAwsCredentials =
  (awsRuntime && awsRuntime.ensureAwsCredentials) ||
  (() => Promise.resolve(false));
function getCurrentUserId() {
  const userId = trimOrEmpty(window.SECRET_CURRENT_USER && window.SECRET_CURRENT_USER.id);
  if (!userId) {
    throw new Error("A signed-in username is required.");
  }
  return userId;
}

function sortMatchesByActivityDesc(items) {
  return [...items].sort((a, b) => getActivityTimestamp(b) - getActivityTimestamp(a));
}

function sortMatchesByMeaningDesc(items) {
  return [...items].sort((a, b) => getMeaningTimestamp(b) - getMeaningTimestamp(a));
}

function findNewestNonEmptyMeaningMatch(items) {
  const sorted = sortMatchesByMeaningDesc(items);
  return sorted.find((item) => hasMeaningText(item.meaning)) || null;
}


async function scanWordMatches(word) {
  const currentHeartsTableClient = getHeartsTableClient();
  if (!currentHeartsTableClient) {
    return [];
  }

  const matches = [];
  let lastEvaluatedKey = undefined;

  do {
    const response = await currentHeartsTableClient
      .scan({
        TableName: awsConfig.heartsTableName,
        FilterExpression: "#word = :word",
        ExpressionAttributeNames: {
          "#rowId": "rowId",
          "#word": "word",
          "#pronunciation": "pronunciation",
          "#meaning": "meaning",
          "#hearted": "hearted",
          "#timestamp": "timestamp",
          "#updatedTimestamp": "updatedTimestamp",
          "#meaningUpdatedTimestamp": "meaningUpdatedTimestamp",
          "#user": "user",
          "#unheartedTimestamp": "unheartedTimestamp"
        },
        ExpressionAttributeValues: {
          ":word": word
        },
        ProjectionExpression:
          "#rowId, #word, #pronunciation, #meaning, #hearted, #timestamp, #updatedTimestamp, #meaningUpdatedTimestamp, #user, #unheartedTimestamp, definitionReview",
        ConsistentRead: true,
        ExclusiveStartKey: lastEvaluatedKey
      })
      .promise();

    if (Array.isArray(response.Items) && response.Items.length > 0) {
      matches.push(...response.Items);
    }

    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return matches;
}

function findNewestCurrentUserMatch(items, currentUserId) {
  if (!currentUserId) {
    return null;
  }

  return (
    sortMatchesByActivityDesc(items).find((item) => trimOrEmpty(item.user) === trimOrEmpty(currentUserId)) || null
  );
}

async function lookupWordState(word) {
  if (!isHeartsConfigured || !await ensureAwsCredentials()) return null;
  // The GSI may omit review metadata or lag behind a heart write. Read the
  // authoritative records for this spelling before applying dictionary state.
  const matches = await scanWordMatches(word);
  const currentUserId = getCurrentUserId();
  return { currentUserId, matches,
    currentUserMatch: findNewestCurrentUserMatch(matches, currentUserId),
    latestMeaningMatch: findNewestNonEmptyMeaningMatch(matches),
    latestImportedMeaningMatch: sortMatchesByMeaningDesc(matches).find(item =>
      trimOrEmpty(item.user) !== currentUserId && hasMeaningText(item.meaning)) || null };
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

async function putCurrentUserRecord(state) {
  generatorRevision++;
  const currentHeartsTableClient = getHeartsTableClient();
  if (!isHeartsConfigured || !currentHeartsTableClient) {
    throw new Error("Hearts persistence is not configured.");
  }

  const now = Date.now();
  const identityId = getCurrentUserId();
  const hasCanonicalRecord = Boolean(state.hasPersistedRecord && trimOrEmpty(state.recordRowId));
  state.user = identityId;
  state.recordRowId = trimOrEmpty(state.recordRowId) || buildCanonicalRecordRowId(identityId, state.word);
  if (!hasCanonicalRecord) {
    state.timestamp = now;
  }
  state.updatedTimestamp = now;

  const item = buildHeartTableItem(state);
  item.definitionReview = await SECRET_DEFINITIONS.save(currentHeartsTableClient,
    awsConfig.heartsTableName, item);

  state.hasPersistedRecord = true;
  generatorRevision++;
  generatorConstraints.remember(item);
  rememberGeneratorRecord(item);
}

async function persistHeartedState(state, hearted) {
  const now = Date.now();
  state.hearted = hearted;
  state.unheartedTimestamp = hearted ? null : now;
  if (!hearted && !state.hasPersistedRecord) {
    return;
  }

  await putCurrentUserRecord(state);
}

async function persistOwnMeaning(state, meaning) {
  state.ownMeaning = meaning;
  state.meaningUpdatedTimestamp = Date.now();
  await putCurrentUserRecord(state);
}

function clearSelection() {
  if (!selectedRowId) {
    return;
  }

  const previous = selectedRowId;
  selectedRowId = null;
  renderRow(previous);
}

function buildHeartTableItem(state) {
  return {
    rowId: state.recordRowId || state.rowId,
    timestamp: state.timestamp,
    user: state.user || null,
    word: state.word,
    pronunciation: state.ipa,
    meaning: state.ownMeaning || null,
    meaningUpdatedTimestamp: state.meaningUpdatedTimestamp ?? null,
    hearted: Boolean(state.hearted),
    updatedTimestamp: state.updatedTimestamp,
    unheartedTimestamp: state.unheartedTimestamp ?? null
  };
}

function stopAudio() {
  sharedAudio.pause();
  sharedAudio.currentTime = 0;
  clearPlayState();
}

function setSelectedRow(rowId) {
  if (!rowId || selectedRowId === rowId) {
    return;
  }

  const previous = selectedRowId;
  selectedRowId = rowId;

  if (playingRowId && playingRowId !== rowId) {
    stopAudio();
  }

  if (previous) {
    renderRow(previous);
  }

  renderRow(rowId);
}

function clearPlayState() {
  if (!playingRowId) {
    return;
  }

  const previous = playingRowId;
  playingRowId = null;
  renderRow(previous);
}

function createRowState(generated) {
  return {
    rowId: generated.rowId,
    recordRowId: "",
    timestamp: generated.timestamp,
    updatedTimestamp: generated.timestamp,
    unheartedTimestamp: null,
    user: "",
    word: generated.word,
    ipa: generated.ipa,
    hearted: false,
    dictionaryClassification: "undefined",
    wordRecords: [],
    ownMeaning: null,
    meaningUpdatedTimestamp: null,
    displayMeaning: null,
    displayMeaningSource: DISPLAY_MEANING_SOURCES.NONE,
    draftMeaning: "",
    draftUpdatedTimestamp: null,
    hasDraftCache: false,
    isEditing: false,
    saveStatus: "idle",
    copyFlash: false,
    hasPersistedRecord: false,
    importedSourceRowId: "",
    importedSourceTimestamp: null
  };
}

function clearPersistRowsTimer() {
  if (!persistRowsTimer) {
    return;
  }

  window.clearTimeout(persistRowsTimer);
  persistRowsTimer = null;
}

function removePersistedRowsStorage() {
  const storage = getLocalStorageHandle();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(LOCAL_STORAGE_ROWS_KEY);
  } catch (error) {
    console.error("Failed to clear generated rows local storage data.", error);
  }
}

function getLocalStorageHandle() {
  try {
    return window.localStorage;
  } catch (error) {
    return null;
  }
}

function saveSyllableSettings(settings) {
  const storage = getLocalStorageHandle();
  if (!storage || !settings || typeof settings !== "object") {
    return;
  }

  const min = Number(settings.min);
  const max = Number(settings.max);
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    return;
  }

  try {
    storage.setItem(
      LOCAL_STORAGE_SYLLABLE_SETTINGS_KEY,
      JSON.stringify({
        min,
        max
      })
    );
  } catch (error) {
    console.error("Failed to save syllable settings.", error);
  }
}

function loadPersistedSyllableSettings() {
  const storage = getLocalStorageHandle();
  if (!storage) {
    return;
  }

  try {
    const rawValue = storage.getItem(LOCAL_STORAGE_SYLLABLE_SETTINGS_KEY);
    if (!rawValue) {
      return;
    }

    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return;
    }

    if (typeof parsed.min !== "undefined") {
      minInput.value = String(parsed.min);
    }

    if (typeof parsed.max !== "undefined") {
      maxInput.value = String(parsed.max);
    }
  } catch (error) {
    console.error("Failed to load syllable settings.", error);
  }
}

function serializeRowState(state) {
  const timestamp = Number(state.timestamp);
  const normalizedTimestamp = Number.isFinite(timestamp) ? timestamp : Date.now();
  const updatedTimestamp = Number(state.updatedTimestamp);
  const normalizedUpdatedTimestamp = Number.isFinite(updatedTimestamp)
    ? updatedTimestamp
    : normalizedTimestamp;
  const importedTimestamp = Number(state.importedSourceTimestamp);
  const unheartedTimestamp = Number(state.unheartedTimestamp);
  const ownMeaning = trimOrEmpty(state.ownMeaning);
  const meaningUpdatedTimestamp = Number(state.meaningUpdatedTimestamp);
  const displayMeaning = trimOrEmpty(state.displayMeaning);
  const draftMeaning = typeof state.draftMeaning === "string" ? state.draftMeaning : "";
  const draftUpdatedTimestamp = Number(state.draftUpdatedTimestamp);

  return {
    rowId: state.rowId,
    recordRowId: trimOrEmpty(state.recordRowId),
    timestamp: normalizedTimestamp,
    updatedTimestamp: normalizedUpdatedTimestamp,
    unheartedTimestamp:
      state.unheartedTimestamp === null || typeof state.unheartedTimestamp === "undefined"
        ? null
        : Number.isFinite(unheartedTimestamp)
          ? unheartedTimestamp
          : null,
    user: trimOrEmpty(state.user),
    word: state.word,
    ipa: state.ipa,
    hearted: Boolean(state.hearted),
    dictionaryClassification: state.dictionaryClassification || "undefined",
    ownMeaning: ownMeaning || null,
    meaningUpdatedTimestamp:
      ownMeaning && Number.isFinite(meaningUpdatedTimestamp) ? meaningUpdatedTimestamp : null,
    displayMeaning: displayMeaning || null,
    displayMeaningSource: trimOrEmpty(state.displayMeaningSource),
    draftMeaning,
    draftUpdatedTimestamp: Number.isFinite(draftUpdatedTimestamp) ? draftUpdatedTimestamp : null,
    hasDraftCache: Boolean(state.hasDraftCache),
    hasPersistedRecord: Boolean(state.hasPersistedRecord),
    importedSourceRowId: trimOrEmpty(state.importedSourceRowId),
    importedSourceTimestamp: Number.isFinite(importedTimestamp) ? importedTimestamp : null
  };
}

function deserializeRowState(rawState) {
  if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) {
    return null;
  }

  const rowId = trimOrEmpty(rawState.rowId);
  const word = trimOrEmpty(rawState.word);
  const ipa = trimOrEmpty(rawState.ipa);
  if (!rowId || !word || !ipa) {
    return null;
  }

  const rawTimestamp = Number(rawState.timestamp);
  const timestamp = Number.isFinite(rawTimestamp) ? rawTimestamp : Date.now();

  const rawUpdatedTimestamp = Number(rawState.updatedTimestamp);
  const updatedTimestamp = Number.isFinite(rawUpdatedTimestamp) ? rawUpdatedTimestamp : timestamp;

  const rawUnheartedTimestamp = Number(rawState.unheartedTimestamp);
  const unheartedTimestamp =
    rawState.unheartedTimestamp === null || typeof rawState.unheartedTimestamp === "undefined"
      ? null
      : Number.isFinite(rawUnheartedTimestamp)
        ? rawUnheartedTimestamp
        : null;

  const ownMeaning = hasMeaningText(rawState.ownMeaning) ? trimOrEmpty(rawState.ownMeaning) : null;
  const rawMeaningUpdatedTimestamp = Number(rawState.meaningUpdatedTimestamp);
  const meaningUpdatedTimestamp = ownMeaning
    ? Number.isFinite(rawMeaningUpdatedTimestamp)
      ? rawMeaningUpdatedTimestamp
      : updatedTimestamp
    : null;
  const displayMeaning = hasMeaningText(rawState.displayMeaning)
    ? trimOrEmpty(rawState.displayMeaning)
    : ownMeaning;
  const displayMeaningSource = trimOrEmpty(rawState.displayMeaningSource);
  const draftMeaning = typeof rawState.draftMeaning === "string" ? rawState.draftMeaning : "";
  const rawDraftUpdatedTimestamp = Number(rawState.draftUpdatedTimestamp);
  const draftUpdatedTimestamp = Number.isFinite(rawDraftUpdatedTimestamp)
    ? rawDraftUpdatedTimestamp
    : null;

  const rawImportedSourceTimestamp = Number(rawState.importedSourceTimestamp);
  const importedSourceTimestamp = Number.isFinite(rawImportedSourceTimestamp)
    ? rawImportedSourceTimestamp
    : null;

  return {
    rowId,
    recordRowId: trimOrEmpty(rawState.recordRowId),
    timestamp,
    updatedTimestamp,
    unheartedTimestamp,
    user: trimOrEmpty(rawState.user),
    word,
    ipa,
    hearted: Boolean(rawState.hearted),
    dictionaryClassification: ["defined", "candidate", "undefined"].includes(rawState.dictionaryClassification)
      ? rawState.dictionaryClassification : "undefined",
    wordRecords: [],
    ownMeaning,
    meaningUpdatedTimestamp,
    displayMeaning,
    displayMeaningSource:
      displayMeaningSource === DISPLAY_MEANING_SOURCES.IMPORTED
        ? DISPLAY_MEANING_SOURCES.IMPORTED
        : displayMeaning
          ? DISPLAY_MEANING_SOURCES.OWN
          : DISPLAY_MEANING_SOURCES.NONE,
    draftMeaning,
    draftUpdatedTimestamp,
    hasDraftCache: Boolean(rawState.hasDraftCache) || draftMeaning.length > 0,
    isEditing: false,
    saveStatus: "idle",
    copyFlash: false,
    hasPersistedRecord: Boolean(rawState.hasPersistedRecord),
    importedSourceRowId: trimOrEmpty(rawState.importedSourceRowId),
    importedSourceTimestamp:
      displayMeaningSource === DISPLAY_MEANING_SOURCES.IMPORTED ? importedSourceTimestamp : null
  };
}

function getPersistedRowStatesInDisplayOrder() {
  const rows = [];
  const rowElements = resultsList.querySelectorAll(".result-row");

  for (const rowElement of rowElements) {
    const rowId = rowElement.dataset.rowId;
    if (!rowId) {
      continue;
    }

    const state = rowStateById.get(rowId);
    if (!state) {
      continue;
    }

    rows.push(serializeRowState(state));

    if (rows.length >= MAX_RESULTS) {
      break;
    }
  }

  return rows;
}

function savePersistedRows() {
  const rows = getPersistedRowStatesInDisplayOrder();
  if (rows.length === 0) {
    removePersistedRowsStorage();
    return;
  }

  const storage = getLocalStorageHandle();
  if (!storage) {
    return;
  }

  const payload = {
    version: LOCAL_STORAGE_ROWS_VERSION,
    rows
  };

  try {
    storage.setItem(LOCAL_STORAGE_ROWS_KEY, JSON.stringify(payload));
  } catch (error) {
    console.error("Failed to save generated rows to local storage.", error);
  }
}

function flushPersistedRowsSave() {
  clearPersistRowsTimer();
  savePersistedRows();
}

function schedulePersistedRowsSave() {
  clearPersistRowsTimer();
  persistRowsTimer = window.setTimeout(() => {
    persistRowsTimer = null;
    savePersistedRows();
  }, PERSIST_SAVE_DEBOUNCE_MS);
}

function loadPersistedRows() {
  const storage = getLocalStorageHandle();
  if (!storage) {
    return [];
  }

  try {
    const rawValue = storage.getItem(LOCAL_STORAGE_ROWS_KEY);
    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }

    if (parsed.version !== LOCAL_STORAGE_ROWS_VERSION || !Array.isArray(parsed.rows)) {
      return [];
    }

    const rows = [];
    for (const rawState of parsed.rows) {
      const state = deserializeRowState(rawState);
      if (!state) {
        continue;
      }

      rows.push(state);
      if (rows.length >= MAX_RESULTS) {
        break;
      }
    }

    return rows;
  } catch (error) {
    console.error("Failed to load generated rows from local storage.", error);

    try {
      storage.removeItem(LOCAL_STORAGE_ROWS_KEY);
    } catch (removeError) {
      console.error("Failed to clear invalid generated rows local storage data.", removeError);
    }

    return [];
  }
}

function restorePersistedRows() {
  const persistedRows = loadPersistedRows();
  if (persistedRows.length === 0) {
    return;
  }

  let skippedRows = 0;
  for (const state of persistedRows) {
    if (rowStateById.has(state.rowId) || generatedWords.has(state.word)) {
      skippedRows += 1;
      continue;
    }

    syncDisplayMeaning(state);
    const row = createResultRow(state);
    rowStateById.set(state.rowId, state);
    generatedWords.add(state.word);
    resultsList.append(row);
    renderRow(state.rowId);
    void hydrateWordState(state.rowId);
  }

  if (skippedRows > 0) {
    savePersistedRows();
  }
}

function clearAllResults() {
  if (generatorDefinitionPicker && !generatorDefinitionPicker.close()) return;
  generatorPickerRowId = null;
  clearPersistRowsTimer();

  const rowIds = Array.from(copyFeedbackTimers.keys());
  for (const rowId of rowIds) {
    clearCopyFeedback(rowId);
  }

  clearSelection();
  stopAudio();

  rowStateById.clear();
  generatedWords.clear();
  audioCache.clear();
  resultsList.textContent = "";

  selectedRowId = null;
  playingRowId = null;

  removePersistedRowsStorage();
}

function handleClearAllClick() {
  clearAllResults();
}

function createResultRow(state) {
  const item = document.createElement("li");
  item.className = "result-row";
  item.dataset.rowId = state.rowId;
  item.dataset.word = state.word;
  item.dataset.ipa = state.ipa;

  const actions = document.createElement("div");
  actions.className = "row-actions";

  const heartButton = createActionButton("heart-btn", "♡", "Save word", "toggle-heart");
  if (!isHeartsConfigured) {
    heartButton.classList.add("is-hidden");
  }

  const copyButton = createActionButton("copy-btn", "⧉", "Copy word details", "copy-word");

  const playButton = createActionButton("play-btn", "▶", "Play pronunciation", "play-pronunciation");
  if (!isPlaybackConfigured) {
    playButton.classList.add("is-hidden");
  }

  actions.append(playButton, heartButton);

  const content = document.createElement("div");
  content.className = "row-content";

  const wordSpan = document.createElement("span");
  wordSpan.className = "word";
  wordSpan.textContent = state.word;

  const ipaSpan = document.createElement("span");
  ipaSpan.className = "ipa";
  ipaSpan.textContent = `/${state.ipa}/`;

  content.append(wordSpan, ipaSpan);

  const meaning = document.createElement("div");
  meaning.className = "row-meaning";

  const copySlot = document.createElement("div");
  copySlot.className = "row-copy";
  copySlot.append(copyButton);

  item.append(actions, content, meaning, copySlot);
  return item;
}

function applyCurrentUserMatchToState(state, match) {
  if (!state || !match) {
    return;
  }
  if (state.saveStatus !== "idle") return;

  // Capture before hasPersistedRecord/timestamp are changed: a newly generated
  // suggestion is not a local edit newer than its existing dictionary record.
  const localTimestamp = getLocalUserStateTimestamp(state);
  state.user = trimOrEmpty(match.user) || state.user;
  state.recordRowId = trimOrEmpty(match.rowId) || state.recordRowId;
  state.hasPersistedRecord = true;
  state.timestamp = toEpochMs(match.timestamp) || state.timestamp;
  state.ipa = trimOrEmpty(match.pronunciation || match.ipa) || state.ipa;

  if (localTimestamp > getActivityTimestamp(match)) {
    return;
  }

  state.updatedTimestamp = toEpochMs(match.updatedTimestamp) || toEpochMs(match.timestamp) || state.updatedTimestamp;
  state.unheartedTimestamp = toEpochMs(match.unheartedTimestamp) || null;
  state.hearted = Boolean(match.hearted);
  state.ownMeaning = hasMeaningText(match.meaning) ? trimOrEmpty(match.meaning) : null;
  state.meaningUpdatedTimestamp = state.ownMeaning
    ? toEpochMs(match.meaningUpdatedTimestamp) || getActivityTimestamp(match)
    : null;
  if (!state.isEditing && getDraftMeaningTimestamp(state) <= getActivityTimestamp(match)) {
    state.draftMeaning = state.ownMeaning || "";
    state.draftUpdatedTimestamp = null;
    state.hasDraftCache = hasMeaningText(state.draftMeaning);
  }
}

async function hydrateWordState(rowId) {
  if (!isHeartsConfigured) {
    return;
  }

  const initialState = rowStateById.get(rowId);
  if (!initialState) {
    return;
  }

  const revision = generatorRevision;
  try {
    const lookup = await lookupWordState(initialState.word);
    if (!lookup) {
      return;
    }

    const currentState = rowStateById.get(rowId);
    if (!currentState) {
      return;
    }
    if (revision !== generatorRevision || currentState.saveStatus !== "idle" || generatorDefinitionPicker?.isOpen()) {
      if (generatorSync) void generatorSync.request();
      return;
    }

    applyCurrentUserMatchToState(currentState, lookup.currentUserMatch);
    applyGeneratorDictionaryMatches(currentState, lookup.matches);
    syncDisplayMeaning(currentState, lookup.latestImportedMeaningMatch || lookup.latestMeaningMatch);
    renderRow(rowId);
    flushPersistedRowsSave();
  } catch (error) {
    console.error("Failed to hydrate generated word state.", error);
  }
}

function applyGeneratorDictionaryMatches(state, matches) {
  state.wordRecords = [...matches];
  state.dictionaryClassification = SECRET_DEFINITIONS.classification(findNewestNonEmptyMeaningMatch(matches));
  state.otherHeartUsers = [...new Set(matches
    .filter(item => item.hearted && SECRET_DEFINITIONS.namedUserId(item.user) &&
      SECRET_DEFINITIONS.namedUserId(item.user) !== SECRET_DEFINITIONS.namedUserId(getCurrentUserId()))
    .map(item => SECRET_DEFINITIONS.namedUserId(item.user)))];
}

function rememberGeneratorRecord(item) {
  for (const state of rowStateById.values()) {
    if (state.word !== item.word) continue;
    const matches = (state.wordRecords || []).filter(record =>
      record.rowId !== item.rowId || record.timestamp !== item.timestamp).concat(item);
    applyGeneratorDictionaryMatches(state, matches);
    syncDisplayMeaning(state, findNewestNonEmptyMeaningMatch(matches));
    renderRow(state.rowId);
  }
}

async function readGeneratorDefinitionRequests() {
  if (!isHeartsConfigured || !await ensureAwsCredentials()) throw new Error("Database access is unavailable.");
  const items = [];
  let cursor;
  do {
    const page = await getHeartsTableClient().scan({ TableName: awsConfig.heartsTableName,
      ConsistentRead: true, ...(cursor ? { ExclusiveStartKey: cursor } : {}) }).promise();
    items.push(...(page.Items || [])); cursor = page.LastEvaluatedKey;
  } while (cursor);
  return items;
}

function getGeneratorDefinitionPicker() {
  if (!generatorDefinitionPicker) generatorDefinitionPicker = SECRET_DEFINITION_PICKER.create({
    client: getHeartsTableClient, table: awsConfig.heartsTableName, user: getCurrentUserId,
    read: readGeneratorDefinitionRequests,
    onMutation: () => { generatorRevision++; },
    onChange: () => {
      const rowId = generatorPickerRowId;
      if (!generatorDefinitionPicker.isOpen()) generatorPickerRowId = null;
      if (rowId) renderRow(rowId);
      if (!generatorDefinitionPicker.isOpen() && generatorSync) void generatorSync.request();
    },
    onAssigned: item => {
      generatorRevision++;
      const state = rowStateById.get(generatorPickerRowId);
      generatorPickerRowId = null;
      if (state) {
        state.isEditing = false;
        applyCurrentUserMatchToState(state, item);
      }
      rememberGeneratorRecord(item);
      generatorConstraints.remember(item);
      flushPersistedRowsSave();
      if (generatorSync) void generatorSync.request();
    }
  });
  return generatorDefinitionPicker;
}

async function openGeneratorDefinitionPicker(rowId) {
  const state = rowStateById.get(rowId);
  if (!state?.hearted || state.saveStatus !== "idle" ||
      generatorDefinitionPicker?.isOpen()) return;
  state.definitionError = ""; state.saveStatus = "loading-definitions"; renderRow(rowId);
  try {
    const items = await readGeneratorDefinitionRequests();
    if (!rowStateById.has(rowId)) return;
    applyGeneratorDictionaryMatches(state, items.filter(item => item.word === state.word && item.pronunciation));
    generatorConstraints.accept(items);
    syncDisplayMeaning(state, findNewestNonEmptyMeaningMatch(state.wordRecords));
    const picker = getGeneratorDefinitionPicker();
    picker.load(items); generatorPickerRowId = rowId; state.saveStatus = "idle";
    picker.open(state.word, state.ipa, { hearted: state.hearted });
    const row = resultsList.querySelector(`.result-row[data-row-id="${rowId}"]`);
    row?.querySelector(".definition-picker select")?.focus();
  } catch (error) {
    state.definitionError = `Could not load requested definitions: ${error.message} Try Select a definition again.`;
  } finally {
    state.saveStatus = "idle";
    // Opening already rendered and focused the picker; avoid rebuilding it.
    if (generatorPickerRowId !== rowId) renderRow(rowId);
  }
}

function renderMeaning(row, state) {
  const container = row.querySelector(".row-meaning");
  if (!container) {
    return;
  }

  container.textContent = "";
  const isSelected = selectedRowId === state.rowId;
  const isSaving = state.saveStatus !== "idle";
  const displayMeaning = getDisplayedMeaning(state);
  if (state.definitionError) {
    const error = document.createElement("p");
    error.className = "generator-definition-error";
    error.setAttribute("role", "status"); error.textContent = state.definitionError;
    container.appendChild(error);
  }

  if (displayMeaning) {
    const definition = document.createElement("span");
    definition.className = "meaning-definition";
    definition.textContent = `— ${displayMeaning}`;
    container.appendChild(definition);
  }
  if (generatorPickerRowId === state.rowId && generatorDefinitionPicker?.isOpen()) {
    const picker = generatorDefinitionPicker.render(state.word);
    if (picker) container.appendChild(picker);
    return;
  }

  const canEditMeaning =
    isHeartsConfigured &&
    (state.hearted || hasOwnMeaning(state) || isImportedDisplayMeaning(state) || getDraftMeaningTimestamp(state) > 0);
  if (!canEditMeaning) {
    return;
  }

  if (state.isEditing && isSelected) {
    const editor = document.createElement("div");
    editor.className = "meaning-editor";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "meaning-input";
    input.placeholder = "What does this word mean?";
    input.value = state.draftMeaning;

    const saveButton = createActionButton("meaning-action is-save", "✓", "Save meaning", "save-meaning");
    const cancelButton = createActionButton(
      "meaning-action",
      "✕",
      "Cancel meaning edit",
      "cancel-meaning"
    );

    if (isSaving) {
      input.disabled = true;
      saveButton.disabled = true;
      cancelButton.disabled = true;
    }

    editor.append(input, saveButton, cancelButton);
    container.appendChild(editor);

    return;
  }

  if (!isSelected && !state.hearted) {
    return;
  }

  const link = document.createElement("button");
  link.type = "button";
  link.className = "meaning-link";
  link.dataset.action = "open-meaning-editor";
  link.textContent = hasOwnMeaning(state) || hasMeaningText(state.draftMeaning) ? "Edit my meaning" : "Write a definition";
  link.disabled = isSaving;
  container.appendChild(link);
  if (state.hearted) {
    const select = document.createElement("button");
    select.type = "button"; select.className = "meaning-link";
    select.dataset.action = "select-definition"; select.textContent = "Select a definition";
    select.disabled = isSaving;
    container.appendChild(select);
  }
}

function renderRow(rowId) {
  const state = rowStateById.get(rowId);
  const row = resultsList.querySelector(`.result-row[data-row-id="${rowId}"]`);
  if (!state || !row) {
    return;
  }

  if (sharedUi.deferEditorRender(row, () => renderRow(rowId))) return;

  row.classList.toggle("is-selected", selectedRowId === rowId);
  const word = row.querySelector(".word");
  if (word) {
    for (const category of ["defined", "candidate", "undefined"]) {
      word.classList.toggle(`is-${category}`, (state.dictionaryClassification || "undefined") === category);
    }
    word.title = `Dictionary state: ${state.dictionaryClassification || "undefined"}`;
  }
  const sharedHearts = SECRET_DEFINITIONS.sharedHearts([
      ...(state.otherHeartUsers || []).map(user => ({ user, hearted: true })),
      { user: getCurrentUserId(), hearted: state.hearted }
    ]);

  const heartButton = row.querySelector(".heart-btn");
  if (heartButton) {
    heartButton.classList.toggle("is-hearted", state.hearted);
    heartButton.classList.toggle("has-shared-hearts", sharedHearts);
    heartButton.title = sharedHearts ? "Hearted by multiple named users" : "";
    heartButton.textContent = state.hearted ? "❤" : "♡";
    heartButton.setAttribute("aria-label", state.hearted ? "Remove saved word" : "Save word");
    heartButton.disabled = state.saveStatus !== "idle";
  }

  const copyButton = row.querySelector(".copy-btn");
  if (copyButton) {
    copyButton.classList.toggle("is-success", state.copyFlash);
    copyButton.textContent = state.copyFlash ? "✓" : copyButton.dataset.icon;
  }

  const playButton = row.querySelector(".play-btn");
  if (playButton) {
    const isPlaying = playingRowId === rowId;
    playButton.classList.toggle("is-playing", isPlaying);
    playButton.classList.remove("is-loading");
    playButton.textContent = isPlaying ? "■" : playButton.dataset.icon;
  }

  const savedEditor = sharedUi.captureEditor(row);
  renderMeaning(row, state);
  sharedUi.restoreEditor(row, savedEditor);
}

function clearCopyFeedback(rowId) {
  const timer = copyFeedbackTimers.get(rowId);
  if (timer) {
    clearTimeout(timer);
    copyFeedbackTimers.delete(rowId);
  }
}

function showCopySuccess(rowId) {
  const state = rowStateById.get(rowId);
  if (!state) {
    return;
  }

  clearCopyFeedback(rowId);
  state.copyFlash = true;
  renderRow(rowId);

  const timer = window.setTimeout(() => {
    const current = rowStateById.get(rowId);
    if (!current) {
      return;
    }

    current.copyFlash = false;
    renderRow(rowId);
    copyFeedbackTimers.delete(rowId);
  }, COPY_FEEDBACK_MS);

  copyFeedbackTimers.set(rowId, timer);
}

async function playPronunciation(rowId) {
  if (!isPlaybackConfigured) {
    return;
  }

  const state = rowStateById.get(rowId);
  const row = resultsList.querySelector(`.result-row[data-row-id="${rowId}"]`);
  if (!state || !row) {
    return;
  }

  const button = row.querySelector(".play-btn");
  if (!button || button.classList.contains("is-hidden")) {
    return;
  }

  if (playingRowId === rowId && !sharedAudio.paused) {
    stopAudio();
    return;
  }

  if (playingRowId && playingRowId !== rowId) {
    stopAudio();
  }

  button.classList.add("is-loading");
  button.textContent = "…";

  try {
    const audioUrl = await synthesize(state.word, state.ipa);
    if (!audioUrl) {
      button.classList.remove("is-loading");
      button.textContent = button.dataset.icon;
      return;
    }

    sharedAudio.pause();
    sharedAudio.currentTime = 0;
    sharedAudio.src = audioUrl;

    await sharedAudio.play();

    playingRowId = rowId;
    renderRow(rowId);
  } catch (error) {
    button.classList.remove("is-loading");
    button.textContent = button.dataset.icon;
    console.error("Failed to synthesize or play pronunciation.", error);
  }
}

async function handleToggleHeart(rowId) {
  const state = rowStateById.get(rowId);
  if (!state || !isHeartsConfigured || state.saveStatus !== "idle" || generatorDefinitionPicker?.isOpen()) {
    return;
  }

  const previousHearted = state.hearted;
  const previousEditing = state.isEditing;

  if (state.hearted) {
    state.hearted = false;
  } else {
    state.hearted = true;
  }
  state.isEditing = false;
  state.saveStatus = "saving-heart";
  renderRow(rowId);

  try {
    await persistHeartedState(state, state.hearted);
  } catch (error) {
    state.hearted = previousHearted;
    state.isEditing = previousEditing;
    console.error("Failed to persist heart state.", error);
  } finally {
    state.saveStatus = "idle";
    renderRow(rowId);
    flushPersistedRowsSave();
  }
}

function openMeaningEditor(rowId) {
  const state = rowStateById.get(rowId);
  if (
    !state ||
    !isHeartsConfigured ||
    (!state.hearted &&
      !hasOwnMeaning(state) &&
      !isImportedDisplayMeaning(state) &&
      !hasMeaningText(state.draftMeaning))
  ) {
    return;
  }

  if (!state.hasDraftCache) {
    state.draftMeaning = state.ownMeaning || "";
    state.hasDraftCache = true;
    state.draftUpdatedTimestamp = null;
  }

  state.isEditing = true;
  renderRow(rowId);
  const row = resultsList.querySelector(`[data-row-id="${rowId}"]`);
  const input = row && row.querySelector(".meaning-input");
  if (input) input.focus();
}

function closeMeaningEditor(rowId) {
  const state = rowStateById.get(rowId);
  if (!state) {
    return;
  }

  state.isEditing = false;
  renderRow(rowId);
}

async function handleSaveMeaning(rowId) {
  const state = rowStateById.get(rowId);
  if (
    !state ||
    !isHeartsConfigured ||
    (!state.hearted &&
      !hasOwnMeaning(state) &&
      !isImportedDisplayMeaning(state) &&
      !hasMeaningText(state.draftMeaning))
  ) {
    return;
  }

  const trimmedMeaning = trimOrEmpty(state.draftMeaning);
  if (!trimmedMeaning) {
    closeMeaningEditor(rowId);
    return;
  }

  const previousOwnMeaning = state.ownMeaning;
  const previousMeaningUpdatedTimestamp = state.meaningUpdatedTimestamp;
  const previousDisplayMeaning = state.displayMeaning;
  const previousDisplayMeaningSource = state.displayMeaningSource;
  const previousEditing = state.isEditing;
  const previousHearted = state.hearted;
  const previousImportedSourceRowId = state.importedSourceRowId;
  const previousImportedSourceTimestamp = state.importedSourceTimestamp;
  const previousUpdatedTimestamp = state.updatedTimestamp;
  const previousDraftUpdatedTimestamp = state.draftUpdatedTimestamp;

  state.ownMeaning = trimmedMeaning;
  state.draftMeaning = trimmedMeaning;
  state.draftUpdatedTimestamp = Date.now();
  state.hasDraftCache = true;
  state.isEditing = false;
  syncDisplayMeaning(state);
  state.saveStatus = "saving-meaning";
  renderRow(rowId);

  try {
    await persistOwnMeaning(state, trimmedMeaning);
  } catch (error) {
    state.ownMeaning = previousOwnMeaning;
    state.meaningUpdatedTimestamp = previousMeaningUpdatedTimestamp;
    state.displayMeaning = previousDisplayMeaning;
    state.displayMeaningSource = previousDisplayMeaningSource;
    state.isEditing = previousEditing;
    state.hearted = previousHearted;
    state.importedSourceRowId = previousImportedSourceRowId;
    state.importedSourceTimestamp = previousImportedSourceTimestamp;
    state.updatedTimestamp = previousUpdatedTimestamp;
    state.draftUpdatedTimestamp = previousDraftUpdatedTimestamp;
    console.error("Failed to save meaning.", error);
  } finally {
    state.saveStatus = "idle";
    renderRow(rowId);
    flushPersistedRowsSave();
  }
}

function handleMeaningInput(event) {
  const input = event.target.closest(".meaning-input");
  if (!input) {
    return;
  }

  const row = input.closest(".result-row");
  if (!row) {
    return;
  }

  const state = rowStateById.get(row.dataset.rowId);
  if (!state) {
    return;
  }

  state.draftMeaning = input.value;
  state.hasDraftCache = true;
  state.draftUpdatedTimestamp = Date.now();
  schedulePersistedRowsSave();
}

function handleMeaningInputKeydown(event) {
  const input = event.target.closest(".meaning-input");
  if (!input) {
    return;
  }

  const row = input.closest(".result-row");
  if (!row) {
    return;
  }

  const rowId = row.dataset.rowId;
  if (!rowId) {
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    void handleSaveMeaning(rowId);
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeMeaningEditor(rowId);
  }
}

function buildWord(min, max) {
  if (!poolManager || !ruleEngine) {
    return null;
  }

  const syllableCount = Math.floor(Math.random() * (max - min + 1)) + min;
  const syllablePatterns = [];
  for (let i = 0; i < syllableCount; i += 1) {
    const pattern = buildSyllablePattern(i, syllableCount);
    if (!pattern) {
      return null;
    }

    syllablePatterns.push(pattern);
  }

  const slots = buildWordSlots(syllablePatterns);
  const symbolsBySyllable = Array.from({ length: syllableCount }, () => []);
  const ipaBySyllable = Array.from({ length: syllableCount }, () => []);
  const symbols = [];

  poolManager.resetWordAttempt();

  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    let candidates = poolManager.getCandidates(slot.type);
    const slotEndsSyllable =
      slot.relationToNext === RELATIONS.BOUNDARY || slot.relationToNext === RELATIONS.NONE;

    if (slotEndsSyllable) {
      candidates = candidates.filter((candidate) => !ruleEngine.isSyllableEndBanned(candidate.symbol));
    }

    if (candidates.length === 0) {
      poolManager.resetWordAttempt();
      return null;
    }

    const selected = randomFrom(candidates);
    symbols.push(selected.symbol);
    symbolsBySyllable[slot.syllableIndex].push(selected.symbol);
    ipaBySyllable[slot.syllableIndex].push(selected.ipa);

    poolManager.restorePendingRestrictions();

    const nextSlot = slots[i + 1];
    if (nextSlot) {
      const blockedSymbols = ruleEngine.resolveBlockedNextSymbols(selected.symbol, slot.relationToNext);
      poolManager.applyNextPickRestrictions(nextSlot.type, blockedSymbols);
    }
  }

  poolManager.resetWordAttempt();

  const lastSymbol = symbols[symbols.length - 1];
  if (ruleEngine.isWordEndBanned(lastSymbol)) {
    return null;
  }

  return {
    rowId: createRowId(),
    timestamp: Date.now(),
    word: symbolsBySyllable.map((syllable) => syllable.join("")).join(""),
    ipa: ipaBySyllable.map((syllable) => syllable.join("")).join("."),
    symbols,
    syllables: symbolsBySyllable.map((syllable) => [...syllable])
  };
}

function generateUniqueWord(min, max) {
  if (wordPrefixInput.value.trim() || wordSuffixInput.value.trim() || generatorConstraints.enabled()) {
    const result = window.SECRET_PREFIX_GENERATOR.search(activeRuleConfig, wordPrefixInput.value,
      min, max, true, generatedWords, generatorConstraints.options());
    if (!result.candidate) setGenerationStatus(result.message);
    return result.candidate ? { ...result.candidate, rowId: createRowId(), timestamp: Date.now() } : null;
  }
  for (let attempt = 0; attempt < RETRY_LIMIT; attempt += 1) {
    const candidate = buildWord(min, max);
    if (candidate && !generatedWords.has(candidate.word)) {
      return candidate;
    }
  }

  return null;
}

function removeOldestRowsIfNeeded() {
  let removedAnyRows = false;

  while (resultsList.children.length > MAX_RESULTS) {
    const oldest = resultsList.lastElementChild;
    if (!oldest) {
      break;
    }

    const oldestWord = oldest.dataset.word;
    const oldestRowId = oldest.dataset.rowId;
    if (oldestRowId === generatorPickerRowId) {
      if (!generatorDefinitionPicker.close()) break;
      generatorPickerRowId = null;
    }

    if (oldestWord) {
      generatedWords.delete(oldestWord);
    }

    if (oldestRowId) {
      if (selectedRowId === oldestRowId) {
        selectedRowId = null;
      }

      if (playingRowId === oldestRowId) {
        stopAudio();
      }

      clearCopyFeedback(oldestRowId);
      rowStateById.delete(oldestRowId);
    }

    oldest.remove();
    removedAnyRows = true;
  }

  return removedAnyRows;
}

function addResult() {
  const { min, max } = clampSyllables();
  if (!ruleConfigCompatibility.isReady) {
    return;
  }

  const generated = generateUniqueWord(min, max);

  if (!generated) {
    if (!(wordPrefixInput.value.trim() || wordSuffixInput.value.trim() || generatorConstraints.enabled())) {
      setGenerationStatus("Could not generate a unique word with the current rules.");
    }
    return;
  }

  setGenerationStatus("", false);
  const state = createRowState(generated);
  rowStateById.set(state.rowId, state);

  const row = createResultRow(state);
  resultsList.prepend(row);
  generatedWords.add(generated.word);
  renderRow(state.rowId);
  void hydrateWordState(state.rowId);

  removeOldestRowsIfNeeded();
  flushPersistedRowsSave();
}

async function handleResultListClick(event) {
  const row = event.target.closest(".result-row");
  if (!row || !resultsList.contains(row)) {
    return;
  }

  const rowId = row.dataset.rowId;
  if (!rowId || !rowStateById.has(rowId)) {
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    event.preventDefault();
    event.stopPropagation();
  }

  setSelectedRow(rowId);

  if (!actionButton) {
    return;
  }

  const action = actionButton.dataset.action;
  if (action === "select-definition") {
    await openGeneratorDefinitionPicker(rowId);
    return;
  }

  if (action === "toggle-heart") {
    await handleToggleHeart(rowId);
    return;
  }

  if (action === "copy-word") {
    try {
      const state = rowStateById.get(rowId);
      const fallbackWord = row.dataset.word || "";
      const fallbackIpa = row.dataset.ipa || "";
      const text = state
        ? buildCopyPayload({
            word: state.word,
            pronunciation: state.ipa,
            ipa: state.ipa,
            meaning: getDisplayedMeaning(state)
          })
        : fallbackWord && fallbackIpa
          ? `${fallbackWord} /${fallbackIpa}/`
          : fallbackWord;
      await copyTextToClipboard(text);
      showCopySuccess(rowId);
    } catch (error) {
      console.error("Copy failed.", error);
    }
    return;
  }

  if (action === "play-pronunciation") {
    await playPronunciation(rowId);
    return;
  }

  if (action === "open-meaning-editor") {
    openMeaningEditor(rowId);
    return;
  }

  if (action === "save-meaning") {
    await handleSaveMeaning(rowId);
    return;
  }

  if (action === "cancel-meaning") {
    closeMeaningEditor(rowId);
  }
}

sharedAudio.addEventListener("ended", () => clearPlayState());
sharedAudio.addEventListener("error", () => clearPlayState());

function handleStorageSync(event) {
  if (!event || event.key !== activeRulesStorageKey) {
    return;
  }

  reloadActiveGeneratorRules();
}

reloadActiveGeneratorRules();
loadPersistedSyllableSettings();
clampSyllables();
restorePersistedRows();

resultsList.addEventListener("click", (event) => {
  void handleResultListClick(event);
});

resultsList.addEventListener("input", handleMeaningInput);
resultsList.addEventListener("keydown", handleMeaningInputKeydown);

document.addEventListener("click", (event) => {
  if (event.target.closest(".result-row")) {
    return;
  }

  clearSelection();
});

window.addEventListener("beforeunload", () => {
  flushPersistedRowsSave();
});
window.addEventListener("storage", handleStorageSync);
window.addEventListener("secret-rules-imported", reloadActiveGeneratorRules);

minInput.addEventListener("change", clampSyllables);
wordPrefixInput.addEventListener("input", () => clampSyllables(false));
wordSuffixInput.addEventListener("input", () => clampSyllables(false));
maxInput.addEventListener("change", clampSyllables);
if (generateBtn) {
  generateBtn.addEventListener("click", addResult);
}
if (clearAllBtn) {
  clearAllBtn.addEventListener("click", handleClearAllClick);
}

generatorSync = SECRET_COOPERATIVE_REFRESH.start({
  isBusy: () => Boolean(generatorDefinitionPicker?.isOpen()) || [...rowStateById.values()].some(state => state.isEditing || state.saveStatus !== "idle") ||
    Boolean(document.activeElement && resultsList.contains(document.activeElement) &&
      document.activeElement.matches("input, textarea, select")),
  version: () => `${generatorRevision}:${generatorConstraints.enabled()}:${rowStateById.size > 0}`,
  read: async () => {
    if (rowStateById.size === 0 && !generatorConstraints.enabled()) return [];
    if (!isHeartsConfigured || !await ensureAwsCredentials()) throw new Error("Database access is unavailable.");
    const items = [];
    let lastKey;
    do {
      const response = await getHeartsTableClient().scan({ TableName: awsConfig.heartsTableName,
        ConsistentRead: true, ExclusiveStartKey: lastKey }).promise();
      items.push(...(response.Items || []));
      lastKey = response.LastEvaluatedKey;
    } while (lastKey);
    return items;
  },
  apply: items => {
    // A skipped read with no rows and normalization off is not a dictionary snapshot.
    if (rowStateById.size || generatorConstraints.enabled()) generatorConstraints.accept(items);
    if (generatorDefinitionPicker) generatorDefinitionPicker.load(items);
    for (const state of rowStateById.values()) {
      const matches = items.filter(item => item.word === state.word && item.pronunciation);
      const own = findNewestCurrentUserMatch(matches, getCurrentUserId());
      if (own) applyCurrentUserMatchToState(state, own);
      else if (state.hasPersistedRecord) {
        state.hearted = false;
        state.ownMeaning = null;
        state.meaningUpdatedTimestamp = null;
        state.hasPersistedRecord = false;
        state.recordRowId = "";
        state.draftMeaning = "";
        state.hasDraftCache = false;
        state.draftUpdatedTimestamp = null;
      }
      applyGeneratorDictionaryMatches(state, matches);
      const imported = sortMatchesByMeaningDesc(matches).find(item =>
        item.user !== getCurrentUserId() && hasMeaningText(item.meaning));
      syncDisplayMeaning(state, imported || findNewestNonEmptyMeaningMatch(matches));
      renderRow(state.rowId);
    }
    flushPersistedRowsSave();
  },
  onSuccess: () => generatorConstraints.success(),
  onError: error => {
    generatorConstraints.error();
    console.warn("Shared refresh failed; keeping current words and normalization counts.", error);
  }
});
window.addEventListener("beforeunload", () => generatorSync.stop());
