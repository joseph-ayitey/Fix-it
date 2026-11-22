import { verifyToken } from "../utils/token.js";
import { findUserById } from "../models/users.js";
import { forbidden, unauthorized } from "../utils/errors.js";

/**
 * Requires `Authorization: Bearer <token>`. Loads the user fresh from the database (so
 * a deleted account's token stops working) and puts it on req.user.
 */
export async function requireAuth(req, _res, next) {
  const header = req.get("Authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return next(unauthorized());

  let claims;
  try {
    claims = verifyToken(token);
  } catch {
    return next(unauthorized("your session has expired. Please sign in again"));
  }

  try {
    const user = await findUserById(claims.userId);
    if (!user) return next(unauthorized("your session has expired. Please sign in again"));
    req.user = user;
    next();
  } catch (err) {
    next(err); // e.g. the database is down: a 500, not "signed out"
  }
}

/**
 * Use after requireAuth. The message says who you're signed in as, because the usual
 * cause of this error is being signed in as someone else than you think.
 */
export function requireRole(role) {
  return (req, _res, next) =>
    req.user?.role === role
      ? next()
      : next(forbidden(`only ${role}s can do this. You're signed in as ${req.user.name} (${req.user.role})`));
}
