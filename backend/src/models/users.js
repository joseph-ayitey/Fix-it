// Users: landlords, tenants and workers (tradespeople landlords offer repairs to).
// Passwords are hashed with scrypt (built into node:crypto) using a per-user random salt,
// and compared in constant time.

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { iso, one, PG } from "../db/index.js";
import { badRequest, conflict } from "../utils/errors.js";

const scrypt = promisify(scryptCb);
const KEY_LENGTH = 64;

export const ROLES = ["landlord", "tenant", "worker"];

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function passwordMatches(password, stored) {
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt") return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

/** The shape every API response uses for a user: never includes the password hash. */
export function toPublicUser(row) {
  return (
    row && {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      // Workers only: what they do and where.
      ...(row.role === "worker" ? { trade: row.trade, area: row.area } : {}),
      createdAt: iso(row.created_at),
    }
  );
}

export async function createUser({ email, name, password, role, trade = null, area = null }) {
  if (role === "worker" && !trade) {
    throw badRequest("workers need to choose their trade", [{ field: "trade", message: "is required for workers" }]);
  }
  if (role !== "worker" && (trade || area)) {
    throw badRequest("only workers have a trade", [{ field: "trade", message: "is only for worker accounts" }]);
  }
  const passwordHash = await hashPassword(password);
  try {
    const row = await one(
      `INSERT INTO users (email, name, password_hash, role, trade, area) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [email, name, passwordHash, role, trade, area],
    );
    return toPublicUser(row);
  } catch (err) {
    if (err.code === PG.UNIQUE_VIOLATION) throw conflict("an account with that email already exists");
    throw err;
  }
}

/** Change your own name, and for workers their trade and area. */
export async function updateProfile(user, { name, trade, area }) {
  if (user.role !== "worker" && (trade !== undefined || area !== undefined)) {
    throw badRequest("only workers have a trade", [{ field: "trade", message: "is only for worker accounts" }]);
  }
  if (user.role === "worker" && trade === null) {
    throw badRequest("workers need a trade", [{ field: "trade", message: "is required for workers" }]);
  }
  const row = await one(
    `UPDATE users SET
       name  = coalesce($2, name),
       trade = CASE WHEN $3::boolean THEN $4 ELSE trade END,
       area  = CASE WHEN $5::boolean THEN $6 ELSE area END
     WHERE id = $1 RETURNING *`,
    [user.id, name ?? null, trade !== undefined, trade ?? null, area !== undefined, area ?? null],
  );
  return toPublicUser(row);
}

/** @returns {Promise<object|null>} the public user if email + password match, else null */
export async function authenticate(email, password) {
  const row = await one(`SELECT * FROM users WHERE lower(email) = lower($1)`, [email]);
  if (!row) {
    // Hash anyway so "no such email" and "wrong password" take the same time.
    await hashPassword(password);
    return null;
  }
  return (await passwordMatches(password, row.password_hash)) ? toPublicUser(row) : null;
}

export async function findUserById(id) {
  return toPublicUser(await one(`SELECT * FROM users WHERE id = $1`, [id]));
}

export async function findUserByEmail(email) {
  return toPublicUser(await one(`SELECT * FROM users WHERE lower(email) = lower($1)`, [email]));
}
