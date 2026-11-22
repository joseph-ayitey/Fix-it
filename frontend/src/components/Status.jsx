import { Children, cloneElement, isValidElement, useEffect, useRef } from "react";

export function Loading({ children = "Loading…" }) {
  return (
    <p className="status" role="status">
      {children}
    </p>
  );
}

/**
 * Grey placeholder shapes while something loads, so the page doesn't jump when the
 * real content arrives. Screen readers hear `label` once instead of the shapes.
 * variant: "list" (issue rows), "cards" (property cards), "tiles", "block" (one panel).
 */
export function Skeleton({ variant = "list", count = 3, label = "Loading…", height }) {
  const shapes = Array.from({ length: count }, (_, i) => i);
  return (
    <div className={`skeleton skeleton--${variant}`} role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      {variant === "block" ? (
        <div className="skeleton__block" style={height ? { height } : undefined} aria-hidden="true" />
      ) : (
        shapes.map((i) => (
          <div key={i} className="skeleton__item" aria-hidden="true">
            <span className="skeleton__line skeleton__line--wide" />
            <span className="skeleton__line" />
          </div>
        ))
      )}
    </div>
  );
}

/**
 * An error banner showing the problem's message (its Problem Details `detail`). With
 * `onRetry`, it offers "Try again", which should re-run the request that failed
 * (useApi's `reload()`).
 */
export function ErrorMessage({ error, title = "Something went wrong", onRetry, retryLabel = "Try again" }) {
  if (!error) return null;
  return (
    <div className="banner banner--error banner--with-action" role="alert">
      <span>
        <strong>{title}.</strong> {error.message}
      </span>
      {onRetry && (
        <button type="button" className="button--small" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}

/** "Nothing here" plus what to do next: `title` (bold), text, and an optional action. */
export function EmptyState({ title, children, action, icon }) {
  return (
    <div className="empty">
      {icon && (
        <div className="empty__icon" aria-hidden="true">
          {icon}
        </div>
      )}
      {title && (
        <p>
          <strong>{title}</strong>
        </p>
      )}
      {children && <div className="empty__text">{children}</div>}
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}

/** The "Load more" button under a cursor-paginated list (see usePagedApi). */
export function LoadMore({ list, label = "Load more", noun = "items" }) {
  if (!list.items) return null;
  return (
    <div className="load-more">
      <ErrorMessage error={list.moreError} title={`Couldn't load more ${noun}`} onRetry={list.loadMore} />
      {list.hasMore ? (
        <button type="button" className="button--ghost" onClick={list.loadMore} disabled={list.loadingMore}>
          {list.loadingMore ? "Loading…" : label}
        </button>
      ) : (
        list.items.length > 0 && (
          <p className="muted small">
            {list.items.length === 1 ? `That's the only one.` : `That's all ${list.items.length} ${noun}.`}
          </p>
        )
      )}
    </div>
  );
}

/**
 * Small "label + input + error" wrapper used by every form. When the API rejects the
 * field, the message appears under it, and the input gets aria-invalid and is linked
 * to the message, so screen readers read the error when the field is focused.
 */
export function Field({ label, error, hint, children, id }) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  const child = Children.only(children);
  const input = isValidElement(child)
    ? cloneElement(child, { "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })
    : child;
  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {input}
      {hint && (
        <small id={`${id}-hint`} className="muted">
          {hint}
        </small>
      )}
      {error && (
        <small id={`${id}-error`} className="field__error">
          {error}
        </small>
      )}
    </div>
  );
}

/**
 * The summary above a form's submit button when the API refuses it: the problem's
 * `detail`, then every field error as a link that jumps to the field. `labels` maps
 * API field names to the labels the user sees; errors for fields the form doesn't show
 * (e.g. "header.idempotency-key") are listed with their message only.
 */
export function ErrorSummary({ error, labels = {}, title = "Please check the form", failTitle = "Couldn't send" }) {
  if (!error) return null;
  const errors = error.errors ?? [];
  const focusField = (field) => (e) => {
    e.preventDefault();
    document.getElementById(field)?.focus();
  };
  return (
    <div className="banner banner--error error-summary" role="alert" id="form-error-summary" tabIndex={-1}>
      <strong>{errors.length ? title : failTitle}.</strong> {error.message}
      {errors.length > 0 && (
        <ul className="error-summary__list">
          {errors.map((e) => (
            <li key={`${e.field}:${e.message}`}>
              {labels[e.field] ? (
                <a href={`#${e.field}`} onClick={focusField(e.field)}>
                  {labels[e.field]}
                </a>
              ) : (
                <span>{e.field}</span>
              )}
              : {e.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * After a failed submit, move keyboard focus to the first invalid field in the form
 * (in the order given), or to the error summary if no shown field is to blame. Without
 * this, a keyboard or screen-reader user would not know the form came back with errors.
 */
export function useFocusFirstInvalid(error, fieldOrder) {
  const last = useRef(null);
  useEffect(() => {
    if (!error || last.current === error) return;
    last.current = error;
    const invalid = error.fieldErrors ?? {};
    const firstField = fieldOrder.find((f) => invalid[f] && document.getElementById(f));
    const target = firstField ? document.getElementById(firstField) : document.getElementById("form-error-summary");
    target?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);
}
