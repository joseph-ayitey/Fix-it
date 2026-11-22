// Signed access tokens (JWT, HS256). The token carries only the user's id and role; the
// auth middleware re-reads the user from the database on every request, so a deleted
// user's token stops working immediately.

import jwt from "jsonwebtoken";

const DEFAULT_TTL = "7d";

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error("JWT_SECRET must be set to at least 32 characters (see .env.example).");
  }
  return s;
}

export function signToken(user) {
  return jwt.sign({ role: user.role }, secret(), {
    subject: String(user.id),
    expiresIn: process.env.JWT_TTL || DEFAULT_TTL,
    algorithm: "HS256",
  });
}

/** @returns {{ userId: number, role: string }} @throws if invalid or expired */
export function verifyToken(token) {
  const payload = jwt.verify(token, secret(), { algorithms: ["HS256"] });
  return { userId: Number(payload.sub), role: payload.role };
}

/** Call at startup so a missing secret fails the boot, not the first login. */
export function assertTokenConfig() {
  secret();
}
