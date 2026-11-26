import { historyCsv, historyRows } from "./history.js";
import { RULE_TYPES } from "./rules.js";
import { byId, formatTime, send } from "./ui.js";

const enabled = byId("enabled");
const interval = byId("interval");
const scopeInputs = [...document.querySelectorAll('input[name="scope"]')];
const ruleType = byId("rule-type");
const ruleValue = byId("rule-value");
const ruleList = byId("rule-list");
const ruleForm = byId("rule-form");
const saveInterval = byId("save-interval");
const saveRule = byId("save-rule");
const cancelRule = byId("cancel-rule");
let settings;
let editingId;
let settingsBusy = false;

function showMessage(id, text = "", error = false) {
  const node = byId(id);
  node.textContent = text;
  node.hidden = !text;
  node.classList.toggle("error", error);
}

function showView() {
  const logVisible = location.hash === "#log";
  byId("settings-view").hidden = logVisible;
  byId("log-view").hidden = !logVisible;
  byId("settings-link").setAttribute("aria-current", logVisible ? "false" : "page");
  byId("log-link").setAttribute("aria-current", logVisible ? "page" : "false");
  document.title = (logVisible ? "Refresh log" : "Settings") + " · Reload-Assist";
}
window.addEventListener("hashchange", showView);
showView();

for (const [value, label] of Object.entries(RULE_TYPES)) {
  ruleType.add(new Option(label, value));
}

function updatePlaceholder() {
  const examples = {
    domain: "example.com",
    prefix: "https://example.com/dashboard/",
    exact: "https://example.com/dashboard",
    contains: "/dashboard",
  };
  ruleValue.placeholder = examples[ruleType.value];
}
ruleType.addEventListener("change", updatePlaceholder);
updatePlaceholder();

function resetRuleForm() {
  editingId = undefined;
  ruleForm.reset();
  updatePlaceholder();
  saveRule.textContent = "Add rule";
  cancelRule.hidden = true;
}

function editRule(rule) {
  editingId = rule.id;
  ruleType.value = rule.type;
  ruleValue.value = rule.value;
  updatePlaceholder();
  saveRule.textContent = "Save rule";
  cancelRule.hidden = false;
  showMessage("rule-message");
  ruleValue.focus();
}

function renderRules() {
  byId("rules-empty").hidden = settings.rules.length !== 0;

  const items = settings.rules.map((rule) => {
    const item = document.createElement("li");
    const description = document.createElement("div");
    const type = document.createElement("small");
    const value = document.createElement("strong");
    const actions = document.createElement("div");
    const edit = document.createElement("button");
    const remove = document.createElement("button");

    type.textContent = RULE_TYPES[rule.type];
    value.textContent = rule.value;
    description.append(type, value);
    actions.className = "row-actions";

    edit.type = "button";
    edit.className = "button";
    edit.textContent = "Edit";
    edit.setAttribute("aria-label", "Edit rule for " + rule.value);
    edit.addEventListener("click", () => editRule(rule));

    remove.type = "button";
    remove.className = "button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", "Remove rule for " + rule.value);
    remove.addEventListener("click", () => applySettings(
      "removeRule", { id: rule.id }, "rule-message", "Rule removed.", () => {
        if (editingId === rule.id) resetRuleForm();
        ruleValue.focus();
      },
    ));

    actions.append(edit, remove);
    item.append(description, actions);
    return item;
  });

  ruleList.replaceChildren(...items);
}

function renderSettings(next) {
  const old = settings;
  settings = next;
  if (!old || old.intervalMinutes !== next.intervalMinutes) interval.value = next.intervalMinutes;
  enabled.checked = next.enabled;
  const pill = byId("status-pill");
  pill.textContent = next.enabled ? "Active" : "Paused";
  pill.dataset.enabled = next.enabled;
  pill.hidden = false;
  for (const input of scopeInputs) input.checked = input.value === next.scope;
  byId("site-rules").hidden = next.scope !== "specific";
  if (JSON.stringify(old?.rules) !== JSON.stringify(next.rules)) renderRules();
}

function setSettingsBusy(busy) {
  settingsBusy = busy;
  for (const input of [enabled, interval, saveInterval, ...scopeInputs, ruleType, ruleValue,
    saveRule, cancelRule, ...ruleList.querySelectorAll("button")]) {
    input.disabled = busy || !settings;
  }
}

async function applySettings(type, payload, messageId, success, afterSave) {
  if (settingsBusy) return;
  setSettingsBusy(true);
  showMessage(messageId);
  try {
    const result = await send(type, payload);
    renderSettings(result.settings);
    setSettingsBusy(false);
    afterSave?.();
    showMessage(messageId, success);
  } catch (error) {
    renderSettings(settings);
    showMessage(messageId, error.message, true);
  } finally {
    setSettingsBusy(false);
  }
}

enabled.addEventListener("change", () => applySettings(
  "setEnabled", { enabled: enabled.checked }, "interval-message", "",
));
byId("interval-form").addEventListener("submit", (event) => {
  event.preventDefault();
  applySettings("setInterval", { minutes: interval.valueAsNumber },
    "interval-message", "Interval saved.", () => { interval.value = settings.intervalMinutes; });
});
for (const input of scopeInputs) {
  input.addEventListener("change", () =>
    applySettings("setScope", { scope: input.value }, "scope-message", ""));
}
ruleForm.addEventListener("submit", (event) => {
  event.preventDefault();
  applySettings("saveRule", { ruleType: ruleType.value, value: ruleValue.value, id: editingId },
    "rule-message", editingId ? "Rule updated." : "Rule added.", () => {
      resetRuleForm();
      ruleValue.focus();
    });
});
cancelRule.addEventListener("click", () => {
  resetRuleForm();
  showMessage("rule-message");
  ruleValue.focus();
});

const from = byId("date-from");
const through = byId("date-through");
const exportButton = byId("export");
const clearButton = byId("clear-log");
const clearDialog = byId("clear-dialog");
const PAGE_SIZE = 25;
let history = [];
let filteredRows = [];
let page = 0;
let clearing = false;

function renderLog() {
  const invalid = Boolean(from.value && through.value && from.value > through.value);
  showMessage("log-error", invalid ? "Choose an end date on or after the start date." : "", true);
  through.setCustomValidity(invalid ? "Choose an end date on or after the start date." : "");

  const hasDate = Boolean(from.value || through.value);
  filteredRows = invalid ? [] : historyRows(history, from.value, through.value);
  const total = filteredRows.length;
  page = Math.min(page, Math.max(0, Math.ceil(total / PAGE_SIZE) - 1));
  const start = page * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, total);
  const rows = filteredRows.slice(start, end).map(({ time, site, requested, failed }) => {
    const row = document.createElement("tr");
    for (const value of [site, formatTime(time), requested, failed]) {
      const cell = row.insertCell();
      cell.textContent = value;
    }
    return row;
  });

  byId("log-rows").replaceChildren(...rows);
  const empty = byId("log-empty");
  empty.hidden = total > 0 || invalid;
  empty.textContent = hasDate ? "No refreshes in this date range." : "No refreshes logged yet.";
  byId("result-count").textContent = total ? `${start + 1}–${end} of ${total}` : "";
  byId("pagination").hidden = total <= PAGE_SIZE;
  byId("previous").disabled = page === 0;
  byId("next").disabled = end >= total;
  exportButton.disabled = total === 0;
  clearButton.disabled = clearing || history.length === 0;
}

for (const field of [from, through]) {
  field.addEventListener("input", () => {
    page = 0;
    renderLog();
  });
}
byId("previous").addEventListener("click", () => {
  page -= 1;
  renderLog();
});
byId("next").addEventListener("click", () => {
  page += 1;
  renderLog();
});

byId("log-filters").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!filteredRows.length) return;

  const blob = new Blob(["\ufeff", historyCsv(filteredRows)], { type: "text/csv;charset=utf-8" });
  const download = document.createElement("a");
  download.href = URL.createObjectURL(blob);
  const period = from.value || through.value ? `-${from.value || "earliest"}-to-${through.value || "latest"}` : "";
  download.download = `reload-assist-log${period}.csv`;
  document.body.append(download);
  download.click();
  download.remove();
  setTimeout(() => URL.revokeObjectURL(download.href), 10_000);
});

clearButton.addEventListener("click", () => {
  clearDialog.returnValue = "cancel";
  clearDialog.showModal();
});
clearDialog.addEventListener("close", async () => {
  if (clearDialog.returnValue !== "clear") return;
  clearing = true;
  clearButton.disabled = true;
  try {
    await send("clearHistory");
    page = 0;
  } catch (error) {
    showMessage("log-error", error.message, true);
  } finally {
    clearing = false;
    clearButton.disabled = history.length === 0;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.settings) {
    renderSettings(changes.settings.newValue);
    setSettingsBusy(settingsBusy);
  }
  if (changes.history) {
    history = changes.history.newValue || [];
    renderLog();
  }
});

try {
  const result = await send("status");
  renderSettings(result.settings);
  setSettingsBusy(false);
  ({ history } = await chrome.storage.local.get({ history: [] }));
  renderLog();
} catch (error) {
  showMessage("load-error", error.message, true);
}
