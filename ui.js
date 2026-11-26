export function byId(id) {
  return document.getElementById(id);
}

export async function send(type, data) {
  const response = await chrome.runtime.sendMessage({ type, ...data });
  if (!response) throw new Error("Reload-Assist did not respond. Try again.");
  if (response.error) throw new Error(response.error);
  return response.data;
}

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatTime(time) {
  return time ? dateTime.format(time) : "—";
}

export function formatInterval(minutes) {
  if (minutes % 60 !== 0) return minutes + (minutes === 1 ? " minute" : " minutes");
  const hours = minutes / 60;
  return hours + (hours === 1 ? " hour" : " hours");
}
