-- FixIt database schema (PostgreSQL), version 1.
--
-- Applied automatically, once, by src/db/migrate.js when the API (or any script) starts
-- against an empty database. Don't edit it to change an EXISTING database: add a
-- numbered file to src/db/migrations/ instead (see the README there).
--
-- What it models: a tenant reports something broken in the home they rent, the landlord
-- assigns a worker, and everyone follows the issue on one shared, timestamped timeline
-- until the tenant confirms it's fixed.
--
-- Conventions:
--   - ids are integer identity columns (Postgres generates them).
--   - All times are timestamptz: stored as an absolute instant (UTC), so they compare
--     and sort correctly no matter which time zone the server or the browser is in.
--   - Fixed sets of values (roles, statuses...) are text + CHECK constraints: readable in
--     psql, and the database itself rejects anything else.
--   - Optional facts we don't have (no postcode, no map position) are NULL, never '' or 0.

-- People: landlords, tenants, and workers (tradespeople landlords assign repairs to).
CREATE TABLE users (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text        NOT NULL,
  name          text        NOT NULL,
  password_hash text        NOT NULL,  -- scrypt; the password itself is never stored
  role          text        NOT NULL CHECK (role IN ('landlord', 'tenant', 'worker')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- One account per email, case-insensitively (Maria@x.com = maria@x.com).
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- A landlord's properties, geocoded via OpenStreetMap (Nominatim).
CREATE TABLE properties (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  landlord_id    integer     NOT NULL REFERENCES users (id),
  label          text,                 -- landlord's own nickname, e.g. "Eixample flat"
  address_input  text        NOT NULL, -- exactly what the landlord typed (or the CSV said)
  -- The idempotency key: address_input lowercased, with spaces and commas tidied, so
  -- "Carrer de Mallorca 401,Barcelona" and "carrer de mallorca 401, Barcelona" are the
  -- same property. One landlord can't have the same address twice; re-importing it
  -- updates the existing row instead of creating a duplicate.
  address_key    text        NOT NULL,
  -- From Nominatim. All nullable: an address that can't be geocoded is still a property
  -- tenants can report issues on, just without a map pin.
  street_address text,
  city           text,
  postcode       text,
  country        text,
  country_code   text,
  latitude       double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude      double precision CHECK (longitude BETWEEN -180 AND 180),
  display_name   text,
  geocode_status text        NOT NULL DEFAULT 'pending'
                 CHECK (geocode_status IN ('pending', 'ok', 'no_match', 'failed')),
  geocoded_at    timestamptz,
  -- Short code the landlord shares with tenants so they can link themselves.
  join_code      text        NOT NULL UNIQUE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT properties_landlord_address_key UNIQUE (landlord_id, address_key)
);

-- Which tenants live where.
CREATE TABLE tenancies (
  property_id integer     NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
  tenant_id   integer     NOT NULL REFERENCES users (id),
  joined_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, tenant_id)
);
CREATE INDEX tenancies_tenant_idx ON tenancies (tenant_id);

-- A landlord's team of workers. A worker can be on several landlords' teams.
CREATE TABLE landlord_workers (
  landlord_id integer     NOT NULL REFERENCES users (id),
  worker_id   integer     NOT NULL REFERENCES users (id),
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (landlord_id, worker_id)
);
CREATE INDEX landlord_workers_worker_idx ON landlord_workers (worker_id);

-- Maintenance issues reported by tenants.
CREATE TABLE issues (
  id                 integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  property_id        integer     NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
  reported_by        integer     NOT NULL REFERENCES users (id),
  title              text        NOT NULL,
  description        text        NOT NULL,
  category           text        NOT NULL CHECK (category IN
                       ('plumbing', 'electrical', 'heating', 'appliance', 'structural', 'pest', 'security', 'other')),
  urgency            text        NOT NULL DEFAULT 'normal' CHECK (urgency IN ('low', 'normal', 'urgent')),
  status             text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  assigned_worker_id integer     REFERENCES users (id), -- NULL = nobody assigned yet
  assigned_at        timestamptz,
  -- First time the landlord's side (landlord or assigned worker) responded.
  -- NULL = nobody has, which the UI shows as "No response from landlord for N days".
  acknowledged_at    timestamptz,
  resolved_at        timestamptz,
  closed_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX issues_property_idx ON issues (property_id, status);
CREATE INDEX issues_reporter_idx ON issues (reported_by);
CREATE INDEX issues_assignee_idx ON issues (assigned_worker_id);

-- The timeline: every report, comment, status change and (un)assignment, append-only.
CREATE TABLE issue_events (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  issue_id    integer     NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
  actor_id    integer     NOT NULL REFERENCES users (id),
  type        text        NOT NULL CHECK (type IN ('reported', 'comment', 'status_change', 'assigned', 'unassigned')),
  body        text,
  from_status text,
  to_status   text,
  subject_id  integer     REFERENCES users (id), -- for (un)assignments: the worker it's about
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX issue_events_issue_idx ON issue_events (issue_id, id);

-- Photos attached to a timeline event. The image is a file in UPLOAD_DIR named
-- stored_name; only its metadata lives here.
CREATE TABLE issue_photos (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  issue_id      integer     NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
  event_id      integer     NOT NULL REFERENCES issue_events (id) ON DELETE CASCADE,
  uploader_id   integer     NOT NULL REFERENCES users (id),
  stored_name   text        NOT NULL UNIQUE,
  original_name text        NOT NULL,
  mime_type     text        NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  size_bytes    integer     NOT NULL CHECK (size_bytes > 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX issue_photos_event_idx ON issue_photos (event_id);
CREATE INDEX issue_photos_issue_idx ON issue_photos (issue_id);
