import { isEligible, parseRule, webUrl } from "./rules.js";
import { trimHistory } from "./history.js";

const ALARM = "reload-assist-refresh";
const MINUTE = 60_000;
const STARTUP_GRACE = 10_000;
const RELOAD_BATCH_SIZE = 20;
const MAX_RULES = 200;
const DEFAULT_SETTINGS = {
  enabled: true,
  intervalMinutes: 60,
  scope: "all",
  rules: [],
};

let pending = Promise.resolve();
function enqueue(operation) {
  const result = pending.then(operation);
  pending = result.catch((error) => console.error("Reload-Assist:", error));
  return result;
}

function readState() {
  return chrome.storage.local.get({
    settings: DEFAULT_SETTINGS,
    nextRefreshAt: null,
    lastRefreshAt: null,
    history: [],
  });
}

async function ensureAlarm(when) {
  const alarm = await chrome.alarms.get(ALARM);
  // A browser may defer nearby alarms to its minimum delay.
  if (!alarm || alarm.scheduledTime < when - 1000 || alarm.scheduledTime > when + 30_000) {
    await chrome.alarms.create(ALARM, { when });
  }
}

async function reloadTabs(tabs) {
  const sites = new Map();
  for (let start = 0; start < tabs.length; start += RELOAD_BATCH_SIZE) {
    await Promise.all(tabs.slice(start, start + RELOAD_BATCH_SIZE).map(async ({ id, url }) => {
      let counts = sites.get(url.hostname);
      if (!counts) {
        counts = [url.hostname, 0, 0];
        sites.set(url.hostname, counts);
      }
      try {
        await chrome.tabs.reload(id);
        counts[1] += 1;
      } catch {
        counts[2] += 1;
      }
    }));
  }

  return [...sites.values()].sort(([left], [right]) => left.localeCompare(right));
}

async function synchronize(state) {
  const { settings, nextRefreshAt } = state;
  if (!settings.enabled) {
    await chrome.alarms.clear(ALARM);
    return state;
  }

  let { resumeAfter } = await chrome.storage.session.get({ resumeAfter: 0 });
  if (!resumeAfter) {
    // Give a newly opened browser time to restore its tabs.
    resumeAfter = Date.now() + STARTUP_GRACE;
    await chrome.storage.session.set({ resumeAfter });
  }

  const now = Date.now();
  if (nextRefreshAt === null) {
    state.nextRefreshAt = now + settings.intervalMinutes * MINUTE;
    await ensureAlarm(state.nextRefreshAt);
    await chrome.storage.local.set({ settings, nextRefreshAt: state.nextRefreshAt });
  } else if (Math.max(nextRefreshAt, resumeAfter) > now) {
    await ensureAlarm(Math.max(nextRefreshAt, resumeAfter));
  } else {
    const tabs = (await chrome.tabs.query({}))
      .map((tab) => ({ id: tab.id, url: webUrl(tab.pendingUrl || tab.url) }))
      .filter(({ id, url }) => Number.isInteger(id) && isEligible(url, settings));

    const refreshedAt = Date.now();
    state.nextRefreshAt = refreshedAt + settings.intervalMinutes * MINUTE;
    // Advance the deadline before reloading so queued events can't repeat this cycle.
    await ensureAlarm(state.nextRefreshAt);
    await chrome.storage.local.set({ nextRefreshAt: state.nextRefreshAt });

    const sites = await reloadTabs(tabs);
    if (sites.length) {
      state.lastRefreshAt = refreshedAt;
      state.history = trimHistory([[refreshedAt, sites], ...state.history], refreshedAt);
      await chrome.storage.local.set({
        lastRefreshAt: state.lastRefreshAt,
        history: state.history,
      });
    }
  }
  return state;
}

async function synchronizeFromStorage() {
  await synchronize(await readState());
}

function status({ settings, nextRefreshAt, lastRefreshAt }) {
  return { settings, nextRefreshAt, lastRefreshAt };
}

async function handleMessage(message) {
  const state = await readState();
  const { settings } = state;

  switch (message.type) {
    case "status":
      return status(await synchronize(state));

    case "setEnabled": {
      if (typeof message.enabled !== "boolean") throw new Error("Choose on or off.");
      if (settings.enabled === message.enabled) return status(await synchronize(state));
      settings.enabled = message.enabled;
      state.nextRefreshAt = settings.enabled ? Date.now() + settings.intervalMinutes * MINUTE : null;
      if (settings.enabled) await ensureAlarm(state.nextRefreshAt);
      await chrome.storage.local.set({ settings, nextRefreshAt: state.nextRefreshAt });
      if (!settings.enabled) await chrome.alarms.clear(ALARM);
      return status(state);
    }

    case "setInterval": {
      const { minutes } = message;
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
        throw new Error("Enter an interval from 1 to 1,440 minutes.");
      }
      if (settings.intervalMinutes === minutes) return status(await synchronize(state));
      settings.intervalMinutes = minutes;
      state.nextRefreshAt = settings.enabled ? Date.now() + minutes * MINUTE : null;
      if (settings.enabled) await ensureAlarm(state.nextRefreshAt);
      await chrome.storage.local.set({ settings, nextRefreshAt: state.nextRefreshAt });
      return status(state);
    }

    case "setScope":
      if (!["all", "specific"].includes(message.scope)) throw new Error("Choose a refresh scope.");
      settings.scope = message.scope;
      break;

    case "saveRule": {
      const rule = parseRule(message.ruleType, message.value);
      const existing = settings.rules.findIndex(({ id }) => id === message.id);
      if (message.id && existing === -1) throw new Error("This rule has already been removed.");
      if (settings.rules.some(({ id, type, value }) =>
        id !== message.id && type === rule.type && value === rule.value)) {
        throw new Error("This rule already exists.");
      }

      if (existing === -1) {
        if (settings.rules.length >= MAX_RULES) throw new Error("Remove a rule before adding another.");
        settings.rules.push({ ...rule, id: crypto.randomUUID() });
      } else {
        settings.rules[existing] = { ...rule, id: message.id };
      }
      break;
    }

    case "removeRule":
      settings.rules = settings.rules.filter(({ id }) => id !== message.id);
      break;

    case "clearHistory":
      await chrome.storage.local.remove("history");
      return status(state);

    default:
      throw new Error("Unknown request.");
  }

  await chrome.storage.local.set({ settings });
  return status(state);
}

chrome.runtime.onInstalled.addListener(() => enqueue(synchronizeFromStorage));
chrome.runtime.onStartup.addListener(() => enqueue(synchronizeFromStorage));
chrome.alarms.onAlarm.addListener(({ name }) => {
  if (name === ALARM) enqueue(synchronizeFromStorage);
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !message?.type) return false;
  enqueue(() => handleMessage(message)).then(
    (data) => respond({ data }),
    (error) => respond({ error: error.message }),
  );
  return true;
});
