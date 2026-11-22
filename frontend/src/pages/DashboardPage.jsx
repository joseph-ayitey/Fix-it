import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useApi } from "../useApi.js";
import IssueList from "../components/IssueList.jsx";
import OfferList from "../components/OfferList.jsx";
import { EmptyState, ErrorMessage, Loading } from "../components/Status.jsx";
import { propertyName } from "../labels.js";

function Tile({ value, label, tone, to }) {
  const className = `tile${tone && value ? ` tile--${tone}` : ""}`;
  const body = (
    <>
      <span className="tile__value">{value}</span>
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

function PropertyCards({ homes, role }) {
  return (
    <ul className="card-grid">
      {homes.map((p) => (
        <li key={p.id} className="card">
          <Link to={`/properties/${p.id}`} className="card__link">
            <h3 className="card__title">{propertyName(p)}</h3>
            <p className="card__address">{p.addressInput}</p>
            <p className="card__meta">
              {p.openIssueCount} open
              {p.urgentIssueCount ? <strong className="text-danger"> · {p.urgentIssueCount} urgent</strong> : null}
              {role === "landlord" ? ` · ${p.tenantCount} tenant${p.tenantCount === 1 ? "" : "s"}` : ` · Landlord: ${p.landlord.name}`}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// What each role needs to see first.
const COPY = {
  landlord: {
    section: "Needs attention",
    empty: "No active issues across your properties.",
    tiles: (s) => [
      { value: s.active, label: "Active issues", to: "/issues" },
      { value: s.urgent, label: "Urgent", tone: "danger", to: "/issues" },
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
      { value: s.urgent, label: "Urgent", tone: "danger", to: "/issues" },
      { value: s.unacknowledged, label: "Not yet acknowledged", tone: "warning" },
      { value: s.needsYourConfirmation, label: "Fixed: please confirm", tone: "warning", to: "/issues?status=resolved" },
    ],
  },
  worker: {
    section: "Your jobs",
    empty: "No active jobs. Landlords who add you to their team can assign you work.",
    tiles: (s) => [
      { value: s.pendingOffers, label: "Job offers waiting", tone: "warning" },
      { value: s.active, label: "Active jobs", to: "/issues" },
      { value: s.urgent, label: "Urgent", tone: "danger", to: "/issues" },
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
  const issues = useApi((signal) => api.listIssues({ status: "active" }, { signal }), []);
  const properties = useApi((signal) => api.listProperties({ signal }), []);
  const offers = useApi((signal) => (role === "worker" ? api.offers({ signal }) : Promise.resolve([])), [role]);

  const error = summary.error || issues.error || properties.error;
  if (error) return <ErrorMessage error={error} title="Couldn't load your dashboard" />;
  if (!summary.data || !issues.data || !properties.data) return <Loading />;

  const s = summary.data;
  const homes = properties.data;
  const copy = COPY[role];

  return (
    <>
      <div className="page-header page-header--row">
        <div>
          <h1>Hi, {user.name.split(" ")[0]}</h1>
          <p className="muted">{subtitle(role, s, homes)}</p>
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

      {role === "tenant" && homes.length === 0 ? (
        <EmptyState>
          <p>
            <strong>You're not linked to a home yet.</strong>
          </p>
          <p>Ask your landlord for your property's join code, then enter it here.</p>
          <Link to="/join" className="button">
            Enter join code
          </Link>
        </EmptyState>
      ) : (
        <>
          {role === "worker" && !user.trade && (
            <div className="banner banner--info" role="status">
              Landlords find workers by trade. <Link to="/team">Set your trade</Link> so they can send you offers.
            </div>
          )}
          {role === "worker" && (
            <section className="section section--first">
              <h2>Job offers</h2>
              <ErrorMessage error={offers.error} title="Couldn't load offers" />
              {offers.data && (
                <OfferList
                  offers={offers.data}
                  onAnswered={() => {
                    offers.reload();
                    summary.reload();
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

          <section className="section">
            <div className="section__head">
              <h2>{copy.section}</h2>
              <Link to="/issues">{role === "worker" ? "All jobs →" : "All issues →"}</Link>
            </div>
            <IssueList issues={issues.data} showReporter={role !== "tenant"} empty={copy.empty} />
          </section>

          {role !== "worker" && (
            <section className="section">
              <div className="section__head">
                <h2>{role === "landlord" ? "Your properties" : "Your home"}</h2>
                <Link to="/properties">{role === "landlord" ? "Manage →" : "Details →"}</Link>
              </div>
              {homes.length === 0 ? (
                <EmptyState>
                  No properties yet. <Link to="/properties/new">Add your first one</Link> and share its join code with your tenants.
                </EmptyState>
              ) : (
                <PropertyCards homes={homes} role={role} />
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
