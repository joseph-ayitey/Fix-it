import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useApi } from "../useApi.js";
import { StatusBadge, UrgencyBadge } from "../components/Badges.jsx";
import Timeline from "../components/Timeline.jsx";
import PhotoGallery from "../components/PhotoGallery.jsx";
import PhotoPicker from "../components/PhotoPicker.jsx";
import { ErrorMessage, Skeleton } from "../components/Status.jsx";
import {
  ago,
  CATEGORY_LABELS,
  formatDate,
  pendingConfirmations,
  STATUS_LABELS,
  TRADE_FOR_CATEGORY,
  TRADES,
  transitionLabel,
  waitingText,
  workerLabel,
} from "../labels.js";

/**
 * An action's error. A 409 means the issue changed under us (someone else acted a
 * moment ago, or the offer was already answered): offer to reload it, then decide again.
 */
function ActionError({ error, title, onReload }) {
  return <ErrorMessage error={error} title={title} onRetry={error?.status === 409 ? onReload : undefined} retryLabel="Reload the issue" />;
}

/** Runs an API action with busy/error state; `onDone` gets the result. */
function useAction(onDone) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function run(action) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      onDone?.(result);
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

/** Status buttons: exactly the transitions the server says this viewer may make now. */
function StatusActions({ issue, role, onChanged, onReload }) {
  const [pending, setPending] = useState(null); // transition waiting for its note
  const [note, setNote] = useState("");
  const { busy, error, run } = useAction(onChanged);

  if (!issue.allowedTransitions.length) return null;

  async function submit(to) {
    if (await run(() => api.changeStatus(issue.id, to, note.trim() || undefined))) {
      setPending(null);
      setNote("");
    }
  }

  const label = (to) => transitionLabel(to, role, issue.status);
  const help = pending?.noteRequired
    ? role === "tenant"
      ? "Required: what's still wrong?"
      : "Required: what isn't done properly? The worker sees this."
    : "Optional: what was done, or when someone is coming. Everyone on the issue sees this.";

  return (
    <div className="panel">
      <h2 className="panel__title">{role === "tenant" ? "Your response" : "Update status"}</h2>
      {pending ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            submit(pending.to);
          }}
        >
          <label htmlFor="status-note" className="small">
            {help}
          </label>
          <textarea id="status-note" rows={3} required={pending.noteRequired} maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="button-row">
            <button type="submit" disabled={busy || (pending.noteRequired && !note.trim())}>
              {label(pending.to)}
            </button>
            <button type="button" className="button--ghost" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="button-row">
          {issue.allowedTransitions.map((t) => (
            <button key={t.to} type="button" className={t.noteRequired || t.to === "closed" ? "button--ghost" : ""} onClick={() => setPending(t)}>
              {label(t.to)}
            </button>
          ))}
        </div>
      )}
      <ActionError error={error} title="Couldn't update" onReload={onReload} />
    </div>
  );
}

/**
 * A resolved issue closes when BOTH have confirmed: the tenant (it works) and the
 * landlord (the work is approved). Shows who has, and the button for whoever is next.
 */
function ConfirmationPanel({ issue, role, onChanged, onReload }) {
  const [note, setNote] = useState("");
  const { busy, error, run } = useAction(onChanged);
  if (issue.status !== "resolved") return null;

  const waiting = pendingConfirmations(issue);
  const row = (who, label) => (
    <li className={issue.confirmations[who] ? "check check--done" : "check"}>
      {issue.confirmations[who] ? "✓" : "○"} {label}
      {issue.confirmations[who] && <span className="muted small"> · {formatDate(issue.confirmations[who])}</span>}
    </li>
  );
  const buttonText = role === "landlord" ? "Approve the work" : "Confirm it's fixed";

  return (
    <div className="panel panel--highlight">
      <h2 className="panel__title">Confirming the fix</h2>
      <ul className="checklist">
        {row("tenant", "Tenant confirms it works")}
        {row("landlord", "Landlord approves the work")}
      </ul>
      {issue.canConfirm ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => api.confirmFix(issue.id, note.trim() || undefined));
          }}
        >
          <label className="field">
            <span className="small">Note (optional)</span>
            <input value={note} maxLength={5000} onChange={(e) => setNote(e.target.value)} placeholder={role === "landlord" ? "e.g. Invoice paid" : "e.g. All dry now, thanks!"} />
          </label>
          <div>
            <button type="submit" disabled={busy}>
              {busy ? "Saving…" : buttonText}
            </button>
          </div>
        </form>
      ) : (
        <p className="muted small">
          {waiting.length ? `Waiting for the ${waiting.join(" and the ")}.` : ""}
          {role === "worker" && " You'll see it close here once they've both confirmed."}
        </p>
      )}
      <ActionError error={error} title="Couldn't confirm" onReload={onReload} />
    </div>
  );
}

/**
 * Landlord: who's on the job. Assigned -> show them (unassign). An offer waiting ->
 * show it (withdraw). Otherwise: find a worker by trade and send an offer.
 */
function WorkerPanel({ issue, onChanged, onReload }) {
  const suggested = TRADE_FOR_CATEGORY[issue.category];
  const [trade, setTrade] = useState(suggested);
  const [workerId, setWorkerId] = useState(null);
  const [message, setMessage] = useState("");
  const pendingOffer = issue.offers?.find((o) => o.status === "pending");
  // Search only when the search is what's shown: active, nobody assigned, no offer waiting.
  const searching = ["open", "in_progress"].includes(issue.status) && !issue.assignee && !pendingOffer;
  const found = useApi(
    (signal) => (searching ? api.findWorkers({ trade, city: issue.property.city ?? undefined }, { signal }) : Promise.resolve(null)),
    [trade, searching],
  );
  const { busy, error, run } = useAction(onChanged);

  if (!["open", "in_progress"].includes(issue.status)) return null;

  // The contract doesn't promise an order for `offers`, so pick the most recent answer explicitly.
  const lastAnswer = (issue.offers ?? [])
    .filter((o) => ["declined", "withdrawn", "cancelled"].includes(o.status))
    .sort((a, b) => Date.parse(b.respondedAt ?? b.createdAt) - Date.parse(a.respondedAt ?? a.createdAt))[0];

  if (issue.assignee) {
    return (
      <div className="panel">
        <h2 className="panel__title">Worker</h2>
        <p className="assignee-line">
          <span>
            <strong>{workerLabel(issue.assignee)}</strong> accepted this job
          </span>
          <button type="button" className="button--ghost button--small" disabled={busy} onClick={() => run(() => api.unassignWorker(issue.id))}>
            Unassign
          </button>
        </p>
        <p className="muted small">Talk privately with them below: choose "Private" when commenting.</p>
        <ActionError error={error} title="Couldn't unassign" onReload={onReload} />
      </div>
    );
  }

  if (pendingOffer) {
    return (
      <div className="panel">
        <h2 className="panel__title">Worker</h2>
        <p className="assignee-line">
          <span>
            Offer sent to <strong>{workerLabel(pendingOffer.worker)}</strong>, waiting for their answer
          </span>
          <button type="button" className="button--ghost button--small" disabled={busy} onClick={() => run(() => api.withdrawOffer(pendingOffer.id))}>
            Withdraw
          </button>
        </p>
        <ActionError error={error} title="Couldn't withdraw" onReload={onReload} />
      </div>
    );
  }

  return (
    <div className="panel">
      <h2 className="panel__title">Find a worker</h2>
      {lastAnswer?.status === "declined" && (
        <p className="small text-warning">
          {lastAnswer.worker.name} declined{lastAnswer.response ? `: "${lastAnswer.response}"` : "."}
        </p>
      )}
      <label className="field">
        <span className="small">Trade</span>
        <select value={trade} onChange={(e) => { setTrade(e.target.value); setWorkerId(null); }}>
          {Object.entries(TRADES).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
              {v === suggested ? " (suggested)" : ""}
            </option>
          ))}
        </select>
      </label>
      <ErrorMessage error={found.error} title="Couldn't search" onRetry={found.reload} />
      {found.loading && !found.data && <Skeleton variant="list" count={2} label="Finding workers…" />}
      {found.data &&
        (found.data.items.length === 0 ? (
          <p className="muted small">No {TRADES[trade].toLowerCase()} has signed up yet. Try another trade.</p>
        ) : (
          <ul className="worker-choices" aria-label="Workers">
            {found.data.items.map((w) => (
              <li key={w.id}>
                <label className={`worker-choice${workerId === w.id ? " worker-choice--selected" : ""}`}>
                  <input type="radio" name="worker" checked={workerId === w.id} onChange={() => setWorkerId(w.id)} />
                  <span>
                    <strong>{w.name}</strong>
                    {w.worksForYou && <span className="badge badge--status-resolved">Works for you</span>}
                    <br />
                    <span className="muted small">
                      {[w.area, `${w.completedJobs} done`, `${w.activeJobs} active`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ))}
      {workerId && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => api.offerJob(issue.id, workerId, message.trim() || undefined)).then((ok) => ok && setMessage(""));
          }}
        >
          <label className="field">
            <span className="small">Message to the worker (optional, the tenant doesn't see it)</span>
            <textarea rows={2} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Urgent, the tenant is home after 5pm" />
          </label>
          <div>
            <button type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send job offer"}
            </button>
          </div>
        </form>
      )}
      <ActionError error={error} title="Couldn't send the offer" onReload={onReload} />
    </div>
  );
}

function CommentForm({ issue, role, onAdded }) {
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState([]);
  const [visibility, setVisibility] = useState("shared");
  const { busy, error, run } = useAction((result) => {
    onAdded(result);
    setBody("");
    setPhotos([]);
  });
  // The private thread exists once there's a worker on the job.
  const canPost = role !== "tenant" && Boolean(issue.assignee);

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => api.comment(issue.id, body.trim(), photos, visibility));
      }}
    >
      {canPost && (
        <fieldset className="visibility-toggle">
          <legend className="visually-hidden">Who can see this comment</legend>
          <label>
            <input type="radio" name="visibility" value="shared" checked={visibility === "shared"} onChange={() => setVisibility("shared")} /> Everyone
          </label>
          <label>
            <input type="radio" name="visibility" value="internal" checked={visibility === "internal"} onChange={() => setVisibility("internal")} /> 🔒 Private:
            landlord &amp; worker only
          </label>
        </fieldset>
      )}
      <label htmlFor="comment" className="visually-hidden">
        Add a comment
      </label>
      <textarea
        id="comment"
        rows={3}
        maxLength={5000}
        placeholder={visibility === "internal" ? "Private note (prices, instructions…)" : "Add a comment…"}
        className={visibility === "internal" ? "textarea--private" : ""}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <ErrorMessage error={error} title="Couldn't post" />
      <div className="comment-actions">
        <PhotoPicker files={photos} onChange={setPhotos} disabled={busy} compact />
        <button type="submit" disabled={busy || (!body.trim() && !photos.length)}>
          {busy ? "Posting…" : visibility === "internal" ? "Post private note" : "Comment"}
        </button>
      </div>
    </form>
  );
}

const BANNERS = {
  tenant: "It's been marked as fixed. Please check and confirm, or reopen it if the problem is still there.",
  landlord: "It's been marked as fixed. Please approve the work, or send it back to the worker.",
};

export default function IssueDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const { data: issue, error, setData, reload } = useApi((signal) => api.getIssue(id, { signal }), [id]);

  if (error) {
    // A malformed id ("/issues/abc") is a 400 for path.issueId, and someone else's issue
    // is a 404 (the API never says which): to the user, both mean "no such issue".
    const missing = [400, 404].includes(error.status);
    return (
      <>
        <ErrorMessage error={error} title={missing ? "Issue not found" : "Couldn't load this issue"} onRetry={missing ? undefined : reload} />
        <Link to="/issues">← All issues</Link>
      </>
    );
  }
  if (!issue) {
    return (
      <div className="detail">
        <Skeleton variant="block" height={220} label="Loading issue…" />
        <Skeleton variant="list" count={3} label="" />
      </div>
    );
  }

  const unacknowledged = ["open", "in_progress"].includes(issue.status) && !issue.acknowledgedAt;
  const property = issue.property.label ? `${issue.property.label} (${issue.property.address})` : issue.property.address;

  return (
    <>
      <p>
        <Link to="/issues">← All issues</Link>
      </p>

      {location.state?.justReported &&
        (location.state.replayed ? (
          // Idempotent-Replayed: true. The first attempt had reached the server (only its
          // response was lost), so no second issue was created.
          <div className="banner banner--info" role="status">
            We'd already received this report, so nothing was sent twice. Here it is.
          </div>
        ) : (
          <div className="banner banner--success" role="status">
            Sent. Your landlord can see it now, and you'll both follow it here.
          </div>
        ))}
      {location.state?.justAccepted && (
        <div className="banner banner--success" role="status">
          Job accepted. You can now see the address, and talk privately with the landlord below.
        </div>
      )}
      {issue.canConfirm && BANNERS[user.role] && (
        <div className="banner banner--info" role="status">
          {BANNERS[user.role]}
        </div>
      )}

      <div className="page-header">
        <div className="badge-row">
          <StatusBadge status={issue.status} />
          <UrgencyBadge urgency={issue.urgency} />
          <span className="badge">{CATEGORY_LABELS[issue.category]}</span>
        </div>
        <h1>{issue.title}</h1>
        <p className={unacknowledged ? "text-warning" : "muted"}>{waitingText(issue)}</p>
      </div>

      <div className="detail">
        <div>
          <div className="panel">
            <p className="pre-wrap">{issue.description}</p>
            <PhotoGallery photos={issue.events.find((e) => e.type === "reported")?.photos} />
            <dl className="meta-list small">
              <div>
                <dt>Property</dt>
                <dd>
                  <Link to={`/properties/${issue.property.id}`}>{property}</Link>
                </dd>
              </div>
              <div>
                <dt>Reported by</dt>
                <dd>
                  {issue.reporter.id === user.id ? "You" : issue.reporter.name}, {formatDate(issue.createdAt)}
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{STATUS_LABELS[issue.status]}</dd>
              </div>
              <div>
                <dt>Worker</dt>
                <dd>
                  {issue.assignee ? (issue.assignee.id === user.id ? "You" : workerLabel(issue.assignee)) : <span className="muted">Not assigned yet</span>}
                  {issue.assignee && issue.assignedAt && <span className="muted"> · since {ago(issue.assignedAt)}</span>}
                </dd>
              </div>
              <div>
                <dt>Last update</dt>
                <dd>
                  <time dateTime={issue.updatedAt} title={formatDate(issue.updatedAt)}>
                    {ago(issue.updatedAt)}
                  </time>
                </dd>
              </div>
            </dl>
          </div>
          <ConfirmationPanel issue={issue} role={user.role} onChanged={setData} onReload={reload} />
          {user.role === "landlord" && <WorkerPanel key={issue.id} issue={issue} onChanged={setData} onReload={reload} />}
          <StatusActions issue={issue} role={user.role} onChanged={setData} onReload={reload} />
        </div>

        <section>
          <h2>History</h2>
          <Timeline events={issue.events} viewerId={user.id} />
          {issue.status !== "closed" ? (
            <CommentForm issue={issue} role={user.role} onAdded={setData} />
          ) : (
            <p className="muted small">This issue is closed. If the problem comes back, report a new issue.</p>
          )}
        </section>
      </div>
    </>
  );
}
