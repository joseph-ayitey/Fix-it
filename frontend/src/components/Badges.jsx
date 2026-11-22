import { STATUS_SHORT, URGENCY_LABELS } from "../labels.js";

export function StatusBadge({ status }) {
  return <span className={`badge badge--status-${status}`}>{STATUS_SHORT[status] ?? status}</span>;
}

export function UrgencyBadge({ urgency }) {
  if (urgency === "normal") return null;
  return <span className={`badge badge--urgency-${urgency}`}>{URGENCY_LABELS[urgency]}</span>;
}
