-- Count distinct unverified registration recipients across Cloudflare locations.
-- Both indexes support the rolling one-day window without scanning all auth logs.
CREATE INDEX idx_email_verification_challenges_register_source_time
  ON email_verification_challenges(ip_hash, created_at, email)
  WHERE purpose='register';

CREATE INDEX idx_auth_audit_logs_register_source_time
  ON auth_audit_logs(ip_hash, created_at, email)
  WHERE event_type='register_code_sent';
