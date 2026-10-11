(function (root) {
  "use strict";
  const deck = typeof module !== "undefined" && module.exports
    ? require("./flashcard-deck.js") : root.SECRET_FLASHCARD_DECK;
  function create({ client, table, user, ensure = async () => true, uuid = () => root.crypto.randomUUID(), now = Date.now }) {
    let rows = [];
    function list() {
      return rows.filter(deck.validCard).sort((a, b) => b.flashcardData.createdAt - a.flashcardData.createdAt ||
        a.flashcardData.id.localeCompare(b.flashcardData.id));
    }
    function fields(sentence, translation) {
      const editor = String(user() || "").trim();
      sentence = typeof sentence === "string" ? sentence.trim() : "";
      translation = typeof translation === "string" ? translation.trim() : "";
      if (!editor || !sentence || !translation || sentence.length > 4000 || translation.length > 4000) {
        throw new Error("A named user and sentence/translation of 1–4000 characters each are required.");
      }
      return { sentence, translation, editor };
    }
    async function write(operation, params, item) {
      if (!await ensure()) throw new Error("Database access is unavailable. Your draft has been kept.");
      try { await client()[operation]({ TableName: table, ...params }).promise(); }
      catch (error) {
        if (error.code === "ConditionalCheckFailedException") {
          throw new Error("This card changed or was deleted by someone else. Cancel, refresh, and reopen it before saving again.");
        }
        throw new Error("Could not save the change. Your draft has been kept; please retry.");
      }
      const key = item || params.Key;
      rows = rows.filter(row => row.rowId !== key.rowId || row.timestamp !== key.timestamp);
      if (item) rows.push(item);
      return item;
    }
    function condition(base) {
      if (!deck.validCard(base)) throw new Error("This card is unavailable. Refresh and try again.");
      return {
        ExpressionAttributeNames: { "#data": "flashcardData", "#revision": "revision" },
        ExpressionAttributeValues: { ":revision": base.flashcardData.revision },
        ConditionExpression: "#data.#revision = :revision"
      };
    }
    async function add(sentence, translation) {
      const values = fields(sentence, translation), id = uuid(), time = now();
      const item = { rowId: `__secret_flashcard__::${id}`, timestamp: 0, flashcardData: {
        kind: "sentence", id, ...values, author: values.editor, createdAt: time, editedAt: time, revision: uuid()
      } };
      return write("put", { Item: item, ConditionExpression: "attribute_not_exists(rowId)" }, item);
    }
    async function edit(base, sentence, translation) {
      const values = fields(sentence, translation), guard = condition(base);
      const item = { ...base, flashcardData: { ...base.flashcardData, ...values, editedAt: now(), revision: uuid() } };
      return write("put", { Item: item, ...guard }, item);
    }
    async function remove(base) {
      if (!String(user() || "").trim()) throw new Error("A named user is required.");
      const guard = condition(base);
      return write("delete", { Key: { rowId: base.rowId, timestamp: base.timestamp }, ...guard });
    }
    return { load(snapshot) { rows = snapshot; }, list, add, edit, remove };
  }
  const api = { create };
  root.SECRET_FLASHCARD_SERVICE = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
