(function (root) {
  "use strict";
  function create({ document, config, onChange, requestRefresh }) {
    const rows = document.getElementById("normalizationRows");
    const status = document.getElementById("normalizationStatus");
    const retry = document.getElementById("normalizationRetry");
    const controls = {};
    let data = [];
    let loaded = false;
    let failed = false;
    function checkbox(labelText, checked, parent) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox"; input.checked = checked;
      label.appendChild(input);
      label.appendChild(document.createTextNode(labelText));
      parent.appendChild(label);
      input.addEventListener("change", () => {
        updateStatus(); onChange();
        if (enabled()) requestRefresh();
      });
      return input;
    }
    for (const [position, title] of [["start", "Start of word"], ["all", "All positions"], ["end", "End of word"]]) {
      const group = document.createElement("fieldset");
      group.className = "normalization-row";
      const legend = document.createElement("legend"); legend.textContent = title; group.appendChild(legend);
      const toggle = checkbox("Enable", false, group);
      const populations = {};
      for (const [category, label] of [["defined", "Defined"], ["candidate", "Candidates"], ["undefined", "Undefined"]]) {
        populations[category] = checkbox(label, true, group);
      }
      controls[position] = { toggle, populations };
      rows.appendChild(group);
    }
    function settings() {
      return Object.fromEntries(Object.entries(controls).map(([position, control]) => [position, {
        enabled: control.toggle.checked,
        categories: Object.entries(control.populations).filter(([, input]) => input.checked).map(([category]) => category)
      }]));
    }
    function enabled() { return Object.values(controls).some(control => control.toggle.checked); }
    function updateStatus() {
      retry.hidden = !enabled() || !failed;
      if (!enabled()) { status.textContent = "Normalization is off."; return; }
      const empty = Object.values(settings()).some(setting => setting.enabled && !setting.categories.length);
      status.textContent = (failed ? loaded
        ? "Could not refresh dictionary counts; using the last successful snapshot. Retrying while active."
        : "Could not load dictionary counts. Retry to use normalization."
        : loaded ? "Using saved dictionary words; counts refresh while active."
          : "Loading dictionary counts before normalized generation…") +
        (empty ? " An enabled setting has no populations selected and uses uniform weights." : "");
    }
    retry.addEventListener("click", () => { requestRefresh(); });
    updateStatus();
    return {
      enabled,
      ready: () => !enabled() || loaded,
      options: () => ({ suffix: document.getElementById("wordSuffix").value,
        weights: enabled() && loaded ? root.SECRET_GENERATOR_NORMALIZATION.calculate(data, config(), settings()).weights : {} }),
      accept(items) { data = items; loaded = true; failed = false; updateStatus(); onChange(); },
      success() { failed = false; updateStatus(); },
      error() { failed = true; updateStatus(); onChange(); },
      remember(item) {
        if (!loaded) return;
        data = data.filter(existing => existing.rowId !== item.rowId || existing.timestamp !== item.timestamp);
        data.push(item); updateStatus(); onChange();
      }
    };
  }
  root.SECRET_GENERATOR_CONSTRAINTS = { create };
  if (typeof module !== "undefined" && module.exports) module.exports = { create };
})(typeof window !== "undefined" ? window : globalThis);
