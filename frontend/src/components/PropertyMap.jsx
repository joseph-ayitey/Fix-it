import { useEffect, useRef } from "react";
import L from "leaflet";
import { pinState } from "../labels.js";

// OpenStreetMap's standard tiles, which fit the project's use of Nominatim. Per OSM's
// tile usage policy, attribution is required and heavy/production traffic should move to
// a dedicated tile provider; this is fine for development and a course project.
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Leaflet draws SVG with colours given as plain values, so it can't use our CSS
// variables directly. Read the current values of the --pin-* tokens from styles.css
// (they differ in dark mode), with fallbacks if the stylesheet isn't loaded.
const PIN_FALLBACKS = { urgent: "#d03b3b", open: "#e09a00", clear: "#0ca30c" };
function pinColour(state) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--pin-${state}`).trim();
  return value || PIN_FALLBACKS[state];
}

/**
 * Leaflet map with one marker per property. Uses Leaflet directly (no react-leaflet)
 * since all it needs is "draw these points and fit the view". Circle markers avoid
 * Leaflet's default marker images, which bundlers notoriously fail to resolve.
 *
 * Markers are coloured by pinState() when `colourByState` is set, and the property
 * with `selectedId` is drawn larger. The markers themselves can't take keyboard
 * focus, so pages using onSelect also list the same properties as focusable cards.
 *
 * @param {{ properties: object[], onSelect?: (id: number) => void, height?: number,
 *           colourByState?: boolean, selectedId?: number|null }} props
 */
export default function PropertyMap({ properties, onSelect, height = 360, colourByState = false, selectedId = null }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const markersRef = useRef(new Map());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const map = L.map(containerRef.current, { scrollWheelZoom: false });
    L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    markersRef.current = new Map();

    const points = properties.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
    for (const p of points) {
      const colour = colourByState ? pinColour(pinState(p)) : "#3b82f6";
      const marker = L.circleMarker([p.latitude, p.longitude], {
        radius: 8,
        weight: 2,
        color: colourByState ? "#ffffff" : "#1d4ed8", // a light ring keeps pins visible on any tile
        fillColor: colour,
        fillOpacity: 0.9,
      });
      const counts = colourByState
        ? `<br>${p.openIssueCount} open${p.urgentIssueCount ? ` · <strong>${p.urgentIssueCount} urgent</strong>` : ""}`
        : `<br>${escapeHtml(p.landlord?.name)}`;
      marker.bindTooltip(`<strong>${escapeHtml(p.label ?? p.streetAddress ?? p.addressInput)}</strong>${counts}`);
      if (onSelectRef.current) marker.on("click", () => onSelectRef.current(p.id));
      marker.addTo(layer);
      markersRef.current.set(p.id, marker);
    }

    if (points.length === 1) {
      map.setView([points[0].latitude, points[0].longitude], 16);
    } else if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points.map((p) => [p.latitude, p.longitude])), { padding: [30, 30], maxZoom: 16 });
    } else {
      map.setView([20, 0], 2);
    }
  }, [properties, colourByState]);

  // Highlight the selected property's pin without redrawing (or re-fitting) the map.
  useEffect(() => {
    for (const [id, marker] of markersRef.current) {
      const selected = id === selectedId;
      marker.setRadius(selected ? 13 : 8);
      marker.setStyle({ weight: selected ? 4 : 2 });
      if (selected) marker.bringToFront();
    }
  }, [selectedId, properties]);

  return <div ref={containerRef} className="map" style={{ height }} role="region" aria-label="Map of properties" />;
}
