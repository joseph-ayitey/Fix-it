import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

/** One protected photo: fetched with the sign-in token, shown from an object URL. */
function AuthPhoto({ photo, onOpen }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl;
    api
      .photoBlob(photo.url, { signal: controller.signal })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setFailed(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo.url]);

  if (failed) return <span className="photo-grid__missing">Photo unavailable</span>;
  if (!src) return <span className="photo-grid__loading" aria-label="Loading photo" />;
  return (
    <button type="button" className="photo-grid__open" onClick={() => onOpen(src, photo.originalName)} aria-label={`Open ${photo.originalName}`}>
      <img src={src} alt={photo.originalName} />
    </button>
  );
}

/** Thumbnails; clicking one opens it full size in a dialog. */
export default function PhotoGallery({ photos }) {
  const dialogRef = useRef(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close?.();
  }, [open]);

  if (!photos?.length) return null;
  return (
    <>
      <ul className="photo-grid" aria-label="Photos">
        {photos.map((p) => (
          <li key={p.id} className="photo-grid__item">
            <AuthPhoto photo={p} onOpen={(src, name) => setOpen({ src, name })} />
          </li>
        ))}
      </ul>
      <dialog ref={dialogRef} className="lightbox" onClose={() => setOpen(null)} onClick={() => setOpen(null)}>
        {open && (
          <figure>
            <img src={open.src} alt={open.name} />
            <figcaption>
              {open.name} · <span className="muted">click anywhere or press Esc to close</span>
            </figcaption>
          </figure>
        )}
      </dialog>
    </>
  );
}
