(function (root) {
  "use strict";
  function validRequest(item) {
    const data = item && item.conceptData;
    return Boolean(data && typeof data.id === "string" && typeof data.text === "string" &&
      data.text.trim() && typeof item.rowId === "string" && Number.isFinite(item.timestamp));
  }
  function fulfilled(item) {
    return Boolean(item && item.word && item.pronunciation && String(item.meaning || "").trim());
  }
  const normalized = text => String(text || "").normalize("NFC").toLowerCase();
  const tokens = text => new Set(normalized(text).match(/[\p{L}\p{M}\p{N}]+/gu) || []);
  function groupWords(raw) {
    const grouped = new Map();
    for (const item of raw) {
      if (!item.word || !item.pronunciation) continue;
      if (!grouped.has(item.word)) grouped.set(item.word, []);
      grouped.get(item.word).push(item);
    }
    const time = record => Number(record.meaningUpdatedTimestamp || record.updatedTimestamp || record.timestamp) || 0;
    return [...grouped].map(([word, records]) => {
      const defined = records.filter(record => String(record.meaning || "").trim()).sort((a, b) => time(b) - time(a));
      if (!defined.length && !records.some(record => record.hearted)) return null;
      const latest = defined[0] || [...records].sort((a, b) => time(b) - time(a))[0];
      const seen = new Set();
      const definitions = defined.filter(record => {
        const key = normalized(record.meaning.trim());
        if (seen.has(key)) return false;
        seen.add(key); return true;
      }).map(record => ({ meaning: record.meaning.trim(), pronunciation: record.pronunciation,
        category: record.definitionReview?.status === "candidate" ? "Candidate" : "Defined" }));
      return { ...latest, word, records, definitions, hasDefinition: defined.length > 0 };
    }).filter(Boolean).sort((a, b) => a.word.localeCompare(b.word, undefined, { sensitivity: "base" }));
  }
  function matchesForConcept(text, words) {
    const query = tokens(text);
    if (!query.size) return [];
    return words.map(word => {
      const matchedTokens = new Set();
      const definitions = word.definitions.filter(definition => {
        const wordsInDefinition = tokens(definition.meaning);
        const matches = [...query].filter(token => wordsInDefinition.has(token));
        matches.forEach(token => matchedTokens.add(token));
        return matches.length > 0;
      });
      return { ...word, definitions, score: matchedTokens.size };
    }).filter(word => word.score > 0)
      .sort((a, b) => b.score - a.score || a.word.localeCompare(b.word, undefined, { sensitivity: "base" }));
  }
  function create({ client, table, user }) {
    let items = [];
    function load(raw) { items = raw.filter(validRequest); }
    function list() {
      return [...items].sort((a, b) => a.conceptData.text.localeCompare(b.conceptData.text, undefined, { sensitivity: "base" }));
    }
    function remember(item) {
      items = items.filter(existing => existing.rowId !== item.rowId);
      items.push(item);
    }
    async function add(text) {
      const trimmed = typeof text === "string" ? text.trim() : "";
      if (!user() || !trimmed || trimmed.length > 2000) throw new Error("Enter a concept of 1–2000 characters.");
      const id = root.crypto.randomUUID();
      const createdAt = Date.now();
      const item = { rowId: `__secret_concept__::${id}`, timestamp: createdAt,
        conceptData: { id, text: trimmed, author: user(), createdAt } };
      await client().put({ TableName: table, Item: item, ConditionExpression: "attribute_not_exists(rowId)" }).promise();
      remember(item);
      return item;
    }
    function condition(fresh) {
      const params = {
        ConditionExpression: "#concept = :concept AND attribute_not_exists(#updated)",
        ExpressionAttributeNames: { "#concept": "conceptData", "#updated": "updatedTimestamp" },
        ExpressionAttributeValues: { ":concept": fresh.conceptData }
      };
      if (fresh.updatedTimestamp != null) {
        params.ConditionExpression = "#concept = :concept AND #updated = :updated";
        params.ExpressionAttributeValues[":updated"] = fresh.updatedTimestamp;
      }
      return params;
    }
    async function freshUnassigned(request, ownerOnly = false) {
      const response = await client().get({ TableName: table,
        Key: { rowId: request.rowId, timestamp: request.timestamp }, ConsistentRead: true }).promise();
      const fresh = response.Item;
      if (!validRequest(fresh)) throw new Error("This concept no longer exists. Refresh the list.");
      if (ownerOnly && fresh.conceptData.author !== user()) throw new Error("Only the requester can edit or delete this concept.");
      if (fulfilled(fresh)) throw new Error(`This concept was already assigned to ${fresh.word}. Refresh the list.`);
      const fields = ["id", "text", "author", "createdAt", "updatedAt"];
      if (fields.some(field => fresh.conceptData[field] !== request.conceptData[field])) {
        throw new Error("This concept changed. Refresh and reconfirm before saving.");
      }
      return fresh;
    }
    async function edit(request, text) {
      const trimmed = typeof text === "string" ? text.trim() : "";
      if (!user() || !trimmed || trimmed.length > 2000) throw new Error("Enter a concept of 1–2000 characters.");
      const fresh = await freshUnassigned(request, true);
      const item = { ...fresh, conceptData: { ...fresh.conceptData, text: trimmed,
        updatedAt: Math.max(Date.now(), (fresh.conceptData.updatedAt || 0) + 1) } };
      await client().put({ TableName: table, Item: item, ...condition(fresh) }).promise();
      remember(item);
      return item;
    }
    async function remove(request) {
      if (!user()) throw new Error("A named user is required.");
      const fresh = await freshUnassigned(request, true);
      if (fresh.word && fresh.pronunciation) {
        const item = { ...fresh };
        delete item.conceptData;
        await client().put({ TableName: table, Item: item, ...condition(fresh) }).promise();
      } else {
        await client().delete({ TableName: table,
          Key: { rowId: fresh.rowId, timestamp: fresh.timestamp }, ...condition(fresh) }).promise();
      }
      items = items.filter(item => item.rowId !== request.rowId);
    }
    async function assign(request, spelling, ipa) {
      const word = typeof spelling === "string" ? spelling.trim().replace(/[.-]/g, "") : "";
      const pronunciation = typeof ipa === "string" ? ipa.trim() : "";
      if (!user() || !word || !pronunciation) throw new Error("A spelling and IPA pronunciation are required.");
      const fresh = await freshUnassigned(request);
      const now = Math.max(Date.now(), (fresh.updatedTimestamp || 0) + 1);
      // The request becomes a normal definition row in the SAME write. There is
      // no second fulfillment write to fail or race, and no new IAM action.
      const item = { ...fresh, word, pronunciation, meaning: fresh.conceptData.text,
        user: user(), hearted: false, updatedTimestamp: now, meaningUpdatedTimestamp: now,
        unheartedTimestamp: null, definitionReview: { status: "candidate" } };
      const params = { TableName: table, Item: item, ...condition(fresh) };
      await client().put(params).promise();
      remember(item);
      return item;
    }
    return { load, list, add, assign, edit, remove };
  }
  const api = { create, validRequest, fulfilled, groupWords, matchesForConcept };
  root.SECRET_MEANING_REQUESTS = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
