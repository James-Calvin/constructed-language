(function (root) {
  "use strict";
  function classification(record) {
    if (!record || !String(record.meaning || "").trim()) return "undefined";
    return record.definitionReview && record.definitionReview.status === "candidate"
      ? "candidate" : "defined";
  }
  function meanings(text) {
    return new Set(String(text || "").split(/[,;]/).map(part => part.trim().normalize("NFC").toLowerCase()).filter(Boolean));
  }
  function isAdditive(before, after) {
    const old = meanings(before), next = meanings(after);
    return old.size > 0 && [...old].every(part => next.has(part));
  }
  function sameMetadata(left, right) {
    if (left === right) return true;
    if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key =>
      Object.prototype.hasOwnProperty.call(right, key) && sameMetadata(left[key], right[key]));
  }
  function reviewForSave(item, previous) {
    if (!String(item.meaning || "").trim()) return null;
    if (previous && (item.meaning === previous.meaning || isAdditive(previous.meaning, item.meaning))) {
      return previous.definitionReview || null;
    }
    // A renamed record keeps its existing review; a fresh definition needs review.
    if (!previous && item.definitionReview) return item.definitionReview;
    return { status: "candidate" };
  }
  async function save(client, table, item, options = {}) {
    const result = await client.get({ TableName: table,
      Key: { rowId: item.rowId, timestamp: item.timestamp }, ConsistentRead: true }).promise();
    const previous = result.Item;
    if (previous && options.heartAction && !options.editor) {
      item.meaning = previous.meaning ?? null;
      item.meaningUpdatedTimestamp = previous.meaningUpdatedTimestamp ??
        (String(previous.meaning || "").trim() ? previous.updatedTimestamp || previous.timestamp : null);
    }
    const baseValue = (row, key) => key === "meaningUpdatedTimestamp" && String(row.meaning || "").trim()
      ? row[key] || row.updatedTimestamp || row.timestamp : key === "meaning" ? String(row.meaning || "").trim() : row[key] ?? null;
    if (options.base && (!previous || ["meaning", "meaningUpdatedTimestamp", "word", "pronunciation"].some(key =>
      baseValue(previous, key) !== baseValue(options.base, key)) ||
      !sameMetadata(previous.definitionReview || null, options.base.definitionReview || null) ||
      !sameMetadata(previous.conceptData || null, options.base.conceptData || null))) {
      throw new Error("This definition changed. Cancel and reopen the editor to review the latest version; your draft has been retained.");
    }
    if (options.base && options.editor) {
      const rows = [];
      let cursor;
      do {
        const page = await client.scan({ TableName: table, ConsistentRead: true,
          FilterExpression: "#word = :word", ExpressionAttributeNames: { "#word": "word" },
          ExpressionAttributeValues: { ":word": previous.word },
          ...(cursor ? { ExclusiveStartKey: cursor } : {}) }).promise();
        rows.push(...(page.Items || [])); cursor = page.LastEvaluatedKey;
      } while (cursor);
      const latest = rows.filter(row => row.word === previous.word && String(row.meaning || "").trim())
        .sort((a, b) => (b.meaningUpdatedTimestamp || b.updatedTimestamp || b.timestamp || 0) -
          (a.meaningUpdatedTimestamp || a.updatedTimestamp || a.timestamp || 0))[0];
      if (!latest || latest.rowId !== previous.rowId || latest.timestamp !== previous.timestamp) {
        throw new Error("A newer definition was saved. Cancel and reopen the editor to review it; your draft has been retained.");
      }
    }
    // Definition editing must not copy stale heart/ownership state over a newer heart save.
    if (options.base) {
      item.user = previous.user;
      item.hearted = previous.hearted;
      item.unheartedTimestamp = previous.unheartedTimestamp ?? null;
      item.updatedTimestamp = Math.max(item.updatedTimestamp || 0, (previous.updatedTimestamp || 0) + 1);
    }
    // Definition activity must not become a new heart/unheart action on an old row.
    item.heartUpdatedTimestamp = options.heartAction || !previous
      ? item.updatedTimestamp || item.timestamp
      : previous.heartUpdatedTimestamp || Math.max(previous.updatedTimestamp || 0, previous.timestamp || 0);
    item.definitionReview = reviewForSave(item, previous);
    if (options.editor) {
      item.meaningEditedBy = options.editor;
      item.meaningEditedAt = item.meaningUpdatedTimestamp;
    } else if (previous) {
      if (previous.meaningEditedBy) item.meaningEditedBy = previous.meaningEditedBy;
      if (previous.meaningEditedAt) item.meaningEditedAt = previous.meaningEditedAt;
    }
    // Generator saves may not have loaded the request metadata from the index.
    if (result.Item) {
      if (result.Item.conceptData) item.conceptData = result.Item.conceptData;
      else delete item.conceptData; // Do not resurrect a request removed on another device.
    }
    if (options.editor && item.conceptData && !item.conceptData.fulfillment && String(item.meaning || "").trim()) {
      if (item.meaning.length > 2000) throw new Error("Linked meanings must be 1–2000 characters.");
      item.conceptData = { ...item.conceptData, text: item.meaning, updatedAt: item.meaningUpdatedTimestamp };
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
      params.ConditionExpression += Object.prototype.hasOwnProperty.call(result.Item, "meaning")
        ? " AND #meaning = :meaning" : " AND attribute_not_exists(#meaning)";
      params.ExpressionAttributeNames["#meaning"] = "meaning";
      if (Object.prototype.hasOwnProperty.call(result.Item, "meaning")) params.ExpressionAttributeValues[":meaning"] = result.Item.meaning;
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
    return Boolean(user && record && namedUserId(record.meaningEditedBy || record.user) !== namedUserId(user) && classification(record) === "candidate");
  }
  function compareCandidates(left, right, user) {
    const priority = Number(canApprove(right.definitionHistory[0], user)) -
      Number(canApprove(left.definitionHistory[0], user));
    return priority || left.word.localeCompare(right.word, undefined, { sensitivity: "base", numeric: true });
  }
  const api = { classification, isAdditive, reviewForSave, save, sharedHearts, canApprove, namedUserId, compareCandidates };
  root.SECRET_DEFINITIONS = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
