BEGIN;

CREATE TABLE IF NOT EXISTS openrails_runtime_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  state_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS openrails_runtime_replay_nonces (
  domain_salt text NOT NULL,
  chain_id text NOT NULL,
  anchor_contract text NOT NULL,
  signer text NOT NULL,
  nonce text NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (domain_salt, chain_id, anchor_contract, signer, nonce)
);

COMMIT;
