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
    async function assign(request, spelling, ipa) {
      const word = typeof spelling === "string" ? spelling.trim().replace(/[.-]/g, "") : "";
      const pronunciation = typeof ipa === "string" ? ipa.trim() : "";
      if (!user() || !word || !pronunciation) throw new Error("A spelling and IPA pronunciation are required.");
      const key = { rowId: request.rowId, timestamp: request.timestamp };
      const response = await client().get({ TableName: table, Key: key, ConsistentRead: true }).promise();
      const fresh = response.Item;
      if (!validRequest(fresh)) throw new Error("This concept no longer exists. Refresh the list.");
      if (fulfilled(fresh)) {
        remember(fresh);
        throw new Error(`This concept was already assigned to ${fresh.word}. Refresh the list.`);
      }
      const now = Date.now();
      // The request becomes a normal definition row in the SAME write. There is
      // no second fulfillment write to fail or race, and no new IAM action.
      const item = { ...fresh, word, pronunciation, meaning: fresh.conceptData.text,
        user: user(), hearted: false, updatedTimestamp: now, meaningUpdatedTimestamp: now,
        unheartedTimestamp: null, definitionReview: { status: "candidate" } };
      const params = { TableName: table, Item: item,
        ConditionExpression: "#concept = :concept AND attribute_not_exists(#updated)",
        ExpressionAttributeNames: { "#concept": "conceptData", "#updated": "updatedTimestamp" },
        ExpressionAttributeValues: { ":concept": fresh.conceptData } };
      if (fresh.updatedTimestamp != null) {
        params.ConditionExpression = "#concept = :concept AND #updated = :updated";
        params.ExpressionAttributeValues[":updated"] = fresh.updatedTimestamp;
      }
      await client().put(params).promise();
      remember(item);
      return item;
    }
    return { load, list, add, assign };
  }
  const api = { create, validRequest, fulfilled };
  root.SECRET_MEANING_REQUESTS = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
