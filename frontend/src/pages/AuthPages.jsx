import { useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { Field } from "../components/Status.jsx";
import { TRADES } from "../labels.js";

/**
 * Where to go once signed in: back to the page that sent you to sign in (RequireAuth
 * puts it in location.state.from), or home. Used in ONE place per page, the
 * "if (user) <Navigate>" below, so signing in can't race against a second redirect.
 */
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

  if (user) return <Navigate to={returnTo} replace />;

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
      <form onSubmit={onSubmit} className="stack">
        <Field label="Email" id="email">
          <input id="email" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Password" id="password">
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
        {error && (
          <div className="banner banner--error" role="alert">
            {error.message}
          </div>
        )}
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

  if (user) return <Navigate to={returnTo} replace />;

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const fieldErrors = error?.fieldErrors ?? {};

  async function onSubmit(e) {
    e.preventDefault();
    if (!form.role) {
      setError({ message: "Choose whether you're a tenant, a landlord or a worker.", fieldErrors: { role: "Choose one" } });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { trade, area, ...rest } = form;
      // Trade and area belong to worker accounts only.
      await signUp(form.role === "worker" ? { ...rest, trade, area: area || null } : rest);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="auth-card">
      <h1>Create your account</h1>
      <form onSubmit={onSubmit} className="stack">
        <fieldset className="role-picker">
          <legend>I am a…</legend>
          {[
            ["tenant", "Tenant", "I rent a home and want to report problems and follow them up."],
            ["landlord", "Landlord", "I own or manage properties and want to track repairs."],
            ["worker", "Worker", "I do repairs (plumbing, electrics, handyman…) and landlords offer me jobs."],
          ].map(([value, title, text]) => (
            <label key={value} className={`role-option${form.role === value ? " role-option--selected" : ""}`}>
              <input type="radio" name="role" value={value} checked={form.role === value} onChange={set("role")} />
              <span className="role-option__title">{title}</span>
              <span className="role-option__text">{text}</span>
            </label>
          ))}
        </fieldset>
        {form.role === "worker" && (
          <>
            <Field label="Your trade" id="trade" hint="Landlords find workers by trade." error={fieldErrors.trade}>
              <select id="trade" required value={form.trade} onChange={set("trade")} aria-describedby="trade-hint">
                <option value="">Choose…</option>
                {Object.entries(TRADES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Where you work (optional)" id="area" hint="e.g. Barcelona, L'Hospitalet" error={fieldErrors.area}>
              <input id="area" maxLength={200} value={form.area} onChange={set("area")} aria-describedby="area-hint" />
            </Field>
          </>
        )}
        <Field label="Full name" id="name" error={fieldErrors.name}>
          <input id="name" required maxLength={200} autoComplete="name" value={form.name} onChange={set("name")} />
        </Field>
        <Field label="Email" id="email" error={fieldErrors.email}>
          <input id="email" type="email" required autoComplete="email" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Password" id="password" hint="At least 8 characters." error={fieldErrors.password}>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            aria-describedby="password-hint"
            value={form.password}
            onChange={set("password")}
          />
        </Field>
        {error && (
          <div className="banner banner--error" role="alert">
            {error.message}
          </div>
        )}
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
