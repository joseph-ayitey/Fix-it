import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { ago, describeActivity, formatDate } from "../labels.js";
import { UrgencyBadge } from "./Badges.jsx";
import { EmptyState, ErrorMessage, Skeleton } from "./Status.jsx";

const ICONS = {
  reported: "＋",
  comment: "💬",
  status_change: "↻",
  assigned: "👷",
  unassigned: "−",
  confirmed: "✓",
  offer_sent: "✉",
  offer_accepted: "✓",
  offer_declined: "✕",
  offer_withdrawn: "↩",
};

const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/**
 * Put a freshly polled first page in front of what we already show.
 * Returns { items, newIds }. If NONE of the polled events is one we already have and
 * there are more behind them, more events happened than fit in one page since the last
 * poll: we can't tell what's in between, so we start over from this page rather than
 * show a list with a silent gap in it.
 */
function mergeLatest(current, polled) {
  const known = new Set(current.map((e) => e.id));
  const newOnes = polled.items.filter((e) => !known.has(e.id));
  if (newOnes.length === polled.items.length && polled.page.hasMore && current.length) {
    return { items: polled.items, newIds: newOnes.map((e) => e.id), reset: true };
  }
  // Events we already had are replaced with their fresh copy (the issue's status or
  // title may have changed since).
  const fresh = new Map(polled.items.map((e) => [e.id, e]));
  return { items: [...newOnes, ...current.map((e) => fresh.get(e.id) ?? e)], newIds: newOnes.map((e) => e.id), reset: false };
}

/**
 * The dashboard's live feed: the latest events across the viewer's issues
 * (GET /dashboard/activity), refreshed by polling every `intervalMs` (decision 0004).
 * Polling stops while the tab is hidden (no point refreshing what nobody sees, and it
 * spares the server), and the user can pause it, since moving content must be
 * pausable for people who find it distracting. New events slide in (unless the user
 * prefers reduced motion) and are announced politely to screen readers.
 */
export default function ActivityFeed({ viewerId, intervalMs = 10_000, limit = 15 }) {
  const [feed, setFeed] = useState({ items: null, olderCursor: null, error: null });
  const [arrived, setArrived] = useState(() => new Set()); // ids that came in by polling: animate these
  const [announcement, setAnnouncement] = useState("");
  const [refreshError, setRefreshError] = useState(null);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(isHidden);
  const [older, setOlder] = useState({ loading: false, error: null });
  const [attempt, setAttempt] = useState(0);
  const [, setTick] = useState(0); // re-render so "2 minutes ago" stays current
  const loaded = useRef(false);

  useEffect(() => {
    const onVisibility = () => setHidden(isHidden());
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // The latest items, readable from the polling callback without re-creating it.
  const itemsRef = useRef(null);
  useEffect(() => {
    itemsRef.current = feed.items;
  }, [feed.items]);

  const fetchLatest = useCallback(
    async (signal) => {
      const polled = await api.activity({ limit }, { signal });
      const current = itemsRef.current;
      if (!current) {
        itemsRef.current = polled.items;
        setFeed({ items: polled.items, olderCursor: polled.page.nextCursor, error: null });
      } else {
        const merged = mergeLatest(current, polled);
        itemsRef.current = merged.items;
        setFeed((prev) => ({ items: merged.items, olderCursor: merged.reset ? polled.page.nextCursor : prev.olderCursor, error: null }));
        if (merged.newIds.length) {
          setArrived((prev) => new Set([...prev, ...merged.newIds]));
          setAnnouncement(`${merged.newIds.length} new event${merged.newIds.length === 1 ? "" : "s"}`);
        }
      }
      loaded.current = true;
      setTick((t) => t + 1);
    },
    [limit],
  );

  // The polling loop. A chain of timeouts (not setInterval), so a slow response can
  // never overlap the next request. It restarts (fetching at once) when the tab comes
  // back into view, the user resumes, or "Try again" is pressed.
  useEffect(() => {
    const stopped = paused || hidden;
    if (stopped && loaded.current) return;
    const controller = new AbortController();
    let timer;
    let cancelled = false;
    const run = async () => {
      try {
        await fetchLatest(controller.signal);
        setRefreshError(null);
      } catch (err) {
        if (err.name === "AbortError") return;
        if (loaded.current) setRefreshError(err);
        else setFeed((f) => ({ ...f, error: err }));
      }
      if (!cancelled && !stopped && loaded.current) timer = setTimeout(run, intervalMs);
    };
    run();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [paused, hidden, attempt, intervalMs, fetchLatest]);

  async function loadOlder() {
    setOlder({ loading: true, error: null });
    try {
      const page = await api.activity({ limit, cursor: feed.olderCursor });
      setFeed((prev) => {
        const known = new Set(prev.items.map((e) => e.id));
        return { ...prev, items: [...prev.items, ...page.items.filter((e) => !known.has(e.id))], olderCursor: page.page.nextCursor };
      });
      setOlder({ loading: false, error: null });
    } catch (err) {
      setOlder({ loading: false, error: err });
    }
  }

  const live = !paused && !hidden;
  return (
    <section className="panel feed" aria-labelledby="feed-title">
      <div className="feed__head">
        <h2 id="feed-title" className="panel__title">
          Activity
        </h2>
        <span className={`live-dot${live ? " live-dot--on" : ""}`}>{live ? "Live" : "Paused"}</span>
        <button type="button" className="button--ghost button--small" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
          {paused ? "Resume" : "Pause"}
        </button>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>

      {feed.error && !feed.items ? (
        <ErrorMessage
          error={feed.error}
          title="Couldn't load activity"
          onRetry={() => {
            setFeed((f) => ({ ...f, error: null }));
            setAttempt((n) => n + 1);
          }}
        />
      ) : !feed.items ? (
        <Skeleton variant="list" count={4} label="Loading activity…" />
      ) : feed.items.length === 0 ? (
        <EmptyState title="Nothing has happened yet.">New reports, comments and status changes on your issues appear here as they happen.</EmptyState>
      ) : (
        <>
          {refreshError && <p className="small text-warning">Couldn't refresh ({refreshError.message}). Trying again shortly.</p>}
          <ol className="feed__list" aria-label="Recent activity">
            {feed.items.map((e) => (
              <li key={e.id} className={`feed__item feed__item--${e.type}${arrived.has(e.id) ? " feed__item--new" : ""}`}>
                <Link to={`/issues/${e.issue.id}`} className="feed__link">
                  <span className="feed__icon" aria-hidden="true">
                    {ICONS[e.type] ?? "•"}
                  </span>
                  <span className="feed__body">
                    <span>
                      <strong>{e.actor.id === viewerId ? "You" : e.actor.name}</strong> {describeActivity(e)}
                      {e.visibility === "internal" && (
                        <span className="badge badge--private" title="Only the landlord and the worker can see this">
                          🔒 Private
                        </span>
                      )}
                    </span>
                    <span className="feed__issue">
                      {e.issue.title} <UrgencyBadge urgency={e.issue.urgency} />
                      <span className="muted"> · {e.issue.propertyLabel}</span>
                    </span>
                    {e.excerpt && <span className="feed__excerpt">“{e.excerpt}”</span>}
                  </span>
                  <time className="feed__time muted small" dateTime={e.createdAt} title={formatDate(e.createdAt)}>
                    {ago(e.createdAt)}
                  </time>
                </Link>
              </li>
            ))}
          </ol>
          <ErrorMessage error={older.error} title="Couldn't load older activity" onRetry={loadOlder} />
          {feed.olderCursor && (
            <button type="button" className="button--ghost button--small feed__more" onClick={loadOlder} disabled={older.loading}>
              {older.loading ? "Loading…" : "Show older"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
