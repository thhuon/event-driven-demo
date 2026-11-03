-- userdb: dữ liệu của user-service (producer)
CREATE TABLE users (
  id          SERIAL PRIMARY KEY,
  full_name   VARCHAR(150) NOT NULL,
  email       VARCHAR(150) NOT NULL UNIQUE,
  phone       VARCHAR(30),
  dob         DATE,
  gender      VARCHAR(10),
  address     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transactional outbox: ghi cùng transaction với users, relay đọc rồi publish
CREATE TABLE outbox (
  id          BIGSERIAL PRIMARY KEY,
  routing_key TEXT NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ
);
CREATE INDEX outbox_unsent ON outbox (id) WHERE sent_at IS NULL;

-- Mỗi consumer có database riêng
CREATE DATABASE emaildb;
CREATE DATABASE auditdb;
CREATE DATABASE statsdb;

\connect emaildb
CREATE TABLE processed_events (
  event_id     UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

\connect auditdb
CREATE TABLE processed_events (
  event_id     UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  event_id    UUID NOT NULL,
  event_type  TEXT NOT NULL,
  user_id     INT,
  data        JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

\connect statsdb
CREATE TABLE processed_events (
  event_id     UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE user_stats (
  gender TEXT PRIMARY KEY,
  total  INT NOT NULL DEFAULT 0
);
