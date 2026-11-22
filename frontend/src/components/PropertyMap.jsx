import { useEffect, useRef } from "react";
import L from "leaflet";

// OpenStreetMap's standard tiles, which fit the project's use of Nominatim. Per OSM's
// tile usage policy, attribution is required and heavy/production traffic should move to
// a dedicated tile provider; this is fine for development and a course project.
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/**
 * Leaflet map with one marker per property. Uses Leaflet directly (no react-leaflet)
 * since all it needs is "draw these points and fit the view". Circle markers avoid
 * Leaflet's default marker images, which bundlers notoriously fail to resolve.
 *
 * @param {{ properties: object[], onSelect?: (id: number) => void, height?: number }} props
 */
export default function PropertyMap({ properties, onSelect, height = 360 }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
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

    const points = properties.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
    for (const p of points) {
      const marker = L.circleMarker([p.latitude, p.longitude], {
        radius: 8,
        weight: 2,
        color: "#1d4ed8",
        fillColor: "#3b82f6",
        fillOpacity: 0.85,
      });
      marker.bindTooltip(`<strong>${escapeHtml(p.label ?? p.streetAddress ?? p.inputAddress)}</strong><br>${escapeHtml(p.landlord?.name)}`);
      if (onSelectRef.current) marker.on("click", () => onSelectRef.current(p.id));
      marker.addTo(layer);
    }

    if (points.length === 1) {
      map.setView([points[0].latitude, points[0].longitude], 16);
    } else if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points.map((p) => [p.latitude, p.longitude])), { padding: [30, 30], maxZoom: 16 });
    } else {
      map.setView([20, 0], 2);
    }
  }, [properties]);

  return <div ref={containerRef} className="map" style={{ height }} role="region" aria-label="Map of properties" />;
}
