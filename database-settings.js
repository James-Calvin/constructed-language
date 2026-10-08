(function bootstrapDatabaseSettings(globalScope) {
  "use strict";

  const SETTINGS_ROW_ID = "__secret_language_settings__";
  const SETTINGS_TIMESTAMP = 0;
  const SETTINGS_RECORD_TYPE = "languageSettings";
  const AUTO_SYNC_INTERVAL_MS = 30000;
  const SYNC_METADATA_STORAGE_KEY = "secret.database-rules.sync.v1";
  const sharedApi = globalScope.LOVE_LANGUAGE_SHARED || {};
  const rulesApi = globalScope.LOVE_LANGUAGE_RULES || {};
  const awsHelpers = globalScope.LOVE_LANGUAGE_AWS || {};
  const normalizedAwsConfig =
    typeof awsHelpers.normalizeConfig === "function"
      ? awsHelpers.normalizeConfig(globalScope.LOVE_LANGUAGE_AWS_CONFIG)
      : globalScope.LOVE_LANGUAGE_AWS_CONFIG;
  const awsRuntime =
    typeof sharedApi.createAwsRuntime === "function"
      ? sharedApi.createAwsRuntime({ awsConfig: normalizedAwsConfig })
      : null;

  const normalizeRuleConfig =
    typeof rulesApi.normalizeRuleConfig === "function"
      ? rulesApi.normalizeRuleConfig
      : (config) => config;
  const saveDraftRuleConfig =
    typeof rulesApi.saveDraftRuleConfig === "function"
      ? rulesApi.saveDraftRuleConfig
      : (config) => config;
  const saveActiveRuleConfig =
    typeof rulesApi.saveActiveRuleConfig === "function"
      ? rulesApi.saveActiveRuleConfig
      : (config) => config;
  const loadDraftRuleConfig =
    typeof rulesApi.loadDraftRuleConfig === "function"
      ? rulesApi.loadDraftRuleConfig
      : () => null;
  const loadActiveRuleConfig =
    typeof rulesApi.loadActiveRuleConfig === "function"
      ? rulesApi.loadActiveRuleConfig
      : () => null;
  let refreshPromise = null;

  function getStorage() {
    try {
      return globalScope.localStorage;
    } catch (error) {
      return null;
    }
  }

  function createRulesFingerprint(draft, active) {
    return JSON.stringify({
      draft: normalizeRuleConfig(draft),
      active: normalizeRuleConfig(active)
    });
  }

  function loadSyncMetadata() {
    const storage = getStorage();
    if (!storage) {
      return null;
    }

    try {
      const metadata = JSON.parse(storage.getItem(SYNC_METADATA_STORAGE_KEY) || "null");
      if (!metadata || typeof metadata.fingerprint !== "string") {
        return null;
      }
      return {
        updatedTimestamp: Number(metadata.updatedTimestamp) || 0,
        fingerprint: metadata.fingerprint
      };
    } catch (error) {
      return null;
    }
  }

  function saveSyncMetadata(updatedTimestamp, draft, active) {
    const storage = getStorage();
    if (!storage) {
      return;
    }

    storage.setItem(
      SYNC_METADATA_STORAGE_KEY,
      JSON.stringify({
        updatedTimestamp: Number(updatedTimestamp) || 0,
        fingerprint: createRulesFingerprint(draft, active)
      })
    );
  }

  function hasLocalRuleChanges(metadata = loadSyncMetadata()) {
    if (!metadata) {
      return false;
    }

    return (
      createRulesFingerprint(loadDraftRuleConfig(), loadActiveRuleConfig()) !== metadata.fingerprint
    );
  }

  function requireDatabase() {
    if (!awsRuntime || !awsRuntime.isHeartsConfigured) {
      throw new Error("Database-backed language settings are not configured.");
    }

    const client = awsRuntime.getHeartsTableClient();
    if (!client) {
      throw new Error("The DynamoDB client is unavailable.");
    }

    return client;
  }

  async function ensureDatabase() {
    const client = requireDatabase();
    const ready = await awsRuntime.ensureAwsCredentials();
    if (!ready) {
      throw new Error("Could not initialize AWS guest credentials.");
    }
    return client;
  }

  function applyStoredItem(item) {
    if (!item || typeof item !== "object") {
      return null;
    }

    const draftSource = item.draftRules || item.rules;
    const activeSource = item.activeRules || draftSource;
    if (!draftSource || !activeSource) {
      throw new Error("The database settings record is incomplete.");
    }

    const draft = saveDraftRuleConfig(normalizeRuleConfig(draftSource));
    const active = saveActiveRuleConfig(normalizeRuleConfig(activeSource));
    const updatedTimestamp = Number(item.updatedTimestamp) || 0;
    saveSyncMetadata(updatedTimestamp, draft, active);
    return {
      draft,
      active,
      updatedTimestamp
    };
  }

  async function getStoredSettingsItem() {
    const client = await ensureDatabase();
    const response = await client
      .get({
        TableName: awsRuntime.awsConfig.heartsTableName,
        Key: {
          rowId: SETTINGS_ROW_ID,
          timestamp: SETTINGS_TIMESTAMP
        },
        ConsistentRead: true
      })
      .promise();

    return response.Item || null;
  }

  async function loadRulesFromDatabase() {
    return synchronizeRulesFromDatabase({ force: true, announce: false });
  }

  async function synchronizeRulesFromDatabase({ force = false, announce = false } = {}) {
    const item = await getStoredSettingsItem();

    if (!item) {
      return {
        found: false,
        changed: false,
        conflict: false,
        draft: null,
        active: null,
        updatedTimestamp: 0
      };
    }

    const databaseTimestamp = Number(item.updatedTimestamp) || 0;
    const metadata = loadSyncMetadata();
    if (!force && metadata && databaseTimestamp <= metadata.updatedTimestamp) {
      return {
        found: true,
        changed: false,
        conflict: false,
        updatedTimestamp: databaseTimestamp
      };
    }

    if (!force && metadata && hasLocalRuleChanges(metadata)) {
      if (announce) {
        globalScope.dispatchEvent(
          new CustomEvent("secret-rules-update-available", {
            detail: { updatedTimestamp: databaseTimestamp }
          })
        );
      }
      return {
        found: true,
        changed: false,
        conflict: true,
        updatedTimestamp: databaseTimestamp
      };
    }

    const applied = applyStoredItem(item);
    if (announce) {
      globalScope.dispatchEvent(
        new CustomEvent("secret-rules-imported", {
          detail: { updatedTimestamp: applied.updatedTimestamp }
        })
      );
    }
    return { found: true, changed: true, conflict: false, ...applied };
  }

  async function refreshRulesFromDatabase() {
    if (refreshPromise) {
      return refreshPromise;
    }

    refreshPromise = (async () => {
      return synchronizeRulesFromDatabase({ force: false, announce: true });
    })().finally(() => {
      refreshPromise = null;
    });

    return refreshPromise;
  }

  async function saveRulesToDatabase({ draft, active }) {
    const client = await ensureDatabase();
    const now = Date.now();
    const normalizedDraft = normalizeRuleConfig(draft);
    const normalizedActive = normalizeRuleConfig(active);

    await client
      .put({
        TableName: awsRuntime.awsConfig.heartsTableName,
        Item: {
          rowId: SETTINGS_ROW_ID,
          timestamp: SETTINGS_TIMESTAMP,
          recordType: SETTINGS_RECORD_TYPE,
          draftRules: normalizedDraft,
          activeRules: normalizedActive,
          updatedTimestamp: now
        }
      })
      .promise();

    saveSyncMetadata(now, normalizedDraft, normalizedActive);

    return { draft: normalizedDraft, active: normalizedActive, updatedTimestamp: now };
  }

  function startAutomaticSync() {
    if (!api.isConfigured) {
      return;
    }

    const refreshWithoutInterrupting = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      void refreshRulesFromDatabase().catch((error) => {
        console.warn("Could not check for newer database language settings.", error);
      });
    };

    globalScope.addEventListener("focus", refreshWithoutInterrupting);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        refreshWithoutInterrupting();
      }
    });
    globalScope.setInterval(refreshWithoutInterrupting, AUTO_SYNC_INTERVAL_MS);
  }

  const api = {
    SETTINGS_ROW_ID,
    SETTINGS_TIMESTAMP,
    SETTINGS_RECORD_TYPE,
    SYNC_METADATA_STORAGE_KEY,
    isConfigured: Boolean(awsRuntime && awsRuntime.isHeartsConfigured),
    hasLocalRuleChanges,
    loadRulesFromDatabase,
    refreshRulesFromDatabase,
    saveRulesToDatabase
  };

  globalScope.SECRET_DATABASE_SETTINGS = api;
  globalScope.SECRET_RULES_READY = synchronizeRulesFromDatabase({ force: false, announce: false })
    .then((result) => ({ ok: true, ...result }))
    .catch((error) => {
      console.warn("Could not refresh language settings from DynamoDB; using the local cache.", error);
      return { ok: false, found: false, error };
    });
  globalScope.SECRET_RULES_READY.then(startAutomaticSync);
})(window);
