import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useApi } from "../useApi.js";
import IssueList from "../components/IssueList.jsx";
import { ErrorMessage, Loading } from "../components/Status.jsx";
import { propertyName } from "../labels.js";

const TABS = [
  ["active", "Active"],
  ["resolved", "Awaiting confirmation"],
  ["closed", "Closed"],
  ["", "All"],
];

export default function IssuesPage() {
  const { user } = useAuth();
  const role = user.role;
  const isLandlord = role === "landlord";
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "active";
  const propertyId = params.get("propertyId") ?? "";
  const assignment = isLandlord ? (params.get("assignment") ?? "") : "";

  const issues = useApi((signal) => api.listIssues({ status, propertyId, assignment }, { signal }), [status, propertyId, assignment]);
  const properties = useApi((signal) => api.listProperties({ signal }), []);

  function update(changes) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) next.set(k, v);
    if (!next.get("propertyId")) next.delete("propertyId");
    if (!next.get("assignment")) next.delete("assignment");
    setParams(next);
  }

  return (
    <>
      <div className="page-header page-header--row">
        <h1>{{ landlord: "Issue inbox", tenant: "Your issues", worker: "Your jobs" }[role]}</h1>
        {role === "tenant" && (
          <Link to="/issues/new" className="button">
            Report an issue
          </Link>
        )}
      </div>

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Filter by status">
          {TABS.map(([value, label]) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={status === value}
              className={`tab${status === value ? " tab--active" : ""}`}
              onClick={() => update({ status: value })}
            >
              {label}
            </button>
          ))}
        </div>
        {isLandlord && (
          <label className="inline-field">
            <span>Worker</span>
            <select value={assignment} onChange={(e) => update({ assignment: e.target.value })}>
              <option value="">Any</option>
              <option value="unassigned">No worker yet</option>
              <option value="assigned">Assigned</option>
            </select>
          </label>
        )}
        {properties.data && properties.data.length > 1 && (
          <label className="inline-field">
            <span>Property</span>
            <select value={propertyId} onChange={(e) => update({ propertyId: e.target.value })}>
              <option value="">All properties</option>
              {properties.data.map((p) => (
                <option key={p.id} value={p.id}>
                  {propertyName(p)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <ErrorMessage error={issues.error} title="Couldn't load issues" />
      {issues.loading && !issues.data ? (
        <Loading />
      ) : (
        issues.data && (
          <IssueList
            issues={issues.data}
            showReporter={role !== "tenant"}
            empty={status === "active" ? "No active issues. 🎉" : "No issues here."}
          />
        )
      )}
    </>
  );
}
