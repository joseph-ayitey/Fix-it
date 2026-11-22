import { useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { ErrorSummary, Field, useFocusFirstInvalid } from "../components/Status.jsx";
import { TRADES } from "../labels.js";

/**
 * Where to go once signed in: back to the page that sent you to sign in (RequireAuth
 * puts it in location.state.from), or home. Used in ONE place per page, the
 * "if (user) <Navigate>" below, so signing in can't race against a second redirect.
 */
// API field name -> label, in form order (for the error summary and focusing).
const LOGIN_FIELDS = { email: "Email", password: "Password" };
const SIGNUP_FIELDS = { role: "I am a…", trade: "Your trade", area: "Where you work", name: "Full name", email: "Email", password: "Password" };

function useReturnPath() {
  const location = useLocation();
  return location.state?.from ?? "/";
}

export function LoginPage() {
  const { user, signIn } = useAuth();
  const returnTo = useReturnPath();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useFocusFirstInvalid(error, Object.keys(LOGIN_FIELDS));

  if (user) return <Navigate to={returnTo} replace />;
  const fieldErrors = error?.fieldErrors ?? {};

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(form.email, form.password); // signed in -> the <Navigate> above takes over
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="auth-card">
      <h1>Sign in to FixIt</h1>
      <form onSubmit={onSubmit} className="stack" noValidate>
        <Field label="Email" id="email" error={fieldErrors.email}>
          <input id="email" type="email" aria-required="true" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Password" id="password" error={fieldErrors.password}>
          <input
            id="password"
            type="password"
            aria-required="true"
            autoComplete="current-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
        <ErrorSummary error={error} labels={LOGIN_FIELDS} failTitle="Couldn't sign in" />
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="muted">
        New here? <Link to="/signup">Create an account</Link>
      </p>
    </div>
  );
}

export function SignupPage() {
  const { user, signUp } = useAuth();
  const returnTo = useReturnPath();
  // "Join as a landlord" on the landing page links here with ?role=landlord.
  const [params] = useSearchParams();
  const preselected = ["landlord", "tenant", "worker"].includes(params.get("role")) ? params.get("role") : "";
  const [form, setForm] = useState({ role: preselected, name: "", email: "", password: "", trade: "", area: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useFocusFirstInvalid(error, Object.keys(SIGNUP_FIELDS));

  if (user) return <Navigate to={returnTo} replace />;

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const fieldErrors = error?.fieldErrors ?? {};

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // The API validates everything (the form has noValidate) and names each bad field.
      // Empty choices are left out, so they come back as "required", not "invalid value".
      const { trade, area, role, ...rest } = form;
      const body = { ...rest, ...(role ? { role } : {}) };
      // Trade and area belong to worker accounts only.
      if (role === "worker") Object.assign(body, trade ? { trade } : {}, { area: area.trim() || null });
      await signUp(body);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="auth-card">
      <h1>Create your account</h1>
      <form onSubmit={onSubmit} className="stack" noValidate>
        <fieldset className={`role-picker${fieldErrors.role ? " role-picker--invalid" : ""}`} aria-describedby={fieldErrors.role ? "role-error" : undefined}>
          <legend>I am a…</legend>
          {[
            ["tenant", "Tenant", "I rent a home and want to report problems and follow them up."],
            ["landlord", "Landlord", "I own or manage properties and want to track repairs."],
            ["worker", "Worker", "I do repairs (plumbing, electrics, handyman…) and landlords offer me jobs."],
          ].map(([value, title, text]) => (
            <label key={value} className={`role-option${form.role === value ? " role-option--selected" : ""}`}>
              <input type="radio" name="role" id={value === "tenant" ? "role" : undefined} value={value} checked={form.role === value} onChange={set("role")} />
              <span className="role-option__title">{title}</span>
              <span className="role-option__text">{text}</span>
            </label>
          ))}
          {fieldErrors.role && (
            <small id="role-error" className="field__error role-picker__error">
              {fieldErrors.role}
            </small>
          )}
        </fieldset>
        {form.role === "worker" && (
          <>
            <Field label="Your trade" id="trade" hint="Landlords find workers by trade." error={fieldErrors.trade}>
              <select id="trade" aria-required="true" value={form.trade} onChange={set("trade")}>
                <option value="">Choose…</option>
                {Object.entries(TRADES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Where you work (optional)" id="area" hint="e.g. Barcelona, L'Hospitalet" error={fieldErrors.area}>
              <input id="area" maxLength={200} value={form.area} onChange={set("area")} />
            </Field>
          </>
        )}
        <Field label="Full name" id="name" error={fieldErrors.name}>
          <input id="name" aria-required="true" maxLength={200} autoComplete="name" value={form.name} onChange={set("name")} />
        </Field>
        <Field label="Email" id="email" error={fieldErrors.email}>
          <input id="email" type="email" aria-required="true" autoComplete="email" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Password" id="password" hint="At least 8 characters." error={fieldErrors.password}>
          <input
            id="password"
            type="password"
            aria-required="true"
            autoComplete="new-password"
            value={form.password}
            onChange={set("password")}
          />
        </Field>
        <ErrorSummary error={error} labels={SIGNUP_FIELDS} failTitle="Couldn't create your account" />
        <button type="submit" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="muted">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}
