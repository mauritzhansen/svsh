const path = require('path');
const crypto = require('crypto');
const express = require('express');
const PDFDocument = require('pdfkit');
const pg = require('pg');

// Return DATE columns as plain 'YYYY-MM-DD' strings (no timezone surprises)
pg.types.setTypeParser(1082, (v) => v);

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://svsh@localhost/svsh'
});

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 4700;
const SESSION_DAYS = 60;

// ---------- Auth helpers ----------
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password, stored) {
    const [salt, hash] = String(stored).split(':');
    if (!salt || !hash) return false;
    const candidate = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), candidate);
}

function parseCookies(req) {
    const out = {};
    (req.headers.cookie || '').split(';').forEach((pair) => {
        const idx = pair.indexOf('=');
        if (idx > -1) out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    });
    return out;
}

async function createSession(res, userId) {
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
        `INSERT INTO sessions (token, user_id, expires_at)
         VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
        [token, userId, SESSION_DAYS]
    );
    res.setHeader('Set-Cookie',
        `sb_session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_DAYS * 24 * 3600}; SameSite=Lax`);
}

// Attach req.user (or null) to every API request
app.use('/api', async (req, res, next) => {
    req.user = null;
    const token = parseCookies(req).sb_session;
    if (token) {
        try {
            const { rows } = await pool.query(
                `SELECT u.id, u.email, u.display_name, u.role
                   FROM sessions s JOIN users u ON u.id = s.user_id
                  WHERE s.token = $1 AND s.expires_at > now() AND u.active`,
                [token]
            );
            req.user = rows[0] || null;
        } catch (err) {
            console.error('Session lookup failed:', err);
        }
    }
    next();
});

function requireAuth(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Not logged in.' });
    next();
}

// admin > helper > guide
const ROLE_RANK = { guide: 1, helper: 2, admin: 3 };
function requireRole(minRole) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'Not logged in.' });
        if (ROLE_RANK[req.user.role] < ROLE_RANK[minRole]) {
            return res.status(403).json({ error: 'Not allowed for your role.' });
        }
        next();
    };
}

function handleError(res, err, what) {
    console.error(`${what} failed:`, err);
    res.status(500).json({ error: `${what} failed.` });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;
const LEVELS = ['beginner', 'beginner-intermediate', 'intermediate', 'intermediate-advanced', 'advanced'];
const GUIDE_MODES = ['foot', 'horse', 'running', 'cycling'];

// ---------- Auth routes ----------
app.get('/api/auth/me', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
        res.json({ user: req.user, setup_required: rows[0].n === 0 });
    } catch (err) {
        handleError(res, err, 'Auth check');
    }
});

// First-run only: creates the initial admin account
app.post('/api/auth/setup', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
        if (rows[0].n > 0) return res.status(403).json({ error: 'Setup already completed.' });

        const { email, password, display_name } = req.body || {};
        const emailNorm = String(email || '').trim().toLowerCase();
        const name = String(display_name || '').trim();
        if (!emailNorm || !name) return res.status(400).json({ error: 'Name and email are required.' });
        if (String(password || '').length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

        const ins = await pool.query(
            `INSERT INTO users (email, password_hash, display_name, role)
             VALUES ($1, $2, $3, 'admin') RETURNING id, email, display_name, role`,
            [emailNorm, hashPassword(password), name]
        );
        await createSession(res, ins.rows[0].id);
        res.json({ user: ins.rows[0] });
    } catch (err) {
        handleError(res, err, 'Setup');
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const emailNorm = String((req.body || {}).email || '').trim().toLowerCase();
        const { rows } = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND active', [emailNorm]);
        const user = rows[0];
        if (!user || !verifyPassword((req.body || {}).password || '', user.password_hash)) {
            return res.status(401).json({ error: 'Wrong email or password.' });
        }
        await createSession(res, user.id);
        res.json({ user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role } });
    } catch (err) {
        handleError(res, err, 'Login');
    }
});

app.post('/api/auth/logout', async (req, res) => {
    try {
        const token = parseCookies(req).sb_session;
        if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
        res.setHeader('Set-Cookie', 'sb_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
        res.json({ ok: true });
    } catch (err) {
        handleError(res, err, 'Logout');
    }
});

// ---------- Users (admin) ----------
app.get('/api/users', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, email, display_name, role, active FROM users ORDER BY display_name');
        res.json({ users: rows });
    } catch (err) {
        handleError(res, err, 'Loading users');
    }
});

app.post('/api/users', requireRole('admin'), async (req, res) => {
    try {
        const { email, password, display_name, role } = req.body || {};
        const emailNorm = String(email || '').trim().toLowerCase();
        if (!emailNorm || !String(display_name || '').trim()) {
            return res.status(400).json({ error: 'Name and email are required.' });
        }
        if (String(password || '').length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
        if (!['admin', 'helper', 'guide'].includes(role)) return res.status(400).json({ error: 'Invalid role.' });
        const { rows } = await pool.query(
            `INSERT INTO users (email, password_hash, display_name, role)
             VALUES ($1, $2, $3, $4) RETURNING id, email, display_name, role, active`,
            [emailNorm, hashPassword(password), String(display_name).trim(), role]
        );
        res.json({ user: rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'That email is already in use.' });
        handleError(res, err, 'Creating user');
    }
});

app.put('/api/users/:id', requireRole('admin'), async (req, res) => {
    try {
        const { display_name, role, active, password } = req.body || {};
        if (role && !['admin', 'helper', 'guide'].includes(role)) return res.status(400).json({ error: 'Invalid role.' });
        const { rows } = await pool.query(
            `UPDATE users SET
                display_name = COALESCE($2, display_name),
                role = COALESCE($3, role),
                active = COALESCE($4, active)
             WHERE id = $1 RETURNING id, email, display_name, role, active`,
            [req.params.id, display_name, role, active]
        );
        if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
        if (password) {
            await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1',
                [req.params.id, hashPassword(password)]);
        }
        res.json({ user: rows[0] });
    } catch (err) {
        handleError(res, err, 'Updating user');
    }
});

// ---------- Settings ----------
app.get('/api/settings', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT key, value FROM settings');
        const settings = {};
        rows.forEach((r) => { settings[r.key] = r.value; });
        res.json({ settings });
    } catch (err) {
        handleError(res, err, 'Loading settings');
    }
});

app.put('/api/settings', requireRole('admin'), async (req, res) => {
    try {
        const allowed = ['business_name', 'business_address', 'currency', 'invoice_footer', 'day_start', 'day_end'];
        for (const key of allowed) {
            if (typeof (req.body || {})[key] === 'string') {
                await pool.query(
                    `INSERT INTO settings (key, value) VALUES ($1, $2)
                     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
                    [key, req.body[key]]);
            }
        }
        res.json({ ok: true });
    } catch (err) {
        handleError(res, err, 'Saving settings');
    }
});

// ---------- Contacts ----------
app.get('/api/contacts', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT c.*, p.name AS parent_name,
                    (SELECT count(*)::int FROM ride_participants rp
                      JOIN rides r ON r.id = rp.ride_id
                      WHERE rp.contact_id = c.id AND r.status = 'active' AND NOT r.is_block) AS ride_count,
                    (SELECT COALESCE(json_agg(json_build_object(
                            'horse_id', hp.horse_id::text, 'kind', hp.kind, 'reason', hp.reason,
                            'horse_name', h.name) ORDER BY hp.kind DESC, h.name), '[]'::json)
                       FROM contact_horse_prefs hp JOIN horses h ON h.id = hp.horse_id
                      WHERE hp.contact_id = c.id) AS horse_prefs,
                    (SELECT COALESCE(json_agg(json_build_object(
                            'weekday', av.weekday, 'start_time', av.start_time::text,
                            'end_time', av.end_time::text) ORDER BY av.weekday, av.start_time), '[]'::json)
                       FROM contact_availability av WHERE av.contact_id = c.id) AS availability,
                    (SELECT COALESCE(json_agg(json_build_object(
                            'period_start', tp.period_start::text, 'period_end', tp.period_end::text)), '[]'::json)
                       FROM term_passes tp WHERE tp.contact_id = c.id) AS term_passes
               FROM contacts c
               LEFT JOIN contacts p ON p.id = c.parent_id
              WHERE NOT c.archived
              ORDER BY c.name`);
        res.json({ contacts: rows });
    } catch (err) {
        handleError(res, err, 'Loading contacts');
    }
});

app.get('/api/contacts/:id', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT c.*, p.name AS parent_name,
                    (SELECT count(*)::int FROM reschedule_credits rc
                      WHERE rc.contact_id = c.id AND rc.used_ride_id IS NULL) AS open_credits,
                    (SELECT COALESCE(json_agg(json_build_object(
                            'id', tp.id::text, 'period_start', tp.period_start::text,
                            'period_end', tp.period_end::text) ORDER BY tp.period_end DESC), '[]'::json)
                       FROM term_passes tp WHERE tp.contact_id = c.id) AS term_passes,
                    (SELECT COALESCE(json_agg(json_build_object(
                            'horse_id', hp.horse_id::text, 'kind', hp.kind, 'reason', hp.reason,
                            'horse_name', h.name) ORDER BY hp.kind DESC, h.name), '[]'::json)
                       FROM contact_horse_prefs hp JOIN horses h ON h.id = hp.horse_id
                      WHERE hp.contact_id = c.id) AS horse_prefs,
                    (SELECT COALESCE(json_agg(json_build_object(
                            'weekday', av.weekday, 'start_time', av.start_time::text,
                            'end_time', av.end_time::text) ORDER BY av.weekday, av.start_time), '[]'::json)
                       FROM contact_availability av WHERE av.contact_id = c.id) AS availability
               FROM contacts c LEFT JOIN contacts p ON p.id = c.parent_id
              WHERE c.id = $1`, [req.params.id]);
        if (!rows[0]) return res.status(404).json({ error: 'Contact not found.' });
        const children = await pool.query(
            `SELECT id, name FROM contacts WHERE parent_id = $1 AND NOT archived ORDER BY name`,
            [req.params.id]);
        const rides = await pool.query(
            `SELECT rp.id, r.date, r.start_time, h.name AS horse_name,
                    COALESCE(rt.name, r.ride_type_name) AS ride_type_name,
                    COALESCE(rp.price_cents, rt.price_cents, 0) AS amount_cents,
                    il.invoice_id
               FROM ride_participants rp
               JOIN rides r ON r.id = rp.ride_id AND r.status = 'active' AND NOT r.is_block
               LEFT JOIN horses h ON h.id = rp.horse_id
               LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
               LEFT JOIN invoice_lines il ON il.participant_id = rp.id
              WHERE rp.contact_id = $1
              ORDER BY r.date DESC, r.start_time DESC
              LIMIT 200`,
            [req.params.id]);
        const invoices = await pool.query(
            'SELECT * FROM invoices WHERE contact_id = $1 ORDER BY created_at DESC', [req.params.id]);
        res.json({ contact: rows[0], children: children.rows, rides: rides.rows, invoices: invoices.rows });
    } catch (err) {
        handleError(res, err, 'Loading contact');
    }
});

// A rider's parent must be a real payer: not themselves, not archived, and not
// itself a kid (one level of nesting only, keeps invoicing unambiguous)
async function validateParent(parentId, contactId) {
    if (!parentId) return null;
    if (contactId && String(parentId) === String(contactId)) return 'A contact cannot be their own parent.';
    const { rows } = await pool.query(
        'SELECT parent_id, archived FROM contacts WHERE id = $1', [parentId]);
    if (!rows[0] || rows[0].archived) return 'Parent contact not found.';
    if (rows[0].parent_id) return 'That contact is a rider themselves and cannot be a parent.';
    if (contactId) {
        const { rows: kids } = await pool.query(
            'SELECT 1 FROM contacts WHERE parent_id = $1 LIMIT 1', [contactId]);
        if (kids[0]) return 'This contact has riders linked to them and cannot get a parent themselves.';
    }
    return null;
}

// Replace-all save of a contact's horse preferences and availability windows.
// Returns an error string, or null on success.
async function saveContactExtras(contactId, body) {
    if (Array.isArray(body.horse_prefs)) {
        const clean = [];
        const seen = new Set();
        for (const p of body.horse_prefs) {
            if (!p || !p.horse_id || seen.has(String(p.horse_id))) continue;
            if (!['preferred', 'caution'].includes(p.kind)) continue;
            seen.add(String(p.horse_id));
            clean.push(p);
        }
        await pool.query('DELETE FROM contact_horse_prefs WHERE contact_id = $1', [contactId]);
        for (const p of clean) {
            await pool.query(
                `INSERT INTO contact_horse_prefs (contact_id, horse_id, kind, reason)
                 VALUES ($1, $2, $3, $4)`,
                [contactId, p.horse_id, p.kind, String(p.reason || '')]);
        }
    }
    if (Array.isArray(body.availability)) {
        for (const a of body.availability) {
            if (!a || !Number.isInteger(a.weekday) || a.weekday < 1 || a.weekday > 7 ||
                !TIME_RE.test(a.start_time || '') || !TIME_RE.test(a.end_time || '') ||
                a.start_time >= a.end_time) {
                return 'Invalid availability window.';
            }
        }
        await pool.query('DELETE FROM contact_availability WHERE contact_id = $1', [contactId]);
        for (const a of body.availability) {
            await pool.query(
                `INSERT INTO contact_availability (contact_id, weekday, start_time, end_time)
                 VALUES ($1, $2, $3, $4)`,
                [contactId, a.weekday, a.start_time, a.end_time]);
        }
    }
    return null;
}

const EXPERIENCE_LEVELS = LEVELS;

app.post('/api/contacts', requireAuth, async (req, res) => {
    try {
        const { name, phone, email, address, parent_id, experience, notes,
                needs_collection, collection_teacher, collection_class } = req.body || {};
        if (!String(name || '').trim()) return res.status(400).json({ error: 'Name is required.' });
        const parentError = await validateParent(parent_id, null);
        if (parentError) return res.status(400).json({ error: parentError });
        const { rows } = await pool.query(
            `INSERT INTO contacts (name, phone, email, address, parent_id, experience,
                                   needs_collection, collection_teacher, collection_class, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [String(name).trim(), phone || '', email || '', address || '', parent_id || null,
             EXPERIENCE_LEVELS.includes(experience) ? experience : null,
             !!needs_collection, collection_teacher || '', collection_class || '', notes || '']);
        const extrasError = await saveContactExtras(rows[0].id, req.body || {});
        if (extrasError) return res.status(400).json({ error: extrasError });
        res.json({ contact: rows[0] });
    } catch (err) {
        handleError(res, err, 'Creating contact');
    }
});

app.put('/api/contacts/:id', requireAuth, async (req, res) => {
    try {
        const { name, phone, email, address, parent_id, experience, notes, archived,
                needs_collection, collection_teacher, collection_class } = req.body || {};
        if (parent_id !== undefined) {
            const parentError = await validateParent(parent_id, req.params.id);
            if (parentError) return res.status(400).json({ error: parentError });
        }
        const { rows } = await pool.query(
            `UPDATE contacts SET
                name = COALESCE($2, name),
                phone = COALESCE($3, phone),
                email = COALESCE($4, email),
                address = COALESCE($5, address),
                parent_id = CASE WHEN $6 THEN $7::bigint ELSE parent_id END,
                experience = CASE WHEN $8 THEN $9 ELSE experience END,
                needs_collection = COALESCE($10, needs_collection),
                collection_teacher = COALESCE($11, collection_teacher),
                collection_class = COALESCE($12, collection_class),
                notes = COALESCE($13, notes),
                archived = COALESCE($14, archived)
             WHERE id = $1 RETURNING *`,
            [req.params.id, name, phone, email, address,
             parent_id !== undefined, parent_id || null,
             experience !== undefined, EXPERIENCE_LEVELS.includes(experience) ? experience : null,
             needs_collection, collection_teacher, collection_class,
             notes, archived]);
        if (!rows[0]) return res.status(404).json({ error: 'Contact not found.' });
        const extrasError = await saveContactExtras(req.params.id, req.body || {});
        if (extrasError) return res.status(400).json({ error: extrasError });
        res.json({ contact: rows[0] });
    } catch (err) {
        handleError(res, err, 'Updating contact');
    }
});

// ---------- Horses ----------
app.get('/api/horses', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT h.*, c.name AS owner_name
               FROM horses h LEFT JOIN contacts c ON c.id = h.owner_contact_id
              ORDER BY h.sort_order, h.name`);
        res.json({ horses: rows });
    } catch (err) {
        handleError(res, err, 'Loading horses');
    }
});

app.post('/api/horses', requireRole('helper'), async (req, res) => {
    try {
        const { name, color, notes, owner_contact_id } = req.body || {};
        if (!String(name || '').trim()) return res.status(400).json({ error: 'Name is required.' });
        const { rows } = await pool.query(
            `INSERT INTO horses (name, color, notes, owner_contact_id, sort_order)
             VALUES ($1, COALESCE($2, '#7c9885'), $3, $4,
                     (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM horses))
             RETURNING *`,
            [String(name).trim(), color, notes || '', owner_contact_id || null]);
        res.json({ horse: rows[0] });
    } catch (err) {
        handleError(res, err, 'Creating horse');
    }
});

app.put('/api/horses/:id', requireRole('helper'), async (req, res) => {
    try {
        const { name, color, notes, active, sort_order, owner_contact_id } = req.body || {};
        const { rows } = await pool.query(
            `UPDATE horses SET
                name = COALESCE($2, name),
                color = COALESCE($3, color),
                notes = COALESCE($4, notes),
                active = COALESCE($5, active),
                sort_order = COALESCE($6, sort_order),
                owner_contact_id = CASE WHEN $7 THEN $8::bigint ELSE owner_contact_id END
             WHERE id = $1 RETURNING *`,
            [req.params.id, name, color, notes, active, sort_order,
             owner_contact_id !== undefined, owner_contact_id || null]);
        if (!rows[0]) return res.status(404).json({ error: 'Horse not found.' });
        res.json({ horse: rows[0] });
    } catch (err) {
        handleError(res, err, 'Updating horse');
    }
});

// ---------- Guides ----------
app.get('/api/guides', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM guides ORDER BY name');
        res.json({ guides: rows });
    } catch (err) {
        handleError(res, err, 'Loading guides');
    }
});

app.post('/api/guides', requireRole('helper'), async (req, res) => {
    try {
        const { name, phone, notes, is_assistant } = req.body || {};
        if (!String(name || '').trim()) return res.status(400).json({ error: 'Name is required.' });
        const { rows } = await pool.query(
            `INSERT INTO guides (name, phone, is_assistant, notes) VALUES ($1, $2, $3, $4) RETURNING *`,
            [String(name).trim(), phone || '', !!is_assistant, notes || '']);
        res.json({ guide: rows[0] });
    } catch (err) {
        handleError(res, err, 'Creating guide');
    }
});

app.put('/api/guides/:id', requireRole('helper'), async (req, res) => {
    try {
        const { name, phone, notes, active, is_assistant } = req.body || {};
        const { rows } = await pool.query(
            `UPDATE guides SET
                name = COALESCE($2, name),
                phone = COALESCE($3, phone),
                notes = COALESCE($4, notes),
                active = COALESCE($5, active),
                is_assistant = COALESCE($6, is_assistant)
             WHERE id = $1 RETURNING *`,
            [req.params.id, name, phone, notes, active, is_assistant]);
        if (!rows[0]) return res.status(404).json({ error: 'Guide not found.' });
        res.json({ guide: rows[0] });
    } catch (err) {
        handleError(res, err, 'Updating guide');
    }
});

// ---------- Ride types ----------
app.get('/api/ride-types', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM ride_types ORDER BY name');
        res.json({ ride_types: rows });
    } catch (err) {
        handleError(res, err, 'Loading ride types');
    }
});

app.post('/api/ride-types', requireRole('helper'), async (req, res) => {
    try {
        const { name, duration_min, price_cents } = req.body || {};
        if (!String(name || '').trim()) return res.status(400).json({ error: 'Name is required.' });
        const { rows } = await pool.query(
            `INSERT INTO ride_types (name, duration_min, price_cents)
             VALUES ($1, COALESCE($2, 60), COALESCE($3, 0)) RETURNING *`,
            [String(name).trim(), duration_min, price_cents]);
        res.json({ ride_type: rows[0] });
    } catch (err) {
        handleError(res, err, 'Creating ride type');
    }
});

// A price change never touches invoiced rides (their amounts are snapshotted
// on the invoice lines). By default it also leaves past, not-yet-invoiced
// rides at the old price (the old price is stamped onto them first);
// pass apply_to_past: true to reprice those too.
app.put('/api/ride-types/:id', requireRole('helper'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { name, duration_min, price_cents, active, apply_to_past } = req.body || {};
        await client.query('BEGIN');
        const { rows: current } = await client.query(
            'SELECT * FROM ride_types WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (!current[0]) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Ride type not found.' });
        }
        const priceChanging = Number.isInteger(price_cents) && price_cents !== current[0].price_cents;
        if (priceChanging && !apply_to_past) {
            await client.query(
                `UPDATE ride_participants rp SET price_cents = rt.price_cents
                   FROM rides r, ride_types rt
                  WHERE rp.ride_id = r.id AND r.ride_type_id = $1 AND rt.id = $1
                    AND r.date < CURRENT_DATE AND rp.price_cents IS NULL`,
                [req.params.id]);
        }
        const { rows } = await client.query(
            `UPDATE ride_types SET
                name = COALESCE($2, name),
                duration_min = COALESCE($3, duration_min),
                price_cents = COALESCE($4, price_cents),
                active = COALESCE($5, active)
             WHERE id = $1 RETURNING *`,
            [req.params.id, name, duration_min, price_cents, active]);
        await client.query('COMMIT');
        res.json({ ride_type: rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        handleError(res, err, 'Updating ride type');
    } finally {
        client.release();
    }
});

// Deleting a ride type never removes rides: existing slots first get the
// type's name and price snapshotted onto them, so history and pending
// invoicing keep the right label and amount. (Invoiced lines are snapshots
// already.) Fixed-slot templates just lose the type and can get a new one.
app.delete('/api/ride-types/:id', requireRole('helper'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE ride_participants rp SET price_cents = COALESCE(rp.price_cents, rt.price_cents)
               FROM rides r, ride_types rt
              WHERE rp.ride_id = r.id AND r.ride_type_id = $1 AND rt.id = $1`,
            [req.params.id]);
        await client.query(
            `UPDATE rides SET ride_type_name = rt.name, ride_type_id = NULL
               FROM ride_types rt
              WHERE rt.id = $1 AND rides.ride_type_id = rt.id`,
            [req.params.id]);
        await client.query(
            'UPDATE recurring_rides SET ride_type_id = NULL WHERE ride_type_id = $1',
            [req.params.id]);
        const del = await client.query('DELETE FROM ride_types WHERE id = $1', [req.params.id]);
        if (!del.rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Ride type not found.' });
        }
        await client.query('COMMIT');
        res.json({ ok: true });
    } catch (err) {
        await client.query('ROLLBACK');
        handleError(res, err, 'Deleting ride type');
    } finally {
        client.release();
    }
});

// ---------- Recurring (fixed) rides — weekly group templates ----------
async function fetchRecurring() {
    const { rows: templates } = await pool.query(
        `SELECT r.*, rt.name AS ride_type_name
           FROM recurring_rides r
           LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
          WHERE r.active
          ORDER BY r.weekday, r.start_time, r.id`);
    if (!templates.length) return [];
    const ids = templates.map((t) => t.id);
    const { rows: parts } = await pool.query(
        `SELECT rp.*, c.name AS contact_name, h.name AS horse_name
           FROM recurring_participants rp
           LEFT JOIN contacts c ON c.id = rp.contact_id
           LEFT JOIN horses h ON h.id = rp.horse_id
          WHERE rp.recurring_id = ANY($1::bigint[])
          ORDER BY c.name NULLS LAST`, [ids]);
    const { rows: rideGuides } = await pool.query(
        `SELECT rg.*, g.name AS guide_name, g.is_assistant, h.name AS horse_name
           FROM recurring_guides rg
           JOIN guides g ON g.id = rg.guide_id
           LEFT JOIN horses h ON h.id = rg.horse_id
          WHERE rg.recurring_id = ANY($1::bigint[])
          ORDER BY g.is_assistant, g.name`, [ids]);
    const byId = {};
    templates.forEach((t) => { t.participants = []; t.guides = []; byId[t.id] = t; });
    parts.forEach((p) => byId[p.recurring_id].participants.push(p));
    rideGuides.forEach((g) => byId[g.recurring_id].guides.push(g));
    return templates;
}

app.get('/api/recurring', requireAuth, async (req, res) => {
    try {
        res.json({ recurring: await fetchRecurring() });
    } catch (err) {
        handleError(res, err, 'Loading fixed rides');
    }
});

// Validate/normalize a template payload; returns { error } or the clean parts
function parseRecurringBody(body) {
    const { weekday, start_time, duration_min, ride_type_id, level, start_date, end_date, notes } = body || {};
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return { error: 'A valid weekday is required.' };
    if (!TIME_RE.test(start_time || '')) return { error: 'A valid time is required.' };
    const participants = [];
    const contactsUsed = new Set();
    for (const p of (Array.isArray(body.participants) ? body.participants : [])) {
        if (!p || (!p.contact_id && !p.horse_id)) continue;
        if (p.contact_id) {
            if (contactsUsed.has(String(p.contact_id))) return { error: 'The same rider is picked twice.' };
            contactsUsed.add(String(p.contact_id));
        }
        participants.push({
            contact_id: p.contact_id || null,
            horse_id: p.horse_id || null,
            frequency: p.frequency === 'biweekly' ? 'biweekly' : 'weekly',
            biweekly_anchor: DATE_RE.test(p.biweekly_anchor || '') ? p.biweekly_anchor : null
        });
    }
    if (!participants.length) return { error: 'A fixed ride needs at least one rider or horse.' };
    const guides = [];
    const guidesUsed = new Set();
    for (const g of (Array.isArray(body.guides) ? body.guides : [])) {
        if (!g || !g.guide_id || guidesUsed.has(String(g.guide_id))) continue;
        guidesUsed.add(String(g.guide_id));
        const mode = GUIDE_MODES.includes(g.mode) ? g.mode : 'foot';
        guides.push({ guide_id: g.guide_id, mode, horse_id: mode === 'horse' ? (g.horse_id || null) : null });
    }
    return {
        weekday, start_time,
        duration_min: Number.isInteger(duration_min) && duration_min > 0 ? duration_min : null,
        ride_type_id: ride_type_id || null,
        level: LEVELS.includes(level) ? level : null,
        start_date: DATE_RE.test(start_date || '') ? start_date : null,
        end_date: DATE_RE.test(end_date || '') ? end_date : null,
        notes: notes || '',
        participants, guides
    };
}

async function insertRecurringChildren(client, recurringId, participants, guides) {
    for (const p of participants) {
        await client.query(
            `INSERT INTO recurring_participants (recurring_id, contact_id, horse_id, frequency, biweekly_anchor)
             VALUES ($1, $2, $3, $4, $5)`,
            [recurringId, p.contact_id, p.horse_id, p.frequency, p.biweekly_anchor]);
    }
    for (const g of guides) {
        await client.query(
            `INSERT INTO recurring_guides (recurring_id, guide_id, mode, horse_id)
             VALUES ($1, $2, $3, $4)`,
            [recurringId, g.guide_id, g.mode, g.horse_id]);
    }
}

app.post('/api/recurring', requireRole('helper'), async (req, res) => {
    const client = await pool.connect();
    try {
        const parsed = parseRecurringBody(req.body);
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        await client.query('BEGIN');
        const { rows } = await client.query(
            `INSERT INTO recurring_rides (weekday, start_time, duration_min, ride_type_id, level, start_date, end_date, notes)
             VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_DATE), $7, $8) RETURNING id`,
            [parsed.weekday, parsed.start_time, parsed.duration_min, parsed.ride_type_id,
             parsed.level, parsed.start_date, parsed.end_date, parsed.notes]);
        await insertRecurringChildren(client, rows[0].id, parsed.participants, parsed.guides);
        await client.query('COMMIT');
        res.json({ recurring_id: rows[0].id });
    } catch (err) {
        await client.query('ROLLBACK');
        handleError(res, err, 'Creating fixed ride');
    } finally {
        client.release();
    }
});

// Removes future, not-yet-invoiced occurrences so the change (or deletion)
// takes effect from today; past and invoiced rides are always kept.
async function dropFutureOccurrences(client, recurringId) {
    await client.query(
        `DELETE FROM rides r
          WHERE r.recurring_id = $1 AND r.date >= CURRENT_DATE AND r.status = 'active'
            AND NOT EXISTS (SELECT 1 FROM ride_participants rp
                            JOIN invoice_lines il ON il.participant_id = rp.id
                           WHERE rp.ride_id = r.id)`,
        [recurringId]);
}

app.put('/api/recurring/:id', requireRole('helper'), async (req, res) => {
    const client = await pool.connect();
    try {
        const parsed = parseRecurringBody(req.body);
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        await client.query('BEGIN');
        const { rows } = await client.query(
            `UPDATE recurring_rides SET
                weekday = $2, start_time = $3, duration_min = $4, ride_type_id = $5,
                level = $6, start_date = COALESCE($7, start_date), end_date = $8, notes = $9
              WHERE id = $1 RETURNING id`,
            [req.params.id, parsed.weekday, parsed.start_time, parsed.duration_min, parsed.ride_type_id,
             parsed.level, parsed.start_date, parsed.end_date, parsed.notes]);
        if (!rows[0]) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Fixed ride not found.' });
        }
        await client.query('DELETE FROM recurring_participants WHERE recurring_id = $1', [req.params.id]);
        await client.query('DELETE FROM recurring_guides WHERE recurring_id = $1', [req.params.id]);
        await insertRecurringChildren(client, req.params.id, parsed.participants, parsed.guides);
        await dropFutureOccurrences(client, req.params.id);
        await client.query('COMMIT');
        res.json({ ok: true });
    } catch (err) {
        await client.query('ROLLBACK');
        handleError(res, err, 'Updating fixed ride');
    } finally {
        client.release();
    }
});

app.delete('/api/recurring/:id', requireRole('helper'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await dropFutureOccurrences(client, req.params.id);
        await client.query('DELETE FROM recurring_rides WHERE id = $1', [req.params.id]);
        await client.query('COMMIT');
        res.json({ ok: true });
    } catch (err) {
        await client.query('ROLLBACK');
        handleError(res, err, 'Deleting fixed ride');
    } finally {
        client.release();
    }
});

// ---------- Rides ----------
function datesInRange(from, to) {
    const out = [];
    const end = new Date(to + 'T00:00:00Z');
    for (let d = new Date(from + 'T00:00:00Z'); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        out.push(d.toISOString().slice(0, 10));
    }
    return out;
}

function isoWeekday(dateStr) {
    const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay(); // 0=Sun..6=Sat
    return dow === 0 ? 7 : dow;
}

async function rideDurationMin(rideTypeId) {
    if (!rideTypeId) return 60;
    const { rows } = await pool.query('SELECT duration_min FROM ride_types WHERE id = $1', [rideTypeId]);
    return (rows[0] && rows[0].duration_min) || 60;
}

// Which of these horses/guides are already in another active ride during
// [time, time + durationMin)? Partial overlaps count: an existing ride blocks
// the whole window its ride type's duration covers (60 min when no type).
// All-day blocks occupy every time of their date, in both directions.
// Returns human-readable messages (empty = all clear).
async function findConflicts(date, time, horseIds, guideIds, excludeRideId, allDay, durationMin) {
    const conflicts = [];
    const overlap = `(r.all_day OR $5 OR (
            r.start_time < $2::time + make_interval(mins => $6) AND
            r.start_time + make_interval(mins => COALESCE(r.duration_min, rt.duration_min, 60)) > $2::time))`;
    const params = (ids) => [date, time, ids, excludeRideId || '0', !!allDay, durationMin || 60];
    if (horseIds.length) {
        const { rows } = await pool.query(
            `SELECT DISTINCT h.name FROM horses h
              WHERE h.id = ANY($3::bigint[]) AND (
                    EXISTS (SELECT 1 FROM ride_participants rp
                             JOIN rides r ON r.id = rp.ride_id
                             LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
                            WHERE rp.horse_id = h.id AND r.date = $1 AND ${overlap}
                              AND r.status = 'active' AND r.id <> $4)
                 OR EXISTS (SELECT 1 FROM ride_guides rg
                             JOIN rides r ON r.id = rg.ride_id
                             LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
                            WHERE rg.horse_id = h.id AND r.date = $1 AND ${overlap}
                              AND r.status = 'active' AND r.id <> $4))`,
            params(horseIds));
        rows.forEach((r) => conflicts.push(`${r.name} is already in another ride or blocked during that time.`));
    }
    if (guideIds.length) {
        const { rows } = await pool.query(
            `SELECT DISTINCT g.name FROM guides g
              WHERE g.id = ANY($3::bigint[])
                AND EXISTS (SELECT 1 FROM ride_guides rg
                             JOIN rides r ON r.id = rg.ride_id
                             LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
                            WHERE rg.guide_id = g.id AND r.date = $1 AND ${overlap}
                              AND r.status = 'active' AND r.id <> $4)`,
            params(guideIds));
        rows.forEach((r) => conflicts.push(`Guide ${r.name} is already on another ride during that time.`));
    }
    return conflicts;
}

// Validate and normalize a ride payload. Returns { error } or the clean parts.
function parseRideBody(body) {
    const { date, ride_type_id, is_block, all_day, level, duration_min, notes } = body || {};
    const isBlock = !!is_block;
    const rideLevel = LEVELS.includes(level) ? level : null;
    const allDay = isBlock && !!all_day; // only blocks can span the whole day
    const start_time = allDay ? '00:00' : (body || {}).start_time;
    if (!DATE_RE.test(date || '')) return { error: 'A valid date is required.' };
    if (!TIME_RE.test(start_time || '')) return { error: 'A valid time is required.' };
    const horsesUsed = new Set();
    const contactsUsed = new Set();
    const participants = [];
    for (const p of (Array.isArray(body.participants) ? body.participants : [])) {
        if (!p) continue;
        const horseId = p.horse_id || null;
        const contactId = isBlock ? null : (p.contact_id || null);
        if (!horseId && !contactId) continue; // needs a rider and/or a horse
        if (horseId) {
            if (horsesUsed.has(String(horseId))) return { error: 'The same horse is picked twice.' };
            horsesUsed.add(String(horseId));
        }
        if (contactId) {
            if (contactsUsed.has(String(contactId))) return { error: 'The same rider is picked twice.' };
            contactsUsed.add(String(contactId));
        }
        participants.push({
            horse_id: horseId,
            contact_id: contactId,
            price_cents: Number.isInteger(p.price_cents) ? p.price_cents : null
        });
    }
    if (!participants.length) {
        return { error: isBlock ? 'Pick at least one horse to block.' : 'A ride needs at least one rider or horse.' };
    }
    const guides = [];
    const guidesUsed = new Set();
    if (!isBlock) {
        for (const g of (Array.isArray(body.guides) ? body.guides : [])) {
            if (!g || !g.guide_id) continue;
            if (guidesUsed.has(String(g.guide_id))) return { error: 'The same instructor is picked twice.' };
            guidesUsed.add(String(g.guide_id));
            const mode = GUIDE_MODES.includes(g.mode) ? g.mode : 'foot';
            const horseId = mode === 'horse' ? (g.horse_id || null) : null;
            if (mode === 'horse' && !horseId) {
                return { error: "Pick which horse the instructor rides, or set another mode." };
            }
            if (horseId) {
                if (horsesUsed.has(String(horseId))) return { error: 'The same horse is picked twice.' };
                horsesUsed.add(String(horseId));
            }
            guides.push({ guide_id: g.guide_id, mode, horse_id: horseId });
        }
    }
    return {
        date, start_time, isBlock, allDay,
        level: rideLevel,
        duration_min: Number.isInteger(duration_min) && duration_min > 0 ? duration_min : null,
        ride_type_id: ride_type_id || null,
        notes: notes || '',
        participants, guides,
        horseIds: [...horsesUsed],
        guideIds: guides.map((g) => String(g.guide_id))
    };
}

async function insertRideChildren(client, rideId, participants, guides) {
    for (const p of participants) {
        await client.query(
            `INSERT INTO ride_participants (ride_id, horse_id, contact_id, from_recurring, price_cents)
             VALUES ($1, $2, $3, $4, $5)`,
            [rideId, p.horse_id, p.contact_id, !!p.from_recurring, p.price_cents]);
    }
    for (const g of guides) {
        await client.query(
            `INSERT INTO ride_guides (ride_id, guide_id, mode, horse_id)
             VALUES ($1, $2, $3, $4)`,
            [rideId, g.guide_id, g.mode, g.horse_id]);
    }
}

// Whole weeks between two YYYY-MM-DD dates (negative if `date` before `anchor`)
function weeksBetween(anchor, date) {
    const a = new Date(anchor + 'T00:00:00Z');
    const b = new Date(date + 'T00:00:00Z');
    return Math.floor((b - a) / (7 * 24 * 3600 * 1000));
}

// Create ride rows for recurring templates in the range. Insert-only: manual
// rides and cancelled tombstones are never touched. Biweekly riders are only
// included on their weeks; a week where nobody is due creates no ride. Only
// HORSE double-bookings skip an occurrence — overlapping staff is allowed
// (handovers between simultaneous lessons are normal).
async function materializeRecurring(from, to) {
    const { rows: templates } = await pool.query(
        `SELECT r.*, COALESCE(r.duration_min, rt.duration_min, 60) AS eff_duration
           FROM recurring_rides r
           LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
          WHERE r.active AND r.start_date <= $2 AND (r.end_date IS NULL OR r.end_date >= $1)`,
        [from, to]);
    if (!templates.length) return;
    const ids = templates.map((t) => t.id);
    const { rows: allParts } = await pool.query(
        'SELECT * FROM recurring_participants WHERE recurring_id = ANY($1::bigint[])', [ids]);
    const { rows: allGuides } = await pool.query(
        'SELECT * FROM recurring_guides WHERE recurring_id = ANY($1::bigint[])', [ids]);
    const dates = datesInRange(from, to);
    for (const t of templates) {
        const tParts = allParts.filter((p) => String(p.recurring_id) === String(t.id));
        const tGuides = allGuides.filter((g) => String(g.recurring_id) === String(t.id));
        for (const date of dates) {
            if (isoWeekday(date) !== t.weekday) continue;
            if (date < t.start_date || (t.end_date && date > t.end_date)) continue;
            const { rows: existing } = await pool.query(
                'SELECT 1 FROM rides WHERE recurring_id = $1 AND date = $2', [t.id, date]);
            if (existing[0]) continue;
            const dueParts = tParts.filter((p) => {
                if (p.frequency !== 'biweekly') return true;
                const w = weeksBetween(p.biweekly_anchor || t.start_date, date);
                return w >= 0 && w % 2 === 0;
            });
            if (!dueParts.length) continue;
            const horseIds = [
                ...dueParts.map((p) => p.horse_id),
                ...tGuides.filter((g) => g.mode === 'horse').map((g) => g.horse_id)
            ].filter(Boolean);
            if (horseIds.length) {
                const conflicts = await findConflicts(date, t.start_time, horseIds, [], null, false, t.eff_duration);
                if (conflicts.length) continue;
            }
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const { rows } = await client.query(
                    `INSERT INTO rides (date, start_time, duration_min, ride_type_id, recurring_id, level, notes)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     ON CONFLICT (recurring_id, date) DO NOTHING RETURNING id`,
                    [date, t.start_time, t.duration_min, t.ride_type_id, t.id, t.level, t.notes || '']);
                if (rows[0]) {
                    await insertRideChildren(client, rows[0].id,
                        dueParts.map((p) => ({ horse_id: p.horse_id, contact_id: p.contact_id, from_recurring: true, price_cents: null })),
                        tGuides.map((g) => ({ guide_id: g.guide_id, mode: g.mode, horse_id: g.mode === 'horse' ? g.horse_id : null })));
                }
                await client.query('COMMIT');
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        }
    }
}

async function fetchRides(from, to) {
    const { rows: rides } = await pool.query(
        `SELECT r.*, COALESCE(rt.name, r.ride_type_name) AS ride_type_name,
                rt.price_cents AS type_price_cents,
                COALESCE(r.duration_min, rt.duration_min, 60) AS duration_min
           FROM rides r LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
          WHERE r.date BETWEEN $1 AND $2 AND r.status = 'active'
          ORDER BY r.date, r.start_time, r.id`, [from, to]);
    if (!rides.length) return [];
    const ids = rides.map((r) => r.id);
    const { rows: parts } = await pool.query(
        `SELECT rp.*, h.name AS horse_name, c.name AS contact_name,
                c.needs_collection, c.collection_teacher, c.collection_class,
                (il.id IS NOT NULL) AS invoiced,
                EXISTS (SELECT 1 FROM term_passes tp
                         WHERE tp.contact_id = rp.contact_id
                           AND r.date BETWEEN tp.period_start AND tp.period_end) AS in_pass_period,
                EXISTS (SELECT 1 FROM reschedule_credits rc
                         WHERE rc.used_ride_id = rp.ride_id AND rc.contact_id = rp.contact_id) AS credit_used
           FROM ride_participants rp
           JOIN rides r ON r.id = rp.ride_id
           LEFT JOIN horses h ON h.id = rp.horse_id
           LEFT JOIN contacts c ON c.id = rp.contact_id
           LEFT JOIN invoice_lines il ON il.participant_id = rp.id
          WHERE rp.ride_id = ANY($1::bigint[])
          ORDER BY h.sort_order NULLS LAST, h.name, c.name`, [ids]);
    const { rows: rideGuides } = await pool.query(
        `SELECT rg.*, g.name AS guide_name, g.is_assistant, h.name AS horse_name
           FROM ride_guides rg
           JOIN guides g ON g.id = rg.guide_id
           LEFT JOIN horses h ON h.id = rg.horse_id
          WHERE rg.ride_id = ANY($1::bigint[])
          ORDER BY g.is_assistant, g.name`, [ids]);
    const byId = {};
    rides.forEach((r) => { r.participants = []; r.guides = []; r.invoiced = false; byId[r.id] = r; });
    parts.forEach((p) => {
        byId[p.ride_id].participants.push(p);
        if (p.invoiced) byId[p.ride_id].invoiced = true;
    });
    rideGuides.forEach((g) => byId[g.ride_id].guides.push(g));
    return rides;
}

app.get('/api/rides', requireAuth, async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '') || from > to) {
            return res.status(400).json({ error: 'Valid from/to dates are required.' });
        }
        if (datesInRange(from, to).length > 62) {
            return res.status(400).json({ error: 'Date range too large (max 62 days).' });
        }
        await materializeRecurring(from, to);
        res.json({ rides: await fetchRides(from, to) });
    } catch (err) {
        handleError(res, err, 'Loading rides');
    }
});

app.post('/api/rides', requireAuth, async (req, res) => {
    const client = await pool.connect();
    try {
        const parsed = parseRideBody(req.body);
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        const conflicts = await findConflicts(parsed.date, parsed.start_time,
            parsed.horseIds, parsed.guideIds, null, parsed.allDay,
            parsed.duration_min || await rideDurationMin(parsed.ride_type_id));
        if (conflicts.length) return res.status(400).json({ error: conflicts.join(' ') });
        await client.query('BEGIN');
        const { rows } = await client.query(
            `INSERT INTO rides (date, start_time, duration_min, ride_type_id, is_block, all_day, level, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [parsed.date, parsed.start_time, parsed.duration_min, parsed.ride_type_id, parsed.isBlock, parsed.allDay, parsed.level, parsed.notes]);
        await insertRideChildren(client, rows[0].id, parsed.participants, parsed.guides);
        await client.query('COMMIT');
        res.json({ ride_id: rows[0].id });
    } catch (err) {
        await client.query('ROLLBACK');
        handleError(res, err, 'Creating ride');
    } finally {
        client.release();
    }
});

app.put('/api/rides/:id', requireAuth, async (req, res) => {
    const client = await pool.connect();
    try {
        const { rows: existing } = await pool.query(
            `SELECT r.*, EXISTS (SELECT 1 FROM ride_participants rp
                                 JOIN invoice_lines il ON il.participant_id = rp.id
                                WHERE rp.ride_id = r.id) AS invoiced
               FROM rides r WHERE r.id = $1`, [req.params.id]);
        if (!existing[0]) return res.status(404).json({ error: 'Ride not found.' });
        if (existing[0].invoiced) {
            return res.status(400).json({ error: 'This ride is already invoiced and can no longer be changed.' });
        }
        const parsed = parseRideBody(req.body);
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        const conflicts = await findConflicts(parsed.date, parsed.start_time,
            parsed.horseIds, parsed.guideIds, req.params.id, parsed.allDay,
            parsed.duration_min || await rideDurationMin(parsed.ride_type_id));
        if (conflicts.length) return res.status(400).json({ error: conflicts.join(' ') });
        await client.query('BEGIN');
        await client.query(
            `UPDATE rides SET date = $2, start_time = $3, duration_min = $4, ride_type_id = $5, is_block = $6, all_day = $7, level = $8, notes = $9
              WHERE id = $1`,
            [req.params.id, parsed.date, parsed.start_time, parsed.duration_min, parsed.ride_type_id, parsed.isBlock, parsed.allDay, parsed.level, parsed.notes]);
        // Children are replaced wholesale — carry the fixed-lesson provenance
        // over for riders who were already on the ride from the template
        const { rows: prevParts } = await client.query(
            'SELECT contact_id FROM ride_participants WHERE ride_id = $1 AND from_recurring', [req.params.id]);
        const wasRecurring = new Set(prevParts.map((p) => String(p.contact_id)));
        parsed.participants.forEach((p) => {
            if (p.contact_id && wasRecurring.has(String(p.contact_id))) p.from_recurring = true;
        });
        await client.query('DELETE FROM ride_participants WHERE ride_id = $1', [req.params.id]);
        await client.query('DELETE FROM ride_guides WHERE ride_id = $1', [req.params.id]);
        await insertRideChildren(client, req.params.id, parsed.participants, parsed.guides);
        await client.query('COMMIT');
        res.json({ ok: true });
    } catch (err) {
        await client.query('ROLLBACK');
        handleError(res, err, 'Updating ride');
    } finally {
        client.release();
    }
});

app.delete('/api/rides/:id', requireAuth, async (req, res) => {
    try {
        const { rows: existing } = await pool.query(
            `SELECT r.*, EXISTS (SELECT 1 FROM ride_participants rp
                                 JOIN invoice_lines il ON il.participant_id = rp.id
                                WHERE rp.ride_id = r.id) AS invoiced
               FROM rides r WHERE r.id = $1`, [req.params.id]);
        if (!existing[0]) return res.status(404).json({ error: 'Ride not found.' });
        if (existing[0].invoiced) {
            return res.status(400).json({ error: 'This ride is already invoiced and cannot be deleted.' });
        }
        if (existing[0].recurring_id) {
            // Keep a tombstone so re-materialization doesn't bring it back
            await pool.query(`UPDATE rides SET status = 'cancelled' WHERE id = $1`, [req.params.id]);
            await pool.query('DELETE FROM ride_participants WHERE ride_id = $1', [req.params.id]);
            await pool.query('DELETE FROM ride_guides WHERE ride_id = $1', [req.params.id]);
        } else {
            await pool.query('DELETE FROM rides WHERE id = $1', [req.params.id]);
        }
        res.json({ ok: true });
    } catch (err) {
        handleError(res, err, 'Deleting ride');
    }
});

// ---------- Reschedule credits ----------
app.get('/api/credits', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT c.id AS contact_id, c.name, count(*)::int AS count
               FROM reschedule_credits rc
               JOIN contacts c ON c.id = rc.contact_id
              WHERE rc.used_ride_id IS NULL
              GROUP BY c.id, c.name
              ORDER BY c.name`);
        res.json({ credits: rows });
    } catch (err) {
        handleError(res, err, 'Loading reschedule credits');
    }
});

app.post('/api/credits', requireAuth, async (req, res) => {
    try {
        const { contact_id, note } = req.body || {};
        if (!contact_id) return res.status(400).json({ error: 'A contact is required.' });
        const { rows } = await pool.query(
            `INSERT INTO reschedule_credits (contact_id, note) VALUES ($1, $2) RETURNING *`,
            [contact_id, String(note || '')]);
        res.json({ credit: rows[0] });
    } catch (err) {
        handleError(res, err, 'Creating reschedule credit');
    }
});

// Marks the contact's oldest open credit as used on the given ride
app.post('/api/credits/consume', requireAuth, async (req, res) => {
    try {
        const { contact_id, ride_id } = req.body || {};
        if (!contact_id || !ride_id) return res.status(400).json({ error: 'Contact and ride are required.' });
        const { rows } = await pool.query(
            `UPDATE reschedule_credits SET used_at = now(), used_ride_id = $2
              WHERE id = (SELECT id FROM reschedule_credits
                           WHERE contact_id = $1 AND used_ride_id IS NULL
                           ORDER BY created_at LIMIT 1)
              RETURNING id`,
            [contact_id, ride_id]);
        if (!rows[0]) return res.status(404).json({ error: 'No open reschedule credit for this contact.' });
        res.json({ ok: true });
    } catch (err) {
        handleError(res, err, 'Using reschedule credit');
    }
});

// ---------- To-dos ----------
app.get('/api/todos', requireAuth, async (req, res) => {
    try {
        if (req.query.done === '1') {
            const { rows } = await pool.query(
                `SELECT * FROM todos WHERE done_at IS NOT NULL
                  ORDER BY done_at DESC LIMIT 300`);
            return res.json({ todos: rows });
        }
        const { rows } = await pool.query(
            `SELECT * FROM todos WHERE done_at IS NULL
              ORDER BY todo_date NULLS LAST, todo_time NULLS FIRST, created_at`);
        const { rows: cnt } = await pool.query(
            'SELECT count(*)::int AS n FROM todos WHERE done_at IS NOT NULL');
        res.json({ todos: rows, done_count: cnt[0].n });
    } catch (err) {
        handleError(res, err, 'Loading to-dos');
    }
});

app.post('/api/todos', requireAuth, async (req, res) => {
    try {
        const { title, todo_date, todo_time } = req.body || {};
        if (!String(title || '').trim()) return res.status(400).json({ error: 'A title is required.' });
        if (todo_date && !DATE_RE.test(todo_date)) return res.status(400).json({ error: 'Invalid date.' });
        if (todo_time && !TIME_RE.test(todo_time)) return res.status(400).json({ error: 'Invalid time.' });
        const { rows } = await pool.query(
            `INSERT INTO todos (title, todo_date, todo_time) VALUES ($1, $2, $3) RETURNING *`,
            [String(title).trim(), todo_date || null, todo_time || null]);
        res.json({ todo: rows[0] });
    } catch (err) {
        handleError(res, err, 'Creating to-do');
    }
});

app.put('/api/todos/:id', requireAuth, async (req, res) => {
    try {
        const { title, todo_date, todo_time, done } = req.body || {};
        if (todo_date && !DATE_RE.test(todo_date)) return res.status(400).json({ error: 'Invalid date.' });
        if (todo_time && !TIME_RE.test(todo_time)) return res.status(400).json({ error: 'Invalid time.' });
        const { rows } = await pool.query(
            `UPDATE todos SET
                title = COALESCE($2, title),
                todo_date = CASE WHEN $3 THEN $4::date ELSE todo_date END,
                todo_time = CASE WHEN $5 THEN $6::time ELSE todo_time END,
                done_at = CASE WHEN $7 THEN (CASE WHEN $8 THEN now() ELSE NULL END) ELSE done_at END
             WHERE id = $1 RETURNING *`,
            [req.params.id, title,
             todo_date !== undefined, todo_date || null,
             todo_time !== undefined, todo_time || null,
             done !== undefined, !!done]);
        if (!rows[0]) return res.status(404).json({ error: 'To-do not found.' });
        res.json({ todo: rows[0] });
    } catch (err) {
        handleError(res, err, 'Updating to-do');
    }
});

app.delete('/api/todos/:id', requireAuth, async (req, res) => {
    try {
        const { rowCount } = await pool.query('DELETE FROM todos WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ error: 'To-do not found.' });
        res.json({ ok: true });
    } catch (err) {
        handleError(res, err, 'Deleting to-do');
    }
});

// ---------- School directory (external service contacts) ----------
app.get('/api/service-contacts', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM service_contacts ORDER BY category, name');
        res.json({ service_contacts: rows });
    } catch (err) {
        handleError(res, err, 'Loading directory');
    }
});

app.post('/api/service-contacts', requireRole('helper'), async (req, res) => {
    try {
        const { name, category, phone, email, notes } = req.body || {};
        if (!String(name || '').trim()) return res.status(400).json({ error: 'A name is required.' });
        const { rows } = await pool.query(
            `INSERT INTO service_contacts (name, category, phone, email, notes)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [String(name).trim(), category || '', phone || '', email || '', notes || '']);
        res.json({ service_contact: rows[0] });
    } catch (err) {
        handleError(res, err, 'Creating directory entry');
    }
});

app.put('/api/service-contacts/:id', requireRole('helper'), async (req, res) => {
    try {
        const { name, category, phone, email, notes } = req.body || {};
        const { rows } = await pool.query(
            `UPDATE service_contacts SET
                name = COALESCE($2, name),
                category = COALESCE($3, category),
                phone = COALESCE($4, phone),
                email = COALESCE($5, email),
                notes = COALESCE($6, notes)
             WHERE id = $1 RETURNING *`,
            [req.params.id, name, category, phone, email, notes]);
        if (!rows[0]) return res.status(404).json({ error: 'Directory entry not found.' });
        res.json({ service_contact: rows[0] });
    } catch (err) {
        handleError(res, err, 'Updating directory entry');
    }
});

app.delete('/api/service-contacts/:id', requireRole('helper'), async (req, res) => {
    try {
        const { rowCount } = await pool.query('DELETE FROM service_contacts WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ error: 'Directory entry not found.' });
        res.json({ ok: true });
    } catch (err) {
        handleError(res, err, 'Deleting directory entry');
    }
});

// ---------- Reports ----------
// Rides per ride type per horse in a period. A horse "worked" when it carried
// a booked rider or a guide; open seats and blocked entries don't count.
app.get('/api/reports/horse-usage', requireAuth, async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '') || from > to) {
            return res.status(400).json({ error: 'Valid from/to dates are required.' });
        }
        const days = datesInRange(from, to).length;
        if (days > 366) return res.status(400).json({ error: 'Period too large (max 1 year).' });
        // Short ranges get fixed slots materialized on the fly; older months are
        // already complete because the auto-invoicer materializes every closed month.
        if (days <= 92) await materializeRecurring(from, to);
        const { rows } = await pool.query(
            `SELECT h.name AS horse_name, x.ride_type_name,
                    count(*)::int AS ride_count,
                    SUM(x.amount_cents)::int AS total_cents
               FROM (
                 SELECT rp.horse_id, COALESCE(rt.name, r.ride_type_name, '(no type)') AS ride_type_name,
                        COALESCE(rp.price_cents, rt.price_cents, 0) AS amount_cents
                   FROM ride_participants rp
                   JOIN rides r ON r.id = rp.ride_id AND r.status = 'active' AND NOT r.is_block
                   LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
                  WHERE r.date BETWEEN $1 AND $2 AND rp.contact_id IS NOT NULL
                 UNION ALL
                 SELECT rg.horse_id, COALESCE(rt.name, r.ride_type_name, '(no type)'),
                        0 AS amount_cents -- guide mounts are workload, not income
                   FROM ride_guides rg
                   JOIN rides r ON r.id = rg.ride_id AND r.status = 'active' AND NOT r.is_block
                   LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
                  WHERE r.date BETWEEN $1 AND $2 AND rg.horse_id IS NOT NULL
               ) x
               JOIN horses h ON h.id = x.horse_id
              GROUP BY h.sort_order, h.name, x.ride_type_name
              ORDER BY h.sort_order, h.name, x.ride_type_name`,
            [from, to]);
        res.json({ rows, from, to });
    } catch (err) {
        handleError(res, err, 'Loading report');
    }
});

// ---------- Invoices ----------
function monthRange(month) {
    // month = 'YYYY-MM' → [first day, last day]
    const [y, m] = month.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}

// A seat is covered by a term pass (and so NOT billable after the fact) when a
// pass spans the ride date AND the seat is a fixed lesson (from the weekly
// template) or a reschedule make-up. Extra ad-hoc bookings stay billable.
// Requires table aliases rp (ride_participants) and r (rides).
const NOT_PASS_COVERED_SQL = `NOT (
    EXISTS (SELECT 1 FROM term_passes tp
             WHERE tp.contact_id = rp.contact_id
               AND r.date BETWEEN tp.period_start AND tp.period_end)
    AND (rp.from_recurring
         OR EXISTS (SELECT 1 FROM reschedule_credits rc
                     WHERE rc.used_ride_id = r.id AND rc.contact_id = rp.contact_id)))`;

// Per-contact summary of booked, not-yet-invoiced rides in a month
app.get('/api/invoices/overview', requireRole('helper'), async (req, res) => {
    try {
        const month = String(req.query.month || '');
        if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'A valid month (YYYY-MM) is required.' });
        const [from, to] = monthRange(month);
        await materializeRecurring(from, to);
        // Rides are booked on the rider; the bill goes to the parent when set
        const { rows } = await pool.query(
            `SELECT payer.id AS contact_id, payer.name,
                    count(*)::int AS ride_count,
                    SUM(COALESCE(rp.price_cents, rt.price_cents, 0))::int AS total_cents
               FROM ride_participants rp
               JOIN rides r ON r.id = rp.ride_id AND r.status = 'active' AND NOT r.is_block
               JOIN contacts rider ON rider.id = rp.contact_id
               JOIN contacts payer ON payer.id = COALESCE(rider.parent_id, rider.id)
               LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
              WHERE r.date BETWEEN $1 AND $2
                AND NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.participant_id = rp.id)
                AND ${NOT_PASS_COVERED_SQL}
              GROUP BY payer.id, payer.name
              ORDER BY payer.name`,
            [from, to]);
        res.json({ overview: rows, from, to });
    } catch (err) {
        handleError(res, err, 'Loading invoice overview');
    }
});

app.get('/api/invoices', requireRole('helper'), async (req, res) => {
    try {
        const params = [];
        let where = '';
        if (req.query.contact_id) {
            params.push(req.query.contact_id);
            where = 'WHERE i.contact_id = $1';
        }
        const { rows } = await pool.query(
            `SELECT i.*, c.name AS contact_name,
                    (SELECT count(*)::int FROM invoice_lines il WHERE il.invoice_id = i.id) AS line_count
               FROM invoices i JOIN contacts c ON c.id = i.contact_id
              ${where}
              ORDER BY i.created_at DESC LIMIT 200`, params);
        res.json({ invoices: rows });
    } catch (err) {
        handleError(res, err, 'Loading invoices');
    }
});

// Creates one invoice for all uninvoiced booked rides of a contact in a period.
// Returns null if there is nothing to invoice. Runs in its own transaction.
async function createInvoiceForContact(contactId, from, to) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Include the payer's own rides and those of their kid riders
        const { rows: rides } = await client.query(
            `SELECT rp.id, r.date, r.start_time, h.name AS horse_name,
                    COALESCE(rt.name, r.ride_type_name, 'Ride') AS ride_type_name,
                    COALESCE(rp.price_cents, rt.price_cents, 0)::int AS amount_cents,
                    CASE WHEN rider.id <> $1 THEN rider.name END AS rider_name
               FROM ride_participants rp
               JOIN rides r ON r.id = rp.ride_id AND r.status = 'active' AND NOT r.is_block
               JOIN contacts rider ON rider.id = rp.contact_id
               LEFT JOIN horses h ON h.id = rp.horse_id
               LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
              WHERE (rider.id = $1 OR rider.parent_id = $1)
                AND r.date BETWEEN $2 AND $3
                AND NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.participant_id = rp.id)
                AND ${NOT_PASS_COVERED_SQL}
              ORDER BY r.date, r.start_time
              FOR UPDATE OF rp`,
            [contactId, from, to]);
        if (!rides.length) {
            await client.query('ROLLBACK');
            return null;
        }
        const year = from.slice(0, 4);
        const { rows: numRows } = await client.query(
            `SELECT COALESCE(MAX(SUBSTRING(number FROM '\\d+$')::int), 0) + 1 AS next
               FROM invoices WHERE number LIKE $1`, [`INV-${year}-%`]);
        const number = `INV-${year}-${String(numRows[0].next).padStart(4, '0')}`;
        const total = rides.reduce((sum, r) => sum + r.amount_cents, 0);
        const { rows: invRows } = await client.query(
            `INSERT INTO invoices (number, contact_id, period_start, period_end, kind, total_cents)
             VALUES ($1, $2, $3, $4, 'monthly', $5) RETURNING *`,
            [number, contactId, from, to, total]);
        for (const r of rides) {
            await client.query(
                `INSERT INTO invoice_lines (invoice_id, participant_id, description, ride_date, amount_cents)
                 VALUES ($1, $2, $3, $4, $5)`,
                [invRows[0].id, r.id,
                 `${r.rider_name ? r.rider_name + ': ' : ''}${r.ride_type_name}${r.horse_name ? ' on ' + r.horse_name : ''} at ${String(r.start_time).slice(0, 5)}`,
                 r.date, r.amount_cents]);
        }
        await client.query('COMMIT');
        return { invoice: invRows[0], line_count: rides.length };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// Create an invoice for all uninvoiced booked rides of a contact in a period
app.post('/api/invoices', requireRole('helper'), async (req, res) => {
    try {
        const { contact_id, from, to } = req.body || {};
        if (!contact_id || !DATE_RE.test(from || '') || !DATE_RE.test(to || '') || from > to) {
            return res.status(400).json({ error: 'Contact and a valid period are required.' });
        }
        const result = await createInvoiceForContact(contact_id, from, to);
        if (!result) return res.status(400).json({ error: 'No uninvoiced rides in that period.' });
        res.json(result);
    } catch (err) {
        handleError(res, err, 'Creating invoice');
    }
});

// ---------- Term passes (invoice in advance) ----------
app.get('/api/term-passes', requireRole('helper'), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT tp.*, c.name AS contact_name,
                    i.number AS invoice_number, i.status AS invoice_status, i.total_cents,
                    (SELECT count(*)::int FROM ride_participants rp
                      JOIN rides r ON r.id = rp.ride_id AND r.status = 'active' AND NOT r.is_block
                     WHERE rp.contact_id = tp.contact_id
                       AND r.date BETWEEN tp.period_start AND LEAST(tp.period_end, CURRENT_DATE)
                       AND (rp.from_recurring OR EXISTS (SELECT 1 FROM reschedule_credits rc
                             WHERE rc.used_ride_id = r.id AND rc.contact_id = rp.contact_id))) AS lessons_so_far
               FROM term_passes tp
               JOIN contacts c ON c.id = tp.contact_id
               LEFT JOIN invoices i ON i.id = tp.invoice_id
              ORDER BY tp.period_end DESC, c.name`);
        res.json({ passes: rows });
    } catch (err) {
        handleError(res, err, 'Loading term passes');
    }
});

// Creates the pass and its up-front ('advance') invoice in one go.
// The invoice goes to the payer (parent when set), like all invoices.
app.post('/api/term-passes', requireRole('helper'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { contact_id, period_start, period_end, amount_cents, description } = req.body || {};
        if (!contact_id || !DATE_RE.test(period_start || '') || !DATE_RE.test(period_end || '') ||
            period_start > period_end) {
            return res.status(400).json({ error: 'Rider and a valid period are required.' });
        }
        if (!Number.isInteger(amount_cents) || amount_cents <= 0) {
            return res.status(400).json({ error: 'A price is required.' });
        }
        const { rows: riderRows } = await pool.query(
            'SELECT id, name, parent_id FROM contacts WHERE id = $1', [contact_id]);
        if (!riderRows[0]) return res.status(404).json({ error: 'Rider not found.' });
        const rider = riderRows[0];
        const payerId = rider.parent_id || rider.id;

        await client.query('BEGIN');
        const year = period_start.slice(0, 4);
        const { rows: numRows } = await client.query(
            `SELECT COALESCE(MAX(SUBSTRING(number FROM '\\d+$')::int), 0) + 1 AS next
               FROM invoices WHERE number LIKE $1`, [`INV-${year}-%`]);
        const number = `INV-${year}-${String(numRows[0].next).padStart(4, '0')}`;
        const desc = String(description || '').trim() ||
            `Term fee ${rider.name}: fixed lessons ${period_start} to ${period_end}`;
        const { rows: invRows } = await client.query(
            `INSERT INTO invoices (number, contact_id, period_start, period_end, kind, total_cents)
             VALUES ($1, $2, $3, $4, 'advance', $5) RETURNING *`,
            [number, payerId, period_start, period_end, amount_cents]);
        await client.query(
            `INSERT INTO invoice_lines (invoice_id, description, ride_date, amount_cents)
             VALUES ($1, $2, $3, $4)`,
            [invRows[0].id, desc, period_start, amount_cents]);
        const { rows: passRows } = await client.query(
            `INSERT INTO term_passes (contact_id, period_start, period_end, invoice_id)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [contact_id, period_start, period_end, invRows[0].id]);
        await client.query('COMMIT');
        res.json({ pass: passRows[0], invoice: invRows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        handleError(res, err, 'Creating term pass');
    } finally {
        client.release();
    }
});

// Bulk: one pass + advance invoice for EVERY rider with fixed lessons in the
// period, priced per planned lesson (so 2×/week riders pay double and
// biweekly riders half). dry_run returns the preview without creating.
// Riders who already have a pass overlapping the period are skipped.
app.post('/api/term-passes/bulk', requireRole('helper'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { period_start, period_end, price_per_lesson_cents, dry_run } = req.body || {};
        if (!DATE_RE.test(period_start || '') || !DATE_RE.test(period_end || '') || period_start > period_end) {
            return res.status(400).json({ error: 'A valid period is required.' });
        }
        if (datesInRange(period_start, period_end).length > 366) {
            return res.status(400).json({ error: 'Period too large (max 1 year).' });
        }
        const price = Number.isInteger(price_per_lesson_cents) ? price_per_lesson_cents : 0;
        if (!dry_run && price <= 0) return res.status(400).json({ error: 'A price per lesson is required.' });

        const { rows: templates } = await pool.query(
            `SELECT id, weekday, start_date, end_date FROM recurring_rides
              WHERE active AND start_date <= $2 AND (end_date IS NULL OR end_date >= $1)`,
            [period_start, period_end]);
        const { rows: parts } = templates.length ? await pool.query(
            `SELECT rp.recurring_id, rp.contact_id, rp.frequency, rp.biweekly_anchor,
                    c.name, c.parent_id
               FROM recurring_participants rp
               JOIN contacts c ON c.id = rp.contact_id
              WHERE rp.contact_id IS NOT NULL AND rp.recurring_id = ANY($1::bigint[])`,
            [templates.map((t) => t.id)]) : { rows: [] };
        const tplById = {};
        templates.forEach((t) => { tplById[t.id] = t; });
        const dates = datesInRange(period_start, period_end);
        const perContact = {};
        for (const p of parts) {
            const t = tplById[p.recurring_id];
            let n = 0;
            for (const date of dates) {
                if (isoWeekday(date) !== t.weekday) continue;
                if (date < t.start_date || (t.end_date && date > t.end_date)) continue;
                if (p.frequency === 'biweekly') {
                    const w = weeksBetween(p.biweekly_anchor || t.start_date, date);
                    if (w < 0 || w % 2 !== 0) continue;
                }
                n++;
            }
            if (!n) continue;
            const entry = perContact[p.contact_id] =
                perContact[p.contact_id] || { name: p.name, parent_id: p.parent_id, lessons: 0 };
            entry.lessons += n;
        }
        const { rows: existing } = await pool.query(
            'SELECT contact_id FROM term_passes WHERE period_start <= $2 AND period_end >= $1',
            [period_start, period_end]);
        const hasPass = new Set(existing.map((e) => String(e.contact_id)));
        const preview = Object.entries(perContact).map(([cid, v]) => ({
            contact_id: cid, name: v.name, lessons: v.lessons,
            amount_cents: v.lessons * price,
            skipped: hasPass.has(String(cid))
        })).sort((a, b) => a.name.localeCompare(b.name));
        if (dry_run) return res.json({ preview });

        await client.query('BEGIN');
        let created = 0;
        const year = period_start.slice(0, 4);
        for (const row of preview) {
            if (row.skipped) continue;
            const { rows: numRows } = await client.query(
                `SELECT COALESCE(MAX(SUBSTRING(number FROM '\\d+$')::int), 0) + 1 AS next
                   FROM invoices WHERE number LIKE $1`, [`INV-${year}-%`]);
            const number = `INV-${year}-${String(numRows[0].next).padStart(4, '0')}`;
            const payerId = perContact[row.contact_id].parent_id || row.contact_id;
            const { rows: invRows } = await client.query(
                `INSERT INTO invoices (number, contact_id, period_start, period_end, kind, total_cents)
                 VALUES ($1, $2, $3, $4, 'advance', $5) RETURNING id`,
                [number, payerId, period_start, period_end, row.amount_cents]);
            await client.query(
                `INSERT INTO invoice_lines (invoice_id, description, ride_date, amount_cents)
                 VALUES ($1, $2, $3, $4)`,
                [invRows[0].id,
                 `Term fee ${row.name}: ${row.lessons} fixed lessons ${period_start} to ${period_end}`,
                 period_start, row.amount_cents]);
            await client.query(
                `INSERT INTO term_passes (contact_id, period_start, period_end, invoice_id)
                 VALUES ($1, $2, $3, $4)`,
                [row.contact_id, period_start, period_end, invRows[0].id]);
            created++;
        }
        await client.query('COMMIT');
        res.json({ created, skipped: preview.length - created });
    } catch (err) {
        await client.query('ROLLBACK');
        handleError(res, err, 'Creating term passes');
    } finally {
        client.release();
    }
});

// Deleting a pass makes its fixed lessons billable again. The advance invoice
// is left alone — delete it separately if it was created in error.
app.delete('/api/term-passes/:id', requireRole('helper'), async (req, res) => {
    try {
        const { rowCount } = await pool.query('DELETE FROM term_passes WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ error: 'Term pass not found.' });
        res.json({ ok: true });
    } catch (err) {
        handleError(res, err, 'Deleting term pass');
    }
});

// ---------- Automatic month-end invoicing ----------
// Once a month is over, every contact with uninvoiced booked rides in it gets
// an invoice automatically. Safe to run repeatedly: already-invoiced rides are
// skipped, so reruns create nothing new.
async function autoInvoiceClosedMonths() {
    try {
        const now = new Date();
        const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
        const month = prev.toISOString().slice(0, 7);
        const [from, to] = monthRange(month);
        await materializeRecurring(from, to);
        const { rows } = await pool.query(
            `SELECT DISTINCT COALESCE(rider.parent_id, rider.id) AS payer_id
               FROM ride_participants rp
               JOIN rides r ON r.id = rp.ride_id AND r.status = 'active' AND NOT r.is_block
               JOIN contacts rider ON rider.id = rp.contact_id
              WHERE r.date BETWEEN $1 AND $2
                AND NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.participant_id = rp.id)
                AND ${NOT_PASS_COVERED_SQL}`,
            [from, to]);
        for (const row of rows) {
            const result = await createInvoiceForContact(row.payer_id, from, to);
            if (result) console.log(`Auto-created invoice ${result.invoice.number} (${result.line_count} rides) for contact ${row.payer_id}`);
        }
    } catch (err) {
        console.error('Automatic month-end invoicing failed:', err);
    }
}

setTimeout(autoInvoiceClosedMonths, 10 * 1000); // shortly after startup
setInterval(autoInvoiceClosedMonths, 12 * 3600 * 1000); // and twice a day

app.put('/api/invoices/:id', requireRole('helper'), async (req, res) => {
    try {
        const { status } = req.body || {};
        if (!['draft', 'sent', 'paid'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
        const { rows } = await pool.query(
            'UPDATE invoices SET status = $2 WHERE id = $1 RETURNING *', [req.params.id, status]);
        if (!rows[0]) return res.status(404).json({ error: 'Invoice not found.' });
        res.json({ invoice: rows[0] });
    } catch (err) {
        handleError(res, err, 'Updating invoice');
    }
});

// Deleting an invoice frees its rides to be invoiced again
app.delete('/api/invoices/:id', requireRole('helper'), async (req, res) => {
    try {
        const { rowCount } = await pool.query('DELETE FROM invoices WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ error: 'Invoice not found.' });
        res.json({ ok: true });
    } catch (err) {
        handleError(res, err, 'Deleting invoice');
    }
});

async function loadSettings() {
    const { rows } = await pool.query('SELECT key, value FROM settings');
    const settings = {};
    rows.forEach((r) => { settings[r.key] = r.value; });
    return settings;
}

// Draws one invoice onto the current page of `doc`
function drawInvoicePage(doc, inv, lines, settings) {
    const cur = settings.currency || 'R';
    const money = (cents) => `${cur} ${(cents / 100).toFixed(2)}`;

    doc.fillColor('#000000').fontSize(20).font('Helvetica-Bold')
        .text(settings.business_name || 'Invoice', 50, 50);
    if (settings.business_address) {
        doc.fontSize(9).font('Helvetica').fillColor('#555555')
            .text(settings.business_address);
    }
    doc.moveDown(1.5);
    doc.fillColor('#000000').fontSize(14).font('Helvetica-Bold').text(`Invoice ${inv.number}`);
    doc.fontSize(10).font('Helvetica').moveDown(0.3);
    doc.text(`Date: ${new Date(inv.created_at).toISOString().slice(0, 10)}`);
    if (inv.period_start) doc.text(`Period: ${inv.period_start} to ${inv.period_end}`);
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').text('Billed to:');
    doc.font('Helvetica').text(inv.contact_name);
    if (inv.contact_address) doc.text(inv.contact_address);
    if (inv.contact_email) doc.text(inv.contact_email);
    if (inv.contact_phone) doc.text(inv.contact_phone);
    doc.moveDown(1.2);

    // Table
    const left = 50, dateW = 80, amountW = 90;
    const right = doc.page.width - 50;
    const descX = left + dateW;
    const amountX = right - amountW;
    const drawRow = (dateTxt, desc, amount, bold) => {
        const y = doc.y;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
        doc.text(dateTxt, left, y, { width: dateW - 10 });
        doc.text(desc, descX, y, { width: amountX - descX - 10 });
        doc.text(amount, amountX, y, { width: amountW, align: 'right' });
        doc.moveDown(0.4);
    };
    drawRow('Date', 'Description', 'Amount', true);
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#999999').stroke();
    doc.moveDown(0.4);
    for (const line of lines) {
        if (doc.y > doc.page.height - 120) doc.addPage();
        drawRow(line.ride_date || '', line.description, money(line.amount_cents), false);
    }
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#999999').stroke();
    doc.moveDown(0.4);
    drawRow('', 'Total', money(inv.total_cents), true);

    if (settings.invoice_footer) {
        doc.moveDown(2);
        doc.fontSize(9).font('Helvetica').fillColor('#555555')
            .text(settings.invoice_footer, left, doc.y, { width: right - left });
    }
}

const INVOICE_WITH_CONTACT_SQL = `
    SELECT i.*, c.name AS contact_name, c.email AS contact_email,
           c.phone AS contact_phone, c.address AS contact_address
      FROM invoices i JOIN contacts c ON c.id = i.contact_id`;

app.get('/api/invoices/:id/pdf', requireRole('helper'), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `${INVOICE_WITH_CONTACT_SQL} WHERE i.id = $1`, [req.params.id]);
        const inv = rows[0];
        if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
        const { rows: lines } = await pool.query(
            'SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY ride_date, id', [inv.id]);
        const settings = await loadSettings();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${inv.number}.pdf"`);
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        doc.pipe(res);
        drawInvoicePage(doc, inv, lines, settings);
        doc.end();
    } catch (err) {
        handleError(res, err, 'Generating invoice PDF');
    }
});

// One PDF with all matching invoices, one per page — for printing or sending
// a whole batch (e.g. the term's advance invoices) in one go.
app.get('/api/invoices/batch-pdf', requireRole('helper'), async (req, res) => {
    try {
        const params = [];
        const where = [];
        if (['advance', 'monthly'].includes(req.query.kind)) {
            params.push(req.query.kind);
            where.push(`i.kind = $${params.length}`);
        }
        if (['draft', 'sent', 'paid'].includes(req.query.status)) {
            params.push(req.query.status);
            where.push(`i.status = $${params.length}`);
        }
        const { rows: invoices } = await pool.query(
            `${INVOICE_WITH_CONTACT_SQL}
              ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
              ORDER BY c.name, i.number`, params);
        if (!invoices.length) return res.status(404).json({ error: 'No matching invoices.' });
        const settings = await loadSettings();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="invoices-batch.pdf"');
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        doc.pipe(res);
        for (let i = 0; i < invoices.length; i++) {
            if (i > 0) doc.addPage();
            const { rows: lines } = await pool.query(
                'SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY ride_date, id', [invoices[i].id]);
            drawInvoicePage(doc, invoices[i], lines, settings);
        }
        doc.end();
    } catch (err) {
        handleError(res, err, 'Generating batch PDF');
    }
});

// SPA fallback
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`SVSH running on http://localhost:${PORT}`);
});