import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { usePagedApi } from "../useApi.js";
import PropertyMap from "../components/PropertyMap.jsx";
import { EmptyState, ErrorMessage, ErrorSummary, Field, LoadMore, Skeleton, useFocusFirstInvalid } from "../components/Status.jsx";
import { propertyName } from "../labels.js";

const PAGE_SIZE = 20;

export default function PropertiesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isLandlord = user.role === "landlord";
  const list = usePagedApi((cursor, signal, size) => api.listProperties({ limit: size ?? PAGE_SIZE, cursor }, { signal }), [], { live: true });

  const header = (
    <div className="page-header page-header--row">
      <h1>{{ landlord: "Properties", tenant: "Your homes", worker: "Job locations" }[user.role]}</h1>
      {user.role !== "worker" && (
        <Link to={isLandlord ? "/properties/new" : "/join"} className="button">
          {isLandlord ? "Add property" : "Join another home"}
        </Link>
      )}
    </div>
  );

  if (list.error) {
    return (
      <>
        {header}
        <ErrorMessage error={list.error} title="Couldn't load properties" onRetry={list.reload} />
      </>
    );
  }
  if (!list.items) {
    return (
      <>
        {header}
        <Skeleton variant="block" height={300} label="Loading properties…" />
        <Skeleton variant="cards" count={3} label="" />
      </>
    );
  }

  const data = list.items;
  const mapped = data.filter((p) => p.latitude !== null);

  return (
    <>
      {header}
      {data.length === 0 ? (
        user.role === "worker" ? (
          <EmptyState title="No job locations yet.">Accept a job offer and its address appears here.</EmptyState>
        ) : isLandlord ? (
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
          <EmptyState
            title="You're not linked to a home."
            action={
              <Link to="/join" className="button">
                Enter a join code
              </Link>
            }
          >
            Ask your landlord for the join code.
          </EmptyState>
        )
      ) : (
        <>
          {mapped.length > 0 && <PropertyMap properties={mapped} onSelect={(id) => navigate(`/properties/${id}`)} />}
          <ul className="card-grid">
            {data.map((p) => (
              <li key={p.id} className="card">
                <Link to={`/properties/${p.id}`} className="card__link">
                  <h2 className="card__title">{propertyName(p)}</h2>
                  <p className="card__address">{p.addressInput}</p>
                  <p className="card__meta">
                    {p.openIssueCount} open issue{p.openIssueCount === 1 ? "" : "s"}
                    {p.urgentIssueCount > 0 && <strong className="text-danger"> · {p.urgentIssueCount} urgent</strong>}
                    {isLandlord && ` · ${p.tenantCount} tenant${p.tenantCount === 1 ? "" : "s"}`}
                    {p.latitude === null && " · not on map"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          <LoadMore list={list} label="Load more properties" noun="properties" />
        </>
      )}
    </>
  );
}

const PROPERTY_FIELDS = { address: "Address", label: "Nickname" };

export function AddPropertyPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ address: "", label: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fieldErrors = error?.fieldErrors ?? {};
  useFocusFirstInvalid(error, Object.keys(PROPERTY_FIELDS));

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // No checks here: the API validates against the contract and says what's wrong.
      const property = await api.addProperty({ address: form.address.trim(), label: form.label.trim() || null });
      navigate(`/properties/${property.id}`, { state: { justAdded: true } });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Add a property</h1>
        <p className="muted">
          We'll find it on OpenStreetMap to place it on your map, and give it a join code to share with your tenants.
        </p>
      </div>
      <form className="form stack" onSubmit={onSubmit} noValidate>
        <Field label="Address" id="address" hint="Street and number, city, country." error={fieldErrors.address}>
          <input
            id="address"
            aria-required="true"
            maxLength={500}
            placeholder="Carrer de Mallorca 401, Barcelona, Spain"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            disabled={busy}
          />
        </Field>
        <Field label="Nickname (optional)" id="label" error={fieldErrors.label}>
          <input
            id="label"
            maxLength={200}
            placeholder="e.g. Eixample flat, 3rd floor"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            disabled={busy}
          />
        </Field>
        <ErrorSummary error={error} labels={PROPERTY_FIELDS} failTitle="Couldn't add the property" />
        <div className="form__actions">
          <button type="submit" disabled={busy}>
            {busy ? "Looking up address…" : "Add property"}
          </button>
        </div>
      </form>
    </>
  );
}

export function JoinPropertyPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const property = await api.joinProperty(code);
      navigate(`/properties/${property.id}`, { state: { justJoined: true } });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="auth-card">
      <h1>Link your home</h1>
      <p className="muted">Your landlord can find this 8-character code on the property's page in FixIt.</p>
      <form className="stack" onSubmit={onSubmit}>
        <Field label="Join code" id="code" error={error?.fieldErrors.code}>
          <input
            id="code"
            className="code-input"
            required
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={20}
            placeholder="ABCD-2345"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
        {error && (
          <div className="banner banner--error" role="alert">
            {error.message}
          </div>
        )}
        <button type="submit" disabled={busy || !code.trim()}>
          {busy ? "Linking…" : "Link home"}
        </button>
      </form>
    </div>
  );
}
