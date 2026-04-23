const DISCORD_EPOCH = 1420070400000n;

export function getYesterdayRangeKst(now = new Date()) {
  const current = getKstParts(now);
  const end = new Date(Date.UTC(current.year, current.month - 1, current.day - 1, 15, 0, 0, 0));
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);

  return {
    start,
    end,
    date: formatKstDate(start),
    startSnowflake: timestampToSnowflake(start.getTime()),
    endSnowflake: timestampToSnowflake(end.getTime())
  };
}

export function getDelayUntilNextRun(timeString, now = new Date()) {
  const [hour, minute] = parseTime(timeString);
  const current = getKstParts(now);
  let target = new Date(Date.UTC(current.year, current.month - 1, current.day, hour - 9, minute, 0, 0));

  if (target <= now) {
    target = new Date(target.getTime() + 24 * 60 * 60 * 1000);
  }

  return target.getTime() - now.getTime();
}

export function formatKstTime(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

export function formatKstDate(date) {
  const parts = getKstParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function getKstParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year").value),
    month: Number(parts.find((part) => part.type === "month").value),
    day: Number(parts.find((part) => part.type === "day").value)
  };
}

function parseTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Invalid DAILY_REPORT_TIME: ${value}. Expected HH:mm`);
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error(`Invalid DAILY_REPORT_TIME: ${value}. Expected HH:mm`);
  }

  return [hour, minute];
}

function timestampToSnowflake(timestampMs) {
  return ((BigInt(timestampMs) - DISCORD_EPOCH) << 22n).toString();
}
