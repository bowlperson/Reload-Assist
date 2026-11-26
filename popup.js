import { byId, formatInterval, formatTime, send } from "./ui.js";

const enabled = byId("enabled");
const message = byId("message");
let current;

function render() {
  if (!current) return;
  const { settings, nextRefreshAt, lastRefreshAt } = current;
  enabled.checked = settings.enabled;
  byId("scope").textContent = settings.scope === "all" ? "All web tabs" : "Specific sites";
  byId("interval").textContent = formatInterval(settings.intervalMinutes);
  byId("last-refresh").textContent = lastRefreshAt ? formatTime(lastRefreshAt) : "None yet";

  let next = "Paused";
  if (settings.enabled) {
    if (settings.scope === "specific" && settings.rules.length === 0) next = "Add a site rule";
    else if (!nextRefreshAt || nextRefreshAt <= Date.now()) next = "Due now";
    else next = formatTime(nextRefreshAt);
  }
  byId("next-refresh").textContent = next;
}

async function update(getStatus) {
  enabled.disabled = true;
  message.hidden = true;
  try {
    current = await getStatus();
  } catch (error) {
    message.textContent = error.message;
    message.hidden = false;
  } finally {
    render();
    enabled.disabled = !current;
  }
}

enabled.addEventListener("change", () => update(() => send("setEnabled", { enabled: enabled.checked })));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !current) return;
  for (const key of ["settings", "nextRefreshAt", "lastRefreshAt"]) {
    if (Object.hasOwn(changes, key)) current[key] = changes[key].newValue;
  }
  render();
});
setInterval(render, 1000);
update(() => send("status"));
