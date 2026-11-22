export function Loading({ children = "Loading…" }) {
  return (
    <p className="status" role="status">
      {children}
    </p>
  );
}

export function ErrorMessage({ error, title = "Something went wrong" }) {
  if (!error) return null;
  return (
    <div className="banner banner--error" role="alert">
      <strong>{title}.</strong> {error.message}
    </div>
  );
}

export function EmptyState({ children }) {
  return <div className="empty">{children}</div>;
}

/** Small "label + input + error" wrapper used by every form. */
export function Field({ label, error, hint, children, id }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && (
        <small id={`${id}-hint`} className="muted">
          {hint}
        </small>
      )}
      {error && (
        <small className="field__error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
