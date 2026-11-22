import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api, problemKind } from "../api.js";
import { useApi } from "../useApi.js";
import { ErrorMessage, ErrorSummary, Field, Skeleton, useFocusFirstInvalid } from "../components/Status.jsx";
import PhotoPicker from "../components/PhotoPicker.jsx";
import { CATEGORY_LABELS, propertyName, URGENCY_HINTS, URGENCY_LABELS } from "../labels.js";

// API field name -> the label the user sees, in the order the fields appear on the form
// (used to focus the first invalid one, and to link to fields from the error summary).
const FIELD_LABELS = {
  propertyId: "Home",
  title: "What's wrong?",
  category: "Category",
  urgency: "How urgent is it?",
  description: "Details",
  photos: "Photos",
};

/**
 * A new Idempotency-Key (decision record 0003). crypto.randomUUID() only exists in
 * "secure contexts" (https, or http://localhost), so opening the dev server from a
 * phone at http://192.168.x.x would lack it: fall back to 16 random bytes in hex.
 */
function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function NewIssuePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const homes = useApi((signal) => api.listProperties({ limit: 100 }, { signal }), []);

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
  // One key per intended report, made when the form is first shown. It is sent with
  // every attempt at THIS report, so if a response is lost and the user presses Send
  // again, the server returns the issue it already created instead of a duplicate.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  useFocusFirstInvalid(error, Object.keys(FIELD_LABELS));

  if (homes.error) return <ErrorMessage error={homes.error} title="Couldn't load your homes" onRetry={homes.reload} />;
  if (!homes.data) return <Skeleton variant="block" height={420} label="Loading the form…" />;
  const myHomes = homes.data.items;
  if (myHomes.length === 0) return <Navigate to="/join" replace />;

  const propertyId = form.propertyId || (myHomes.length === 1 ? String(myHomes[0].id) : "");
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const fieldErrors = error?.fieldErrors ?? {};

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // No validation in the browser (the form has noValidate): the API checks the report
    // against the contract and lists every problem, which we show next to each field.
    // Unchosen drop-downs are left out rather than sent as "", so the API reports them
    // as missing instead of "not one of the allowed values".
    const fields = { title: form.title.trim(), description: form.description.trim(), urgency: form.urgency };
    if (propertyId) fields.propertyId = Number(propertyId);
    if (form.category) fields.category = form.category;
    try {
      const { issue, replayed } = await api.reportIssue(fields, photos, { idempotencyKey });
      setIdempotencyKey(newIdempotencyKey()); // done: a further report is a new action
      navigate(`/issues/${issue.id}`, { state: { justReported: true, replayed } });
    } catch (err) {
      setError(err);
      setBusy(false);
      // When to make a new key:
      // - unreachable server or 5xx: we can't know whether the issue was created, so KEEP
      //   the key; retrying with it is safe (the server replays the first result).
      // - 409 "request in progress": the first attempt is still running; retry with the
      //   same key to get its result.
      // - any other 4xx (e.g. a 400 the user is about to fix): nothing was stored for this
      //   key, and the corrected report is a different body, which would be a 422 with
      //   the old key. So the next attempt gets a fresh key.
      const keepKey = err.isRetryable || problemKind(err) === "idempotency-request-in-progress";
      if (!keepKey) setIdempotencyKey(newIdempotencyKey());
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

      <form className="form stack" onSubmit={onSubmit} noValidate>
        <fieldset disabled={busy} className="stack">
          {myHomes.length > 1 && (
            <Field label="Home" id="propertyId" error={fieldErrors.propertyId}>
              <select id="propertyId" aria-required="true" value={propertyId} onChange={set("propertyId")}>
                <option value="">Choose…</option>
                {myHomes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {propertyName(p)}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="What's wrong?" id="title" hint="A short summary, e.g. 'Kitchen tap won't turn off'." error={fieldErrors.title}>
            <input id="title" aria-required="true" maxLength={120} value={form.title} onChange={set("title")} />
          </Field>

          <Field label="Category" id="category" error={fieldErrors.category}>
            <select id="category" aria-required="true" value={form.category} onChange={set("category")}>
              <option value="">Choose…</option>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <fieldset className="urgency-picker" aria-describedby={fieldErrors.urgency ? "urgency-error" : undefined}>
            <legend>How urgent is it?</legend>
            {Object.entries(URGENCY_LABELS).map(([value, label]) => (
              <label key={value} className={`urgency-option urgency-option--${value}${form.urgency === value ? " urgency-option--selected" : ""}`}>
                <input
                  type="radio"
                  name="urgency"
                  id={value === "low" ? "urgency" : undefined}
                  value={value}
                  checked={form.urgency === value}
                  onChange={set("urgency")}
                />
                <span className="urgency-option__title">{label}</span>
                <span className="urgency-option__text">{URGENCY_HINTS[value]}</span>
              </label>
            ))}
            {fieldErrors.urgency && (
              <small id="urgency-error" className="field__error">
                {fieldErrors.urgency}
              </small>
            )}
          </fieldset>

          <Field
            label="Details"
            id="description"
            hint="Where exactly, since when, what you've already tried, and when someone can get in."
            error={fieldErrors.description}
          >
            <textarea id="description" aria-required="true" maxLength={5000} rows={6} value={form.description} onChange={set("description")} />
          </Field>

          <PhotoPicker files={photos} onChange={setPhotos} disabled={busy} />
          {fieldErrors.photos && <small className="field__error">{fieldErrors.photos}</small>}
        </fieldset>

        <ErrorSummary error={error} labels={FIELD_LABELS} failTitle="Couldn't send your report" />
        {error?.isRetryable && (
          <p className="small" role="status">
            Your report may or may not have reached the server. It's safe to press Send again: it won't be filed twice.
          </p>
        )}
        <div className="form__actions">
          <button type="submit" disabled={busy}>
            {busy ? (photos.length ? "Uploading photos…" : "Sending…") : error?.isRetryable ? "Send again" : "Send to landlord"}
          </button>
        </div>
      </form>
    </>
  );
}
