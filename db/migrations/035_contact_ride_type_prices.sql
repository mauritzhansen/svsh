-- A rider can have their own price for a ride type: a discounted group lesson,
-- a staff child's rate, a long-standing arrangement. It overrides the ride
-- type's standard price for that rider and nothing else.
--
-- Price resolution, cheapest-to-find first:
--   1. the seat's own price_cents   (a one-off, set on the ride itself)
--   2. this table                   (this rider's standing rate for the type)
--   3. ride_types.price_cents       (the standard price)

CREATE TABLE contact_ride_type_prices (
    id BIGSERIAL PRIMARY KEY,
    contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    ride_type_id BIGINT NOT NULL REFERENCES ride_types(id) ON DELETE CASCADE,
    price_cents INT NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
    UNIQUE (contact_id, ride_type_id)
);

CREATE INDEX contact_ride_type_prices_contact ON contact_ride_type_prices (contact_id);
