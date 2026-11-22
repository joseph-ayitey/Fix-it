// Human wording for the API's enum values, kept in one place.

export const STATUS_LABELS = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved: awaiting tenant",
  closed: "Closed",
};

export const STATUS_SHORT = { open: "Open", in_progress: "In progress", resolved: "Resolved", closed: "Closed" };

export const CATEGORY_LABELS = {
  plumbing: "Plumbing / leaks",
  electrical: "Electrical",
  heating: "Heating / hot water",
  appliance: "Appliance",
  structural: "Walls, windows, doors, roof",
  pest: "Pests / damp / mould",
  security: "Locks & security",
  other: "Other",
};

export const URGENCY_LABELS = { low: "Low", normal: "Normal", urgent: "Urgent" };

export const URGENCY_HINTS = {
  low: "Annoying but can wait: a sticking drawer, a cosmetic crack.",
  normal: "Needs fixing soon: a broken appliance, a slow drain.",
  urgent: "Safety risk or a home that isn't livable: active leak, no heat or hot water, a broken lock, exposed wiring.",
};

// Must match backend/src/utils/people.js.
export const TRADES = {
  plumber: "Plumber",
  electrician: "Electrician",
  heating_engineer: "Heating engineer",
  appliance_repair: "Appliance repair",
  builder: "Builder",
  locksmith: "Locksmith",
  pest_control: "Pest control",
  handyman: "Handyman",
};

/** The trade pre-selected in "Find a worker" for each issue category. */
export const TRADE_FOR_CATEGORY = {
  plumbing: "plumber",
  electrical: "electrician",
  heating: "heating_engineer",
  appliance: "appliance_repair",
  structural: "builder",
  pest: "pest_control",
  security: "locksmith",
  other: "handyman",
};

/** What each status button says, from the viewer's point of view. */
export function transitionLabel(to, role, fromStatus) {
  if (role === "tenant") return { closed: "Withdraw (no longer needed)", open: "Still not fixed: reopen" }[to] ?? to;
  if (role === "landlord" && fromStatus === "resolved") {
    return { in_progress: "Send back: not done properly", closed: "Close (tenant hasn't replied in 7 days)" }[to] ?? to;
  }
  return { in_progress: "Start work", resolved: "Mark as fixed" }[to] ?? to;
}

/** "Marc R. · Plumber" */
export function workerLabel(worker) {
  if (!worker) return null;
  return worker.tradeLabel ? `${worker.name} · ${worker.tradeLabel}` : worker.name;
}

/** Who still has to confirm a resolved issue: e.g. ["tenant", "landlord"]. */
export function pendingConfirmations(issue) {
  if (issue.status !== "resolved" || !issue.confirmations) return [];
  return ["tenant", "landlord"].filter((who) => !issue.confirmations[who]);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "3 days", "5 hours", "just now" */
export function duration(ms) {
  if (ms < MINUTE) return "less than a minute";
  if (ms < HOUR) return plural(Math.floor(ms / MINUTE), "minute");
  if (ms < DAY) return plural(Math.floor(ms / HOUR), "hour");
  return plural(Math.floor(ms / DAY), "day");
}

export function ago(iso, now = Date.now()) {
  const ms = now - Date.parse(iso);
  return ms < MINUTE ? "just now" : `${duration(ms)} ago`;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * The one-line "where does this stand" message for an issue, the thing both sides
 * argue about without FixIt: how long has it been waiting, and on whom.
 */
export function waitingText(issue, now = Date.now()) {
  if (issue.status === "closed") return `Closed ${ago(issue.closedAt, now)}`;
  if (issue.status === "resolved") {
    const waiting = pendingConfirmations(issue);
    const who = waiting.length === 2 ? "tenant and landlord" : waiting[0] ?? "confirmation";
    return `Marked fixed ${ago(issue.resolvedAt, now)} · waiting for ${who} to confirm`;
  }
  if (!issue.acknowledgedAt) return `No response from landlord for ${duration(now - Date.parse(issue.createdAt))}`;
  const responded = duration(Date.parse(issue.acknowledgedAt) - Date.parse(issue.createdAt));
  return `Landlord responded after ${responded} · open for ${duration(now - Date.parse(issue.createdAt))}`;
}

export const propertyName = (p) => p.label || p.streetAddress || p.addressInput || p.address;
