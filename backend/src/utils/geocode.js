// Address -> coordinates via OpenStreetMap's Nominatim (https://nominatim.org), used when
// a landlord adds a property so it can be shown on a map.
//
// Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/):
//   - at most 1 request per second, per application: enforced client-side by RateLimiter.
//     server.js creates ONE client, so the limit holds across all concurrent requests.
//   - a real, descriptive User-Agent identifying the app (default library UAs are blocked)
//   - no bulk/systematic geocoding: here it runs once per property a landlord adds.
//
// Failure handling: transient failures (network, timeout, 5xx, 429) are retried with
// exponential backoff + jitter; 4xx (including 403, Nominatim's "policy violation") are
// not. Geocoding is never allowed to block adding a property: the caller stores the
// outcome as geocode_status and the property works fine without a map pin.

const BASE_URL = "https://nominatim.openstreetmap.org";

export class RateLimiter {
  constructor({ maxRequests = 1, windowMs = 1_000 } = {}) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.timestamps = [];
  }

  async wait() {
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(now);
        return;
      }
      await sleep(this.windowMs - (now - this.timestamps[0]) + 25);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(ms, 0)));
}

export class GeocodeError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message);
    this.name = "GeocodeError";
    this.status = status;
    this.retryable = retryable;
  }
}

export class NominatimClient {
  constructor({
    userAgent,
    language = "en",
    baseUrl = BASE_URL,
    rateLimiter = new RateLimiter(),
    timeoutMs = 10_000,
    maxRetries = 3,
    baseBackoffMs = 500,
    maxBackoffMs = 10_000,
  } = {}) {
    if (!userAgent) {
      throw new Error("NominatimClient needs a userAgent (NOMINATIM_USER_AGENT in .env): Nominatim rejects default ones.");
    }
    Object.assign(this, { userAgent, language, baseUrl, rateLimiter, timeoutMs, maxRetries, baseBackoffMs, maxBackoffMs });
  }

  backoffDelay(attempt) {
    const exp = Math.min(this.baseBackoffMs * 2 ** attempt, this.maxBackoffMs);
    return exp + Math.random() * exp * 0.3;
  }

  async getJson(pathAndQuery) {
    const url = `${this.baseUrl}${pathAndQuery}`;
    let lastError;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.rateLimiter.wait();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let retryAfterMs = null;

      try {
        const res = await fetch(url, {
          headers: { "User-Agent": this.userAgent, Accept: "application/json" },
          signal: controller.signal,
        });
        if (res.ok) return await res.json();

        if (res.status === 429 || res.status >= 500) {
          const header = res.headers.get("Retry-After");
          if (res.status === 429 && header !== null) retryAfterMs = Number(header) * 1000;
          lastError = new GeocodeError(`Nominatim returned ${res.status}`, { status: res.status, retryable: true });
        } else {
          throw new GeocodeError(`Nominatim returned ${res.status}`, { status: res.status, retryable: false });
        }
      } catch (err) {
        if (err instanceof GeocodeError && !err.retryable) throw err;
        if (!(err instanceof GeocodeError)) {
          lastError = new GeocodeError(
            err.name === "AbortError" ? `Nominatim timed out after ${this.timeoutMs}ms` : `network error: ${err.message}`,
            { retryable: true },
          );
        }
      } finally {
        clearTimeout(timer);
      }

      if (attempt < this.maxRetries) await sleep(retryAfterMs ?? this.backoffDelay(attempt));
    }
    throw lastError;
  }

  /** Raw first Nominatim match for a free-form address, or null when nothing matches. */
  async search(address) {
    const query = new URLSearchParams({
      q: address,
      format: "jsonv2",
      addressdetails: "1",
      limit: "1",
      // Without this, names come back in the local language ("España", "Catalunya").
      "accept-language": this.language,
    });
    const results = await this.getJson(`/search?${query}`);
    return Array.isArray(results) && results.length ? results[0] : null;
  }

  /** Geocode and parse in one step. @returns {Promise<ParsedLocation|null>} */
  async geocode(address) {
    const raw = await this.search(address);
    return raw ? parseNominatimResult(raw) : null;
  }
}

/**
 * Nominatim jsonv2 result -> our location fields. Two traps handled here:
 *   - lat/lon arrive as STRINGS ("41.3990519"), so they're parsed and NaN-checked;
 *   - address parts are present or absent depending on how well-mapped the area is,
 *     and a missing one becomes null (city falls back to town/village).
 *
 * @typedef {{ streetAddress: string|null, city: string|null, postcode: string|null,
 *   country: string|null, countryCode: string|null, latitude: number, longitude: number,
 *   displayName: string|null }} ParsedLocation
 * @returns {ParsedLocation|null} null if the coordinates are unusable
 */
export function parseNominatimResult(raw) {
  const latitude = Number.parseFloat(raw?.lat);
  const longitude = Number.parseFloat(raw?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const a = raw.address ?? {};
  return {
    streetAddress: [a.house_number, a.road].filter(Boolean).join(" ") || null,
    city: a.city ?? a.town ?? a.village ?? null,
    postcode: a.postcode ?? null,
    country: a.country ?? null,
    countryCode: a.country_code ?? null,
    latitude,
    longitude,
    displayName: raw.display_name ?? null,
  };
}

/** Used when NOMINATIM_USER_AGENT isn't set (or in tests): never calls out. */
export const noGeocoder = {
  async geocode() {
    return null;
  },
  disabled: true,
};
