import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useApi } from "../useApi.js";
import PropertyMap from "../components/PropertyMap.jsx";
import IssueList from "../components/IssueList.jsx";
import { ErrorMessage, Loading } from "../components/Status.jsx";
import { formatDate, propertyName } from "../labels.js";

const GEOCODE_MESSAGES = {
  no_match: "OpenStreetMap couldn't find this address, so it isn't on the map.",
  failed: "The map lookup failed (the service may have been down).",
  pending: "Map lookup is turned off on this server.",
};

function formatCode(code) {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function JoinCodePanel({ property, onChange }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(property.joinCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the code is on screen anyway */
    }
  }

  async function rotate() {
    if (!window.confirm("Make a new code? The current one will stop working. Tenants already linked stay linked.")) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await api.rotateJoinCode(property.id));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2 className="panel__title">Invite tenants</h2>
      <p className="muted small">Share this code with your tenants. They enter it after signing up to link themselves to this property.</p>
      <div className="join-code">
        <code className="join-code__value" aria-label="Join code">
          {formatCode(property.joinCode)}
        </code>
        <button type="button" className="button--ghost" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="button--ghost" onClick={rotate} disabled={busy}>
          New code
        </button>
      </div>
      <ErrorMessage error={error} title="Couldn't change the code" />
    </div>
  );
}

function TenantsPanel({ property, onChange }) {
  const [error, setError] = useState(null);

  async function remove(tenant) {
    if (!window.confirm(`Remove ${tenant.name} from this property? Their past issues stay on record.`)) return;
    setError(null);
    try {
      await api.removeTenant(property.id, tenant.id);
      onChange(await api.getProperty(property.id));
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="panel">
      <h2 className="panel__title">Tenants</h2>
      {property.tenants.length === 0 ? (
        <p className="muted small">No tenants linked yet.</p>
      ) : (
        <ul className="plain-list">
          {property.tenants.map((t) => (
            <li key={t.id} className="plain-list__row">
              <span>
                <strong>{t.name}</strong>
                <br />
                <a href={`mailto:${t.email}`} className="small">
                  {t.email}
                </a>
                <span className="muted small"> · since {new Date(t.joinedAt).toLocaleDateString()}</span>
              </span>
              <button type="button" className="button--ghost button--small" onClick={() => remove(t)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorMessage error={error} title="Couldn't remove tenant" />
    </div>
  );
}

export default function PropertyDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const isLandlord = user.role === "landlord";

  const property = useApi((signal) => api.getProperty(id, { signal }), [id]);
  const issues = useApi((signal) => api.listIssues({ propertyId: id }, { signal }), [id]);
  const [retrying, setRetrying] = useState(false);

  if (property.error) {
    return (
      <>
        <ErrorMessage error={property.error} title={property.error.status === 404 ? "Property not found" : "Couldn't load this property"} />
        <Link to="/properties">← Back</Link>
      </>
    );
  }
  if (!property.data) return <Loading />;
  const p = property.data;

  async function retryGeocode() {
    setRetrying(true);
    try {
      property.setData(await api.retryGeocode(p.id));
    } finally {
      setRetrying(false);
    }
  }

  return (
    <>
      <p>
        <Link to={user.role === "worker" ? "/issues" : "/properties"}>← {{ landlord: "All properties", tenant: "Your homes", worker: "Your jobs" }[user.role]}</Link>
      </p>

      {location.state?.justAdded && (
        <div className="banner banner--success" role="status">
          Property added. Share the join code below with your tenants.
        </div>
      )}
      {location.state?.justJoined && (
        <div className="banner banner--success" role="status">
          You're linked to this home. You can now report issues to {p.landlord.name}.
        </div>
      )}

      <div className="page-header page-header--row">
        <div>
          <h1>{propertyName(p)}</h1>
          <p className="muted">{p.displayName ?? p.addressInput}</p>
        </div>
        {user.role === "tenant" && (
          <Link to={`/issues/new?propertyId=${p.id}`} className="button">
            Report an issue
          </Link>
        )}
      </div>

      <div className="detail">
        <div>
          {p.latitude !== null ? (
            <PropertyMap properties={[p]} height={280} />
          ) : (
            <div className="panel">
              <p className="muted small">{GEOCODE_MESSAGES[p.geocodeStatus]}</p>
              {isLandlord && p.geocodeStatus !== "pending" && (
                <button type="button" className="button--ghost button--small" onClick={retryGeocode} disabled={retrying}>
                  {retrying ? "Looking up…" : "Try the map lookup again"}
                </button>
              )}
            </div>
          )}
          {isLandlord ? (
            <>
              <JoinCodePanel property={p} onChange={property.setData} />
              <TenantsPanel property={p} onChange={property.setData} />
            </>
          ) : (
            <div className="panel">
              <h2 className="panel__title">Landlord</h2>
              <p>
                <strong>{p.landlord.name}</strong>
                <br />
                <a href={`mailto:${p.landlord.email}`}>{p.landlord.email}</a>
              </p>
            </div>
          )}
          <p className="muted small">Added {formatDate(p.createdAt)}</p>
        </div>

        <section>
          <h2>{{ landlord: "Issues at this property", tenant: "Your issues here", worker: "Your jobs here" }[user.role]}</h2>
          <ErrorMessage error={issues.error} title="Couldn't load issues" />
          {issues.data ? (
            <IssueList issues={issues.data} showProperty={false} showReporter={user.role !== "tenant"} empty="No issues reported here yet." />
          ) : (
            !issues.error && <Loading />
          )}
        </section>
      </div>
    </>
  );
}
