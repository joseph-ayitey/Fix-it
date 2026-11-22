// Properties, and the tenancies that link tenants to them.
//
// Who sees a property: the landlord who owns it, tenants who joined it with its code,
// and a worker while they have an active job there. Anyone else gets a 404 (not a 403),
// so ids of other people's properties can't be probed.

import { randomInt } from "node:crypto";
import { iso, many, one, params, PG, query } from "../db/index.js";
import { conflict, notFound } from "../utils/errors.js";

// No 0/O/1/I/L: codes get read out over the phone and typed from a text message.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function generateJoinCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** Canonical form of a code a person typed: uppercase, no spaces or dashes. */
export function normalizeJoinCode(input) {
  return String(input ?? "").toUpperCase().replace(/[\s-]/g, "");
}

/**
 * The idempotency key for an address: the same property typed slightly differently
 * ("Carrer de Mallorca 401,Barcelona" / "carrer de mallorca  401, barcelona") gives the
 * same key, so it can't be added twice.
 */
export function addressKey(address) {
  return String(address).trim().toLowerCase().replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ");
}

const SELECT = `
  SELECT p.*,
         u.name  AS landlord_name,
         u.email AS landlord_email,
         (SELECT count(*) FROM tenancies t WHERE t.property_id = p.id)::int AS tenant_count,
         (SELECT count(*) FROM issues i WHERE i.property_id = p.id AND i.status IN ('open', 'in_progress'))::int AS open_issue_count,
         (SELECT count(*) FROM issues i WHERE i.property_id = p.id AND i.status IN ('open', 'in_progress')
                                         AND i.urgency = 'urgent')::int AS urgent_issue_count
  FROM properties p
  JOIN users u ON u.id = p.landlord_id
`;

/** Access rule as SQL: properties `viewer` may see. */
function visibleTo(viewer, p) {
  if (viewer.role === "landlord") return `p.landlord_id = ${p(viewer.id)}`;
  if (viewer.role === "worker") {
    // A worker sees a property only while they have an ACTIVE job there.
    return `EXISTS (SELECT 1 FROM issues i WHERE i.property_id = p.id AND i.assigned_worker_id = ${p(viewer.id)}
                    AND i.status IN ('open', 'in_progress'))`;
  }
  return `EXISTS (SELECT 1 FROM tenancies t WHERE t.property_id = p.id AND t.tenant_id = ${p(viewer.id)})`;
}

/** @param {object} viewer the signed-in user; the join code is only shown to the owner */
function toProperty(row, viewer) {
  return {
    id: row.id,
    label: row.label,
    addressInput: row.address_input,
    streetAddress: row.street_address,
    city: row.city,
    postcode: row.postcode,
    country: row.country,
    countryCode: row.country_code,
    latitude: row.latitude,
    longitude: row.longitude,
    displayName: row.display_name,
    geocodeStatus: row.geocode_status,
    landlord: { id: row.landlord_id, name: row.landlord_name, email: row.landlord_email },
    tenantCount: row.tenant_count,
    openIssueCount: row.open_issue_count,
    urgentIssueCount: row.urgent_issue_count,
    ...(viewer.role === "landlord" ? { joinCode: row.join_code } : {}),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function listPropertiesFor(viewer) {
  const p = params();
  const order = viewer.role === "landlord" ? "urgent_issue_count DESC, open_issue_count DESC, p.created_at DESC" : "p.created_at DESC";
  const rows = await many(`${SELECT} WHERE ${visibleTo(viewer, p)} ORDER BY ${order}, p.id DESC`, p.values);
  return rows.map((r) => toProperty(r, viewer));
}

/** The property row if `viewer` may see it, else 404. `q` = a transaction client, optionally. */
export async function requirePropertyAccess(viewer, id, q) {
  const p = params();
  const row = await one(`${SELECT} WHERE p.id = ${p(id)} AND ${visibleTo(viewer, p)}`, p.values, q);
  if (!row) throw notFound("property not found");
  return row;
}

export async function getPropertyFor(viewer, id) {
  const property = toProperty(await requirePropertyAccess(viewer, id), viewer);
  if (viewer.role === "landlord") {
    const tenants = await many(
      `SELECT u.id, u.name, u.email, t.joined_at FROM tenancies t JOIN users u ON u.id = t.tenant_id
       WHERE t.property_id = $1 ORDER BY t.joined_at`,
      [id],
    );
    property.tenants = tenants.map((t) => ({ id: t.id, name: t.name, email: t.email, joinedAt: iso(t.joined_at) }));
  }
  return property;
}

const NO_LOCATION = {
  streetAddress: null,
  city: null,
  postcode: null,
  country: null,
  countryCode: null,
  latitude: null,
  longitude: null,
  displayName: null,
};

/**
 * Ask the geocoder, never letting a failure escape: adding a property must work even if
 * OpenStreetMap is down. The outcome is recorded as geocode_status.
 * @returns {Promise<{ status: 'ok'|'no_match'|'failed'|'pending', location: object }>}
 */
export async function geocodeSafely(geocoder, address) {
  if (geocoder.disabled) return { status: "pending", location: NO_LOCATION };
  try {
    const location = await geocoder.geocode(address);
    return location ? { status: "ok", location: { ...NO_LOCATION, ...location } } : { status: "no_match", location: NO_LOCATION };
  } catch (err) {
    console.warn(`geocoding failed for "${address}": ${err.message}`);
    return { status: "failed", location: NO_LOCATION };
  }
}

const LOCATION_COLUMNS = `street_address = $2, city = $3, postcode = $4, country = $5, country_code = $6,
  latitude = $7, longitude = $8, display_name = $9, geocode_status = $10,
  geocoded_at = CASE WHEN $10 IN ('ok', 'no_match') THEN now() ELSE geocoded_at END, updated_at = now()`;

function locationValues({ status, location: l }) {
  return [l.streetAddress, l.city, l.postcode, l.country, l.countryCode, l.latitude, l.longitude, l.displayName, status];
}

/** Insert, retrying on the (astronomically unlikely) join-code collision. */
async function insertProperty(landlordId, { label, address }, geo, q) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await one(
        `INSERT INTO properties (landlord_id, label, address_input, address_key, street_address, city, postcode,
           country, country_code, latitude, longitude, display_name, geocode_status, geocoded_at, join_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 CASE WHEN $13 IN ('ok', 'no_match') THEN now() END, $14)
         RETURNING id`,
        [landlordId, label, address, addressKey(address), ...locationValues(geo).slice(0, 8), geo.status, generateJoinCode()],
        q,
      );
    } catch (err) {
      if (err.code === PG.UNIQUE_VIOLATION && err.constraint === "properties_join_code_key" && attempt < 5) continue;
      throw err;
    }
  }
}

/**
 * Landlord adds one property through the app. An address they already have is a 409:
 * in a form, saying so beats silently returning the existing property.
 */
export async function createProperty(landlord, { label, address }, geocoder) {
  const existing = await one(`SELECT id FROM properties WHERE landlord_id = $1 AND address_key = $2`, [landlord.id, addressKey(address)]);
  if (existing) throw conflict("you've already added a property with this address");

  const geo = await geocodeSafely(geocoder, address);
  try {
    const { id } = await insertProperty(landlord.id, { label, address }, geo);
    return getPropertyFor(landlord, id);
  } catch (err) {
    if (err.code === PG.UNIQUE_VIOLATION && err.constraint === "properties_landlord_address_key") {
      throw conflict("you've already added a property with this address");
    }
    throw err;
  }
}

/**
 * The idempotent version, for `npm run import`: create the property, or update the one
 * this landlord already has at that address. Running the same import twice never creates
 * duplicates, and doesn't call the geocoding API again for addresses already found
 * (Nominatim asks clients not to repeat requests). `refresh` forces a new lookup.
 *
 * @returns {Promise<{ outcome: 'created'|'updated'|'unchanged', id: number, geocodeStatus: string, geocoded: boolean }>}
 */
export async function upsertPropertyForImport(landlordId, { label, address }, geocoder, { refresh = false } = {}) {
  const key = addressKey(address);
  const existing = await one(`SELECT * FROM properties WHERE landlord_id = $1 AND address_key = $2`, [landlordId, key]);

  if (!existing) {
    const geo = await geocodeSafely(geocoder, address);
    // ON CONFLICT covers a second import running at the same moment.
    const row = await one(
      `WITH ins AS (
         INSERT INTO properties (landlord_id, label, address_input, address_key, street_address, city, postcode,
           country, country_code, latitude, longitude, display_name, geocode_status, geocoded_at, join_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 CASE WHEN $13 IN ('ok', 'no_match') THEN now() END, $14)
         ON CONFLICT ON CONSTRAINT properties_landlord_address_key DO NOTHING
         RETURNING id)
       SELECT id FROM ins`,
      [landlordId, label, address, key, ...locationValues(geo).slice(0, 8), geo.status, generateJoinCode()],
    );
    if (row) return { outcome: "created", id: row.id, geocodeStatus: geo.status, geocoded: !geocoder.disabled };
    return upsertPropertyForImport(landlordId, { label, address }, geocoder, { refresh });
  }

  // Look the address up again only if the last attempt didn't get a definite answer
  // (the service failed, or geocoding was off), or if asked to. A definite "no match"
  // isn't retried on every run: Nominatim asks clients not to repeat the same query.
  const needsGeocode = refresh || ["failed", "pending"].includes(existing.geocode_status);
  const labelChanged = (label ?? null) !== (existing.label ?? null);
  let locationChanged = false;
  let geocoded = false;

  if (needsGeocode && !geocoder.disabled) {
    const geo = await geocodeSafely(geocoder, address);
    geocoded = true;
    const l = geo.location;
    locationChanged =
      geo.status !== existing.geocode_status ||
      l.latitude !== existing.latitude ||
      l.longitude !== existing.longitude ||
      l.displayName !== existing.display_name;
    // Never replace a good location with a temporary failure.
    const keepOld = geo.status === "failed" && existing.geocode_status === "ok";
    if (locationChanged && !keepOld) {
      await query(`UPDATE properties SET ${LOCATION_COLUMNS} WHERE id = $1`, [existing.id, ...locationValues(geo)]);
    } else {
      locationChanged = false;
    }
  }
  if (labelChanged) await query(`UPDATE properties SET label = $2, updated_at = now() WHERE id = $1`, [existing.id, label]);

  const after = await one(`SELECT geocode_status FROM properties WHERE id = $1`, [existing.id]);
  return {
    outcome: labelChanged || locationChanged ? "updated" : "unchanged",
    id: existing.id,
    geocodeStatus: after.geocode_status,
    geocoded,
  };
}

/** Re-run geocoding for a property whose lookup failed or found nothing. */
export async function regeocodeProperty(landlord, id, geocoder) {
  const row = await requirePropertyAccess(landlord, id);
  const geo = await geocodeSafely(geocoder, row.address_input);
  await query(`UPDATE properties SET ${LOCATION_COLUMNS} WHERE id = $1`, [id, ...locationValues(geo)]);
  return getPropertyFor(landlord, id);
}

export async function updatePropertyLabel(landlord, id, label) {
  await requirePropertyAccess(landlord, id);
  await query(`UPDATE properties SET label = $2, updated_at = now() WHERE id = $1`, [id, label]);
  return getPropertyFor(landlord, id);
}

/** New join code: anyone holding the old one can no longer join. Existing tenants stay. */
export async function rotateJoinCode(landlord, id) {
  await requirePropertyAccess(landlord, id);
  await query(`UPDATE properties SET join_code = $2, updated_at = now() WHERE id = $1`, [id, generateJoinCode()]);
  return getPropertyFor(landlord, id);
}

export async function joinProperty(tenant, rawCode) {
  const row = await one(`SELECT id FROM properties WHERE join_code = $1`, [normalizeJoinCode(rawCode)]);
  if (!row) throw notFound("no property matches that code. Check it with your landlord");
  const { rowCount } = await query(
    `INSERT INTO tenancies (property_id, tenant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [row.id, tenant.id],
  );
  return { property: await getPropertyFor(tenant, row.id), joined: rowCount === 1 };
}

/** Landlord ends a tenancy. The tenant's past issues stay on the property's record. */
export async function removeTenant(landlord, propertyId, tenantId) {
  await requirePropertyAccess(landlord, propertyId);
  const { rowCount } = await query(`DELETE FROM tenancies WHERE property_id = $1 AND tenant_id = $2`, [propertyId, tenantId]);
  if (!rowCount) throw notFound("that tenant isn't linked to this property");
}

