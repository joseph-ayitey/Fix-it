import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useApi } from "../useApi.js";
import PropertyMap from "../components/PropertyMap.jsx";
import { EmptyState, ErrorMessage, Field, Loading } from "../components/Status.jsx";
import { propertyName } from "../labels.js";

export default function PropertiesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isLandlord = user.role === "landlord";
  const { data, error, loading } = useApi((signal) => api.listProperties({ signal }), []);

  if (error) return <ErrorMessage error={error} title="Couldn't load properties" />;
  if (loading) return <Loading />;

  const mapped = data.filter((p) => p.latitude !== null);

  return (
    <>
      <div className="page-header page-header--row">
        <h1>{{ landlord: "Properties", tenant: "Your homes", worker: "Job locations" }[user.role]}</h1>
        {user.role !== "worker" && (
          <Link to={isLandlord ? "/properties/new" : "/join"} className="button">
            {isLandlord ? "Add property" : "Join another home"}
          </Link>
        )}
      </div>

      {data.length === 0 ? (
        <EmptyState>
          {user.role === "worker" ? (
            "No active jobs, so no locations to show."
          ) : isLandlord ? (
            <>
              No properties yet. <Link to="/properties/new">Add one</Link>.
            </>
          ) : (
            <>
              You're not linked to a home. <Link to="/join">Enter a join code</Link>.
            </>
          )}
        </EmptyState>
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
                    {isLandlord && ` · ${p.tenantCount} tenant${p.tenantCount === 1 ? "" : "s"}`}
                    {p.latitude === null && " · not on map"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export function AddPropertyPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ address: "", label: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fieldErrors = error?.fieldErrors ?? {};

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const property = await api.addProperty({ address: form.address, label: form.label || null });
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
      <form className="form stack" onSubmit={onSubmit}>
        <Field label="Address" id="address" hint="Street and number, city, country." error={fieldErrors.address}>
          <input
            id="address"
            required
            minLength={5}
            maxLength={500}
            aria-describedby="address-hint"
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
        {error && (
          <div className="banner banner--error" role="alert">
            {error.message}
          </div>
        )}
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
        <Field label="Join code" id="code">
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
