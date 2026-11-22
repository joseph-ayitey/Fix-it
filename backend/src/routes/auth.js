import { Router } from "express";
import { authenticate, createUser, ROLES, updateProfile } from "../models/users.js";
import { TRADES } from "../utils/people.js";
import { requireAuth } from "../middleware/auth.js";
import { signToken } from "../utils/token.js";
import { unauthorized } from "../utils/errors.js";
import { validate } from "../utils/validate.js";

const router = Router();

// POST /api/auth/register  { email, name, password, role }  -> 201 { token, user }
router.post("/register", async (req, res) => {
  const input = validate(req.body, {
    email: { type: "email", required: true, max: 320 },
    name: { required: true, max: 200 },
    password: { required: true, min: 8, max: 200 },
    role: { required: true, oneOf: ROLES },
    trade: { oneOf: Object.keys(TRADES) }, // workers only: required for them
    area: { max: 200 }, // workers only: where they work, e.g. "Barcelona"
  });
  const user = await createUser(input);
  res.status(201).json({ token: signToken(user), user });
});

// POST /api/auth/login  { email, password }  -> 200 { token, user }
router.post("/login", async (req, res) => {
  const { email, password } = validate(req.body, {
    email: { type: "email", required: true, max: 320 },
    password: { required: true, max: 200 },
  });
  const user = await authenticate(email, password);
  if (!user) throw unauthorized("email or password is incorrect");
  res.json({ token: signToken(user), user });
});

// GET /api/auth/me  -> the signed-in user
router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// PATCH /api/auth/me  { name?, trade?, area? }: update your own profile
router.patch("/me", requireAuth, async (req, res) => {
  const input = validate(req.body, { name: { min: 1, max: 200 }, trade: { oneOf: Object.keys(TRADES) }, area: { max: 200 } });
  // validate() turns omitted fields into null; only pass on what was actually sent.
  const changes = Object.fromEntries(Object.keys(req.body).map((k) => [k, input[k]]));
  res.json({ user: await updateProfile(req.user, changes) });
});

export default router;
