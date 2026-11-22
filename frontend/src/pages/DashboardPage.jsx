import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useApi } from "../useApi.js";
import IssueList from "../components/IssueList.jsx";
import OfferList from "../components/OfferList.jsx";
import PropertyMap from "../components/PropertyMap.jsx";
import ActivityFeed from "../components/ActivityFeed.jsx";
import { CategoryBars, WeeklyTrend } from "../components/Charts.jsx";
import { EmptyState, ErrorMessage, Skeleton } from "../components/Status.jsx";
import { formatHours, PIN_LABELS, pinState, propertyName } from "../labels.js";

function prefersReducedMotion() {
  return typeof window === "undefined" || !window.matchMedia || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Animate a number from 0 up to `target` once (ease-out, ~0.8 s). With reduced motion,
 * or where animation isn't available (tests), it shows the final number at once.
 */
function useCountUp(target, duration = 800) {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));
  useEffect(() => {
    if (prefersReducedMotion() || typeof requestAnimationFrame !== "function") {
      setValue(target);
      return;
    }
    let frame;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

function Tile({ value = 0, label, tone, to }) {
  const shown = useCountUp(value);
  const className = `tile${tone && value ? ` tile--${tone}` : ""}`;
  const body = (
    <>
      {/* Screen readers get the final number, not every step of the animation. */}
      <span className="tile__value" aria-hidden="true">
        {shown}
      </span>
      <span className="visually-hidden">{value} </span>
      <span className="tile__label">{label}</span>
    </>
  );
  return to ? (
    <Link to={to} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** The properties beside the map. Hovering or focusing a card highlights its pin, and clicking a pin highlights the card. */
function PropertyCards({ homes, role, selectedId, onSelect, cardRefs }) {
  return (
    <ul className="dash-cards" aria-label={role === "landlord" ? "Your properties" : "Properties"}>
      {homes.map((p) => {
        const state = pinState(p);
        return (
          <li
            key={p.id}
            ref={(el) => (el ? cardRefs.current.set(p.id, el) : cardRefs.current.delete(p.id))}
            className={`dash-card${selectedId === p.id ? " dash-card--selected" : ""}`}
            onMouseEnter={() => onSelect(p.id)}
          >
            <Link to={`/properties/${p.id}`} className="dash-card__link" onFocus={() => onSelect(p.id)}>
              <span className={`pin-dot pin-dot--${state}`} title={PIN_LABELS[state]} aria-hidden="true" />
              <span className="dash-card__text">
                <strong className="dash-card__title">{propertyName(p)}</strong>
                <span className="muted small">
                  {p.openIssueCount} open
                  {p.urgentIssueCount ? <strong className="text-danger"> · {p.urgentIssueCount} urgent</strong> : null}
                  {role === "landlord" ? ` · ${p.tenantCount} tenant${p.tenantCount === 1 ? "" : "s"}` : ` · ${p.landlord.name}`}
                  {p.latitude === null && " · not on map"}
                </span>
                <span className="visually-hidden">{PIN_LABELS[state]}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function MapLegend() {
  return (
    <ul className="map-legend" aria-label="Map key">
      {Object.entries(PIN_LABELS).map(([state, label]) => (
        <li key={state}>
          <span className={`pin-dot pin-dot--${state}`} aria-hidden="true" /> {label}
        </li>
      ))}
    </ul>
  );
}

/** Map of properties with pins coloured by state, and the matching cards beside it. */
function PropertiesPanel({ homes, more, role }) {
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState(null);
  const cardRefs = useRef(new Map());
  const mapped = homes.filter((p) => p.latitude !== null && p.longitude !== null);

  function onPin(id) {
    setSelectedId(id);
    const card = cardRefs.current.get(id);
    card?.scrollIntoView?.({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  const title = { landlord: "Your properties", tenant: "Your home", worker: "Where your jobs are" }[role];
  return (
    <section className="panel dash-map" aria-labelledby="dash-map-title">
      <div className="section__head">
        <h2 id="dash-map-title" className="panel__title">
          {title}
        </h2>
        {role !== "worker" && <Link to="/properties">{role === "landlord" ? "Manage →" : "Details →"}</Link>}
      </div>
      {homes.length === 0 ? (
        role === "landlord" ? (
          <EmptyState
            title="No properties yet."
            action={
              <Link to="/properties/new" className="button">
                Add your first property
              </Link>
            }
          >
            Add one and share its join code with your tenants.
          </EmptyState>
        ) : (
          <EmptyState title="No job locations yet.">Accept a job offer and its address appears here.</EmptyState>
        )
      ) : (
        <div className="dash-map__body">
          {mapped.length > 0 ? (
            <div>
              <PropertyMap
                properties={mapped}
                height={300}
                colourByState
                selectedId={selectedId}
                // A first click highlights the card; clicking the same pin again opens the property.
                onSelect={(id) => (id === selectedId ? navigate(`/properties/${id}`) : onPin(id))}
              />
              <MapLegend />
            </div>
          ) : (
            <p className="muted small">None of these addresses could be placed on the map yet.</p>
          )}
          <div>
            <PropertyCards homes={homes} role={role} selectedId={selectedId} onSelect={setSelectedId} cardRefs={cardRefs} />
            {more && <p className="muted small">Showing the first {homes.length}. <Link to="/properties">See them all →</Link></p>}
          </div>
        </div>
      )}
    </section>
  );
}

/** Median time to first response and to close, with how many issues each is based on. */
function ResponseTimes({ rt, role }) {
  const metrics = [
    {
      label: role === "tenant" ? "Your landlord's first response" : "First response",
      hours: rt.medianHoursToFirstResponse,
      count: rt.respondedCount,
    },
    { label: role === "tenant" ? "Fixed and closed" : "Time to close", hours: rt.medianHoursToClose, count: rt.closedCount },
  ];
  return (
    <div className="metrics">
      {metrics.map((m) => (
        <div key={m.label} className="metric">
          <span className="metric__label">{m.label}</span>
          {m.hours === null ? (
            <>
              <span className="metric__value metric__value--none">Not enough data yet</span>
              <span className="muted small">Shown once an issue gets this far.</span>
            </>
          ) : (
            <>
              <span className="metric__value">{formatHours(m.hours)}</span>
              <span className="muted small">
                median of {m.count} issue{m.count === 1 ? "" : "s"}
              </span>
            </>
          )}
        </div>
      ))}
      <p className="muted small metrics__note">Issues reported in the last {rt.windowDays} days.</p>
    </div>
  );
}

/** Response times, issues by category and the 12-week trend, from GET /dashboard/stats. */
function StatsPanels({ stats, role }) {
  if (stats.error) {
    return (
      <div className="dash-charts">
        <ErrorMessage error={stats.error} title="Couldn't load your statistics" onRetry={stats.reload} />
      </div>
    );
  }
  if (!stats.data) {
    return (
      <div className="dash-charts">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} variant="block" height={220} label={i === 1 ? "Loading statistics…" : ""} />
        ))}
      </div>
    );
  }
  const s = stats.data;
  return (
    <div className="dash-charts">
      <section className="panel" aria-labelledby="rt-title">
        <h2 id="rt-title" className="panel__title">
          Response times
        </h2>
        <ResponseTimes rt={s.responseTimes} role={role} />
      </section>
      <section className="panel" aria-labelledby="cat-title">
        <h2 id="cat-title" className="panel__title">
          Issues by category
        </h2>
        <CategoryBars byCategory={s.byCategory} />
      </section>
      <section className="panel" aria-labelledby="trend-title">
        <h2 id="trend-title" className="panel__title">
          Last 12 weeks
        </h2>
        <WeeklyTrend weekly={s.weekly} />
      </section>
    </div>
  );
}

// What each role needs to see first.
const COPY = {
  landlord: {
    section: "Needs attention",
    empty: "No active issues across your properties.",
    tiles: (s) => [
      { value: s.active, label: "Active issues", to: "/issues" },
      { value: s.urgent, label: "Urgent", tone: "danger", to: "/issues?urgency=urgent" },
      { value: s.unacknowledged, label: "Awaiting your response", tone: "warning" },
      { value: s.unassigned, label: "No worker assigned", tone: "warning", to: "/issues?assignment=unassigned" },
      { value: s.needsYourConfirmation, label: "Fixed: approve the work", tone: "warning", to: "/issues?status=resolved" },
    ],
  },
  tenant: {
    section: "Your open issues",
    empty: "Nothing open. If something breaks, report it here.",
    tiles: (s) => [
      { value: s.active, label: "Active issues", to: "/issues" },
      { value: s.urgent, label: "Urgent", tone: "danger", to: "/issues?urgency=urgent" },
      { value: s.unacknowledged, label: "Not yet acknowledged", tone: "warning" },
      { value: s.needsYourConfirmation, label: "Fixed: please confirm", tone: "warning", to: "/issues?status=resolved" },
    ],
  },
  worker: {
    section: "Your jobs",
    empty: "No active jobs. Accept a job offer and it appears here.",
    tiles: (s) => [
      { value: s.pendingOffers, label: "Job offers waiting", tone: "warning" },
      { value: s.active, label: "Active jobs", to: "/issues" },
      { value: s.urgent, label: "Urgent", tone: "danger", to: "/issues?urgency=urgent" },
      { value: s.awaitingConfirmation, label: "Fixed, awaiting confirmation", to: "/issues?status=resolved" },
    ],
  },
};

function subtitle(role, s, homes) {
  if (role === "landlord") {
    if (s.unacknowledged) return `${s.unacknowledged} issue${s.unacknowledged === 1 ? " is" : "s are"} waiting for a first response.`;
    if (s.unassigned) return `${s.unassigned} active issue${s.unassigned === 1 ? " has" : "s have"} no worker yet.`;
    return "You're up to date on every reported issue.";
  }
  if (role === "worker") {
    if (s.pendingOffers) return `You have ${s.pendingOffers} job offer${s.pendingOffers === 1 ? "" : "s"} to answer.`;
    return s.active ? "Here's what you're working on." : "No jobs right now.";
  }
  return homes.length ? "Report a problem in your home and follow it until it's fixed." : "Link your home to get started.";
}

export default function DashboardPage() {
  const { user } = useAuth();
  const role = user.role;

  const summary = useApi((signal) => api.issueSummary({ signal }), []);
  // The first 100 (the API's largest page) is plenty for a dashboard map; the
  // Properties page has "Load more" for the rest.
  const properties = useApi((signal) => api.listProperties({ limit: 100 }, { signal }), []);
  const stats = useApi((signal) => api.dashboardStats({ signal }), []);
  // The top of the inbox: the server's default `priority` sort puts what needs attention first.
  const issues = useApi((signal) => api.listIssues({ status: "active", limit: 5 }, { signal }), []);
  const offers = useApi((signal) => (role === "worker" ? api.offers({ signal }) : Promise.resolve(null)), [role]);

  const header = (homes, s) => (
    <div className="page-header page-header--row">
      <div>
        <h1>Hi, {user.name.split(" ")[0]}</h1>
        {s && <p className="muted">{subtitle(role, s, homes)}</p>}
      </div>
      {role === "landlord" && (
        <Link to="/properties/new" className="button">
          Add property
        </Link>
      )}
      {role === "tenant" && homes.length > 0 && (
        <Link to="/issues/new" className="button">
          Report an issue
        </Link>
      )}
    </div>
  );

  const error = summary.error || properties.error;
  if (error) {
    return (
      <>
        {header([], null)}
        <ErrorMessage
          error={error}
          title="Couldn't load your dashboard"
          onRetry={() => {
            summary.reload();
            properties.reload();
          }}
        />
      </>
    );
  }
  if (!summary.data || !properties.data) {
    return (
      <>
        {header([], null)}
        <Skeleton variant="tiles" count={4} label="Loading your dashboard…" />
        <Skeleton variant="block" height={300} label="" />
      </>
    );
  }

  const s = summary.data;
  const homes = properties.data.items;
  const copy = COPY[role];

  if (role === "tenant" && homes.length === 0) {
    return (
      <>
        {header(homes, s)}
        <EmptyState
          icon="🏠"
          title="You're not linked to a home yet."
          action={
            <Link to="/join" className="button">
              Enter join code
            </Link>
          }
        >
          Ask your landlord for your property's join code, then enter it here.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      {header(homes, s)}

      {role === "worker" && !user.trade && (
        <div className="banner banner--info" role="status">
          Landlords find workers by trade. <Link to="/team">Set your trade</Link> so they can send you offers.
        </div>
      )}
      {role === "worker" && (
        <section className="section section--first">
          <h2>Job offers</h2>
          {offers.error ? (
            <ErrorMessage error={offers.error} title="Couldn't load offers" onRetry={offers.reload} />
          ) : !offers.data ? (
            <Skeleton variant="list" count={1} label="Loading offers…" />
          ) : (
            <OfferList
              offers={offers.data.items}
              onAnswered={() => {
                offers.reload();
                summary.reload();
                stats.reload();
              }}
            />
          )}
        </section>
      )}

      <div className="tiles">
        {copy.tiles(s).map((t) => (
          <Tile key={t.label} {...t} />
        ))}
      </div>

      <div className="dash-grid">
        <div className="dash-grid__main">
          {(role !== "worker" || homes.length > 0) && <PropertiesPanel homes={homes} more={properties.data.page.hasMore} role={role} />}
          <section className="section">
            <div className="section__head">
              <h2>{copy.section}</h2>
              <Link to="/issues">{role === "worker" ? "All jobs →" : "All issues →"}</Link>
            </div>
            {issues.error ? (
              <ErrorMessage error={issues.error} title="Couldn't load issues" onRetry={issues.reload} />
            ) : !issues.data ? (
              <Skeleton variant="list" count={3} label="Loading issues…" />
            ) : issues.data.items.length === 0 ? (
              <EmptyState
                icon="✓"
                title={copy.empty}
                action={
                  role === "tenant" && (
                    <Link to="/issues/new" className="button button--small">
                      Report an issue
                    </Link>
                  )
                }
              />
            ) : (
              <IssueList issues={issues.data.items} showReporter={role !== "tenant"} />
            )}
          </section>
        </div>
        <aside className="dash-grid__side">
          <ActivityFeed viewerId={user.id} />
        </aside>
      </div>

      <StatsPanels stats={stats} role={role} />
    </>
  );
}
