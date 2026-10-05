(function bootstrapDatabaseSettings(globalScope) {
  "use strict";

  const SETTINGS_ROW_ID = "__secret_language_settings__";
  const SETTINGS_RECORD_TYPE = "languageSettings";
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
    return {
      draft,
      active,
      updatedTimestamp: Number(item.updatedTimestamp) || 0
    };
  }

  async function loadRulesFromDatabase() {
    const client = await ensureDatabase();
    const response = await client
      .get({
        TableName: awsRuntime.awsConfig.heartsTableName,
        Key: { rowId: SETTINGS_ROW_ID },
        ConsistentRead: true
      })
      .promise();

    if (!response.Item) {
      return { found: false, draft: null, active: null, updatedTimestamp: 0 };
    }

    const applied = applyStoredItem(response.Item);
    return { found: true, ...applied };
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
          recordType: SETTINGS_RECORD_TYPE,
          draftRules: normalizedDraft,
          activeRules: normalizedActive,
          updatedTimestamp: now
        }
      })
      .promise();

    return { draft: normalizedDraft, active: normalizedActive, updatedTimestamp: now };
  }

  const api = {
    SETTINGS_ROW_ID,
    SETTINGS_RECORD_TYPE,
    isConfigured: Boolean(awsRuntime && awsRuntime.isHeartsConfigured),
    loadRulesFromDatabase,
    saveRulesToDatabase
  };

  globalScope.SECRET_DATABASE_SETTINGS = api;
  globalScope.SECRET_RULES_READY = loadRulesFromDatabase()
    .then((result) => ({ ok: true, ...result }))
    .catch((error) => {
      console.warn("Could not refresh language settings from DynamoDB; using the local cache.", error);
      return { ok: false, found: false, error };
    });
})(window);
