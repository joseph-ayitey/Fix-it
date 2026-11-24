import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useApi, usePagedApi } from "../useApi.js";
import IssueList from "../components/IssueList.jsx";
import { EmptyState, ErrorMessage, LoadMore, Skeleton } from "../components/Status.jsx";
import { CATEGORY_LABELS, propertyName, SORT_LABELS, URGENCY_LABELS } from "../labels.js";

const TABS = [
  ["active", "Active"],
  ["resolved", "Awaiting confirmation"],
  ["closed", "Closed"],
  ["", "All"],
];

const PAGE_SIZE = 20;
// Query-string keys besides the status tab (left out of the URL when empty).
const FILTERS = ["propertyId", "assignment", "urgency", "category", "q", "sort"];

/**
 * The search box. It keeps its own text while you type and writes it to the URL a
 * moment after you stop (or at once on Enter), so the list isn't refetched on every key.
 */
function SearchBox({ value, onSearch }) {
  const [text, setText] = useState(value);
  // Follow the URL when it changes from outside (Back button, "Clear filters").
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text.trim() === value) return;
    const t = setTimeout(() => onSearch(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text, value, onSearch]);

  return (
    <form
      role="search"
      className="search-box"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(text.trim());
      }}
    >
      <label htmlFor="issue-search" className="visually-hidden">
        Search issues
      </label>
      <input
        id="issue-search"
        type="search"
        placeholder="Search titles and descriptions…"
        maxLength={200}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </form>
  );
}

function Select({ id, label, value, onChange, options, any }) {
  return (
    <label className="inline-field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {any && <option value="">{any}</option>}
        {Object.entries(options).map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function IssuesPage() {
  const { user } = useAuth();
  const role = user.role;
  const isLandlord = role === "landlord";
  const [params, setParams] = useSearchParams();
  // Every filter lives in the URL, so a filtered inbox can be bookmarked, shared and
  // survives a reload or the Back button.
  const status = params.get("status") ?? "active";
  const propertyId = params.get("propertyId") ?? "";
  const assignment = isLandlord ? (params.get("assignment") ?? "") : "";
  const urgency = params.get("urgency") ?? "";
  const category = params.get("category") ?? "";
  const q = params.get("q") ?? "";
  const sort = params.get("sort") ?? "priority";

  const issues = usePagedApi(
    (cursor, signal, size) =>
      api.listIssues(
        // `priority` is the server's default, so it's left out of the request and the URL.
        { status, propertyId, assignment, urgency, category, q, sort: sort === "priority" ? "" : sort, limit: size ?? PAGE_SIZE, cursor },
        { signal },
      ),
    [status, propertyId, assignment, urgency, category, q, sort],
    { live: true }, // new reports and status changes by others appear without a refresh
  );
  // For the property filter. Up to 100 (the API's maximum page size) is plenty for a
  // drop-down; a landlord with more would search by text instead.
  const properties = useApi((signal) => (role === "worker" ? Promise.resolve(null) : api.listProperties({ limit: 100 }, { signal })), [role]);

  function update(changes) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(changes)) next.set(k, v);
      // Keep the URL tidy: leave out filters that aren't set.
      for (const k of FILTERS) if (!next.get(k) || (k === "sort" && next.get(k) === "priority")) next.delete(k);
      return next;
    });
  }
  // Stable, so the search box's debounce timer isn't restarted by unrelated re-renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const onSearch = useCallback((text) => update({ q: text }), [setParams]);
  const filtered = Boolean(propertyId || assignment || urgency || category || q);
  // The sort order is a preference, not a filter, so "Clear filters" keeps it.
  const clearFilters = () => update(Object.fromEntries(FILTERS.filter((k) => k !== "sort").map((k) => [k, ""])));

  const propertyOptions = Object.fromEntries((properties.data?.items ?? []).map((p) => [p.id, propertyName(p)]));

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
        <SearchBox value={q} onSearch={onSearch} />
      </div>

      <div className="toolbar toolbar--filters" aria-label="More filters" role="group">
        <Select id="filter-urgency" label="Urgency" value={urgency} onChange={(v) => update({ urgency: v })} options={URGENCY_LABELS} any="Any" />
        <Select id="filter-category" label="Category" value={category} onChange={(v) => update({ category: v })} options={CATEGORY_LABELS} any="All" />
        {isLandlord && (
          <Select
            id="filter-assignment"
            label="Worker"
            value={assignment}
            onChange={(v) => update({ assignment: v })}
            options={{ unassigned: "No worker yet", assigned: "Assigned" }}
            any="Any"
          />
        )}
        {Object.keys(propertyOptions).length > 1 && (
          <Select id="filter-property" label="Property" value={propertyId} onChange={(v) => update({ propertyId: v })} options={propertyOptions} any="All properties" />
        )}
        <Select id="filter-sort" label="Sort" value={sort} onChange={(v) => update({ sort: v })} options={SORT_LABELS} />
        {filtered && (
          <button type="button" className="button--ghost button--small" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {issues.error ? (
        <ErrorMessage error={issues.error} title="Couldn't load issues" onRetry={issues.reload} />
      ) : !issues.items ? (
        <Skeleton variant="list" count={4} label="Loading issues…" />
      ) : issues.items.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No issues match these filters."
            action={
              <button type="button" className="button--ghost" onClick={clearFilters}>
                Clear filters
              </button>
            }
          >
            Try a different search, or widen the filters.
          </EmptyState>
        ) : (
          <EmptyState
            icon="✓"
            title={status === "active" ? "No active issues." : "No issues here."}
            action={
              role === "tenant" && (
                <Link to="/issues/new" className="button">
                  Report an issue
                </Link>
              )
            }
          >
            {{
              landlord: "When a tenant reports something, it appears here.",
              tenant: "If something in your home breaks, report it and follow it here.",
              worker: "Accept a job offer from your dashboard and it appears here.",
            }[role]}
          </EmptyState>
        )
      ) : (
        <div aria-busy={issues.loading}>
          <IssueList issues={issues.items} showReporter={role !== "tenant"} />
          <LoadMore list={issues} label="Load more issues" noun="issues" />
        </div>
      )}
    </>
  );
}
