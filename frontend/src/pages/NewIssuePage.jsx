import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useApi } from "../useApi.js";
import { ErrorMessage, Field, Loading } from "../components/Status.jsx";
import PhotoPicker from "../components/PhotoPicker.jsx";
import { CATEGORY_LABELS, propertyName, URGENCY_HINTS, URGENCY_LABELS } from "../labels.js";

export default function NewIssuePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const homes = useApi((signal) => api.listProperties({ signal }), []);

  const [form, setForm] = useState({
    propertyId: params.get("propertyId") ?? "",
    title: "",
    category: "",
    urgency: "normal",
    description: "",
  });
  const [photos, setPhotos] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (homes.error) return <ErrorMessage error={homes.error} title="Couldn't load your homes" />;
  if (!homes.data) return <Loading />;
  if (homes.data.length === 0) return <Navigate to="/join" replace />;

  const propertyId = form.propertyId || (homes.data.length === 1 ? String(homes.data[0].id) : "");
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const fieldErrors = error?.fieldErrors ?? {};

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const issue = await api.reportIssue({ ...form, propertyId: Number(propertyId) }, photos);
      navigate(`/issues/${issue.id}`, { state: { justReported: true } });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <>
      <p>
        <Link to="/issues">← Your issues</Link>
      </p>
      <div className="page-header">
        <h1>Report an issue</h1>
        <p className="muted">Your landlord is notified in FixIt, and everything you both say about it is kept on one timeline.</p>
      </div>

      <form className="form stack" onSubmit={onSubmit}>
        <fieldset disabled={busy} className="stack">
          {homes.data.length > 1 && (
            <Field label="Home" id="propertyId" error={fieldErrors.propertyId}>
              <select id="propertyId" required value={propertyId} onChange={set("propertyId")}>
                <option value="">Choose…</option>
                {homes.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {propertyName(p)}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="What's wrong?" id="title" hint="A short summary, e.g. 'Kitchen tap won't turn off'." error={fieldErrors.title}>
            <input id="title" required minLength={3} maxLength={120} aria-describedby="title-hint" value={form.title} onChange={set("title")} />
          </Field>

          <Field label="Category" id="category" error={fieldErrors.category}>
            <select id="category" required value={form.category} onChange={set("category")}>
              <option value="">Choose…</option>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <fieldset className="urgency-picker">
            <legend>How urgent is it?</legend>
            {Object.entries(URGENCY_LABELS).map(([value, label]) => (
              <label key={value} className={`urgency-option urgency-option--${value}${form.urgency === value ? " urgency-option--selected" : ""}`}>
                <input type="radio" name="urgency" value={value} checked={form.urgency === value} onChange={set("urgency")} />
                <span className="urgency-option__title">{label}</span>
                <span className="urgency-option__text">{URGENCY_HINTS[value]}</span>
              </label>
            ))}
          </fieldset>

          <Field
            label="Details"
            id="description"
            hint="Where exactly, since when, what you've already tried, and when someone can get in."
            error={fieldErrors.description}
          >
            <textarea
              id="description"
              required
              minLength={10}
              maxLength={5000}
              rows={6}
              aria-describedby="description-hint"
              value={form.description}
              onChange={set("description")}
            />
          </Field>

          <PhotoPicker files={photos} onChange={setPhotos} disabled={busy} />
        </fieldset>

        {error && (
          <div className="banner banner--error" role="alert">
            {error.message}
          </div>
        )}
        <div className="form__actions">
          <button type="submit" disabled={busy}>
            {busy ? (photos.length ? "Uploading photos…" : "Sending…") : "Send to landlord"}
          </button>
        </div>
      </form>
    </>
  );
}
