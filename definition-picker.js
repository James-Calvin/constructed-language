(function (root) {
  "use strict";
  function create({ client, table, user, read, onChange, onAssigned, onMutation, onBusyChange = () => {} }) {
    const requests = root.SECRET_MEANING_REQUESTS.create({ client, table, user });
    let active = null;
    function load(raw) { requests.load(raw); }
    function close() {
      if (active?.busy) return false;
      active = null;
      return true;
    }
    function open(word, pronunciation, options = {}) {
      if (active?.busy) return;
      active = { word, pronunciation, options, selected: null, error: "", busy: false, needsRefresh: false };
      onChange();
    }
    function render(word) {
      if (!active || active.word !== word) return null;
      const state = active;
      const form = document.createElement("form");
      form.className = "definition-picker";
      const label = document.createElement("label");
      label.textContent = "Select a requested definition";
      const select = document.createElement("select");
      label.append(select);
      function button(text) {
        const node = document.createElement("button"); node.type = "button";
        node.className = "dictionary-word-action"; node.textContent = text; return node;
      }
      const assign = button("Assign as candidate"); assign.type = "submit";
      const refresh = button("Refresh concepts");
      const cancel = button("Cancel");
      const message = document.createElement("p"); message.setAttribute("role", "status");
      form.append(label, assign, refresh, cancel, message);
      function populate() {
        select.replaceChildren();
        const placeholder = document.createElement("option"); placeholder.value = "";
        const available = requests.list().filter(item => !root.SECRET_MEANING_REQUESTS.fulfilled(item));
        placeholder.textContent = available.length ? "Choose an unassigned concept" : "No unassigned concepts — add one on Meanings needed";
        select.append(placeholder);
        for (const request of available) {
          const option = document.createElement("option"); option.value = request.conceptData.id;
          option.textContent = request.conceptData.text; select.append(option);
        }
        select.value = state.selected?.conceptData.id || "";
      }
      function update() {
        select.disabled = refresh.disabled = cancel.disabled = state.busy;
        assign.disabled = state.busy || !state.selected || state.needsRefresh;
        message.textContent = state.busy ? "Saving…" : state.error;
        onBusyChange(state.busy);
      }
      select.addEventListener("change", () => {
        state.selected = requests.list().find(item => item.conceptData.id === select.value) || null;
        state.error = ""; update();
      });
      refresh.addEventListener("click", async () => {
        if (state.busy) return;
        state.busy = true; update();
        try {
          load(await read());
          state.selected = null; state.needsRefresh = false;
          state.error = "List refreshed. Choose a concept and confirm.";
          populate();
        } catch (error) { state.error = `Could not refresh concepts: ${error.message}`; }
        finally { state.busy = false; update(); }
      });
      cancel.addEventListener("click", () => { if (close()) onChange(); });
      form.addEventListener("submit", async event => {
        event.preventDefault(); event.stopPropagation();
        if (state.busy || !state.selected || state.needsRefresh) return;
        state.busy = true; onMutation(); update();
        try {
          const assigned = await requests.assign(state.selected, state.word, state.pronunciation, state.options);
          active = null;
          onAssigned(assigned);
        } catch (error) {
          state.error = `${error.message} Refresh concepts and choose again before assigning.`;
          state.needsRefresh = true;
        } finally { state.busy = false; update(); }
      });
      // Do not let dictionary row click/keydown handlers rebuild an active picker.
      for (const event of ["click", "input", "keydown"]) form.addEventListener(event, e => e.stopPropagation());
      populate(); update();
      return form;
    }
    return { load, open, close, render, isOpen: () => Boolean(active), isBusy: () => Boolean(active?.busy) };
  }
  root.SECRET_DEFINITION_PICKER = { create };
  if (typeof module !== "undefined") module.exports = { create };
})(typeof window !== "undefined" ? window : globalThis);
