-- Web Push: one row per instructor device that has agreed to be notified when
-- the schedule changes. The endpoint is issued by Apple/Google and is the
-- address we push to; it is unique per device+site and is rotated by the
-- browser, so an endpoint that stops working is simply deleted (410 Gone).
--
-- The VAPID keypair identifying this server to the push services lives in
-- settings, generated on first boot, so nothing has to be configured by hand.

CREATE TABLE push_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,          -- client public key, for payload encryption
    auth TEXT NOT NULL,            -- client auth secret
    label TEXT NOT NULL DEFAULT '', -- optional: which instructor/device
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_ok TIMESTAMPTZ            -- last successful delivery, for pruning
);