-- Mijn Bereyl – basisschema
-- Geldbedragen worden altijd als integer in centen opgeslagen.
-- Gewichten als integer in grammen.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Doorlopende nummers (AV-2026-0001, BX-0001, F-2026-0001 ...)
CREATE TABLE counters (
  name text PRIMARY KEY,
  value integer NOT NULL DEFAULT 0
);

-- ============ Configuratie (versies: concept → gepubliceerd → gearchiveerd) ============
CREATE TABLE config_versions (
  id serial PRIMARY KEY,
  key text NOT NULL,
  version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','published','archived')),
  data jsonb NOT NULL,
  effective_from date,
  note text,
  created_by integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (key, version)
);
CREATE UNIQUE INDEX config_one_draft ON config_versions(key) WHERE status = 'draft';

-- ============ Gebruikers, bedrijven en toegang ============
CREATE TABLE users (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '',
  phone text,
  password_hash text,
  staff_role text CHECK (staff_role IN ('admin','planner','field')),
  active boolean NOT NULL DEFAULT true,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id text PRIMARY KEY,               -- sha256 van het cookie-token
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE auth_tokens (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('login','set_password','invite')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE companies (
  id serial PRIMARY KEY,
  name text NOT NULL,
  coc_number text,
  vat_number text,
  invoice_email text,
  invoice_attn text,
  invoice_street text,
  invoice_postcode text,
  invoice_city text,
  printmasters_status text NOT NULL DEFAULT 'none'
    CHECK (printmasters_status IN ('none','interest','claimed','verified','rejected')),
  printmasters_rule_code text,
  printmasters_note text,
  public_slug text UNIQUE,
  public_enabled boolean NOT NULL DEFAULT false,
  public_show_name boolean NOT NULL DEFAULT true,
  public_show_logo boolean NOT NULL DEFAULT false,
  public_show_totals boolean NOT NULL DEFAULT true,
  logo_file_id integer,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('customer_admin','customer_member')),
  status text NOT NULL CHECK (status IN ('pending','active','revoked')),
  invited_by integer REFERENCES users(id),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_id)
);

CREATE TABLE locations (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  street text NOT NULL DEFAULT '',
  postcode text NOT NULL,
  city text NOT NULL DEFAULT '',
  instructions text,
  contact_name text,
  contact_phone text,
  distance_km integer,                 -- afgeronde enkele-reisafstand
  distance_source text,                -- route | postcode_indicatie | demo | handmatig
  distance_calculated_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ Bestanden ============
CREATE TABLE files (
  id serial PRIMARY KEY,
  company_id integer REFERENCES companies(id),
  kind text NOT NULL,          -- proposal_pdf, acceptance_pdf, invoice_pdf, photo, certificate, statement, logo, terms
  path text NOT NULL,
  filename text NOT NULL,
  mime text NOT NULL,
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  uploaded_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ Aanvragen en voorstellen ============
CREATE TABLE requests (
  id serial PRIMARY KEY,
  number text NOT NULL UNIQUE,
  submission_id uuid NOT NULL UNIQUE,   -- idempotentie bij dubbel verzenden
  company_id integer REFERENCES companies(id),
  kind text NOT NULL CHECK (kind IN ('proposal','outside_area','printmasters_intro')),
  status text NOT NULL DEFAULT 'new',
  answers jsonb NOT NULL,
  contact jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE proposals (
  id serial PRIMARY KEY,
  request_id integer REFERENCES requests(id),
  company_id integer NOT NULL REFERENCES companies(id),
  location_id integer REFERENCES locations(id),
  subscription_id integer,                  -- bij wijzigingsvoorstellen
  kind text NOT NULL CHECK (kind IN ('new','change','price_update')),
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL CHECK (status IN ('open','accepted','withdrawn','expired','superseded')),
  provisional boolean NOT NULL DEFAULT false,   -- voorlopig PrintMasters-voordeel
  offer jsonb NOT NULL,                         -- volledige momentopname van de berekening
  monthly_cents integer NOT NULL,
  valid_until date NOT NULL,
  terms_version text NOT NULL,
  config_refs jsonb NOT NULL,                   -- gebruikte configuratieversies
  pdf_file_id integer REFERENCES files(id),
  effective_from date,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE acceptances (
  id serial PRIMARY KEY,
  proposal_id integer NOT NULL UNIQUE REFERENCES proposals(id),
  user_id integer NOT NULL REFERENCES users(id),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  proposal_version integer NOT NULL,
  terms_version text NOT NULL,
  amounts jsonb NOT NULL,
  ip text,
  user_agent text,
  pdf_file_id integer REFERENCES files(id)
);

-- ============ Boxen ============
CREATE TABLE boxes (
  id serial PRIMARY KEY,
  number text NOT NULL UNIQUE,
  size integer NOT NULL CHECK (size IN (250,500,1000)),
  status text NOT NULL CHECK (status IN ('in_stock','reserved','placed','in_transit','maintenance','retired')),
  company_id integer REFERENCES companies(id),
  location_id integer REFERENCES locations(id),
  qr_token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(12),'hex'),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ Abonnementen ============
CREATE TABLE subscriptions (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id),
  location_id integer NOT NULL REFERENCES locations(id),
  status text NOT NULL CHECK (status IN ('pending_placement','active','ending','ended')),
  started_at date,
  end_date date,
  billing_stops_at date,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Actieve en geplande versies houden gelijktijdige wijzigingen consistent
CREATE TABLE subscription_versions (
  id serial PRIMARY KEY,
  subscription_id integer NOT NULL REFERENCES subscriptions(id),
  version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('scheduled','active','superseded','cancelled')),
  effective_from date NOT NULL,
  proposal_id integer REFERENCES proposals(id),
  terms jsonb NOT NULL,          -- geaccepteerde afspraak: box, pakket, tarieven, afstand
  box_size integer NOT NULL,
  package_code text NOT NULL,
  monthly_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, version)
);
CREATE UNIQUE INDEX subscription_one_active ON subscription_versions(subscription_id) WHERE status = 'active';
CREATE UNIQUE INDEX subscription_one_scheduled ON subscription_versions(subscription_id) WHERE status = 'scheduled';

-- ============ Legingstegoed ============
CREATE TABLE credit_periods (
  id serial PRIMARY KEY,
  subscription_id integer NOT NULL REFERENCES subscriptions(id),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  included integer NOT NULL,
  closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, starts_on)
);

CREATE TABLE credit_mutations (
  id serial PRIMARY KEY,
  period_id integer NOT NULL REFERENCES credit_periods(id),
  appointment_id integer,
  kind text NOT NULL CHECK (kind IN ('grant','reserve','release','consume','correction','expire','carry_over')),
  delta_available integer NOT NULL DEFAULT 0,   -- effect op nog te gebruiken (niet gereserveerd) tegoed
  delta_reserved integer NOT NULL DEFAULT 0,    -- effect op ingepland tegoed
  reason text NOT NULL,
  actor_user_id integer REFERENCES users(id),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ Afspraken ============
CREATE TABLE staff_routes (
  id serial PRIMARY KEY,
  name text NOT NULL,
  employee_user_id integer REFERENCES users(id),
  capacity_per_day integer NOT NULL DEFAULT 8,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE appointments (
  id serial PRIMARY KEY,
  number text NOT NULL UNIQUE,
  source_key text UNIQUE,
  company_id integer NOT NULL REFERENCES companies(id),
  location_id integer NOT NULL REFERENCES locations(id),
  subscription_id integer REFERENCES subscriptions(id),
  type text NOT NULL CHECK (type IN ('placement','emptying','swap','final_pickup')),
  -- afzonderlijke statussen
  request_status text NOT NULL DEFAULT 'requested'
    CHECK (request_status IN ('requested','confirmed','cancelled','rejected')),
  execution_status text NOT NULL DEFAULT 'pending'
    CHECK (execution_status IN ('pending','executed','failed')),
  weighing_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (weighing_status IN ('not_applicable','pending','confirmed')),
  financial_status text NOT NULL DEFAULT 'pending'
    CHECK (financial_status IN ('pending','included','free_combination','invoiced','no_charge')),
  flexible boolean NOT NULL DEFAULT false,
  preferences jsonb NOT NULL DEFAULT '[]',     -- [{date, daypart}]
  note text,
  combine_printmasters boolean NOT NULL DEFAULT false,
  printmasters_delivery_ref text,
  combination_status text CHECK (combination_status IN ('requested','confirmed','declined')),
  funding text CHECK (funding IN ('included','paid','free_combination','contract','none')),
  price_cents integer,                          -- vastgelegde prijs exclusief btw
  price_detail jsonb,
  planned_date date,
  planned_daypart text,
  route_id integer REFERENCES staff_routes(id),
  assigned_user_id integer REFERENCES users(id),
  box_size integer,
  new_box_size integer,                         -- bij omruilen
  confirmed_at timestamptz,
  confirmed_by integer REFERENCES users(id),
  executed_at timestamptz,
  executed_by integer REFERENCES users(id),
  cancelled_at timestamptz,
  cancel_reason text,
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appointments_company ON appointments(company_id);
CREATE INDEX appointments_planned ON appointments(planned_date);

-- ============ Inzamelingen en impact ============
CREATE TABLE processing_batches (
  id serial PRIMARY KEY,
  number text NOT NULL UNIQUE,
  processor text NOT NULL,
  destination text CHECK (destination IN ('reuse','fiber','recycling','other')),
  destination_note text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','processed')),
  processed_at date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE collections (
  id serial PRIMARY KEY,
  appointment_id integer NOT NULL UNIQUE REFERENCES appointments(id),
  company_id integer NOT NULL REFERENCES companies(id),
  location_id integer NOT NULL REFERENCES locations(id),
  collected_at timestamptz NOT NULL,
  box_taken_id integer REFERENCES boxes(id),
  box_placed_id integer REFERENCES boxes(id),
  employee_user_id integer REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('picked_up','weight_confirmed')),
  net_weight_grams integer,
  weighed_at timestamptz,
  batch_id integer REFERENCES processing_batches(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE weight_corrections (
  id serial PRIMARY KEY,
  collection_id integer NOT NULL REFERENCES collections(id),
  old_grams integer,
  new_grams integer NOT NULL,
  reason text NOT NULL,
  user_id integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE collection_photos (
  collection_id integer NOT NULL REFERENCES collections(id),
  file_id integer NOT NULL REFERENCES files(id),
  PRIMARY KEY (collection_id, file_id)
);

-- Eén bron voor publieke en persoonlijke impact
CREATE VIEW confirmed_weights AS
  SELECT c.id, c.company_id, c.location_id, c.collected_at, c.net_weight_grams, c.batch_id, co.is_demo
  FROM collections c
  JOIN companies co ON co.id = c.company_id
  WHERE c.status = 'weight_confirmed' AND c.net_weight_grams IS NOT NULL;

CREATE TABLE certificates (
  id serial PRIMARY KEY,
  batch_id integer REFERENCES processing_batches(id),
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('batch','customer_statement')),
  file_id integer REFERENCES files(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','released')),
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE certificate_releases (
  id serial PRIMARY KEY,
  certificate_id integer NOT NULL REFERENCES certificates(id),
  company_id integer NOT NULL REFERENCES companies(id),
  statement_file_id integer REFERENCES files(id),
  released_by integer REFERENCES users(id),
  released_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (certificate_id, company_id)
);

-- ============ Facturen en betalingen ============
CREATE TABLE invoices (
  id serial PRIMARY KEY,
  number text UNIQUE,                 -- pas bij definitief
  source_key text NOT NULL UNIQUE,    -- voorkomt dubbele facturen
  company_id integer NOT NULL REFERENCES companies(id),
  subscription_id integer REFERENCES subscriptions(id),
  appointment_id integer REFERENCES appointments(id),
  credits_invoice_id integer REFERENCES invoices(id),
  status text NOT NULL CHECK (status IN ('concept','final','sent','paid','payment_failed','credited')),
  description text NOT NULL,
  subtotal_cents integer NOT NULL,
  vat_cents integer NOT NULL,
  total_cents integer NOT NULL,
  vat_rate_bp integer NOT NULL,       -- 2100 = 21%
  issued_on date,
  due_on date,
  pdf_file_id integer REFERENCES files(id),
  send_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoice_lines (
  id serial PRIMARY KEY,
  invoice_id integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit_cents integer NOT NULL,
  total_cents integer NOT NULL
);

CREATE TABLE mandates (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id),
  provider text NOT NULL,
  provider_mandate_id text,
  status text NOT NULL CHECK (status IN ('missing','pending','valid','revoked')),
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_mandate_id)
);

CREATE TABLE payments (
  id serial PRIMARY KEY,
  invoice_id integer NOT NULL REFERENCES invoices(id),
  provider text NOT NULL,
  provider_payment_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('open','pending','paid','failed','refunded')),
  amount_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id)
);

CREATE TABLE payment_events (
  id serial PRIMARY KEY,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  payload jsonb NOT NULL,
  processed_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

-- ============ Werkvoorraad, e-mail, automatisering, audit ============
CREATE TABLE tasks (
  id serial PRIMARY KEY,
  type text NOT NULL,
  title text NOT NULL,
  detail text,
  company_id integer REFERENCES companies(id),
  ref_type text,
  ref_id integer,
  owner_user_id integer REFERENCES users(id),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  due_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  dedupe_key text UNIQUE,
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_templates (
  id serial PRIMARY KEY,
  key text NOT NULL,
  audience text NOT NULL CHECK (audience IN ('external','internal')),
  name text NOT NULL,
  version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','published','archived')),
  subject text NOT NULL,
  blocks jsonb NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]',
  created_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (key, version)
);
CREATE UNIQUE INDEX email_template_one_draft ON email_templates(key) WHERE status = 'draft';
CREATE UNIQUE INDEX email_template_one_published ON email_templates(key) WHERE status = 'published';

CREATE TABLE email_log (
  id serial PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  template_key text,
  template_version integer,
  company_id integer REFERENCES companies(id),
  to_address text NOT NULL,
  cc text,
  reply_to text,
  subject text NOT NULL,
  html text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]',   -- [{file_id, filename}]
  status text NOT NULL CHECK (status IN ('queued','sent','failed','not_configured','test')),
  error text,
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id bigserial PRIMARY KEY,
  type text NOT NULL,
  payload jsonb NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','skipped')),
  run_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_error text,
  result jsonb,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX jobs_ready ON jobs(run_at) WHERE status = 'queued';

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  actor_user_id integer REFERENCES users(id),
  company_id integer REFERENCES companies(id),
  action text NOT NULL,
  entity_type text,
  entity_id integer,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_company ON audit_log(company_id, created_at DESC);
