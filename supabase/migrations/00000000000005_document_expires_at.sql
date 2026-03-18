-- Add expires_at column to documents for user-controlled expiry renewal
ALTER TABLE documents ADD COLUMN expires_at TIMESTAMPTZ DEFAULT NULL;
