const DISCORD_EPOCH = 1420070400000n;

const KST_WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

// Returns the target workday range in KST for daily worklog generation.
// - Mon (KST): targets previous Friday (3 days back)
// - Tue-Fri (KST): targets the previous day (1 day back)
// - Sat/Sun (KST): returns null so the caller can skip the run
export function getTargetWorkdayRangeKst(now = new Date()) {
  const current = getKstParts(now);
  const weekday = getKstWeekday(now);

  if (weekday === 0 || weekday === 6) {
    return null;
  }

  const daysBack = weekday === 1 ? 3 : 1;

  const end = new Date(
    Date.UTC(current.year, current.month - 1, current.day - daysBack, 15, 0, 0, 0)
  );
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);

  return {
    start,
    end,
    date: formatKstDate(start),
    startSnowflake: timestampToSnowflake(start.getTime()),
    endSnowflake: timestampToSnowflake(end.getTime()),
    weekday: KST_WEEKDAY_NAMES[weekday]
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

function getKstWeekday(date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short"
  });
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[formatter.format(date)];
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
