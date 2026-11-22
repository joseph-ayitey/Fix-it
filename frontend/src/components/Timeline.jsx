import { ago, formatDate, STATUS_SHORT } from "../labels.js";
import PhotoGallery from "./PhotoGallery.jsx";

function describe(event) {
  const photos = event.photos?.length ?? 0;
  const withPhotos = photos ? ` with ${photos} photo${photos === 1 ? "" : "s"}` : "";
  if (event.type === "reported") return `reported the issue${withPhotos}`;
  if (event.type === "comment") return event.body ? `commented${withPhotos}` : `added ${photos} photo${photos === 1 ? "" : "s"}`;
  const worker = event.subject ? `${event.subject.name}${event.subject.tradeLabel ? ` (${event.subject.tradeLabel})` : ""}` : "the worker";
  if (event.type === "assigned") return `assigned ${worker} to this issue`;
  if (event.type === "unassigned") return `took ${worker} off this issue`;
  if (event.type === "confirmed") return event.actor.role === "landlord" ? "approved the work" : "confirmed it's fixed";
  if (event.type === "offer_sent") return `offered the job to ${worker}`;
  if (event.type === "offer_accepted") return "accepted the job";
  if (event.type === "offer_declined") return "declined the job";
  if (event.type === "offer_withdrawn") return `withdrew the offer to ${worker}`;
  return `changed status: ${STATUS_SHORT[event.fromStatus]} → ${STATUS_SHORT[event.toStatus]}`;
}

/** The issue's permanent record: who did what, when. */
export default function Timeline({ events, viewerId }) {
  return (
    <ol className="timeline" aria-label="Issue history">
      {events.map((e) => (
        <li key={e.id} className={`timeline__item timeline__item--${e.type}${e.visibility === "internal" ? " timeline__item--private" : ""}`}>
          <div className="timeline__head">
            {e.visibility === "internal" && (
              <span className="badge badge--private" title="Only the landlord and the worker can see this">
                🔒 Private
              </span>
            )}
            <strong>{e.actor.id === viewerId ? "You" : e.actor.name}</strong>
            <span className="muted"> ({e.actor.role}) {describe(e)}</span>
            <time className="timeline__time muted" dateTime={e.createdAt} title={formatDate(e.createdAt)}>
              {ago(e.createdAt)}
            </time>
          </div>
          {e.body && <p className="timeline__body">{e.body}</p>}
          {/* The report's own photos are shown with the description; later ones here. */}
          {e.type !== "reported" && <PhotoGallery photos={e.photos} />}
        </li>
      ))}
    </ol>
  );
}
