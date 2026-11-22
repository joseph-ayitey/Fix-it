import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  createProperty,
  getPropertyFor,
  joinProperty,
  listPropertiesFor,
  regeocodeProperty,
  removeTenant,
  rotateJoinCode,
  updatePropertyLabel,
} from "../models/properties.js";
import { notFound } from "../utils/errors.js";
import { parseId, validate } from "../utils/validate.js";

function idParam(req, name = "id") {
  const id = parseId(req.params[name]);
  if (!id) throw notFound("property not found");
  return id;
}

export default function propertiesRouter({ geocoder }) {
  const router = Router();
  router.use(requireAuth);

  // GET /api/properties: landlord: properties they own; tenant: properties they've joined
  router.get("/", async (req, res) => {
    res.json(await listPropertiesFor(req.user));
  });

  // POST /api/properties  { address, label? }: landlord adds a property (geocoded)
  router.post("/", requireRole("landlord"), async (req, res) => {
    const input = validate(req.body, {
      address: { required: true, min: 5, max: 500 },
      label: { max: 200 },
    });
    const property = await createProperty(req.user, input, geocoder);
    res.status(201).location(`/api/properties/${property.id}`).json(property);
  });

  // POST /api/properties/join  { code }: tenant links themselves to a property
  router.post("/join", requireRole("tenant"), async (req, res) => {
    const { code } = validate(req.body, { code: { required: true, max: 20 } });
    const { property, joined } = await joinProperty(req.user, code);
    res.status(joined ? 201 : 200).json(property);
  });

  // GET /api/properties/:id
  router.get("/:id", async (req, res) => {
    res.json(await getPropertyFor(req.user, idParam(req)));
  });

  // PATCH /api/properties/:id  { label }
  router.patch("/:id", requireRole("landlord"), async (req, res) => {
    const { label } = validate(req.body, { label: { max: 200 } });
    res.json(await updatePropertyLabel(req.user, idParam(req), label));
  });

  // POST /api/properties/:id/join-code: issue a new code; the old one stops working
  router.post("/:id/join-code", requireRole("landlord"), async (req, res) => {
    res.json(await rotateJoinCode(req.user, idParam(req)));
  });

  // POST /api/properties/:id/geocode: retry a failed or no-match address lookup
  router.post("/:id/geocode", requireRole("landlord"), async (req, res) => {
    res.json(await regeocodeProperty(req.user, idParam(req), geocoder));
  });

  // DELETE /api/properties/:id/tenants/:tenantId: end a tenancy
  router.delete("/:id/tenants/:tenantId", requireRole("landlord"), async (req, res) => {
    const tenantId = parseId(req.params.tenantId);
    if (!tenantId) throw notFound("tenant not found");
    await removeTenant(req.user, idParam(req), tenantId);
    res.status(204).end();
  });

  return router;
}
