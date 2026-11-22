import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { CATEGORY_LABELS, ago } from "../labels.js";
import { UrgencyBadge } from "./Badges.jsx";
import { EmptyState, ErrorMessage } from "./Status.jsx";

/** One job offer for the worker: what the job is, and Accept / Decline. */
function OfferCard({ offer, onAnswered }) {
  const navigate = useNavigate();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { issue } = offer;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const accepted = await api.acceptOffer(offer.id);
      navigate(`/issues/${accepted.id}`, { state: { justAccepted: true } });
    } catch (err) {
      setError(err);
      setBusy(false);
      if (err.status === 409) onAnswered();
    }
  }

  async function decline(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.declineOffer(offer.id, reason.trim() || undefined);
      onAnswered();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <li className="panel offer-card">
      <div className="offer-card__head">
        <strong>{issue.title}</strong>
        <span className="badge-row">
          <UrgencyBadge urgency={issue.urgency} />
          <span className="badge">{CATEGORY_LABELS[issue.category]}</span>
        </span>
      </div>
      <p className="muted small">
        From {offer.landlord.name} · {issue.city ?? "location shared on accepting"} · offered {ago(offer.createdAt)}
        {issue.photoCount > 0 && ` · 📷 ${issue.photoCount}`}
      </p>
      <p className="pre-wrap">{issue.description}</p>
      {offer.message && (
        <p className="offer-card__message">
          <span className="muted small">Message from the landlord:</span>
          <br />
          {offer.message}
        </p>
      )}
      <ErrorMessage error={error} title="Couldn't answer" />
      {declining ? (
        <form className="stack" onSubmit={decline}>
          <label className="field">
            <span className="small">Reason (optional, helps the landlord)</span>
            <input value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Fully booked this week" />
          </label>
          <div className="button-row">
            <button type="submit" disabled={busy}>
              Decline offer
            </button>
            <button type="button" className="button--ghost" onClick={() => setDeclining(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="button-row">
          <button type="button" onClick={accept} disabled={busy}>
            {busy ? "Accepting…" : "Accept job"}
          </button>
          <button type="button" className="button--ghost" onClick={() => setDeclining(true)} disabled={busy}>
            Decline
          </button>
        </div>
      )}
    </li>
  );
}

export default function OfferList({ offers, onAnswered }) {
  const pending = offers.filter((o) => o.status === "pending");
  if (!pending.length) return <EmptyState>No job offers waiting. Landlords find you by your trade.</EmptyState>;
  return (
    <ul className="offer-list" aria-label="Job offers">
      {pending.map((o) => (
        <OfferCard key={o.id} offer={o} onAnswered={onAnswered} />
      ))}
    </ul>
  );
}
