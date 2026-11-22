import { useEffect, useId, useMemo, useRef, useState } from "react";

// Must match backend/src/utils/photos.js (the server enforces it; this just saves a
// wasted upload and gives the message before the user hits Send).
export const MAX_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Choose up to 5 photos, with thumbnails and a remove button for each.
 * Controlled: `files` is a File[]; `onChange(nextFiles)`.
 */
export default function PhotoPicker({ files, onChange, disabled, compact = false, label = "Photos (optional)" }) {
  const inputId = useId();
  const inputRef = useRef(null);
  const [problem, setProblem] = useState(null);

  const previews = useMemo(() => files.map((f) => ({ file: f, url: URL.createObjectURL(f) })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  function add(e) {
    const picked = [...e.target.files];
    e.target.value = ""; // let the same file be picked again after removing it
    const issues = [];
    const ok = picked.filter((f) => {
      if (!ACCEPTED_TYPES.includes(f.type)) {
        issues.push(`${f.name}: only JPEG, PNG, WebP or GIF`);
        return false;
      }
      if (f.size > MAX_PHOTO_BYTES) {
        issues.push(`${f.name}: larger than 8 MB`);
        return false;
      }
      return true;
    });
    const room = MAX_PHOTOS - files.length;
    if (ok.length > room) issues.push(`Only ${MAX_PHOTOS} photos allowed; extra ones were left out.`);
    setProblem(issues.length ? issues.join(" · ") : null);
    if (ok.length && room > 0) onChange([...files, ...ok.slice(0, room)]);
  }

  return (
    <div className={`photo-picker${compact ? " photo-picker--compact" : ""}`}>
      {!compact && <span className="photo-picker__label">{label}</span>}
      {previews.length > 0 && (
        <ul className="photo-grid" aria-label="Selected photos">
          {previews.map(({ file, url }, i) => (
            <li key={url} className="photo-grid__item">
              <img src={url} alt={file.name} />
              <button
                type="button"
                className="photo-grid__remove"
                aria-label={`Remove ${file.name}`}
                disabled={disabled}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {files.length < MAX_PHOTOS && (
        <>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            multiple
            className="visually-hidden"
            onChange={add}
            disabled={disabled}
          />
          <label htmlFor={inputId} className={`button button--ghost button--small${disabled ? " is-disabled" : ""}`}>
            {compact ? "📷 Attach photo" : files.length ? "Add more photos" : "📷 Add photos"}
          </label>
          {!compact && <small className="muted"> Up to {MAX_PHOTOS}, 8 MB each. A clear photo helps your landlord send the right person.</small>}
        </>
      )}
      {problem && (
        <small className="field__error" role="alert">
          {problem}
        </small>
      )}
    </div>
  );
}
