-- 002: workers' trades, job offers, private landlord-worker notes, two-sided confirmation.

-- 1. Workers say what they do (and optionally where), so landlords can find them by
--    trade instead of needing their email. Only workers have a trade.
ALTER TABLE users ADD COLUMN trade text, ADD COLUMN area text;
ALTER TABLE users ADD CONSTRAINT users_trade_check CHECK (trade IN
  ('plumber', 'electrician', 'heating_engineer', 'appliance_repair', 'builder', 'locksmith', 'pest_control', 'handyman'));
ALTER TABLE users ADD CONSTRAINT users_trade_only_workers CHECK (trade IS NULL OR role = 'worker');
CREATE INDEX users_trade_idx ON users (trade) WHERE role = 'worker';

-- 2. Job offers: a landlord offers an issue to a worker, who accepts or declines.
--    Only an accepted offer assigns the worker, so nobody gets jobs they didn't agree to.
CREATE TABLE job_offers (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  issue_id     integer     NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
  landlord_id  integer     NOT NULL REFERENCES users (id),
  worker_id    integer     NOT NULL REFERENCES users (id),
  status       text        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn', 'cancelled')),
  message      text,  -- from the landlord
  response     text,  -- from the worker (e.g. why they declined)
  created_at   timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
-- At most one open offer per issue at a time: the database itself guarantees it.
CREATE UNIQUE INDEX job_offers_one_pending_per_issue ON job_offers (issue_id) WHERE status = 'pending';
CREATE INDEX job_offers_worker_idx ON job_offers (worker_id, status);

-- 3. Timeline: private entries (landlord and worker only), plus new event types.
ALTER TABLE issue_events ADD COLUMN visibility text NOT NULL DEFAULT 'shared'
  CHECK (visibility IN ('shared', 'internal'));
ALTER TABLE issue_events DROP CONSTRAINT issue_events_type_check;
ALTER TABLE issue_events ADD CONSTRAINT issue_events_type_check CHECK (type IN
  ('reported', 'comment', 'status_change', 'assigned', 'unassigned', 'confirmed',
   'offer_sent', 'offer_accepted', 'offer_declined', 'offer_withdrawn'));

-- 4. A resolved issue closes once BOTH the tenant (it works) and the landlord (the work is
--    approved) have confirmed.
ALTER TABLE issues ADD COLUMN tenant_confirmed_at timestamptz, ADD COLUMN landlord_confirmed_at timestamptz;
-- Issues already marked resolved were resolved under the old rule, where the landlord's
-- word was enough: count that as the landlord's confirmation, so only the tenant's is due.
UPDATE issues SET landlord_confirmed_at = resolved_at WHERE status = 'resolved';
