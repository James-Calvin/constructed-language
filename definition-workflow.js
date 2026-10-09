(function (root) {
  "use strict";
  function classification(record) {
    if (!record || !String(record.meaning || "").trim()) return "undefined";
    return record.definitionReview && record.definitionReview.status === "candidate"
      ? "candidate" : "defined";
  }
  function reviewForSave(item, previous) {
    if (!String(item.meaning || "").trim()) return null;
    if (previous && item.meaning === previous.meaning &&
        item.meaningUpdatedTimestamp === previous.meaningUpdatedTimestamp) {
      return previous.definitionReview || null;
    }
    // A renamed record keeps its existing review; a fresh definition needs review.
    if (!previous && item.definitionReview) return item.definitionReview;
    return { status: "candidate" };
  }
  async function save(client, table, item) {
    const result = await client.get({ TableName: table,
      Key: { rowId: item.rowId, timestamp: item.timestamp }, ConsistentRead: true }).promise();
    item.definitionReview = reviewForSave(item, result.Item);
    // Generator saves may not have loaded the request metadata from the index.
    if (result.Item) {
      if (result.Item.conceptData) item.conceptData = result.Item.conceptData;
      else delete item.conceptData; // Do not resurrect a request removed on another device.
    }
    const params = { TableName: table, Item: item };
    if (result.Item) {
      params.ConditionExpression = "#updated = :updated AND (attribute_not_exists(#review) OR #review = :review)";
      params.ExpressionAttributeNames = { "#updated": "updatedTimestamp", "#review": "definitionReview" };
      params.ExpressionAttributeValues = { ":updated": result.Item.updatedTimestamp,
        ":review": result.Item.definitionReview || null };
      // Very old rows may not have an activity timestamp.
      if (result.Item.updatedTimestamp == null) {
        params.ConditionExpression = "attribute_not_exists(#updated) AND (attribute_not_exists(#review) OR #review = :review)";
        delete params.ExpressionAttributeValues[":updated"];
      }
      // Request editing/removal must also win against a heart save already in flight.
      params.ConditionExpression += result.Item.conceptData
        ? " AND #concept = :concept" : " AND (attribute_not_exists(#concept) OR #concept = :concept)";
      params.ExpressionAttributeNames["#concept"] = "conceptData";
      params.ExpressionAttributeValues[":concept"] = result.Item.conceptData || null;
    } else {
      params.ConditionExpression = "attribute_not_exists(rowId)";
    }
    await client.put(params).promise();
    return item.definitionReview;
  }
  function namedUserId(user) {
    if (typeof user !== "string") return "";
    const normalized = user.trim().replace(/\s+/g, " ").toLowerCase();
    // Legacy Cognito identities have region:UUID IDs, not chosen usernames.
    return normalized.includes(":") ? "" : normalized;
  }
  function sharedHearts(records) {
    return new Set(records.filter(record => record.hearted)
      .map(record => namedUserId(record.user)).filter(Boolean)).size > 1;
  }
  function canApprove(record, user) {
    return Boolean(user && record && record.user !== user && classification(record) === "candidate");
  }
  const api = { classification, reviewForSave, save, sharedHearts, canApprove, namedUserId };
  root.SECRET_DEFINITIONS = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
