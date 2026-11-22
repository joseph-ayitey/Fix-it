import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Leaflet needs real layout and network tiles, neither of which jsdom has. The map is
// purely visual, so page tests replace it with a stub that just lists what it was given.
vi.mock("../components/PropertyMap.jsx", () => ({
  default: ({ properties }) => <div data-testid="map">{properties.length} on map</div>,
}));

// jsdom has no object URLs; photo previews and protected photos need them.
let n = 0;
URL.createObjectURL ??= () => `blob:test/${++n}`;
URL.revokeObjectURL ??= () => {};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
