-- 003: remembered Idempotency-Keys, so retrying a create request never creates it twice.
-- See src/middleware/idempotency.js and docs/decisions/0003-idempotency-keys.md.

CREATE TABLE idempotency_keys (
  user_id           integer     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key               text        NOT NULL,  -- chosen by the client, unique per user
  operation         text        NOT NULL,  -- e.g. 'POST /issues': a key belongs to one endpoint
  request_hash      text        NOT NULL,  -- SHA-256 of the request body (and photos), to detect reuse
  status            text        NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  response_status   integer,
  response_body     jsonb,
  response_location text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  PRIMARY KEY (user_id, key)
);

-- For clearing out keys older than 24 hours.
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);
