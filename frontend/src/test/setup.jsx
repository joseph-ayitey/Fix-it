import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// findBy… / waitFor wait up to 1 s by default. A busy machine can need longer to render
// a page after a fake API answer, so wait up to 5 s; a real hang still fails.
configure({ asyncUtilTimeout: 5_000 });

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
