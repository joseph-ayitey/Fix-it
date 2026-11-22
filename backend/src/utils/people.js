// Trades, and how much of a person's identity each party gets to see.

export const TRADES = {
  plumber: "Plumber",
  electrician: "Electrician",
  heating_engineer: "Heating engineer",
  appliance_repair: "Appliance repair",
  builder: "Builder",
  locksmith: "Locksmith",
  pest_control: "Pest control",
  handyman: "Handyman",
};

/** The trade a landlord most likely needs for each issue category (pre-selected in "Find a worker"). */
export const TRADE_FOR_CATEGORY = {
  plumbing: "plumber",
  electrical: "electrician",
  heating: "heating_engineer",
  appliance: "appliance_repair",
  structural: "builder",
  pest: "pest_control",
  security: "locksmith",
  other: "handyman",
};

/** "Pau Vidal" -> "Pau V." */
export function shortName(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts[0]} ${parts.at(-1)[0].toUpperCase()}.`;
}

/**
 * How `viewer` sees `person`'s name. The landlord coordinates everyone, so they see full
 * names; everyone sees their own and the landlord's full name. Tenants and workers see
 * each other only as "Pau V.", never with contact details: they talk on the issue's
 * timeline, not privately.
 */
export function nameFor(viewer, person) {
  if (!person?.name) return person?.name ?? null;
  if (viewer.role === "landlord" || viewer.id === person.id || person.role === "landlord") return person.name;
  return shortName(person.name);
}
