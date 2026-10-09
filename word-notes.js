(function (root) {
  "use strict";
  function validNote(item) {
    const n = item && item.noteData;
    return Boolean(n && n.kind === "note" && typeof n.id === "string" && typeof n.word === "string" &&
      typeof n.text === "string" && typeof n.author === "string" && Number.isFinite(n.createdAt));
  }
  function unread(notes, receipts, user) {
    return notes.filter(n => n.author !== user && !receipts.some(r => r.reader === user && r.id === n.id));
  }
  function create({ client, table, user }) {
    let items = [];
    const states = new Map();
    const views = new Map();
    let revision = 0;
    let pendingWrites = 0;
    function state(word) {
      if (!states.has(word)) states.set(word, { open: false, draft: "", busy: false, error: "" });
      return states.get(word);
    }
    function notes(word) {
      return items.filter(item => validNote(item) && item.noteData.word === word).map(item => item.noteData)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    }
    function unreadNotes(word) {
      return unread(notes(word), items.filter(i => i.noteData && i.noteData.kind === "read").map(i => i.noteData), user());
    }
    async function put(item) {
      revision++;
      pendingWrites++;
      try {
        await client().put({ TableName: table, Item: item }).promise();
        const index = items.findIndex(i => i.rowId === item.rowId && i.timestamp === item.timestamp);
        if (index < 0) items.push(item); else items[index] = item;
      } finally { pendingWrites--; revision++; }
    }
    async function markRead(word) {
      const reader = user();
      await Promise.all(unreadNotes(word).map(n => put({
        rowId: `__secret_note_read__::${encodeURIComponent(n.id)}::${encodeURIComponent(reader)}`, timestamp: 0,
        noteData: { kind: "read", word, id: n.id, reader }
      })));
    }
    async function add(word, text) {
      const author = user();
      const trimmed = typeof text === "string" ? text.trim() : "";
      if (!author || !word || !trimmed || trimmed.length > 4000) {
        throw new Error("A named user, word, and note of 1–4000 characters are required.");
      }
      const id = root.crypto.randomUUID();
      await put({ rowId: `__secret_note__::${id}`, timestamp: 0,
        noteData: { kind: "note", word, id, text: trimmed, author, createdAt: Date.now() } });
    }
    function render(word) {
      const local = state(word);
      const details = document.createElement("details");
      details.className = "word-notes";
      details.open = local.open;
      const summary = document.createElement("summary");
      const label = document.createElement("span");
      const dot = document.createElement("span");
      dot.className = "word-notes-unread";
      dot.textContent = "♥";
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", "Unread notes");
      summary.append(label, dot);
      const list = document.createElement("ol");
      list.className = "word-notes-list";
      const form = document.createElement("form");
      const input = document.createElement("textarea");
      input.className = "word-notes-input";
      input.setAttribute("aria-label", `Add a note for ${word}`);
      input.placeholder = "Add an optional note…";
      input.maxLength = 4000;
      input.rows = 2;
      input.value = local.draft;
      const button = document.createElement("button");
      button.type = "submit";
      button.className = "dictionary-word-action";
      button.textContent = "Add note";
      const status = document.createElement("p");
      status.className = "word-notes-status";
      status.setAttribute("role", "status");
      form.append(input, button, status);
      details.append(summary, list, form);
      function update() {
        const all = notes(word);
        label.textContent = `Notes (${all.length})`;
        dot.hidden = unreadNotes(word).length === 0;
        button.disabled = local.busy || !local.draft.trim();
        status.textContent = local.error || (local.busy ? "Saving…" : "");
        if (input.value !== local.draft) input.value = local.draft;
        list.replaceChildren(...all.map(n => {
          const li = document.createElement("li");
          const byline = document.createElement("small");
          byline.textContent = `${n.author} · ${new Date(n.createdAt).toLocaleString()}`;
          const text = document.createElement("p");
          text.textContent = n.text;
          li.append(byline, text);
          return li;
        }));
      }
      // A dictionary rerender may replace this panel during an AWS request.
      views.set(word, update);
      function refreshView() { const current = views.get(word); if (current) current(); }
      input.addEventListener("input", () => { local.draft = input.value; button.disabled = local.busy || !input.value.trim(); });
      details.addEventListener("toggle", async () => {
        if (!details.isConnected) return;
        local.open = details.open;
        if (!local.open || !unreadNotes(word).length) return;
        try { await markRead(word); local.error = ""; }
        catch (error) { local.error = "Could not save read status. Reopen notes to retry."; console.error(error); }
        refreshView();
      });
      form.addEventListener("submit", async event => {
        event.preventDefault();
        const text = local.draft.trim();
        if (local.busy || !text || event.isComposing) return;
        local.busy = true;
        local.error = "";
        update();
        try {
          await add(word, text);
          if (local.draft.trim() === text) { local.draft = ""; input.value = ""; }
        } catch (error) { local.error = "Could not save note. Your draft is kept; please retry."; console.error(error); }
        finally { local.busy = false; refreshView(); }
      });
      update();
      return details;
    }
    async function rename(oldWord, nextWord) {
      if (oldWord === nextWord) return;
      for (const item of items.filter(i => i.noteData && i.noteData.word === oldWord)) {
        await put({ ...item, noteData: { ...item.noteData, word: nextWord } });
      }
      if (states.has(oldWord)) { states.set(nextWord, states.get(oldWord)); states.delete(oldWord); }
    }
    async function remove(word) {
      for (const item of items.filter(i => i.noteData && i.noteData.word === word)) {
        await client().delete({ TableName: table, Key: { rowId: item.rowId, timestamp: item.timestamp } }).promise();
        items = items.filter(i => i !== item);
      }
      states.delete(word);
    }
    return { load: raw => { items = raw.filter(i => i.noteData); }, render, notes, unreadNotes, markRead, add, rename, remove,
      isBusy: () => pendingWrites > 0, version: () => revision };
  }
  const api = { create, unread, validNote };
  root.SECRET_WORD_NOTES = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
