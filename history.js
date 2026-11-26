export const RETENTION_DAYS = 30;
export const MAX_SITE_ROWS = 10_000;

export function trimHistory(rounds, now = Date.now()) {
  const cutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let remaining = MAX_SITE_ROWS;
  const trimmed = [];

  for (const [time, sites] of rounds) {
    if (remaining === 0) break;
    if (time < cutoff) continue;
    trimmed.push([time, sites.slice(0, remaining)]);
    remaining -= trimmed.at(-1)[1].length;
  }

  return trimmed;
}

export function dateBounds(from, through) {
  function midnight(input, extraDays = 0) {
    const [year, month, day] = input.split("-").map(Number);
    const date = new Date(0);
    date.setFullYear(year, month - 1, day + extraDays);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  return {
    start: from ? midnight(from) : -Infinity,
    end: through ? midnight(through, 1) : Infinity,
  };
}

export function historyRows(rounds, from = "", through = "") {
  const { start, end } = dateBounds(from, through);
  return trimHistory(rounds)
    .filter(([time]) => time >= start && time < end)
    .flatMap(([time, sites]) => sites.map(([site, requested, failed]) => ({
      time, site, requested, failed,
    })));
}

export function historyCsv(rows) {
  function field(value) {
    let safe = String(value);
    if (/^[=+\-@\t\r\n]/u.test(safe)) safe = "'" + safe;
    return '"' + safe.replaceAll('"', '""') + '"';
  }

  return [
    "site,refresh_time_utc,reloads_requested,reload_request_failures",
    ...rows.map(({ time, site, requested, failed }) =>
      [site, new Date(time).toISOString(), requested, failed].map(field).join(",")),
  ].join("\r\n") + "\r\n";
}
