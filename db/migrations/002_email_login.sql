-- Inloggen uitsluitend via een persoonlijke e-maillink: wachtwoorden worden niet meer opgeslagen.
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
DELETE FROM auth_tokens WHERE purpose = 'set_password';
ALTER TABLE auth_tokens DROP CONSTRAINT IF EXISTS auth_tokens_purpose_check;
ALTER TABLE auth_tokens ADD CONSTRAINT auth_tokens_purpose_check CHECK (purpose IN ('login','invite'));
UPDATE email_templates SET status='archived' WHERE key='auth_password_reset';

-- Rem op het aanvragen van inloglinks (per e-mailadres en per IP), gedeeld over alle serverprocessen.
CREATE TABLE login_requests (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_requests_email ON login_requests(email, created_at);
CREATE INDEX login_requests_ip ON login_requests(ip, created_at);
