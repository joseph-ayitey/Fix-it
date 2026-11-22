import { useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useApi } from "../useApi.js";
import { EmptyState, ErrorMessage, Field, Loading } from "../components/Status.jsx";
import { TRADES } from "../labels.js";

function TradeSelect({ id, value, onChange, allowAll = false, required = false }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} required={required}>
      <option value="">{allowAll ? "All trades" : "Choose…"}</option>
      {Object.entries(TRADES).map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

/** Landlord: browse the directory. Offering a job happens from an issue ("Find a worker"). */
function Directory() {
  const [trade, setTrade] = useState("");
  const found = useApi((signal) => api.findWorkers({ trade }, { signal }), [trade]);
  return (
    <section className="section">
      <div className="section__head">
        <h2>Find workers</h2>
        <label className="inline-field">
          <span>Trade</span>
          <TradeSelect id="directory-trade" value={trade} onChange={setTrade} allowAll />
        </label>
      </div>
      <p className="muted small">
        To hire someone, open an issue and use <strong>Find a worker</strong>: they get a job offer they can accept or
        decline. Contact details are shared once they accept.
      </p>
      <ErrorMessage error={found.error} title="Couldn't search" />
      {found.data &&
        (found.data.length === 0 ? (
          <EmptyState>No workers with that trade yet.</EmptyState>
        ) : (
          <ul className="issue-list">
            {found.data.map((w) => (
              <li key={w.id} className="issue-row">
                <div className="issue-row__link">
                  <div className="issue-row__title">
                    {w.name} <span className="badge">{w.tradeLabel}</span>
                    {w.worksForYou && <span className="badge badge--status-resolved">Works for you</span>}
                  </div>
                  <div className="issue-row__meta">
                    {[w.area, `${w.completedJobs} job${w.completedJobs === 1 ? "" : "s"} completed`, `${w.activeJobs} active`]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

function LandlordTeam() {
  const team = useApi((signal) => api.team({ signal }), []);
  const [error, setError] = useState(null);

  async function remove(worker) {
    const jobs = worker.activeJobs ? ` Their ${worker.activeJobs} active job(s) will become unassigned.` : "";
    if (!window.confirm(`Stop working with ${worker.name}?${jobs}`)) return;
    setError(null);
    try {
      await api.removeWorker(worker.id);
      team.reload();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Workers</h1>
        <p className="muted">Workers join your list when they accept one of your job offers.</p>
      </div>
      <section>
        <h2>Your workers</h2>
        <ErrorMessage error={team.error || error} title="Something went wrong" />
        {!team.data ? (
          !team.error && <Loading />
        ) : team.data.workers.length === 0 ? (
          <EmptyState>Nobody yet. Open an issue and use "Find a worker" to send your first job offer.</EmptyState>
        ) : (
          <ul className="issue-list">
            {team.data.workers.map((w) => (
              <li key={w.id} className="issue-row">
                <div className="issue-row__link team-row">
                  <div>
                    <div className="issue-row__title">
                      {w.name} {w.trade && <span className="badge">{TRADES[w.trade]}</span>}
                    </div>
                    <div className="issue-row__meta">
                      <a href={`mailto:${w.email}`}>{w.email}</a> · {w.activeJobs} active job{w.activeJobs === 1 ? "" : "s"}
                    </div>
                  </div>
                  <button type="button" className="button--ghost button--small" onClick={() => remove(w)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Directory />
    </>
  );
}

function WorkerProfile() {
  const { user, updateProfile } = useAuth();
  const [form, setForm] = useState({ trade: user.trade ?? "", area: user.area ?? "" });
  const [state, setState] = useState({ busy: false, error: null, saved: false });
  const landlords = useApi((signal) => api.team({ signal }), []);

  async function onSubmit(e) {
    e.preventDefault();
    setState({ busy: true, error: null, saved: false });
    try {
      await updateProfile({ trade: form.trade, area: form.area || null });
      setState({ busy: false, error: null, saved: true });
    } catch (err) {
      setState({ busy: false, error: err, saved: false });
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Your work profile</h1>
        <p className="muted">Landlords find you by trade and area, and send you job offers. They don't see your email until you accept.</p>
      </div>
      <div className="detail">
        <form className="panel stack" onSubmit={onSubmit}>
          <h2 className="panel__title">Trade & area</h2>
          {!user.trade && (
            <div className="banner banner--info" role="status">
              Choose your trade so landlords can find you.
            </div>
          )}
          <Field label="Trade" id="profile-trade">
            <TradeSelect id="profile-trade" value={form.trade} onChange={(trade) => setForm({ ...form, trade })} required />
          </Field>
          <Field label="Where you work" id="profile-area" hint="e.g. Barcelona, L'Hospitalet">
            <input id="profile-area" maxLength={200} value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} aria-describedby="profile-area-hint" />
          </Field>
          <ErrorMessage error={state.error} title="Couldn't save" />
          {state.saved && (
            <p className="small" role="status">
              Saved.
            </p>
          )}
          <div className="form__actions">
            <button type="submit" disabled={state.busy || !form.trade}>
              {state.busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
        <section>
          <h2>Landlords you work for</h2>
          <ErrorMessage error={landlords.error} title="Couldn't load" />
          {landlords.data &&
            (landlords.data.landlords.length === 0 ? (
              <EmptyState>None yet. Accept a job offer and the landlord appears here.</EmptyState>
            ) : (
              <ul className="issue-list">
                {landlords.data.landlords.map((l) => (
                  <li key={l.id} className="issue-row">
                    <div className="issue-row__link">
                      <div className="issue-row__title">{l.name}</div>
                      <div className="issue-row__meta">since {new Date(l.addedAt).toLocaleDateString()}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ))}
        </section>
      </div>
    </>
  );
}

export default function TeamPage() {
  const { user } = useAuth();
  if (user.role === "tenant") return <Navigate to="/" replace />;
  return user.role === "landlord" ? <LandlordTeam /> : <WorkerProfile />;
}
