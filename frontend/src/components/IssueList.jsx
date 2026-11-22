import { Link } from "react-router-dom";
import { CATEGORY_LABELS, waitingText, workerLabel } from "../labels.js";
import { StatusBadge, UrgencyBadge } from "./Badges.jsx";
import { EmptyState } from "./Status.jsx";

/** Issue rows, with the property shown unless the list is already for one property. */
export default function IssueList({ issues, showProperty = true, showReporter = false, empty = "No issues." }) {
  if (!issues.length) return <EmptyState>{empty}</EmptyState>;
  const now = Date.now();
  return (
    <ul className="issue-list">
      {issues.map((issue) => {
        const overdue = ["open", "in_progress"].includes(issue.status) && !issue.acknowledgedAt;
        return (
          <li key={issue.id} className={`issue-row${overdue && issue.urgency === "urgent" ? " issue-row--alert" : ""}`}>
            <Link to={`/issues/${issue.id}`} className="issue-row__link">
              <div className="issue-row__main">
                <span className="issue-row__title">{issue.title}</span>
                <span className="issue-row__badges">
                  <UrgencyBadge urgency={issue.urgency} />
                  <StatusBadge status={issue.status} />
                </span>
              </div>
              <div className="issue-row__meta">
                {[
                  CATEGORY_LABELS[issue.category],
                  showProperty && (issue.property.label || issue.property.address),
                  showReporter && `Reported by ${issue.reporter.name}`,
                  issue.assignee
                    ? `Worker: ${workerLabel(issue.assignee)}`
                    : ["open", "in_progress"].includes(issue.status) && showReporter && "No worker yet",
                  issue.photoCount > 0 && `📷 ${issue.photoCount}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              <div className={`issue-row__waiting${overdue ? " issue-row__waiting--overdue" : ""}`}>{waitingText(issue, now)}</div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
