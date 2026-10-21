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
app.set('trust proxy', 1); // behind Caddy: makes req.ip the real client address
app.disable('x-powered-by'); // don't advertise the stack

// Security headers. The app is fully self-contained (no external scripts,
// styles, fonts or images), so a strict CSP costs nothing.
app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
        "script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; " +
        "frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
});

app.use(express.json({ limit: '1mb' }));
// no-cache = browsers revalidate (ETag) on every load, so a deploy is picked
// up immediately; unchanged files still answer with a cheap 304.
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
        if (/\.(js|css|html)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    }
}));

const PORT = process.env.PORT || 4700;
const SESSION_DAYS = 60;
// Behind TLS in production (Caddy); plain HTTP only for local development
const COOKIE_SECURE = process.env.NODE_ENV === 'production' ? '; Secure' : '';

// Login throttle: slows brute force without locking anyone out permanently.
// Keyed per IP+email, in memory (single process, one small stable).
const loginAttempts = new Map();
const LOGIN_MAX = 8;              // failures before the window blocks
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function loginKey(req, email) {
    return `${req.ip}|${String(email || '').toLowerCase()}`;
}

function loginBlocked(key) {
    const rec = loginAttempts.get(key);
    if (!rec) return false;
    if (Date.now() - rec.first > LOGIN_WINDOW_MS) {
        loginAttempts.delete(key);
        return false;
    }
    return rec.count >= LOGIN_MAX;
}

function noteLoginFailure(key) {
    const rec = loginAttempts.get(key);
    if (!rec || Date.now() - rec.first > LOGIN_WINDOW_MS) {
        loginAttempts.set(key, { count: 1, first: Date.now() });
    } else {
        rec.count++;
    }
    if (loginAttempts.size > 5000) loginAttempts.clear(); // crude bound
}

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
        `sb_session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_DAYS * 24 * 3600}; SameSite=Lax${COOKIE_SECURE}`);
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
        if (String(password || '').length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters.' });

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
        const key = loginKey(req, emailNorm);
        if (loginBlocked(key)) {
            return res.status(429).json({ error: 'Too many attempts. Please wait 15 minutes and try again.' });
        }
        const { rows } = await pool.query(
            'SELECT * FROM users WHERE email = $1 AND active', [emailNorm]);
        const user = rows[0];
        if (!user || !verifyPassword((req.body || {}).password || '', user.password_hash)) {
            noteLoginFailure(key);
            return res.status(401).json({ error: 'Wrong email or password.' });
        }
        loginAttempts.delete(key);
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
        res.setHeader('Set-Cookie', `sb_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${COOKIE_SECURE}`);
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
        if (String(password || '').length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters.' });
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
        const allowed = ['business_name', 'business_address', 'business_phone', 'business_email',
                         'currency', 'invoice_footer', 'bank_details', 'arena_fee_cents',
                         'arena_fee_note', 'day_start', 'day_end',
                         'livery_price_cents', 'livery_note'];
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

app.post('/api/settings/rotate-schedule-token', requireRole('admin'), async (req, res) => {
    try {
        const token = crypto.randomBytes(32).toString('hex');
        await pool.query(
            `INSERT INTO settings (key, value) VALUES ('public_schedule_token', $1)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [token]);
        res.json({ token });
    } catch (err) {
        handleError(res, err, 'Rotating schedule link');
    }
});

// ---------- Contacts ----------
// Which horses this contact has on livery, and at what share. Replaces the
// whole set, so an empty list means they are no longer a livery customer. A
// share that is not full, half or quarter is a typo, not an intention.
async function saveLiveryHorses(contactId, list) {
    if (!Array.isArray(list)) return null;
    const clean = [];
    for (const h of list) {
        if (!h || !h.horse_id) continue;
        const share = Number(h.share);
        if (![25, 50, 100].includes(share)) {
            return 'Livery must be a full, half or quarter share.';
        }
        clean.push({ horse_id: h.horse_id, share,
                     discount: Math.max(0, Math.round(Number(h.discount_cents) || 0)) });
    }
    // anything dropped from the list stops being a livery horse of theirs
    await pool.query(
        `UPDATE horses SET livery_share = NULL
          WHERE owner_contact_id = $1 AND livery_share IS NOT NULL
            AND NOT (id = ANY($2::bigint[]))`,
        [contactId, clean.map((c) => c.horse_id)]);
    for (const c of clean) {
        await pool.query(
            `UPDATE horses SET owner_contact_id = $1, livery_share = $2,
                    livery_discount_cents = $3 WHERE id = $4`,
            [contactId, c.share, c.discount, c.horse_id]);
    }
    return null;
}

app.get('/api/contacts', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT c.*, p.name AS parent_name,
                    (SELECT count(*)::int FROM ride_participants rp
                      JOIN rides r ON r.id = rp.ride_id
                      WHERE rp.contact_id = c.id AND r.status = 'active' AND NOT r.is_block) AS ride_count,
                    -- "Parent" and "Rider" are derived, not stored: a contact can be
                    -- both (a parent who also rides), and neither flag needs upkeep.
                    (SELECT count(*)::int FROM contacts k
                      WHERE k.parent_id = c.id AND NOT k.archived) AS child_count,
                    (SELECT COALESCE(json_agg(json_build_object('id', k.id::text, 'name', k.name)
                            ORDER BY k.name), '[]'::json)
                       FROM contacts k WHERE k.parent_id = c.id AND NOT k.archived) AS children,
                    (SELECT count(*)::int FROM recurring_participants xp
                      WHERE xp.contact_id = c.id) AS fixed_count,
                    sc.name AS school_name,
                    -- the weekly slots this rider holds, for the contact list
                    (SELECT COALESCE(json_agg(json_build_object(
                            'weekday', rr.weekday, 'start_time', rr.start_time::text,
                            'frequency', xp.frequency) ORDER BY rr.weekday, rr.start_time), '[]'::json)
                       FROM recurring_participants xp
                       JOIN recurring_rides rr ON rr.id = xp.recurring_id
                      WHERE xp.contact_id = c.id AND rr.active
                        AND (rr.end_date IS NULL OR rr.end_date >= CURRENT_DATE)) AS fixed_rides,
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
                            'id', mc.id::text, 'name', mc.name, 'price_cents', mc.price_cents)
                            ORDER BY mc.sort_order, mc.name), '[]'::json)
                       FROM contact_monthly_charges mc WHERE mc.contact_id = c.id) AS monthly_charges,
                    (SELECT COALESCE(json_agg(json_build_object(
                            'horse_id', h.id::text, 'name', h.name, 'share', h.livery_share,
                            'discount_cents', h.livery_discount_cents)
                            ORDER BY h.sort_order, h.name), '[]'::json)
                       FROM horses h
                      WHERE h.owner_contact_id = c.id AND h.livery_share IS NOT NULL) AS livery_horses,
                    (SELECT COALESCE(json_agg(json_build_object(
                            'id', ch.id::text, 'charge_date', ch.charge_date::text,
                            'description', ch.description, 'amount_cents', ch.amount_cents,
                            'invoiced', EXISTS (SELECT 1 FROM invoice_lines il WHERE il.charge_id = ch.id))
                            ORDER BY ch.charge_date DESC, ch.id DESC), '[]'::json)
                       FROM contact_charges ch WHERE ch.contact_id = c.id) AS charges
               FROM contacts c
               LEFT JOIN contacts p ON p.id = c.parent_id
               LEFT JOIN schools sc ON sc.id = c.school_id
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
                            'horse_id', hp.horse_id::text, 'kind', hp.kind, 'reason', hp.reason,
                            'horse_name', h.name) ORDER BY hp.kind DESC, h.name), '[]'::json)
                       FROM contact_horse_prefs hp JOIN horses h ON h.id = hp.horse_id
                      WHERE hp.contact_id = c.id) AS horse_prefs,
                    (SELECT COALESCE(json_agg(json_build_object(
                            'weekday', av.weekday, 'start_time', av.start_time::text,
                            'end_time', av.end_time::text) ORDER BY av.weekday, av.start_time), '[]'::json)
                       FROM contact_availability av WHERE av.contact_id = c.id) AS availability,
                    (SELECT COALESCE(json_agg(json_build_object(
                            'id', mc.id::text, 'name', mc.name, 'price_cents', mc.price_cents)
                            ORDER BY mc.sort_order, mc.name), '[]'::json)
                       FROM contact_monthly_charges mc WHERE mc.contact_id = c.id) AS monthly_charges,
                    (SELECT COALESCE(json_agg(json_build_object(
                            'horse_id', h.id::text, 'name', h.name, 'share', h.livery_share,
                            'discount_cents', h.livery_discount_cents)
                            ORDER BY h.sort_order, h.name), '[]'::json)
                       FROM horses h
                      WHERE h.owner_contact_id = c.id AND h.livery_share IS NOT NULL) AS livery_horses,
                    (SELECT COALESCE(json_agg(json_build_object(
                            'id', ch.id::text, 'charge_date', ch.charge_date::text,
                            'description', ch.description, 'amount_cents', ch.amount_cents,
                            'invoiced', EXISTS (SELECT 1 FROM invoice_lines il WHERE il.charge_id = ch.id))
                            ORDER BY ch.charge_date DESC, ch.id DESC), '[]'::json)
                       FROM contact_charges ch WHERE ch.contact_id = c.id) AS charges
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
    // Extra monthly charges for this one customer, on top of the standard ones
    // every livery customer gets. Sent as a full list, so an empty array really
    // does mean "none" rather than "no change".
    const liveryError = await saveLiveryHorses(contactId, body.livery_horses);
    if (liveryError) return liveryError;
    if (Array.isArray(body.monthly_charges)) {
        await pool.query('DELETE FROM contact_monthly_charges WHERE contact_id = $1', [contactId]);
        let i = 0;
        for (const m of body.monthly_charges) {
            const name = String((m || {}).name || '').trim();
            if (!name) continue;
            await pool.query(
                `INSERT INTO contact_monthly_charges (contact_id, name, price_cents, sort_order)
                 VALUES ($1, $2, $3, $4)`,
                [contactId, name, Math.round(Number(m.price_cents) || 0), i++]);
        }
    }
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
const PAYMENT_TERMS = ['advance_monthly', 'advance_term', 'arrears', 'cash_after'];

// Anyone who pays must say how. Only checked when the caller states the role,
// so partial updates (archiving, linking a parent) are unaffected.
function paymentTermsError(body) {
    const { is_parent, payment_terms } = body || {};
    if (payment_terms !== undefined && payment_terms !== null &&
        !PAYMENT_TERMS.includes(payment_terms)) {
        return 'That payment arrangement is not recognised.';
    }
    if (is_parent === true && !payment_terms) {
        return 'Choose how this parent pays before saving.';
    }
    return null;
}

// Term dates decide which lessons are term-time and which fall in the holidays,
// and that drives what is invoiced. The school belongs to whoever PAYS, not to
// each rider: one invoice covers all of a payer's children, so two term
// calendars on one invoice would have to be split down the middle. A rider with
// a payer above them simply follows that payer's school.
function schoolError(body) {
    const b = body || {};
    const paysOwnWay = b.is_rider === true && !b.parent_id;
    if ((paysOwnWay || b.is_parent === true) && b.school_id === null) {
        return 'Pick the school — term dates decide which lessons are term-time.';
    }
    return null;
}

app.post('/api/contacts', requireAuth, async (req, res) => {
    try {
        const { name, phone, email, address, parent_id, experience, notes,
                needs_collection, collection_teacher, collection_class,
                is_prospect, birth_year, is_rider, is_parent, payment_terms,
                school_id, pays_arena_fee } = req.body || {};
        if (!String(name || '').trim()) return res.status(400).json({ error: 'Name is required.' });
        if (is_rider === false && is_parent === false) {
            return res.status(400).json({ error: 'Tick rider, parent, or both.' });
        }
        const termsError = paymentTermsError(req.body);
        if (termsError) return res.status(400).json({ error: termsError });
        const schErr = schoolError(req.body);
        if (schErr) return res.status(400).json({ error: schErr });
        const parentError = await validateParent(parent_id, null);
        if (parentError) return res.status(400).json({ error: parentError });
        const { rows } = await pool.query(
            `INSERT INTO contacts (name, phone, email, address, parent_id, experience,
                                   needs_collection, collection_teacher, collection_class,
                                   is_prospect, birth_year, notes, is_rider, is_parent, payment_terms,
                                   school_id, pays_arena_fee)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`,
            [String(name).trim(), phone || '', email || '', address || '', parent_id || null,
             EXPERIENCE_LEVELS.includes(experience) ? experience : null,
             !!needs_collection, collection_teacher || '', collection_class || '',
             !!is_prospect, Number.isInteger(birth_year) ? birth_year : null, notes || '',
             is_rider !== false, !!is_parent, payment_terms || null, school_id || null,
             !!pays_arena_fee]);
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
                needs_collection, collection_teacher, collection_class,
                is_prospect, birth_year, is_rider, is_parent, payment_terms,
                school_id, pays_arena_fee } = req.body || {};
        if (is_rider === false && is_parent === false) {
            return res.status(400).json({ error: 'Tick rider, parent, or both.' });
        }
        const termsError = paymentTermsError(req.body);
        if (termsError) return res.status(400).json({ error: termsError });
        const schErr = schoolError(req.body);
        if (schErr) return res.status(400).json({ error: schErr });
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
                archived = COALESCE($14, archived),
                is_prospect = COALESCE($15, is_prospect),
                birth_year = CASE WHEN $16 THEN $17::int ELSE birth_year END,
                is_rider = COALESCE($18, is_rider),
                is_parent = COALESCE($19, is_parent),
                payment_terms = CASE WHEN $20 THEN $21 ELSE payment_terms END,
                school_id = CASE WHEN $22 THEN $23::bigint ELSE school_id END,
                pays_arena_fee = COALESCE($24, pays_arena_fee)
             WHERE id = $1 RETURNING *`,
            [req.params.id, name, phone, email, address,
             parent_id !== undefined, parent_id || null,
             experience !== undefined, EXPERIENCE_LEVELS.includes(experience) ? experience : null,
             needs_collection, collection_teacher, collection_class,
             notes, archived,
             typeof is_prospect === 'boolean' ? is_prospect : null,
             birth_year !== undefined, Number.isInteger(birth_year) ? birth_year : null,
             typeof is_rider === 'boolean' ? is_rider : null,
             typeof is_parent === 'boolean' ? is_parent : null,
             payment_terms !== undefined, payment_terms || null,
             school_id !== undefined, school_id || null,
             typeof pays_arena_fee === 'boolean' ? pays_arena_fee : null]);
        if (!rows[0]) return res.status(404).json({ error: 'Contact not found.' });
        const extrasError = await saveContactExtras(req.params.id, req.body || {});
        if (extrasError) return res.status(400).json({ error: extrasError });
        res.json({ contact: rows[0] });
    } catch (err) {
        handleError(res, err, 'Updating contact');
    }
});

// Deleting is only safe for a contact with no history. Their ride seats and
// invoice lines would otherwise be silently blanked (both are ON DELETE SET
// NULL), quietly rewriting what happened — so anything with a trace behind it
// must be archived instead, which the caller is told to offer.
app.delete('/api/contacts/:id', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT (SELECT count(*) FROM ride_participants WHERE contact_id = $1)::int AS rides,
                    -- only LIVE slots count: a link to a template that has ended
                    -- or been switched off is not a schedule entry, and the
                    -- contact list already ignores those (so blocking the delete
                    -- on one contradicted what the row showed)
                    (SELECT count(*) FROM recurring_participants xp
                      JOIN recurring_rides rr ON rr.id = xp.recurring_id
                     WHERE xp.contact_id = $1 AND rr.active
                       AND (rr.end_date IS NULL OR rr.end_date >= CURRENT_DATE))::int AS fixed,
                    (SELECT count(*) FROM invoices
                      WHERE contact_id = $1 OR rider_contact_id = $1)::int AS invoices,
                    (SELECT count(*) FROM reschedule_credits WHERE contact_id = $1)::int AS credits,
                    (SELECT count(*) FROM horses WHERE owner_contact_id = $1)::int AS horses,
                    (SELECT count(*) FROM contacts WHERE parent_id = $1)::int AS children`,
            [req.params.id]);
        const r = rows[0];
        // Money and relationships are hard blockers — nothing may quietly rewrite
        // an invoice or orphan a rider. Schedule entries are softer: a rider who
        // was never billed can simply be taken off the schedule and removed.
        const hard = [];
        if (r.invoices) hard.push(`${r.invoices} invoice${r.invoices === 1 ? '' : 's'}`);
        if (r.credits) hard.push('reschedule credits');
        if (r.horses) hard.push('an owned horse');
        if (r.children) hard.push(`${r.children} rider${r.children === 1 ? '' : 's'} under them`);
        const soft = [];
        if (r.rides) soft.push(`${r.rides} booked ride${r.rides === 1 ? '' : 's'}`);
        if (r.fixed) soft.push(`${r.fixed} weekly fixed ride${r.fixed === 1 ? '' : 's'}`);

        if (hard.length) {
            return res.status(409).json({
                error: `This contact has ${hard.concat(soft).join(', ')}. Archive them instead so the history is kept.`,
                can_archive: true
            });
        }
        if (soft.length && req.query.detach !== '1') {
            return res.status(409).json({
                error: `This contact is on ${soft.join(' and ')}, but has never been invoiced.`,
                can_archive: true,
                can_detach: true,
                detail: soft.join(' and ')
            });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            if (soft.length) {
                await client.query('DELETE FROM recurring_participants WHERE contact_id = $1', [req.params.id]);
                await client.query('DELETE FROM ride_participants WHERE contact_id = $1', [req.params.id]);
            }
            const { rowCount } = await client.query('DELETE FROM contacts WHERE id = $1', [req.params.id]);
            await client.query('COMMIT');
            if (!rowCount) return res.status(404).json({ error: 'Contact not found.' });
            res.json({ ok: true, removed_from_schedule: soft.length > 0 });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        handleError(res, err, 'Deleting contact');
    }
});

// ---------- Schools and their term dates ----------
// Per-term billing follows the rider's SCHOOL term, and the schools do not
// share dates — so terms are stored per school per year.
app.get('/api/schools', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT s.*, (SELECT COALESCE(json_agg(json_build_object(
                        'id', t.id::text, 'year', t.year, 'term_no', t.term_no,
                        'period_start', t.period_start::text, 'period_end', t.period_end::text)
                        ORDER BY t.year, t.term_no), '[]'::json)
                    FROM school_terms t WHERE t.school_id = s.id) AS terms,
                    (SELECT count(*)::int FROM contacts c
                      WHERE c.school_id = s.id AND NOT c.archived) AS rider_count
               FROM schools s ORDER BY s.sort_order, s.name`);
        res.json({ schools: rows });
    } catch (err) {
        handleError(res, err, 'Loading schools');
    }
});

// One-off expenses against a contact: a vet call, a bag of feed, or a discount
// (negative). They sit as "pending" until an invoice picks them up, after which
// they show as invoiced and can no longer be edited away from under it.
app.post('/api/contacts/:id/charges', requireRole('helper'), async (req, res) => {
    try {
        const { charge_date, description, amount_cents } = req.body || {};
        if (!DATE_RE.test(String(charge_date || ''))) {
            return res.status(400).json({ error: 'A valid date is required.' });
        }
        if (!String(description || '').trim()) {
            return res.status(400).json({ error: 'A description is required.' });
        }
        const cents = Math.round(Number(amount_cents));
        if (!Number.isFinite(cents) || cents === 0) {
            return res.status(400).json({ error: 'An amount is required.' });
        }
        const { rows } = await pool.query(
            `INSERT INTO contact_charges (contact_id, charge_date, description, amount_cents)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [req.params.id, charge_date, String(description).trim(), cents]);
        res.json({ charge: rows[0] });
    } catch (err) {
        handleError(res, err, 'Adding the expense');
    }
});

app.delete('/api/charges/:id', requireRole('helper'), async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT 1 FROM invoice_lines WHERE charge_id = $1', [req.params.id]);
        if (rows[0]) {
            return res.status(400).json({
                error: 'That expense is already on an invoice. Delete the invoice first.' });
        }
        await pool.query('DELETE FROM contact_charges WHERE id = $1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) {
        handleError(res, err, 'Deleting the expense');
    }
});

// The livery extras catalogue, maintained in Settings. A small list of named
// charges rather than free text, so an invoice can actually price them.
app.get('/api/livery-extras', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM livery_extras ORDER BY sort_order, name');
        res.json({ extras: rows });
    } catch (err) {
        handleError(res, err, 'Loading livery extras');
    }
});

app.post('/api/livery-extras', requireRole('helper'), async (req, res) => {
    try {
        const { name, price_cents } = req.body || {};
        if (!String(name || '').trim()) {
            return res.status(400).json({ error: 'A name is required.' });
        }
        const { rows } = await pool.query(
            'INSERT INTO livery_extras (name, price_cents) VALUES ($1, $2) RETURNING *',
            [String(name).trim(), Math.max(0, parseInt(price_cents, 10) || 0)]);
        res.json({ extra: rows[0] });
    } catch (err) {
        handleError(res, err, 'Adding livery extra');
    }
});

app.put('/api/livery-extras/:id', requireRole('helper'), async (req, res) => {
    try {
        const { name, price_cents, active } = req.body || {};
        const { rows } = await pool.query(
            `UPDATE livery_extras SET name = COALESCE($2, name),
                    price_cents = COALESCE($3, price_cents), active = COALESCE($4, active)
              WHERE id = $1 RETURNING *`,
            [req.params.id, name ? String(name).trim() : null,
             price_cents === undefined ? null : Math.max(0, parseInt(price_cents, 10) || 0),
             typeof active === 'boolean' ? active : null]);
        if (!rows[0]) return res.status(404).json({ error: 'Not found.' });
        res.json({ extra: rows[0] });
    } catch (err) {
        handleError(res, err, 'Updating livery extra');
    }
});

// Deleting an extra unticks it for everyone (the join cascades). Invoices
// already raised keep their lines, because those are stored on the invoice.
app.delete('/api/livery-extras/:id', requireRole('helper'), async (req, res) => {
    try {
        await pool.query('DELETE FROM livery_extras WHERE id = $1', [req.params.id]);
        res.json({ ok: true });
    } catch (err) {
        handleError(res, err, 'Deleting livery extra');
    }
});

app.post('/api/schools', requireRole('helper'), async (req, res) => {
    try {
        const name = String((req.body || {}).name || '').trim();
        if (!name) return res.status(400).json({ error: 'A school name is required.' });
        const { rows } = await pool.query(
            `INSERT INTO schools (name, sort_order)
             VALUES ($1, COALESCE((SELECT MAX(sort_order) + 1 FROM schools), 1)) RETURNING *`, [name]);
        res.json({ school: rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'That school already exists.' });
        handleError(res, err, 'Creating school');
    }
});

app.put('/api/schools/:id', requireRole('helper'), async (req, res) => {
    try {
        const { name, active, year_start_month: ysm } = req.body || {};
        const month = Number(ysm);
        if (ysm !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) {
            return res.status(400).json({ error: 'The academic year must start in a valid month.' });
        }
        const { rows } = await pool.query(
            `UPDATE schools SET name = COALESCE($2, name), active = COALESCE($3, active),
                    year_start_month = COALESCE($4, year_start_month)
              WHERE id = $1 RETURNING *`,
            [req.params.id, name ? String(name).trim() : null,
             typeof active === 'boolean' ? active : null,
             ysm === undefined ? null : month]);
        if (!rows[0]) return res.status(404).json({ error: 'School not found.' });
        res.json({ school: rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'That school already exists.' });
        handleError(res, err, 'Updating school');
    }
});

app.delete('/api/schools/:id', requireRole('helper'), async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT count(*)::int AS n FROM contacts WHERE school_id = $1 AND NOT archived',
            [req.params.id]);
        if (rows[0].n) {
            return res.status(409).json({
                error: `${rows[0].n} rider${rows[0].n === 1 ? ' is' : 's are'} at this school. ` +
                       'Move them first, or mark the school inactive instead.'
            });
        }
        const { rowCount } = await pool.query('DELETE FROM schools WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ error: 'School not found.' });
        res.json({ ok: true });
    } catch (err) {
        handleError(res, err, 'Deleting school');
    }
});

// Which schools are on holiday on a given day? A school is "on holiday" only
// when its terms for that year ARE known and the date falls outside them —
// with no term dates we say so rather than guessing, because a wrong holiday
// banner would have her cancelling lessons that are actually running.
app.get('/api/schools/holidays', requireAuth, async (req, res) => {
    try {
        const date = String(req.query.date || '');
        if (!DATE_RE.test(date)) return res.status(400).json({ error: 'A valid date is required.' });
        const year = Number(date.slice(0, 4));
        const { rows } = await pool.query(
            `SELECT s.id, s.name,
                    (SELECT count(*) FROM school_terms t
                      WHERE t.school_id = s.id AND t.year = $2)::int AS terms_known,
                    (SELECT t.term_no FROM school_terms t
                      WHERE t.school_id = s.id AND $1::date BETWEEN t.period_start AND t.period_end
                      LIMIT 1) AS in_term,
                    (SELECT min(t.period_start)::text FROM school_terms t
                      WHERE t.school_id = s.id AND t.period_start > $1::date) AS next_term_start
               FROM schools s WHERE s.active ORDER BY s.sort_order, s.name`,
            [date, year]);
        res.json({
            date,
            schools: rows.map((r) => ({
                id: r.id, name: r.name,
                status: r.in_term ? 'term' : (r.terms_known ? 'holiday' : 'unknown'),
                term_no: r.in_term || null,
                next_term_start: r.next_term_start
            }))
        });
    } catch (err) {
        handleError(res, err, 'Loading school holidays');
    }
});

// Save one term's dates. Re-saving the same school/year/term overwrites it.
app.put('/api/schools/:id/terms/:year/:term', requireRole('helper'), async (req, res) => {
    try {
        const year = Number(req.params.year), term = Number(req.params.term);
        if (!Number.isInteger(year) || year < 2000 || year > 2100) {
            return res.status(400).json({ error: 'A valid year is required.' });
        }
        if (!Number.isInteger(term) || term < 1 || term > 4) {
            return res.status(400).json({ error: 'The term must be 1, 2, 3 or 4.' });
        }
        const { period_start, period_end } = req.body || {};
        // empty dates clear the term
        if (!period_start && !period_end) {
            await pool.query(
                'DELETE FROM school_terms WHERE school_id = $1 AND year = $2 AND term_no = $3',
                [req.params.id, year, term]);
            return res.json({ ok: true, cleared: true });
        }
        if (!DATE_RE.test(period_start || '') || !DATE_RE.test(period_end || '') ||
            period_start > period_end) {
            return res.status(400).json({ error: 'Both dates are required, and the start must come first.' });
        }
        const { rows } = await pool.query(
            `INSERT INTO school_terms (school_id, year, term_no, period_start, period_end)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (school_id, year, term_no)
             DO UPDATE SET period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end
             RETURNING *`,
            [req.params.id, year, term, period_start, period_end]);
        res.json({ term: rows[0] });
    } catch (err) {
        handleError(res, err, 'Saving term dates');
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
        const { name, color, notes, owner_contact_id, shared_with_school } = req.body || {};
        if (!String(name || '').trim()) return res.status(400).json({ error: 'Name is required.' });
        const { rows } = await pool.query(
            `INSERT INTO horses (name, color, notes, owner_contact_id, shared_with_school, sort_order)
             VALUES ($1, COALESCE($2, '#7c9885'), $3, $4, $5,
                     (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM horses))
             RETURNING *`,
            [String(name).trim(), color, notes || '', owner_contact_id || null,
             !!owner_contact_id && !!shared_with_school]);
        res.json({ horse: rows[0] });
    } catch (err) {
        handleError(res, err, 'Creating horse');
    }
});

// Block a horse for whole days across a date range (injury, resting, …).
// Days where the horse already has a ride or block are skipped and reported.
app.post('/api/horses/:id/block', requireAuth, async (req, res) => {
    const client = await pool.connect();
    try {
        const { from, to } = req.body || {};
        if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '') || from > to) {
            return res.status(400).json({ error: 'A valid date range is required.' });
        }
        const dates = datesInRange(from, to);
        if (dates.length > 366) return res.status(400).json({ error: 'Range too long (max 1 year).' });
        // optional part-day block: a timed block instead of a whole-day one
        const startTime = TIME_RE.test((req.body || {}).start_time || '') ? req.body.start_time : null;
        const durationMin = Number.isInteger((req.body || {}).duration_min) && req.body.duration_min > 0
            ? req.body.duration_min : null;
        if (startTime && !durationMin) {
            return res.status(400).json({ error: 'Give an end time for a part-day block.' });
        }
        const { rows: horseRows } = await pool.query('SELECT name FROM horses WHERE id = $1', [req.params.id]);
        if (!horseRows[0]) return res.status(404).json({ error: 'Horse not found.' });

        const skipped = [];
        let created = 0;
        await client.query('BEGIN');
        for (const date of dates) {
            const conflicts = startTime
                ? await findConflicts(date, startTime, [req.params.id], null, false, durationMin)
                : (await client.query(
                    `SELECT 1 FROM rides r
                      WHERE r.date = $1 AND r.status = 'active'
                        AND (EXISTS (SELECT 1 FROM ride_participants rp
                                      WHERE rp.ride_id = r.id AND rp.horse_id = $2)
                          OR EXISTS (SELECT 1 FROM ride_guides rg
                                      WHERE rg.ride_id = r.id AND rg.horse_id = $2))
                      LIMIT 1`, [date, req.params.id])).rows.length ? ['busy'] : [];
            if (conflicts.length) { skipped.push(date); continue; }
            const { rows: ins } = await client.query(
                `INSERT INTO rides (date, start_time, duration_min, is_block, all_day, notes)
                 VALUES ($1, $2, $3, true, $4, $5) RETURNING id`,
                [date, startTime || '00:00', durationMin, !startTime, (req.body || {}).notes || '']);
            await client.query(
                'INSERT INTO ride_participants (ride_id, horse_id) VALUES ($1, $2)',
                [ins[0].id, req.params.id]);
            created++;
        }
        await client.query('COMMIT');
        res.json({ created, skipped, horse: horseRows[0].name });
    } catch (err) {
        await client.query('ROLLBACK');
        handleError(res, err, 'Blocking the horse');
    } finally {
        client.release();
    }
});

// scope 'one' = just that date; 'future' = that date and everything after it
app.delete('/api/horses/:id/block', requireAuth, async (req, res) => {
    try {
        const from = req.query.from;
        if (!DATE_RE.test(from || '')) return res.status(400).json({ error: 'A valid date is required.' });
        const scope = req.query.scope === 'future' ? 'future' : 'one';
        const { rowCount } = await pool.query(
            `DELETE FROM rides r
              WHERE r.is_block AND r.all_day
                AND (${scope === 'future' ? 'r.date >= $2' : 'r.date = $2'})
                AND EXISTS (SELECT 1 FROM ride_participants rp
                             WHERE rp.ride_id = r.id AND rp.horse_id = $1)`,
            [req.params.id, from]);
        res.json({ removed: rowCount });
    } catch (err) {
        handleError(res, err, 'Unblocking the horse');
    }
});

// How many whole-day blocks does this horse have from a date onwards?
app.get('/api/horses/:id/blocks', requireAuth, async (req, res) => {
    try {
        const from = DATE_RE.test(req.query.from || '') ? req.query.from : todayISO();
        const { rows } = await pool.query(
            `SELECT r.date FROM rides r
              WHERE r.is_block AND r.all_day AND r.date >= $2
                AND EXISTS (SELECT 1 FROM ride_participants rp
                             WHERE rp.ride_id = r.id AND rp.horse_id = $1)
              ORDER BY r.date`, [req.params.id, from]);
        res.json({ dates: rows.map((r) => r.date) });
    } catch (err) {
        handleError(res, err, 'Loading blocks');
    }
});

// Drag-to-reorder the calendar's horse columns
app.put('/api/horses/reorder', requireRole('helper'), async (req, res) => {
    const client = await pool.connect();
    try {
        const ids = Array.isArray((req.body || {}).horse_ids) ? req.body.horse_ids : [];
        if (!ids.length) return res.status(400).json({ error: 'No order given.' });
        await client.query('BEGIN');
        for (let i = 0; i < ids.length; i++) {
            await client.query('UPDATE horses SET sort_order = $2 WHERE id = $1', [ids[i], i]);
        }
        await client.query('COMMIT');
        res.json({ ok: true });
    } catch (err) {
        await client.query('ROLLBACK');
        handleError(res, err, 'Reordering horses');
    } finally {
        client.release();
    }
});

app.put('/api/horses/:id', requireRole('helper'), async (req, res) => {
    try {
        const { name, color, notes, active, sort_order, owner_contact_id,
                shared_with_school } = req.body || {};
        const { rows } = await pool.query(
            `UPDATE horses SET
                name = COALESCE($2, name),
                color = COALESCE($3, color),
                notes = COALESCE($4, notes),
                active = COALESCE($5, active),
                sort_order = COALESCE($6, sort_order),
                owner_contact_id = CASE WHEN $7 THEN $8::bigint ELSE owner_contact_id END,
                -- a horse with no owner is the school's, so the flag is moot
                shared_with_school = CASE WHEN $8::bigint IS NULL AND $7
                    THEN false ELSE COALESCE($9, shared_with_school) END
             WHERE id = $1 RETURNING *`,
            [req.params.id, name, color, notes, active, sort_order,
             owner_contact_id !== undefined, owner_contact_id || null,
             typeof shared_with_school === 'boolean' ? shared_with_school : null]);
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

// Every lesson an instructor leads in a period, past or planned. Used on the
// instructor's dialog to check their work and what they are owed.
app.get('/api/guides/:id/rides', requireAuth, async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '') || from > to) {
            return res.status(400).json({ error: 'Valid from/to dates are required.' });
        }
        if (datesInRange(from, to).length > 366) {
            return res.status(400).json({ error: 'Period too large (max 1 year).' });
        }
        // planned weeks only exist once materialized, so make sure they do
        await materializeRecurring(from, to);
        const { rows } = await pool.query(
            `SELECT r.id, r.date::text AS date, r.start_time::text AS start_time,
                    COALESCE(r.duration_min, rt.duration_min, 60) AS duration_min,
                    r.level, r.venue, rg.mode,
                    COALESCE(rt.name, r.ride_type_name) AS ride_type_name,
                    (SELECT count(*)::int FROM ride_participants rp
                      WHERE rp.ride_id = r.id AND rp.contact_id IS NOT NULL) AS rider_count,
                    (SELECT string_agg(c.name, ', ' ORDER BY c.name)
                       FROM ride_participants rp JOIN contacts c ON c.id = rp.contact_id
                      WHERE rp.ride_id = r.id) AS riders
               FROM ride_guides rg
               JOIN rides r ON r.id = rg.ride_id
               LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
              WHERE rg.guide_id = $1 AND r.date BETWEEN $2 AND $3
                AND r.status = 'active' AND NOT r.is_block
              ORDER BY r.date, r.start_time`,
            [req.params.id, from, to]);
        res.json({ rides: rows, from, to });
    } catch (err) {
        handleError(res, err, 'Loading instructor lessons');
    }
});

// Pay per lesson: optional, but if given it must be a sane whole number of cents
function guideRateError(rate) {
    if (rate === undefined || rate === null) return null;
    if (!Number.isInteger(rate) || rate < 0) return 'The pay per lesson must be a positive amount.';
    return null;
}

app.post('/api/guides', requireRole('helper'), async (req, res) => {
    try {
        const { name, phone, notes, is_assistant, color, rate_cents } = req.body || {};
        if (!String(name || '').trim()) return res.status(400).json({ error: 'Name is required.' });
        const rateError = guideRateError(rate_cents);
        if (rateError) return res.status(400).json({ error: rateError });
        const { rows } = await pool.query(
            `INSERT INTO guides (name, phone, is_assistant, notes, color, rate_cents)
             VALUES ($1, $2, $3, $4, COALESCE($5, '#6a6a66'), $6) RETURNING *`,
            [String(name).trim(), phone || '', !!is_assistant, notes || '', color,
             Number.isInteger(rate_cents) ? rate_cents : null]);
        res.json({ guide: rows[0] });
    } catch (err) {
        handleError(res, err, 'Creating guide');
    }
});

app.put('/api/guides/:id', requireRole('helper'), async (req, res) => {
    try {
        const { name, phone, notes, active, is_assistant, color, rate_cents } = req.body || {};
        const rateError = guideRateError(rate_cents);
        if (rateError) return res.status(400).json({ error: rateError });
        const { rows } = await pool.query(
            `UPDATE guides SET
                name = COALESCE($2, name),
                phone = COALESCE($3, phone),
                notes = COALESCE($4, notes),
                active = COALESCE($5, active),
                is_assistant = COALESCE($6, is_assistant),
                color = COALESCE($7, color),
                rate_cents = CASE WHEN $8 THEN $9::int ELSE rate_cents END
             WHERE id = $1 RETURNING *`,
            [req.params.id, name, phone, notes, active, is_assistant, color,
             rate_cents !== undefined, Number.isInteger(rate_cents) ? rate_cents : null]);
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
    // The template's type is what every occurrence it creates inherits.
    if (!ride_type_id) return { error: 'A ride type is required.' };
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
    // Being placed on a fixed ride graduates an interested rider to a real one
    const placedContacts = participants.map((p) => p.contact_id).filter(Boolean);
    if (placedContacts.length) {
        await client.query(
            'UPDATE contacts SET is_prospect = false WHERE id = ANY($1::bigint[]) AND is_prospect',
            [placedContacts]);
    }
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

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function shiftDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
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

// Which of these horses are already in another active ride during
// [time, time + durationMin)? Partial overlaps count: an existing ride blocks
// the whole window its ride type's duration covers (60 min when no type).
// All-day blocks occupy every time of their date, in both directions.
// Instructors are deliberately NOT checked — one instructor can run two
// overlapping rides; the UI flags the overlap instead of forbidding it.
// Returns human-readable messages (empty = all clear).
async function findConflicts(date, time, horseIds, excludeRideId, allDay, durationMin) {
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
    return conflicts;
}

// Validate and normalize a ride payload. Returns { error } or the clean parts.
function parseRideBody(body) {
    const { date, ride_type_id, is_block, all_day, level, duration_min, notes, venue, instructor_notes } = body || {};
    const isBlock = !!is_block;
    const rideLevel = LEVELS.includes(level) ? level : null;
    const allDay = isBlock && !!all_day; // only blocks can span the whole day
    const start_time = allDay ? '00:00' : (body || {}).start_time;
    if (!DATE_RE.test(date || '')) return { error: 'A valid date is required.' };
    if (!TIME_RE.test(start_time || '')) return { error: 'A valid time is required.' };
    // Every real ride must be priced and countable; blocks are not rides.
    if (!isBlock && !ride_type_id) return { error: 'A ride type is required.' };
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
            alt_horse_id: p.alt_horse_id || null,
            contact_id: contactId,
            price_cents: Number.isInteger(p.price_cents) ? p.price_cents : null
        });
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
    // riders taken off this ride, kept rather than deleted
    const cancelled = new Set();
    const cancellations = (Array.isArray((body || {}).cancellations) ? body.cancellations : [])
        .filter((c) => c && c.contact_id)
        .map((c) => ({
            contact_id: c.contact_id,
            kind: c.kind === 'rescheduled' ? 'rescheduled' : 'cancelled',
            from_series: !!c.from_series,
            // a late cancellation is still owed for; see migration 031
            billed: !!c.billed
        }));
    // Nobody can be on the ride twice, and riding while also taken off it is
    // the same contradiction wearing two hats — it is what put a rider on the
    // day twice, once live and once struck through.
    for (const c of cancellations) {
        const id = String(c.contact_id);
        if (contactsUsed.has(id)) {
            return { error: 'A rider cannot be both on this ride and taken off it.' };
        }
        if (cancelled.has(id)) return { error: 'The same rider is taken off twice.' };
        cancelled.add(id);
    }
    // A lesson where everyone called off is still a real record of the day, so
    // cancellations count as content even when no seat is left.
    if (!participants.length && !cancellations.length && (isBlock || !guides.length)) {
        return { error: isBlock ? 'Pick at least one horse to block.'
            : 'A ride needs at least one rider, horse or instructor.' };
    }
    return {
        date, start_time, isBlock, allDay,
        level: rideLevel,
        venue: ['arena', 'outride'].includes(venue) ? venue : 'instructor',
        duration_min: Number.isInteger(duration_min) && duration_min > 0 ? duration_min : null,
        ride_type_id: ride_type_id || null,
        notes: notes || '',
        instructor_notes: instructor_notes || '',
        participants, guides, cancellations,
        horseIds: [...horsesUsed]
    };
}

// "INV-2026-0050" on its own in a line of prose reads like a code; give it a word.
const invoiceLabel = (number) => (number ? `invoice ${number}` : 'an earlier invoice');

async function replaceCancellations(client, rideId, cancellations) {
    // A cancellation already billed must survive: deleting it would orphan the
    // invoice line and let the same lesson be charged again.
    await client.query(
        `DELETE FROM ride_cancellations rc
          WHERE rc.ride_id = $1
            AND NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.cancellation_id = rc.id)`,
        [rideId]);
    for (const c of cancellations || []) {
        await client.query(
            `INSERT INTO ride_cancellations (ride_id, contact_id, kind, from_series, billed)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (ride_id, contact_id) DO UPDATE
                 SET kind = EXCLUDED.kind, from_series = EXCLUDED.from_series,
                     billed = EXCLUDED.billed`,
            [rideId, c.contact_id, c.kind, c.from_series, !!c.billed]);
    }
}

async function insertRideChildren(client, rideId, participants, guides) {
    for (const p of participants) {
        await client.query(
            `INSERT INTO ride_participants (ride_id, horse_id, alt_horse_id, contact_id, from_recurring, price_cents)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [rideId, p.horse_id, p.alt_horse_id || null, p.contact_id, !!p.from_recurring, p.price_cents]);
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
                if (p.start_date && date < p.start_date) return false;
                if (p.frequency !== 'biweekly') return true;
                const w = weeksBetween(p.biweekly_anchor || t.start_date, date);
                return w >= 0 && w % 2 === 0;
            });
            // The slot is always created, even on a week when nobody is due:
            // the diary keeps the slot and the grid shows who is off (off_riders).
            if (!tParts.length && !tGuides.length) continue;
            const horseIds = [
                ...dueParts.map((p) => p.horse_id),
                ...tGuides.filter((g) => g.mode === 'horse').map((g) => g.horse_id)
            ].filter(Boolean);
            if (horseIds.length) {
                const conflicts = await findConflicts(date, t.start_time, horseIds, null, false, t.eff_duration);
                if (conflicts.length) continue;
            }
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const { rows } = await client.query(
                    `INSERT INTO rides (date, start_time, duration_min, ride_type_id, recurring_id, level, venue, notes, instructor_notes)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                     ON CONFLICT (recurring_id, date) DO NOTHING RETURNING id`,
                    [date, t.start_time, t.duration_min, t.ride_type_id, t.id, t.level, t.venue || 'instructor', t.notes || '', t.instructor_notes || '']);
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
        `SELECT rp.*, h.name AS horse_name, ah.name AS alt_horse_name, c.name AS contact_name,
                c.needs_collection, c.collection_teacher, c.collection_class,
                (il.id IS NOT NULL) AS invoiced,
                il.amount_cents AS invoiced_cents,
                inv.number AS invoice_number,
                EXISTS (SELECT 1 FROM reschedule_credits rc
                         WHERE rc.used_ride_id = rp.ride_id AND rc.contact_id = rp.contact_id) AS credit_used
           FROM ride_participants rp
           JOIN rides r ON r.id = rp.ride_id
           LEFT JOIN horses h ON h.id = rp.horse_id
           LEFT JOIN horses ah ON ah.id = rp.alt_horse_id
           LEFT JOIN contacts c ON c.id = rp.contact_id
           LEFT JOIN invoice_lines il ON il.participant_id = rp.id
           LEFT JOIN invoices inv ON inv.id = il.invoice_id
          WHERE rp.ride_id = ANY($1::bigint[])
          ORDER BY h.sort_order NULLS LAST, h.name, c.name`, [ids]);
    const { rows: rideGuides } = await pool.query(
        `SELECT rg.*, g.name AS guide_name, g.is_assistant, g.color AS guide_color, h.name AS horse_name
           FROM ride_guides rg
           JOIN guides g ON g.id = rg.guide_id
           LEFT JOIN horses h ON h.id = rg.horse_id
          WHERE rg.ride_id = ANY($1::bigint[])
          ORDER BY g.is_assistant, g.name`, [ids]);
    const byId = {};
    rides.forEach((r) => {
        r.participants = []; r.guides = []; r.off_riders = []; r.cancellations = [];
        r.invoiced = false; r.invoiced_riders = [];
        byId[r.id] = r;
    });
    parts.forEach((p) => {
        byId[p.ride_id].participants.push(p);
        if (p.invoiced) {
            byId[p.ride_id].invoiced = true;
            byId[p.ride_id].invoiced_riders.push({ name: p.contact_name, number: p.invoice_number });
        }
    });
    rideGuides.forEach((g) => byId[g.ride_id].guides.push(g));

    // Riders taken off these rides — kept so the day still shows what happened
    const { rows: cancels } = ids.length ? await pool.query(
        `SELECT rc.ride_id, rc.contact_id::text, rc.kind, rc.from_series, rc.billed,
                EXISTS (SELECT 1 FROM invoice_lines il WHERE il.cancellation_id = rc.id) AS invoiced,
                c.name AS contact_name
           FROM ride_cancellations rc JOIN contacts c ON c.id = rc.contact_id
          WHERE rc.ride_id = ANY($1::bigint[])
          ORDER BY c.name`, [ids]) : { rows: [] };
    cancels.forEach((c) => { if (byId[c.ride_id]) byId[c.ride_id].cancellations.push(c); });

    // Riders who belong to the weekly series but aren't riding this week
    // (every-2nd-week riders on their off week, or taken off for the day).
    const tplIds = [...new Set(rides.filter((r) => r.recurring_id).map((r) => r.recurring_id))];
    if (tplIds.length) {
        const { rows: tplParts } = await pool.query(
            `SELECT rp.recurring_id, rp.contact_id, rp.frequency, rp.start_date,
                    c.name AS contact_name, t.end_date AS tpl_end
               FROM recurring_participants rp
               JOIN recurring_rides t ON t.id = rp.recurring_id
               JOIN contacts c ON c.id = rp.contact_id
              WHERE rp.recurring_id = ANY($1::bigint[])`, [tplIds]);
        const byTpl = {};
        tplParts.forEach((p) => { (byTpl[p.recurring_id] = byTpl[p.recurring_id] || []).push(p); });
        rides.forEach((r) => {
            if (!r.recurring_id) return;
            // Riders who ARE on this week still need their cadence reported, or
            // the ride dialog has no way to know and shows everyone as weekly —
            // which then saves back over the real setting.
            const freqBy = {};
            (byTpl[r.recurring_id] || []).forEach((p) => {
                freqBy[String(p.contact_id)] = p.frequency;
            });
            r.participants.forEach((p) => {
                p.frequency = freqBy[String(p.contact_id)] || 'weekly';
            });
            const here = new Set(r.participants.map((p) => String(p.contact_id)));
            // a cancellation is shown explicitly; don't also list them as "off"
            r.cancellations.forEach((c) => here.add(String(c.contact_id)));
            (byTpl[r.recurring_id] || []).forEach((p) => {
                if (here.has(String(p.contact_id))) return;
                if (p.start_date && r.date < p.start_date) return;
                const next = shiftDays(r.date, 7);
                r.off_riders.push({
                    contact_id: p.contact_id,
                    contact_name: p.contact_name,
                    frequency: p.frequency,
                    next_date: (!p.tpl_end || next <= p.tpl_end) ? next : null
                });
            });
        });
    }
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
            parsed.horseIds, null, parsed.allDay,
            parsed.duration_min || await rideDurationMin(parsed.ride_type_id));
        if (conflicts.length) return res.status(400).json({ error: conflicts.join(' ') });
        await client.query('BEGIN');
        const { rows } = await client.query(
            `INSERT INTO rides (date, start_time, duration_min, ride_type_id, is_block, all_day, level, venue, notes, instructor_notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [parsed.date, parsed.start_time, parsed.duration_min, parsed.ride_type_id, parsed.isBlock, parsed.allDay, parsed.level, parsed.venue, parsed.notes, parsed.instructor_notes]);
        await insertRideChildren(client, rows[0].id, parsed.participants, parsed.guides);
        await client.query('COMMIT');
        notifyScheduleChanged(parsed.date);
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
        const parsed = parseRideBody(req.body);
        if (parsed.error) return res.status(400).json({ error: parsed.error });
        // An invoiced ride is no longer frozen — the time, the horses and the
        // other riders often still need fixing after billing. What cannot
        // happen is losing the seat an invoice line points at, so the seats
        // that carry invoice lines are preserved through the save and cannot
        // be removed here; the invoice has to go first.
        const { rows: invoicedSeats } = await pool.query(
            `SELECT rp.id, rp.contact_id::text, c.name AS contact_name, i.number,
                    il.id AS line_id, il.amount_cents
               FROM ride_participants rp
               JOIN invoice_lines il ON il.participant_id = rp.id
               JOIN invoices i ON i.id = il.invoice_id
               LEFT JOIN contacts c ON c.id = rp.contact_id
              WHERE rp.ride_id = $1`, [req.params.id]);
        const billedContacts = new Set(invoicedSeats.map((s) => String(s.contact_id)));
        const submitted = new Set(parsed.participants.map((p) => String(p.contact_id)));
        // An invoiced rider can still come off the day — that is the normal
        // course of a month — but not silently: the save has to say which of
        // the three it is, because each one means something different for the
        // money. Cancelled-and-charged and rescheduled leave the invoice as it
        // stands; cancelled-and-not-charged gives the money back as a discount.
        const cancelledBy = new Map(
            (parsed.cancellations || []).map((c) => [String(c.contact_id), c]));
        const dropped = invoicedSeats.filter((s) => !submitted.has(String(s.contact_id))
            && !cancelledBy.has(String(s.contact_id)));
        if (dropped.length) {
            return res.status(400).json({
                error: `${dropped.map((d) => d.contact_name || 'A rider').join(', ')} `
                    + `${dropped.length === 1 ? 'is' : 'are'} already on invoice `
                    + `${[...new Set(dropped.map((d) => d.number))].join(', ')}. `
                    + 'Delete that invoice before taking them off this ride.' });
        }
        // The ride's own settings describe every seat on it, the billed ones
        // included, so none of them may move while an invoice points here —
        // re-timing or re-typing a lesson someone has already paid for would
        // silently change what they were charged for. The UI disables these,
        // so reaching this is a stale page or a direct call.
        if (invoicedSeats.length) {
            // Only the two the invoice itself is built from: it lists each
            // lesson by date and prices it by ride type. pg hands back a Date
            // for a date column, so both sides are normalised before comparing.
            const day = (v) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
            const frozen = [
                ['date', day(existing[0].date), day(parsed.date)],
                ['ride type', String(existing[0].ride_type_id ?? ''), String(parsed.ride_type_id ?? '')]
            ].filter(([, was, now]) => was !== now).map(([what]) => what);
            if (frozen.length) {
                return res.status(400).json({
                    error: `This ride is on invoice ${[...new Set(invoicedSeats.map((s) => s.number))].join(', ')}, `
                        + `so its ${frozen.join(' and ')} cannot be changed. `
                        + 'Delete that invoice first, or change only the riders who are not on it.' });
            }
        }
        const conflicts = await findConflicts(parsed.date, parsed.start_time,
            parsed.horseIds, req.params.id, parsed.allDay,
            parsed.duration_min || await rideDurationMin(parsed.ride_type_id));
        if (conflicts.length) return res.status(400).json({ error: conflicts.join(' ') });
        await client.query('BEGIN');
        await client.query(
            `UPDATE rides SET date = $2, start_time = $3, duration_min = $4, ride_type_id = $5, is_block = $6, all_day = $7, level = $8, venue = $9, notes = $10, instructor_notes = $11
              WHERE id = $1`,
            [req.params.id, parsed.date, parsed.start_time, parsed.duration_min, parsed.ride_type_id, parsed.isBlock, parsed.allDay, parsed.level, parsed.venue, parsed.notes, parsed.instructor_notes]);
        // Children are replaced wholesale — carry the fixed-lesson provenance
        // over for riders who were already on the ride from the template
        const { rows: prevParts } = await client.query(
            'SELECT contact_id FROM ride_participants WHERE ride_id = $1 AND from_recurring', [req.params.id]);
        const wasRecurring = new Set(prevParts.map((p) => String(p.contact_id)));
        parsed.participants.forEach((p) => {
            if (p.contact_id && wasRecurring.has(String(p.contact_id))) p.from_recurring = true;
        });
        // Cancellations are written first so an invoiced seat that is coming
        // off the ride has something to hand its invoice line to.
        await replaceCancellations(client, req.params.id, parsed.cancellations);
        for (const seat of invoicedSeats) {
            const c = cancelledBy.get(String(seat.contact_id));
            if (!c) continue;
            const { rows: rc } = await client.query(
                'SELECT id FROM ride_cancellations WHERE ride_id = $1 AND contact_id = $2',
                [req.params.id, seat.contact_id]);
            if (!rc[0]) continue;
            // The lesson was invoiced and that invoice stands. Move the line
            // onto the cancellation so the charge keeps its meaning and the
            // seat is free to be deleted below.
            await client.query(
                'UPDATE invoice_lines SET participant_id = NULL, cancellation_id = $2 WHERE id = $1',
                [seat.line_id, rc[0].id]);
            // Cancelled and NOT charged, on a lesson already paid for: the
            // money has to come back, and an issued invoice is not rewritten.
            // It returns as a discount on the next one.
            if (c.kind === 'cancelled' && !c.billed && seat.amount_cents > 0) {
                await client.query(
                    `INSERT INTO contact_charges (contact_id, charge_date, description, amount_cents)
                     VALUES ($1, $2, $3, $4)`,
                    [seat.contact_id, parsed.date,
                     `Refund — cancelled lesson ${fmtDay(parsed.date)} (${invoiceLabel(seat.number)})`,
                     -seat.amount_cents]);
            }
        }
        // Keep the seats an invoice still points at; replace everything else.
        await client.query(
            `DELETE FROM ride_participants rp WHERE rp.ride_id = $1
              AND NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.participant_id = rp.id)`,
            [req.params.id]);
        await client.query('DELETE FROM ride_guides WHERE ride_id = $1', [req.params.id]);
        await insertRideChildren(client, req.params.id,
            parsed.participants.filter((p) => !billedContacts.has(String(p.contact_id))),
            parsed.guides);
        // a preserved seat can still have its horse changed
        for (const seat of invoicedSeats) {
            const p = parsed.participants.find((x) => String(x.contact_id) === String(seat.contact_id));
            if (!p) continue;
            await client.query(
                'UPDATE ride_participants SET horse_id = $2, alt_horse_id = $3 WHERE id = $1',
                [seat.id, p.horse_id || null, p.alt_horse_id || null]);
        }
        // Typing one occurrence of a fixed ride types the whole series: the
        // template (so future weeks inherit it) plus every other occurrence that
        // has no type yet, past ones included. Occurrences with a type already
        // set are deliberate one-offs and are left alone, and invoiced rides are
        // never touched because their amounts are already on an invoice.
        // "Change the whole series": push this ride's setup onto the template so
        // future weeks inherit it, and onto later occurrences that are not
        // invoiced yet. Riders are not touched here — they are handled by
        // /repeat-riders, which the dialog calls separately.
        let seriesRides = 0;
        if (existing[0].recurring_id && (req.body || {}).apply_scope === 'series') {
            await client.query(
                `UPDATE recurring_rides SET start_time = $2, duration_min = $3, ride_type_id = $4,
                        level = $5, venue = $6, instructor_notes = $7
                  WHERE id = $1`,
                [existing[0].recurring_id, parsed.start_time, parsed.duration_min,
                 parsed.ride_type_id, parsed.level, parsed.venue, parsed.instructor_notes]);
            const { rowCount } = await client.query(
                `UPDATE rides r SET start_time = $2, duration_min = $3, ride_type_id = $4,
                        level = $5, venue = $6, instructor_notes = $7
                  WHERE r.recurring_id = $1 AND r.id <> $8 AND r.date > $9
                    AND r.status = 'active' AND NOT r.is_block
                    AND NOT EXISTS (SELECT 1 FROM ride_participants rp
                                     JOIN invoice_lines il ON il.participant_id = rp.id
                                    WHERE rp.ride_id = r.id)`,
                [existing[0].recurring_id, parsed.start_time, parsed.duration_min,
                 parsed.ride_type_id, parsed.level, parsed.venue, parsed.instructor_notes,
                 req.params.id, parsed.date]);
            seriesRides = rowCount;
            // Instructors travel with the series too. They used to be left out
            // of this block entirely, so changing who teaches a fixed lesson
            // silently applied to that one day — the template kept the old
            // instructor and every later week was built from it.
            await client.query('DELETE FROM recurring_guides WHERE recurring_id = $1',
                [existing[0].recurring_id]);
            for (const g of parsed.guides) {
                await client.query(
                    `INSERT INTO recurring_guides (recurring_id, guide_id, mode, horse_id)
                     VALUES ($1, $2, $3, $4)`,
                    [existing[0].recurring_id, g.guide_id, g.mode,
                     g.mode === 'horse' ? g.horse_id : null]);
            }
            // and onto the weeks already created, same exclusions as above
            const { rows: later } = await client.query(
                `SELECT r.id FROM rides r
                  WHERE r.recurring_id = $1 AND r.id <> $2 AND r.date > $3
                    AND r.status = 'active' AND NOT r.is_block
                    AND NOT EXISTS (SELECT 1 FROM ride_participants rp
                                     JOIN invoice_lines il ON il.participant_id = rp.id
                                    WHERE rp.ride_id = r.id)`,
                [existing[0].recurring_id, req.params.id, parsed.date]);
            for (const l of later) {
                await client.query('DELETE FROM ride_guides WHERE ride_id = $1', [l.id]);
                for (const g of parsed.guides) {
                    await client.query(
                        `INSERT INTO ride_guides (ride_id, guide_id, mode, horse_id)
                         VALUES ($1, $2, $3, $4)`,
                        [l.id, g.guide_id, g.mode, g.mode === 'horse' ? g.horse_id : null]);
                }
            }
        }
        let typedSiblings = 0;
        if (existing[0].recurring_id && parsed.ride_type_id) {
            await client.query(
                'UPDATE recurring_rides SET ride_type_id = $2 WHERE id = $1 AND ride_type_id IS NULL',
                [existing[0].recurring_id, parsed.ride_type_id]);
            const { rowCount } = await client.query(
                `UPDATE rides r SET ride_type_id = $2
                  WHERE r.recurring_id = $1 AND r.id <> $3
                    AND r.ride_type_id IS NULL AND r.ride_type_name IS NULL
                    AND r.status = 'active' AND NOT r.is_block
                    AND NOT EXISTS (SELECT 1 FROM ride_participants rp
                                     JOIN invoice_lines il ON il.participant_id = rp.id
                                    WHERE rp.ride_id = r.id)`,
                [existing[0].recurring_id, parsed.ride_type_id, req.params.id]);
            typedSiblings = rowCount;
        }
        await client.query('COMMIT');
        notifyScheduleChanged(parsed.date);
        res.json({ ok: true, typed_siblings: typedSiblings, series_rides: seriesRides });
    } catch (err) {
        await client.query('ROLLBACK');
        handleError(res, err, 'Updating ride');
    } finally {
        client.release();
    }
});

// Turn a one-off ride into a weekly fixed ride, copying its riders,
// instructors, time, duration, level and type. The ride itself becomes the
// series' first occurrence.
app.post('/api/rides/:id/repeat', requireRole('helper'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { rows } = await pool.query('SELECT * FROM rides WHERE id = $1', [req.params.id]);
        const ride = rows[0];
        if (!ride) return res.status(404).json({ error: 'Ride not found.' });
        if (ride.recurring_id) return res.status(400).json({ error: 'This ride already repeats weekly.' });
        if (ride.is_block) return res.status(400).json({ error: 'Blocks cannot repeat.' });
        const { rows: parts } = await pool.query(
            'SELECT contact_id, horse_id FROM ride_participants WHERE ride_id = $1', [req.params.id]);
        const { rows: guides } = await pool.query(
            'SELECT guide_id, mode, horse_id FROM ride_guides WHERE ride_id = $1', [req.params.id]);
        const endDate = DATE_RE.test((req.body || {}).end_date || '') ? req.body.end_date : null;

        await client.query('BEGIN');
        const { rows: tpl } = await client.query(
            `INSERT INTO recurring_rides (weekday, start_time, duration_min, ride_type_id, level, venue,
                                          start_date, end_date, notes, instructor_notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [isoWeekday(ride.date), ride.start_time, ride.duration_min, ride.ride_type_id,
             ride.level, ride.venue, ride.date, endDate, ride.notes || '', ride.instructor_notes || '']);
        // Horses are usually assigned per day, so the template carries riders only
        const freq = {};
        (Array.isArray((req.body || {}).participants) ? req.body.participants : []).forEach((p) => {
            if (p && p.contact_id) freq[String(p.contact_id)] = p.frequency === 'biweekly' ? 'biweekly' : 'weekly';
        });
        await insertRecurringChildren(client, tpl[0].id,
            parts.filter((p) => p.contact_id).map((p) => ({
                contact_id: p.contact_id,
                horse_id: null,
                frequency: freq[String(p.contact_id)] || 'weekly',
                biweekly_anchor: freq[String(p.contact_id)] === 'biweekly' ? ride.date : null
            })),
            guides.map((g) => ({ guide_id: g.guide_id, mode: g.mode, horse_id: null })));
        await client.query('UPDATE rides SET recurring_id = $2 WHERE id = $1',
            [req.params.id, tpl[0].id]);
        await client.query('COMMIT');
        res.json({ recurring_id: tpl[0].id });
    } catch (err) {
        await client.query('ROLLBACK');
        handleError(res, err, 'Making the ride repeat');
    } finally {
        client.release();
    }
});

// Keep the series' rider list in step with an occurrence: adds riders that
// were added on the day, and updates how often each one rides.
// Changing a rider's cadence has to reach the weeks that were ALREADY created.
// Materialisation only ever fills gaps — it skips any date that has a ride row —
// so without this the rider stays on every week until something else rebuilds
// the series, which is what made "every 2nd week" look like it did nothing.
//
// Seats are adjusted in place rather than deleting and re-creating the future
// occurrences: those rides may carry horse assignments, instructors and ad-hoc
// riders that have nothing to do with this change. Only seats the series itself
// put there are removed, and never an invoiced one.
async function syncSeriesCadence(client, recurringId) {
    const { rows: tpl } = await client.query(
        'SELECT start_date::text AS start_date FROM recurring_rides WHERE id = $1', [recurringId]);
    if (!tpl[0]) return;
    const { rows: parts } = await client.query(
        `SELECT contact_id, frequency, biweekly_anchor::text AS biweekly_anchor,
                start_date::text AS start_date
           FROM recurring_participants
          WHERE recurring_id = $1 AND contact_id IS NOT NULL`, [recurringId]);
    const { rows: rides } = await client.query(
        `SELECT id, date::text AS date FROM rides
          WHERE recurring_id = $1 AND date >= CURRENT_DATE AND status = 'active'`, [recurringId]);
    for (const r of rides) {
        for (const p of parts) {
            const due = (!p.start_date || r.date >= p.start_date) &&
                (p.frequency !== 'biweekly' ||
                 (() => {
                     const w = weeksBetween(p.biweekly_anchor || tpl[0].start_date, r.date);
                     return w >= 0 && w % 2 === 0;
                 })());
            if (due) {
                // Taking a rider off a single week is a decision about that
                // day, and the series must not quietly overrule it: without
                // this the seat comes straight back, leaving the rider on the
                // ride AND struck off it at the same time.
                await client.query(
                    `INSERT INTO ride_participants (ride_id, contact_id, from_recurring)
                     SELECT $1, $2, true
                      WHERE NOT EXISTS (SELECT 1 FROM ride_cancellations rc
                                         WHERE rc.ride_id = $1 AND rc.contact_id = $2)
                     ON CONFLICT (ride_id, contact_id) DO NOTHING`, [r.id, p.contact_id]);
            } else {
                await client.query(
                    `DELETE FROM ride_participants rp
                      WHERE rp.ride_id = $1 AND rp.contact_id = $2 AND rp.from_recurring
                        AND NOT EXISTS (SELECT 1 FROM invoice_lines il
                                         WHERE il.participant_id = rp.id)`,
                    [r.id, p.contact_id]);
            }
        }
    }
}

app.put('/api/rides/:id/repeat-riders', requireRole('helper'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { rows } = await pool.query('SELECT * FROM rides WHERE id = $1', [req.params.id]);
        const ride = rows[0];
        if (!ride) return res.status(404).json({ error: 'Ride not found.' });
        if (!ride.recurring_id) return res.status(400).json({ error: 'This ride does not repeat.' });
        const wanted = (Array.isArray((req.body || {}).participants) ? req.body.participants : [])
            .filter((p) => p && p.contact_id);
        await client.query('BEGIN');
        for (const p of wanted) {
            const frequency = p.frequency === 'biweekly' ? 'biweekly' : 'weekly';
            const { rowCount } = await client.query(
                `UPDATE recurring_participants
                    SET frequency = $3,
                        biweekly_anchor = CASE WHEN $3 = 'biweekly'
                            THEN COALESCE(biweekly_anchor, $4::date) ELSE NULL END
                  WHERE recurring_id = $1 AND contact_id = $2`,
                [ride.recurring_id, p.contact_id, frequency, ride.date]);
            if (!rowCount) {
                await client.query(
                    `INSERT INTO recurring_participants (recurring_id, contact_id, frequency, biweekly_anchor, start_date)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [ride.recurring_id, p.contact_id, frequency,
                     frequency === 'biweekly' ? ride.date : null, ride.date]);
            }
        }
        await syncSeriesCadence(client, ride.recurring_id);
        await client.query('COMMIT');
        res.json({ ok: true });
    } catch (err) {
        await client.query('ROLLBACK');
        handleError(res, err, 'Updating the repeat');
    } finally {
        client.release();
    }
});

// Take a rider off the weekly series entirely, from this date onwards.
// Their seat on past rides (and any invoiced ride) is left untouched.
app.delete('/api/rides/:id/repeat-riders/:contactId', requireRole('helper'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { rows } = await pool.query('SELECT * FROM rides WHERE id = $1', [req.params.id]);
        const ride = rows[0];
        if (!ride) return res.status(404).json({ error: 'Ride not found.' });
        if (!ride.recurring_id) return res.status(400).json({ error: 'This ride does not repeat.' });
        await client.query('BEGIN');
        await client.query(
            'DELETE FROM recurring_participants WHERE recurring_id = $1 AND contact_id = $2',
            [ride.recurring_id, req.params.contactId]);
        // drop their seat from later, not-yet-invoiced occurrences
        await client.query(
            `DELETE FROM ride_participants rp
              USING rides r
              WHERE rp.ride_id = r.id AND r.recurring_id = $1 AND r.date > $2
                AND rp.contact_id = $3
                AND NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.participant_id = rp.id)`,
            [ride.recurring_id, ride.date, req.params.contactId]);
        // tidy up occurrences that are now completely empty
        await client.query(
            `DELETE FROM rides r
              WHERE r.recurring_id = $1 AND r.date > $2
                AND NOT EXISTS (SELECT 1 FROM ride_participants rp WHERE rp.ride_id = r.id)
                AND NOT EXISTS (SELECT 1 FROM ride_guides rg WHERE rg.ride_id = r.id)`,
            [ride.recurring_id, ride.date]);
        await client.query('COMMIT');
        res.json({ ok: true });
    } catch (err) {
        await client.query('ROLLBACK');
        handleError(res, err, 'Removing the rider from the series');
    } finally {
        client.release();
    }
});

// Stop a series from this date on: the occurrence stays as a one-off ride,
// later occurrences go, and the template ends the day before.
app.post('/api/rides/:id/stop-repeat', requireRole('helper'), async (req, res) => {
    const client = await pool.connect();
    try {
        const { rows } = await pool.query('SELECT * FROM rides WHERE id = $1', [req.params.id]);
        const ride = rows[0];
        if (!ride) return res.status(404).json({ error: 'Ride not found.' });
        if (!ride.recurring_id) return res.status(400).json({ error: 'This ride does not repeat.' });
        await client.query('BEGIN');
        await client.query(
            `DELETE FROM rides r
              WHERE r.recurring_id = $1 AND r.date > $2 AND r.status = 'active'
                AND NOT EXISTS (SELECT 1 FROM ride_participants rp
                                JOIN invoice_lines il ON il.participant_id = rp.id
                               WHERE rp.ride_id = r.id)`,
            [ride.recurring_id, ride.date]);
        await client.query('UPDATE recurring_rides SET end_date = $2::date - 1 WHERE id = $1',
            [ride.recurring_id, ride.date]);
        await client.query('UPDATE rides SET recurring_id = NULL WHERE id = $1', [req.params.id]);
        await client.query('COMMIT');
        res.json({ ok: true });
    } catch (err) {
        await client.query('ROLLBACK');
        handleError(res, err, 'Stopping the repeat');
    } finally {
        client.release();
    }
});

// scope: 'one' (default) | 'future' | 'all'. Invoiced rides are never removed.
app.delete('/api/rides/:id', requireAuth, async (req, res) => {
    const client = await pool.connect();
    try {
        const scope = ['one', 'future', 'all'].includes(req.query.scope) ? req.query.scope : 'one';
        const { rows: existing } = await pool.query(
            `SELECT r.*, EXISTS (SELECT 1 FROM ride_participants rp
                                 JOIN invoice_lines il ON il.participant_id = rp.id
                                WHERE rp.ride_id = r.id) AS invoiced
               FROM rides r WHERE r.id = $1`, [req.params.id]);
        const ride = existing[0];
        if (!ride) return res.status(404).json({ error: 'Ride not found.' });
        if (scope === 'one' && ride.invoiced) {
            return res.status(400).json({ error: 'This ride is already invoiced and cannot be deleted.' });
        }
        if (scope !== 'one' && !ride.recurring_id) {
            return res.status(400).json({ error: 'This ride does not repeat.' });
        }

        await client.query('BEGIN');
        if (scope === 'one') {
            if (ride.recurring_id) {
                // tombstone so re-materialization doesn't bring it back
                await client.query(`UPDATE rides SET status = 'cancelled' WHERE id = $1`, [req.params.id]);
                await client.query('DELETE FROM ride_participants WHERE ride_id = $1', [req.params.id]);
                await client.query('DELETE FROM ride_guides WHERE ride_id = $1', [req.params.id]);
            } else {
                await client.query('DELETE FROM rides WHERE id = $1', [req.params.id]);
            }
        } else {
            const dateClause = scope === 'future' ? 'AND r.date >= $2' : '';
            const params = scope === 'future' ? [ride.recurring_id, ride.date] : [ride.recurring_id];
            await client.query(
                `DELETE FROM rides r
                  WHERE r.recurring_id = $1 ${dateClause}
                    AND NOT EXISTS (SELECT 1 FROM ride_participants rp
                                    JOIN invoice_lines il ON il.participant_id = rp.id
                                   WHERE rp.ride_id = r.id)`, params);
            if (scope === 'future') {
                // keep the series' history, just end it before this date
                await client.query('UPDATE recurring_rides SET end_date = $2::date - 1 WHERE id = $1',
                    [ride.recurring_id, ride.date]);
            } else {
                await client.query('DELETE FROM recurring_rides WHERE id = $1', [ride.recurring_id]);
            }
        }
        await client.query('COMMIT');
        notifyScheduleChanged(ride.date);
        res.json({ ok: true });
    } catch (err) {
        await client.query('ROLLBACK');
        handleError(res, err, 'Deleting ride');
    } finally {
        client.release();
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

// Drop one unused credit for a contact — a credit raised in error would
// otherwise sit in the calendar bar for ever with no way to clear it.
app.delete('/api/credits/:contactId', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `DELETE FROM reschedule_credits
              WHERE id = (SELECT id FROM reschedule_credits
                           WHERE contact_id = $1 AND used_ride_id IS NULL
                           ORDER BY created_at LIMIT 1)
             RETURNING id`, [req.params.contactId]);
        if (!rows[0]) return res.status(404).json({ error: 'No open credit for that rider.' });
        res.json({ ok: true });
    } catch (err) {
        handleError(res, err, 'Removing reschedule credit');
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
// Ride types broken down by day: how many ride slots ran, how many rider seats
// were filled and what they were worth. The UI rolls this up per type and can
// drill into a single date.
app.get('/api/reports/ride-types', requireAuth, async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '') || from > to) {
            return res.status(400).json({ error: 'Valid from/to dates are required.' });
        }
        const days = datesInRange(from, to).length;
        if (days > 366) return res.status(400).json({ error: 'Period too large (max 1 year).' });
        if (days <= 92) await materializeRecurring(from, to);
        // Seats are counted per ride first — folding the participant join into the
        // outer group would multiply each ride's duration by its seat count.
        const { rows } = await pool.query(
            `WITH ride_rows AS (
                 SELECT r.id, r.date,
                        COALESCE(rt.name, r.ride_type_name, '(no type)') AS tname,
                        COALESCE(r.duration_min, rt.duration_min, 60) AS mins,
                        rt.price_cents AS type_price
                   FROM rides r
                   LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
                  WHERE r.date BETWEEN $1 AND $2
                    AND r.status = 'active' AND NOT r.is_block
             ), seat_rows AS (
                 SELECT rr.id, count(rp.id)::int AS seats,
                        COALESCE(SUM(COALESCE(rp.price_cents, rr.type_price, 0)), 0)::int AS cents
                   FROM ride_rows rr
                   LEFT JOIN ride_participants rp
                          ON rp.ride_id = rr.id AND rp.contact_id IS NOT NULL
                  GROUP BY rr.id
             )
             SELECT rr.date::text AS date, rr.tname AS ride_type_name,
                    count(*)::int AS rides,
                    SUM(s.seats)::int AS seats,
                    SUM(s.cents)::int AS cents,
                    SUM(rr.mins)::int AS mins
               FROM ride_rows rr
               JOIN seat_rows s ON s.id = rr.id
              GROUP BY rr.date, rr.tname
              ORDER BY rr.date, 2`,
            [from, to]);
        res.json({ rows, from, to });
    } catch (err) {
        handleError(res, err, 'Loading report');
    }
});

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
const NOT_PASS_COVERED_SQL = `TRUE`;   // term passes were removed; nothing is pre-covered

// Is this ride inside one of the rider's school terms? A rider inherits their
// payer's school when they have none of their own. With no term dates on record
// the answer is false — i.e. treated as holiday — so an unknown period is billed
// after the fact rather than charged in advance for lessons that may not happen.
// Requires aliases r (rides), rider and payer (contacts).
const IN_TERM_SQL = `EXISTS (
    SELECT 1 FROM school_terms st
     WHERE st.school_id = payer.school_id
       AND r.date BETWEEN st.period_start AND st.period_end)`;

// How far back an advance invoice reaches for lessons that were ridden but
// never billed — holiday lessons and ad-hoc ones. Exactly one calendar month:
// October's invoice carries September's leftovers and nothing older. Without
// the cap a single missed run would drag months of old lessons onto one
// invoice, which is not something a parent can check against their diary.
//
// Anything older than the cap is not lost, only out of scope for the automatic
// runs: it is counted as `older_unbilled` and shown as a warning so it can be
// billed deliberately with a custom date range.
const CARRY_BACK = `INTERVAL '1 month'`;

// A lesson that was taken off the day is still owed for in two of the three
// cases: a late cancellation marked as still chargeable, and a reschedule —
// where the credit the rider gets is paid for by the day they missed. The
// third (off the schedule, not charged) stays unbilled.
const BILLABLE_CANCELLATION_SQL = "(rc.billed OR rc.kind = 'rescheduled')";

// The other half of the reschedule rule: the seat the credit was spent on is
// free, because the missed day carried the charge. Requires aliases r (rides)
// and rp (ride_participants).
const NOT_MAKEUP_SQL = `NOT EXISTS (
    SELECT 1 FROM reschedule_credits rc2
     WHERE rc2.used_ride_id = r.id AND rc2.contact_id = rp.contact_id)`;

// Every overview counts seats to preview an invoice, so each one has to count
// the billable cancellations too — otherwise the preview and the invoice it
// creates disagree. This is the same shape as a seats row, keyed on the
// cancellation rather than the seat. A rescheduled day keeps the rider's plain
// name so it merges with the days they rode; a late cancellation is marked,
// because that is a lesson nobody rode and the parent will ask about it.
//   cols  — extra leading columns the sibling branch selects after id
//   extra — extra trailing columns
//   where — the branch's own filters, as ' AND ...'
function cancelledSeatsSQL({ cols = '', extra = '', where = '' } = {}) {
    return `SELECT rc.id${cols ? ', ' + cols : ''},
                   rider.name || CASE WHEN rc.kind = 'cancelled'
                                       THEN ' (cancelled late)' ELSE '' END AS rider_name,
                   COALESCE(rider.parent_id, rider.id) AS payer_id,
                   r.date, r.ride_type_id, r.ride_type_name,
                   COALESCE(rt.price_cents, 0) AS cents${extra}
              FROM ride_cancellations rc
              JOIN rides r ON r.id = rc.ride_id AND r.status = 'active' AND NOT r.is_block
              JOIN contacts rider ON rider.id = rc.contact_id AND NOT rider.archived
              JOIN contacts payer ON payer.id = COALESCE(rider.parent_id, rider.id)
              LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
             WHERE ${BILLABLE_CANCELLATION_SQL}
               AND NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.cancellation_id = rc.id)
               ${where}`;
}

// Heading for everything on an invoice that is neither a lesson nor a horse's
// livery: one-off expenses, discounts, arena fees, standing monthly charges.
const EXTRAS_SECTION = 'Additional costs';

// A customer can be billable without riding at all — livery, or a standing
// monthly charge. They have no seats, so every overview built on seats alone
// misses them entirely and there is no way to reach a Create invoice button.
// Requires the alias payer.
const HAS_STANDING_SQL = `(
    EXISTS (SELECT 1 FROM horses h
             WHERE h.owner_contact_id = payer.id AND h.livery_share IS NOT NULL)
    OR EXISTS (SELECT 1 FROM contact_monthly_charges mc WHERE mc.contact_id = payer.id))`;

// The previous calendar month relative to a date — the window an advance
// invoice reaches back over. Written once so the term run and the monthly run
// cannot drift apart on what "last month" means.
const PREV_MONTH_SQL = (d) => `(r.date >= date_trunc('month', ${d}::date) - INTERVAL '1 month'
                                AND r.date < date_trunc('month', ${d}::date))`;

// Does one of this payer's school terms START inside the invoice month? In
// those months the per-term customer gets a single combined invoice (term
// ahead + last month's leftovers) rather than two, so the monthly run leaves
// them alone. Requires the alias payer.
const TERM_STARTS_SQL = `EXISTS (
    SELECT 1 FROM school_terms st
     WHERE st.school_id = payer.school_id
       AND st.period_start BETWEEN $1 AND $2)`;

// Per-contact summary of booked, not-yet-invoiced rides in a month
// Which advance months still owe invoices? An advance run is only "done" when
// every rider on that arrangement has been invoiced for the period, so the page
// can surface August even though we are already halfway through it.
app.get('/api/invoices/advance-outstanding', requireRole('helper'), async (req, res) => {
    try {
        const terms = req.query.terms === 'advance_term' ? 'advance_term' : 'advance_monthly';
        const base = new Date();
        const months = [];
        for (let i = -1; i <= 2; i++) {
            const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
            months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
        const out = [];
        for (const month of months) {
            const [from, to] = monthRange(month);
            await materializeRecurring(from, to);
            const { rows } = await pool.query(
                `SELECT count(DISTINCT rider_id)::int AS riders,
                        COALESCE(SUM(cents), 0)::int AS total_cents
                   FROM (
                     SELECT rider.id AS rider_id,
                            COALESCE(rp.price_cents, rt.price_cents, 0) AS cents
                       FROM ride_participants rp
                       JOIN rides r ON r.id = rp.ride_id AND r.status = 'active' AND NOT r.is_block
                       JOIN contacts rider ON rider.id = rp.contact_id
                       JOIN contacts payer ON payer.id = COALESCE(rider.parent_id, rider.id)
                       LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
                      WHERE r.date BETWEEN $1 AND $2
                        AND payer.payment_terms = $3
                        AND NOT rider.archived
                        AND NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.participant_id = rp.id)
                        AND ${NOT_MAKEUP_SQL}
                        AND ${NOT_PASS_COVERED_SQL}
                     UNION ALL
                     -- the days that were missed but are still owed for
                     SELECT rider.id, COALESCE(rt.price_cents, 0)
                       FROM ride_cancellations rc
                       JOIN rides r ON r.id = rc.ride_id AND r.status = 'active' AND NOT r.is_block
                       JOIN contacts rider ON rider.id = rc.contact_id AND NOT rider.archived
                       JOIN contacts payer ON payer.id = COALESCE(rider.parent_id, rider.id)
                       LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
                      WHERE ${BILLABLE_CANCELLATION_SQL}
                        AND r.date BETWEEN $1 AND $2
                        AND payer.payment_terms = $3
                        AND NOT EXISTS (SELECT 1 FROM invoice_lines il
                                         WHERE il.cancellation_id = rc.id)
                   ) q`,
                [from, to, terms]);
            out.push({ month, riders: rows[0].riders, total_cents: rows[0].total_cents });
        }
        // The invoices page offers a month picker; there is no point offering
        // months from before the school has any rides at all.
        const { rows: firstRow } = await pool.query(
            "SELECT min(date)::text AS first FROM rides WHERE status = 'active'");
        res.json({ months: out, first_ride_date: (firstRow[0] || {}).first || null });
    } catch (err) {
        handleError(res, err, 'Loading advance status');
    }
});

// Per-term billing, grouped by school: each school's own term dates decide the
// period, so one "Term 3 2026" run bills three different date ranges correctly.
app.get('/api/invoices/term-overview', requireRole('helper'), async (req, res) => {
    try {
        const year = Number(req.query.year), term = Number(req.query.term);
        if (!Number.isInteger(year) || year < 2000 || year > 2100 ||
            !Number.isInteger(term) || term < 1 || term > 4) {
            return res.status(400).json({ error: 'A valid year and term (1–4) are required.' });
        }
        const { rows: schools } = await pool.query(
            `SELECT s.id, s.name, s.year_start_month,
                    t.period_start::text AS period_start, t.period_end::text AS period_end
               FROM schools s
               LEFT JOIN school_terms t
                      ON t.school_id = s.id AND t.year = $1 AND t.term_no = $2
              WHERE s.active ORDER BY s.sort_order, s.name`,
            [year, term]);

        const groups = [];
        for (const s of schools) {
            if (!s.period_start) {
                groups.push({ ...s, no_dates: true, rows: [] });
                continue;
            }
            await materializeRecurring(s.period_start, s.period_end);
            const { rows } = await pool.query(
                `WITH seats AS (
                     SELECT rp.id, rider.name AS rider_name,
                            COALESCE(rider.parent_id, rider.id) AS payer_id,
                            r.date, r.ride_type_id, r.ride_type_name,
                            COALESCE(rp.price_cents, rt.price_cents, 0) AS cents
                       FROM ride_participants rp
                       JOIN rides r ON r.id = rp.ride_id AND r.status = 'active' AND NOT r.is_block
                       JOIN contacts rider ON rider.id = rp.contact_id AND NOT rider.archived
                       JOIN contacts p2 ON p2.id = COALESCE(rider.parent_id, rider.id)
                       LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
                      WHERE (r.date BETWEEN $1 AND $2 OR ${PREV_MONTH_SQL('$1')})
                        AND p2.school_id = $3
                        AND p2.payment_terms = 'advance_term'
                        AND NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.participant_id = rp.id)
                        AND ${NOT_MAKEUP_SQL}
                     UNION ALL
                     ${cancelledSeatsSQL({ where: `
                        AND (r.date BETWEEN $1 AND $2 OR ${PREV_MONTH_SQL('$1')})
                        AND payer.school_id = $3
                        AND payer.payment_terms = 'advance_term'` })}
                 )
                 SELECT payer.id AS contact_id, payer.name, payer.name AS payer_name,
                        payer.payment_terms,
                        count(*)::int AS ride_count,
                        SUM(s.cents)::int AS total_cents,
                        count(*) FILTER (WHERE s.ride_type_id IS NULL
                                           AND s.ride_type_name IS NULL)::int AS untyped_rides,
                        (SELECT json_agg(x ORDER BY x->>'name')
                           FROM (SELECT json_build_object(
                                        'name', s2.rider_name,
                                        'count', count(*),
                                        'dates', json_agg(s2.date::text ORDER BY s2.date)) AS x
                                   FROM seats s2 WHERE s2.payer_id = payer.id
                                  GROUP BY s2.rider_name) q) AS riders
                   FROM seats s
                   JOIN contacts payer ON payer.id = s.payer_id
                  GROUP BY payer.id, payer.name, payer.payment_terms
                  ORDER BY payer.name`,
                [s.period_start, s.period_end, s.id]);
            groups.push({ ...s, no_dates: false, rows });
        }

        // Per-term riders with no school cannot be placed in any term at all
        const { rows: noSchool } = await pool.query(
            `SELECT rider.id AS contact_id, rider.name, payer.name AS payer_name
               FROM contacts rider
               JOIN contacts payer ON payer.id = COALESCE(rider.parent_id, rider.id)
              WHERE NOT rider.archived AND rider.is_rider
                AND payer.payment_terms = 'advance_term'
                AND payer.school_id IS NULL
              ORDER BY rider.name`);
        res.json({ year, term, groups, no_school: noSchool });
    } catch (err) {
        handleError(res, err, 'Loading term overview');
    }
});

// The month-ahead run. Two different things go on one invoice:
//   * the coming month's TERM lessons, which follow the fixed schedule and can
//     safely be billed before they happen; and
//   * everything still unbilled from before it — holiday and ad-hoc lessons,
//     which are only knowable once they have been ridden.
// Holiday lessons in the coming month are deliberately NOT billed now; they
// land on next month's invoice once it is known who actually rode.
// Cash after the lesson is not a monthly run: the rider pays on the day, so
// these accumulate until someone settles them. No month bound — everything
// ridden and not yet invoiced shows here, however long ago.
app.get('/api/invoices/cash-overview', requireRole('helper'), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `WITH seats AS (
                 SELECT rp.id, rider.name AS rider_name,
                        COALESCE(rider.parent_id, rider.id) AS payer_id,
                        r.date, r.ride_type_id, r.ride_type_name,
                        COALESCE(rp.price_cents, rt.price_cents, 0) AS cents
                   FROM ride_participants rp
                   JOIN rides r ON r.id = rp.ride_id AND r.status = 'active' AND NOT r.is_block
                   JOIN contacts rider ON rider.id = rp.contact_id AND NOT rider.archived
                   JOIN contacts payer ON payer.id = COALESCE(rider.parent_id, rider.id)
                   LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
                  WHERE payer.payment_terms = 'cash_after'
                    AND r.date <= CURRENT_DATE
                    AND NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.participant_id = rp.id)
                    AND ${NOT_MAKEUP_SQL}
                 UNION ALL
                 ${cancelledSeatsSQL({ where: `
                    AND payer.payment_terms = 'cash_after'
                    AND r.date <= CURRENT_DATE` })}
             )
             SELECT payer.id AS contact_id, payer.name, payer.name AS payer_name,
                    payer.payment_terms,
                    count(*)::int AS ride_count,
                    SUM(s.cents)::int AS total_cents,
                    min(s.date)::text AS first_date, max(s.date)::text AS last_date,
                    count(*) FILTER (WHERE s.ride_type_id IS NULL
                                       AND s.ride_type_name IS NULL)::int AS untyped_rides,
                    (SELECT json_agg(x ORDER BY x->>'name')
                       FROM (SELECT json_build_object(
                                    'name', s2.rider_name, 'count', count(*),
                                    'dates', json_agg(s2.date::text ORDER BY s2.date)) AS x
                               FROM seats s2 WHERE s2.payer_id = payer.id
                              GROUP BY s2.rider_name) q) AS riders
               FROM seats s JOIN contacts payer ON payer.id = s.payer_id
              GROUP BY payer.id, payer.name, payer.payment_terms
              ORDER BY payer.name`);
        res.json({ cash: rows });
    } catch (err) {
        handleError(res, err, 'Loading cash lessons');
    }
});

app.get('/api/invoices/advance-overview', requireRole('helper'), async (req, res) => {
    try {
        const month = String(req.query.month || '');
        if (!/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ error: 'A valid month (YYYY-MM) is required.' });
        }
        const [from, to] = monthRange(month);
        await materializeRecurring(from, to);
        const { rows } = await pool.query(
            `WITH seats AS (
                 SELECT rp.id, rider.name AS rider_name,
                        COALESCE(rider.parent_id, rider.id) AS payer_id,
                        r.date, r.ride_type_id, r.ride_type_name,
                        COALESCE(rp.price_cents, rt.price_cents, 0) AS cents,
                        (r.date BETWEEN $1 AND $2) AS in_month,
                        (r.date >= $1::date - ${CARRY_BACK}) AS in_reach,
                        payer.payment_terms AS terms,
                        -- a per-term payer whose term starts this month is
                        -- invoiced once, by the term run, leftovers included
                        (payer.payment_terms = 'advance_term' AND ${TERM_STARTS_SQL}) AS term_month,
                        ${IN_TERM_SQL} AS in_term
                   FROM ride_participants rp
                   JOIN rides r ON r.id = rp.ride_id AND r.status = 'active' AND NOT r.is_block
                   JOIN contacts rider ON rider.id = rp.contact_id AND NOT rider.archived
                   JOIN contacts payer ON payer.id = COALESCE(rider.parent_id, rider.id)
                   LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
                  WHERE r.date <= $2
                    AND payer.payment_terms IN ('advance_monthly', 'advance_term')
                    AND NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.participant_id = rp.id)
                    AND ${NOT_MAKEUP_SQL}
                 UNION ALL
                 ${cancelledSeatsSQL({
                     extra: `,
                        (r.date BETWEEN $1 AND $2) AS in_month,
                        (r.date >= $1::date - ${CARRY_BACK}) AS in_reach,
                        payer.payment_terms AS terms,
                        (payer.payment_terms = 'advance_term' AND ${TERM_STARTS_SQL}) AS term_month,
                        ${IN_TERM_SQL} AS in_term`,
                     where: `
                        AND r.date <= $2
                        AND payer.payment_terms IN ('advance_monthly', 'advance_term')` })}
             ), billable AS (
                 -- Everyone on advance billing gets last month's leftovers here:
                 -- the lessons the advance invoice could not have known about,
                 -- ridden in the holidays or booked ad hoc.
                 --
                 -- Monthly payers additionally get the coming month's term
                 -- lessons. Per-term payers do not: those are on their term
                 -- invoice already, so for them this is the leftovers alone.
                 SELECT * FROM seats
                  WHERE NOT term_month
                    AND ((NOT in_month AND in_reach)
                         OR (in_month AND in_term AND terms = 'advance_monthly'))
             )
             SELECT payer.id AS contact_id, payer.name, payer.name AS payer_name,
                    payer.payment_terms,
                    count(*)::int AS ride_count,
                    SUM(b.cents)::int AS total_cents,
                    count(*) FILTER (WHERE b.in_month)::int AS term_ahead,
                    count(*) FILTER (WHERE NOT b.in_month)::int AS carried_over,
                    (SELECT count(*)::int FROM seats s
                      WHERE s.payer_id = payer.id AND NOT s.in_reach) AS older_unbilled,
                    (SELECT min(s.date)::text FROM seats s
                      WHERE s.payer_id = payer.id AND NOT s.in_reach) AS older_from,
                    (SELECT json_agg(x ORDER BY x->>'month')
                       FROM (SELECT json_build_object('month', to_char(o.date, 'YYYY-MM'),
                                                      'count', count(*)) AS x
                               FROM seats o
                              WHERE o.payer_id = payer.id AND NOT o.in_reach
                              GROUP BY to_char(o.date, 'YYYY-MM')) q) AS older_months,
                    count(*) FILTER (WHERE b.ride_type_id IS NULL
                                       AND b.ride_type_name IS NULL)::int AS untyped_rides,
                    (SELECT json_agg(x ORDER BY x->>'name')
                       FROM (SELECT json_build_object(
                                    'name', b2.rider_name,
                                    'count', count(*),
                                    'dates', json_agg(b2.date::text ORDER BY b2.date)) AS x
                               FROM billable b2 WHERE b2.payer_id = payer.id
                              GROUP BY b2.rider_name) q) AS riders
               FROM billable b
               JOIN contacts payer ON payer.id = b.payer_id
              GROUP BY payer.id, payer.name, payer.payment_terms
             UNION ALL
             -- payers whose ONLY unbilled lessons are older than the cap: they
             -- get no invoice this run but must still be visible
             -- column order must match the branch above exactly:
             -- ride_count, total_cents, term_ahead, carried_over,
             -- older_unbilled, older_from, older_months, untyped_rides, riders
             SELECT payer.id, payer.name, payer.name, payer.payment_terms,
                    0, 0, 0, 0,
                    count(*)::int, min(s.date)::text,
                    (SELECT json_agg(x ORDER BY x->>'month')
                       FROM (SELECT json_build_object('month', to_char(o.date, 'YYYY-MM'),
                                                      'count', count(*)) AS x
                               FROM seats o
                              WHERE o.payer_id = payer.id AND NOT o.in_reach
                              GROUP BY to_char(o.date, 'YYYY-MM')) q),
                    0, NULL::json
               FROM seats s JOIN contacts payer ON payer.id = s.payer_id
              WHERE NOT s.in_reach
                AND NOT EXISTS (SELECT 1 FROM billable b WHERE b.payer_id = s.payer_id)
              GROUP BY payer.id, payer.name, payer.payment_terms
             UNION ALL
             -- Livery or a standing monthly charge with no lessons at all. A
             -- per-term payer is left out in the month their term starts, since
             -- the term run invoices them once for everything that month.
             SELECT payer.id, payer.name, payer.name, payer.payment_terms,
                    0, 0, 0, 0, 0, NULL::text, NULL::json, 0, NULL::json
               FROM contacts payer
              WHERE NOT payer.archived AND ${HAS_STANDING_SQL}
                AND payer.payment_terms IN ('advance_monthly', 'advance_term')
                AND NOT (payer.payment_terms = 'advance_term' AND ${TERM_STARTS_SQL})
                AND NOT EXISTS (SELECT 1 FROM seats s WHERE s.payer_id = payer.id)
              ORDER BY 2`,
            [from, to]);
        res.json({ overview: rows, from, to, month });
    } catch (err) {
        handleError(res, err, 'Loading advance overview');
    }
});

app.get('/api/invoices/overview', requireRole('helper'), async (req, res) => {
    try {
        // Either a whole month, or any explicit range — a term is just a range
        const month = String(req.query.month || '');
        let from, to;
        if (month) {
            if (!/^\d{4}-\d{2}$/.test(month)) {
                return res.status(400).json({ error: 'A valid month (YYYY-MM) is required.' });
            }
            [from, to] = monthRange(month);
        } else {
            from = String(req.query.from || '');
            to = String(req.query.to || '');
            if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
                return res.status(400).json({ error: 'A valid month, or a from/to range, is required.' });
            }
            if (datesInRange(from, to).length > 366) {
                return res.status(400).json({ error: 'Period too large (max 1 year).' });
            }
        }
        await materializeRecurring(from, to);
        // One row per PAYER, since that is who gets the invoice, with a rider
        // breakdown so the row can show who is on it and on which dates.
        const { rows } = await pool.query(
            `WITH seats AS (
                 SELECT rp.id, rp.contact_id, rider.name AS rider_name,
                        COALESCE(rider.parent_id, rider.id) AS payer_id,
                        r.date, r.ride_type_id, r.ride_type_name,
                        COALESCE(rp.price_cents, rt.price_cents, 0) AS cents
                   FROM ride_participants rp
                   JOIN rides r ON r.id = rp.ride_id AND r.status = 'active' AND NOT r.is_block
                   JOIN contacts rider ON rider.id = rp.contact_id AND NOT rider.archived
                   LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
                  WHERE r.date BETWEEN $1 AND $2
                    AND NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.participant_id = rp.id)
                    AND ${NOT_MAKEUP_SQL}
                    AND ${NOT_PASS_COVERED_SQL}
                 UNION ALL
                 ${cancelledSeatsSQL({ cols: 'rc.contact_id',
                     where: 'AND r.date BETWEEN $1 AND $2' })}
             )
             SELECT payer.id AS contact_id, payer.name, payer.name AS payer_name,
                    payer.payment_terms, payer.school_id,
                    count(*)::int AS ride_count,
                    SUM(s.cents)::int AS total_cents,
                    count(*) FILTER (WHERE s.ride_type_id IS NULL
                                       AND s.ride_type_name IS NULL)::int AS untyped_rides,
                    count(*) FILTER (WHERE s.date <= CURRENT_DATE)::int AS past_rides,
                    COALESCE(SUM(s.cents) FILTER (WHERE s.date <= CURRENT_DATE), 0)::int AS past_cents,
                    (SELECT json_agg(x ORDER BY x->>'name')
                       FROM (SELECT json_build_object(
                                    'name', s2.rider_name,
                                    'count', count(*),
                                    'dates', json_agg(s2.date::text ORDER BY s2.date)) AS x
                               FROM seats s2 WHERE s2.payer_id = payer.id
                              GROUP BY s2.rider_name) q) AS riders
               FROM seats s
               JOIN contacts payer ON payer.id = s.payer_id
              GROUP BY payer.id, payer.name, payer.payment_terms, payer.school_id
             UNION ALL
             -- livery and standing charges with no lessons behind them
             SELECT payer.id, payer.name, payer.name, payer.payment_terms, payer.school_id,
                    0, 0, 0, 0, 0, NULL::json
               FROM contacts payer
              WHERE NOT payer.archived AND ${HAS_STANDING_SQL}
                AND NOT EXISTS (SELECT 1 FROM seats s WHERE s.payer_id = payer.id)
              ORDER BY 2`,
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
            `SELECT i.*, c.name AS contact_name, c.phone AS contact_phone, rc.name AS rider_name,
                    (SELECT count(*)::int FROM invoice_lines il WHERE il.invoice_id = i.id) AS line_count
               FROM invoices i JOIN contacts c ON c.id = i.contact_id
               LEFT JOIN contacts rc ON rc.id = i.rider_contact_id
              ${where}
              ORDER BY i.created_at DESC LIMIT 200`, params);
        res.json({ invoices: rows });
    } catch (err) {
        handleError(res, err, 'Loading invoices');
    }
});

// Creates one invoice for all uninvoiced booked rides of a contact in a period.
// Returns null if there is nothing to invoice. Runs in its own transaction.
// The arena fee is charged once a quarter, on the invoice that covers that
// quarter's FIRST month — so it lands on whichever run bills that month,
// whether that is the month ahead, the month in arrears, or the term.
function arenaFeeQuarters(from, to) {
    const out = [];
    const start = new Date(from + 'T00:00:00Z');
    const end = new Date(to + 'T00:00:00Z');
    let y = start.getUTCFullYear();
    for (let year = y - 1; year <= end.getUTCFullYear() + 1; year++) {
        for (const m of [0, 3, 6, 9]) {            // Jan, Apr, Jul, Oct
            const mStart = new Date(Date.UTC(year, m, 1));
            const mEnd = new Date(Date.UTC(year, m + 1, 0));
            if (mEnd >= start && mStart <= end) {
                out.push({ year, quarter: m / 3 + 1, on: mStart.toISOString().slice(0, 10) });
            }
        }
    }
    return out;
}

// Each calendar month the invoice period touches. Livery is a monthly charge,
// so a one-month invoice carries one, and a term invoice carries one per month.
function liveryMonths(from, to) {
    const out = [];
    const start = new Date(from + 'T00:00:00Z');
    const end = new Date(to + 'T00:00:00Z');
    let y = start.getUTCFullYear(), m = start.getUTCMonth();
    while (new Date(Date.UTC(y, m, 1)) <= end) {
        const first = new Date(Date.UTC(y, m, 1));
        out.push({
            label: MONTH_NAMES_FULL[m] + ' ' + y,
            on: (first < start ? start : first).toISOString().slice(0, 10)
        });
        if (++m > 11) { m = 0; y++; }
    }
    return out;
}

const MONTH_NAMES_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

// Livery for the payer. The share scales the base price. The standard monthly
// charges do NOT follow it, with one exception: a quarter share splits them
// 50/50 with the other quarter-share owner. Full and half shares pay them in
// full. The customer's own standing charges are separate — theirs, not the
// horse's — and are never scaled.
async function liveryLines(client, payerId, from, to) {
    // A customer can stable several horses, each on its own share.
    const { rows: horses } = await client.query(
        `SELECT name, livery_share, livery_discount_cents FROM horses
          WHERE owner_contact_id = $1 AND livery_share IS NOT NULL
          ORDER BY sort_order, name`, [payerId]);
    if (!horses.length) return [];
    const priceRow = await client.query(
        "SELECT value FROM settings WHERE key = 'livery_price_cents'");
    const base = parseInt((priceRow.rows[0] || {}).value, 10) || 0;
    // Two sources, both at full price: the standard charges every livery
    // customer gets, and anything extra recorded against this one.
    // Standard charges are per horse: two horses means two lots of bedding.
    const { rows: extras } = await client.query(
        `SELECT name, price_cents FROM livery_extras WHERE active
          ORDER BY sort_order, name`);

    if (!base && !extras.length) return [];

    // Rides cannot be double-billed because an invoiced seat is skipped, but a
    // livery charge has no seat to mark. Guard on the description instead, so
    // re-running a month (or an overlapping term invoice) cannot charge twice.
    const { rows: already } = await client.query(
        `SELECT il.description FROM invoice_lines il
           JOIN invoices i ON i.id = il.invoice_id
          WHERE i.contact_id = $1 AND il.participant_id IS NULL`, [payerId]);
    const billed = new Set(already.map((r) => r.description));
    const lines = [];
    const add = (l) => { if (!billed.has(l.description)) lines.push(l); };
    for (const month of liveryMonths(from, to)) {
        for (const h of horses) {
            const section = `Livery — ${h.name}`;
            if (base) {
                add({
                    section,
                    description: `${month.label}`
                        + (h.livery_share === 100 ? '' : ` (${h.livery_share}% share)`),
                    ride_date: month.on,
                    amount_cents: Math.round(base * h.livery_share / 100)
                });
            }
            // Only a quarter share splits the standard charges, and it splits
            // them in half — not to a quarter. Full and half pay them whole.
            const split = h.livery_share === 25;
            for (const e of extras) {
                if (!e.price_cents) continue;
                add({ section, description: `${e.name} — ${month.label}${split ? ' (shared 50/50)' : ''}`,
                      ride_date: month.on,
                      amount_cents: split ? Math.round(e.price_cents / 2) : e.price_cents });
            }
            // Shown as its own line rather than folded into the livery charge,
            // so the full price and the deal are both visible on the invoice.
            if (h.livery_discount_cents) {
                add({ section, description: `Discount — ${month.label}`,
                      ride_date: month.on, amount_cents: -h.livery_discount_cents });
            }
        }

    }
    return lines;
}

// One-off expenses not yet billed. Swept up to the end of the period rather
// than only within it, so an expense entered late for an already-invoiced month
// lands on the next invoice instead of being stranded forever.
async function chargeLines(client, payerId, to, soleRider) {
    // An expense is recorded against whoever it concerns — a vet call for one
    // child, a bag of feed for another — but the invoice belongs to the payer.
    // So sweep the payer's own charges AND those of everyone they pay for;
    // recording one against a child used to mean it was never billed at all.
    const { rows } = await client.query(
        `SELECT ch.id, ch.charge_date, ch.description, ch.amount_cents, c.name AS who,
                (c.id <> $1) AS is_child
           FROM contact_charges ch
           JOIN contacts c ON c.id = ch.contact_id
          WHERE COALESCE(c.parent_id, c.id) = $1 AND ch.charge_date <= $2
            AND NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.charge_id = ch.id)
          ORDER BY ch.charge_date, ch.id`, [payerId, to]);
    return rows.map((r) => ({
        charge_id: r.id,
        section: EXTRAS_SECTION,
        // name the rider when the invoice covers more than one, as ride lines do
        description: (!soleRider && r.is_child ? `${r.who} — ` : '') + r.description,
        ride_date: String(r.charge_date).slice(0, 10),
        amount_cents: r.amount_cents
    }));
}

// Standing monthly charges for a customer: a livery extra, a donation, a
// standing arrangement of any kind. Deliberately independent of livery — these
// used to be billed only inside the livery lines, so a customer with no horse
// stabled here could be given one and never be charged for it.
async function monthlyChargeLines(client, payerId, from, to) {
    const { rows } = await client.query(
        `SELECT name, price_cents FROM contact_monthly_charges
          WHERE contact_id = $1 ORDER BY sort_order, name`, [payerId]);
    if (!rows.length) return [];
    const { rows: already } = await client.query(
        `SELECT il.description FROM invoice_lines il
           JOIN invoices i ON i.id = il.invoice_id
          WHERE i.contact_id = $1 AND il.participant_id IS NULL`, [payerId]);
    const billed = new Set(already.map((r) => r.description));
    const lines = [];
    for (const month of liveryMonths(from, to)) {
        for (const c of rows) {
            if (!c.price_cents) continue;
            const description = `${c.name} — ${month.label}`;
            if (!billed.has(description)) {
                lines.push({ section: EXTRAS_SECTION, description,
                         ride_date: month.on, amount_cents: c.price_cents });
            }
        }
    }
    return lines;
}

// Lessons a rider called off too late to be let off paying. The seat is gone,
// so there is nothing for the ride query to find — these are billed from the
// cancellation record instead, at what the lesson would have cost.
async function cancelledLines(client, payerId, from, to, soleRider) {
    const { rows } = await client.query(
        `SELECT rc.id, rc.kind, r.date, c.name AS rider_name,
                COALESCE(rt.name, r.ride_type_name, 'Ride') AS ride_type_name,
                COALESCE(rt.price_cents, 0)::int AS amount_cents
           FROM ride_cancellations rc
           JOIN rides r ON r.id = rc.ride_id AND r.status = 'active' AND NOT r.is_block
           JOIN contacts c ON c.id = rc.contact_id
           LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
          WHERE ${BILLABLE_CANCELLATION_SQL} AND COALESCE(c.parent_id, c.id) = $1
            AND r.date BETWEEN $2 AND $3
            AND NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.cancellation_id = rc.id)
          ORDER BY r.date`, [payerId, from, to]);
    return rows.map((r) => ({
        cancellation_id: r.id,
        section: r.ride_type_name,
        description: r.kind === 'rescheduled'
            ? r.rider_name : `${r.rider_name} (cancelled late)`,
        ride_date: String(r.date).slice(0, 10),
        amount_cents: r.amount_cents
    }));
}

async function arenaFeeLines(client, riderIds, from, to, soleRider) {
    const feeRow = await client.query(
        "SELECT value FROM settings WHERE key = 'arena_fee_cents'");
    const cents = parseInt((feeRow.rows[0] || {}).value, 10);
    if (!Number.isInteger(cents) || cents <= 0 || !riderIds.length) return [];
    const quarters = arenaFeeQuarters(from, to);
    if (!quarters.length) return [];
    const { rows: payers } = await client.query(
        'SELECT id, name FROM contacts WHERE id = ANY($1::bigint[]) AND pays_arena_fee',
        [riderIds]);
    const lines = [];
    for (const r of payers) {
        for (const q of quarters) {
            lines.push({
                section: EXTRAS_SECTION,
                description: `${soleRider ? '' : r.name + ' — '}Arena fee Q${q.quarter} ${q.year}`,
                ride_date: q.on,
                amount_cents: cents
            });
        }
    }
    return lines;
}

// mode 'advance_month' bills the month-ahead rule (term lessons of the coming
// month + everything unbilled from before it). Anything else bills the plain
// date range, which is what the arrears, cash and term runs want.
async function createInvoiceForContact(contactId, from, to, mode) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // One invoice per PAYER: every rider they pay for, on one document —
        // their children plus themselves if they ride too. contactId may be any
        // of those people; the payer is resolved from it.
        const { rows: riderRows } = await client.query(
            'SELECT id, name, parent_id FROM contacts WHERE id = $1', [contactId]);
        if (!riderRows[0]) {
            await client.query('ROLLBACK');
            return null;
        }
        const payerId = riderRows[0].parent_id || riderRows[0].id;
        const { rows: rides } = await client.query(
            `SELECT rp.id, rp.contact_id, c.name AS rider_name, r.date, r.start_time,
                    COALESCE(rt.name, r.ride_type_name, 'Ride') AS ride_type_name,
                    COALESCE(rp.price_cents, rt.price_cents, 0)::int AS amount_cents
               FROM ride_participants rp
               JOIN rides r ON r.id = rp.ride_id AND r.status = 'active' AND NOT r.is_block
               JOIN contacts c ON c.id = rp.contact_id
               JOIN contacts rider ON rider.id = rp.contact_id
               JOIN contacts payer ON payer.id = COALESCE(rider.parent_id, rider.id)
               LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
              WHERE COALESCE(c.parent_id, c.id) = $1
                AND NOT c.archived
                AND ${mode === 'advance_month'
                    // Last month's unbilled lessons for anyone on advance
                    // billing, plus the coming month's term lessons for the
                    // monthly payers only — a per-term payer has those on their
                    // term invoice, so taking them here would bill them twice.
                    ? `((r.date < $2 AND r.date >= $2::date - ${CARRY_BACK})
                        OR (r.date >= $2 AND r.date <= $3 AND ${IN_TERM_SQL}
                            AND payer.payment_terms = 'advance_monthly'))`
                    : mode === 'term'
                    // The term ahead, plus anything left unbilled from the month
                    // before it started — so a per-term customer gets one
                    // invoice in a term month, not a term one and a monthly one.
                    ? `(r.date BETWEEN $2 AND $3 OR ${PREV_MONTH_SQL('$2')})`
                    : 'r.date BETWEEN $2 AND $3'}
                AND NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.participant_id = rp.id)
                AND ${NOT_MAKEUP_SQL}
                AND ${NOT_PASS_COVERED_SQL}
              ORDER BY c.name, r.date, r.start_time
              FOR UPDATE OF rp`,
            [payerId, from, to]);
        // Livery is charged to the payer, not to a seat, so a livery customer
        // with no lessons this period still has something to invoice.
        const livery = (await liveryLines(client, payerId, from, to))
            .concat(await monthlyChargeLines(client, payerId, from, to));
        const soleRiderGuess = rides.length
            && new Set(rides.map((r) => String(r.contact_id))).size === 1;
        const charges = await chargeLines(client, payerId, to, soleRiderGuess);
        const lateCancels = await cancelledLines(client, payerId, from, to, soleRiderGuess);
        if (!rides.length && !livery.length && !charges.length && !lateCancels.length) {
            await client.query('ROLLBACK');
            return null;
        }
        // rider_contact_id only means something on a single-rider invoice
        const riderIds = [...new Set(rides.map((r) => String(r.contact_id)))];
        const soleRider = riderIds.length === 1 ? riderIds[0] : null;
        const fees = (await arenaFeeLines(client, riderIds, from, to, soleRider))
            .concat(livery).concat(charges).concat(lateCancels);
        const year = from.slice(0, 4);
        const { rows: numRows } = await client.query(
            `SELECT COALESCE(MAX(SUBSTRING(number FROM '\\d+$')::int), 0) + 1 AS next
               FROM invoices WHERE number LIKE $1`, [`INV-${year}-%`]);
        const number = `INV-${year}-${String(numRows[0].next).padStart(4, '0')}`;
        const total = rides.reduce((sum, r) => sum + r.amount_cents, 0)
            + fees.reduce((sum, f) => sum + f.amount_cents, 0);
        const { rows: invRows } = await client.query(
            `INSERT INTO invoices (number, contact_id, rider_contact_id, period_start, period_end, kind, total_cents)
             VALUES ($1, $2, $3, $4, $5, 'monthly', $6) RETURNING *`,
            [number, payerId, soleRider, from, to, total]);
        for (const r of rides) {
            await client.query(
                `INSERT INTO invoice_lines (invoice_id, participant_id, section, description, ride_date, amount_cents)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [invRows[0].id, r.id, r.ride_type_name, r.rider_name, r.date, r.amount_cents]);
        }
        for (const f of fees) {
            await client.query(
                `INSERT INTO invoice_lines (invoice_id, participant_id, charge_id, cancellation_id,
                                            section, description, ride_date, amount_cents)
                 VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)`,
                [invRows[0].id, f.charge_id || null, f.cancellation_id || null,
                 f.section || EXTRAS_SECTION, f.description, f.ride_date, f.amount_cents]);
        }
        await client.query('COMMIT');
        // Return the invoice the way the list shows it — with the payer's name
        // and phone and its line count — so the caller can render it without
        // re-fetching the whole page.
        const { rows: full } = await pool.query(
            `${INVOICE_WITH_CONTACT_SQL} WHERE i.id = $1`, [invRows[0].id]);
        const invoice = { ...(full[0] || invRows[0]), line_count: rides.length };
        return { invoice, line_count: rides.length + fees.length,
                 riders: riderIds.length, arena_fees: fees.length };
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
        const { contact_id, from, to, mode } = req.body || {};
        if (!contact_id || !DATE_RE.test(from || '') || !DATE_RE.test(to || '') || from > to) {
            return res.status(400).json({ error: 'Contact and a valid period are required.' });
        }
        const result = await createInvoiceForContact(contact_id, from, to, mode);
        if (!result) return res.status(400).json({ error: 'No uninvoiced rides in that period.' });
        res.json(result);
    } catch (err) {
        handleError(res, err, 'Creating invoice');
    }
});

// ---------- Term passes (invoice in advance) ----------

// Creates the pass and its up-front ('advance') invoice in one go.
// The invoice goes to the payer (parent when set), like all invoices.

// Edit a term pass and its advance invoice together, while the invoice is
// still a draft (period, amount and the line text). Anything already sent or
// paid is refused — issue a separate invoice for the difference instead.

// Bulk: one pass + advance invoice for EVERY rider with fixed lessons in the
// period, priced per planned lesson (so 2×/week riders pay double and
// biweekly riders half). dry_run returns the preview without creating.
// Riders who already have a pass overlapping the period are skipped.
// Who is on per-term billing but has no pass covering the period? The term-pass
// card cannot infer a term the way the monthly runs infer a month, so without
// this it just says "no term passes yet" and never tells you who is missing one.


// Deleting a pass makes its fixed lessons billable again. The advance invoice
// is left alone — delete it separately if it was created in error.

// ---------- Automatic month-end invoicing ----------
// Once a month is over, payers billed IN ARREARS get their invoice
// automatically. Nobody else does: advance-monthly and per-term payers are
// billed before the period from their own runs, and cash riders settle on the
// day — auto-invoicing them would raise a second, contradictory bill.
// Safe to run repeatedly: already-invoiced rides are skipped.
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
               JOIN contacts rider ON rider.id = rp.contact_id AND NOT rider.archived
               JOIN contacts payer ON payer.id = COALESCE(rider.parent_id, rider.id)
              WHERE r.date BETWEEN $1 AND $2
                AND payer.payment_terms = 'arrears'
                AND NOT EXISTS (SELECT 1 FROM invoice_lines il WHERE il.participant_id = rp.id)
                AND ${NOT_PASS_COVERED_SQL}`,
            [from, to]);
        let made = 0, skipped = 0;
        for (const row of rows) {
            const result = await createInvoiceForContact(row.payer_id, from, to);
            if (!result) continue;
            // A zero invoice almost always means the rides have no ride type,
            // so it is a data gap rather than a real bill. Undo it and say so
            // rather than leaving junk drafts for someone to clear up.
            if (result.invoice.total_cents === 0) {
                await pool.query('DELETE FROM invoices WHERE id = $1', [result.invoice.id]);
                skipped++;
                continue;
            }
            made++;
            console.log(`Auto-created invoice ${result.invoice.number} (${result.line_count} rides) for payer ${row.payer_id}`);
        }
        if (made || skipped) {
            console.log(`Month-end invoicing for ${month}: ${made} created` +
                (skipped ? `, ${skipped} skipped with a zero total (rides have no ride type)` : ''));
        }
    } catch (err) {
        console.error('Automatic month-end invoicing failed:', err);
    }
}

// OFF by default. It was creating invoices for payers billed in advance, and
// unattended invoicing is only safe once every payer has payment terms and
// every ride has a type. Turn it back on with a settings row:
//   INSERT INTO settings (key, value) VALUES ('auto_invoice', 'on')
//     ON CONFLICT (key) DO UPDATE SET value = 'on';
// It then invoices IN-ARREARS payers only, for the month just ended.
async function autoInvoiceIfEnabled() {
    try {
        const { rows } = await pool.query(
            "SELECT value FROM settings WHERE key = 'auto_invoice'");
        if ((rows[0] || {}).value !== 'on') return;
        await autoInvoiceClosedMonths();
    } catch (err) {
        console.error('Auto-invoice check failed:', err);
    }
}

setTimeout(autoInvoiceIfEnabled, 10 * 1000); // shortly after startup
setInterval(autoInvoiceIfEnabled, 12 * 3600 * 1000); // and twice a day

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
// Only drafts may be deleted. Numbering is highest-plus-one, so removing an
// invoice that has already gone out would let the next one reuse its number and
// leave two different documents sharing it.
app.delete('/api/invoices/:id', requireRole('helper'), async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT number, status FROM invoices WHERE id = $1', [req.params.id]);
        if (!rows[0]) return res.status(404).json({ error: 'Invoice not found.' });
        if (rows[0].status !== 'draft') {
            return res.status(400).json({
                error: `${rows[0].number} is marked as ${rows[0].status} and cannot be deleted. ` +
                       'Set it back to draft first if it really was not sent.'
            });
        }
        const { rowCount } = await pool.query(
            "DELETE FROM invoices WHERE id = $1 AND status = 'draft'", [req.params.id]);
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
// "14 Oct 2026" — the same format the screen uses
// "13 Oct" — a date list on an invoice line repeats the year on every entry
// otherwise, which is noise when the period is already stated at the top.
function fmtShort(value) {
    const d = value instanceof Date ? value : new Date(String(value).slice(0, 10) + 'T00:00:00Z');
    return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
}

function fmtDay(value) {
    if (!value) return '';
    // pg hands back a Date for timestamptz and a string for date columns
    const d = value instanceof Date ? value
        : new Date(String(value).slice(0, 10) + 'T00:00:00Z');
    if (isNaN(d)) return String(value);
    return d.toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        // a plain date column has no zone; read it as written
        timeZone: value instanceof Date ? undefined : 'UTC'
    });
}

function drawInvoicePage(doc, inv, lines, settings) {
    const cur = settings.currency || 'R';
    const money = (cents) => `${cur} ${(cents / 100).toFixed(2)}`;

    doc.fillColor('#000000').fontSize(20).font('Helvetica-Bold')
        .text(settings.business_name || 'Invoice', 50, 50);
    doc.fontSize(9).font('Helvetica').fillColor('#555555');
    if (settings.business_address) doc.text(settings.business_address);
    const contact = [settings.business_phone, settings.business_email].filter(Boolean).join('  ·  ');
    if (contact) doc.text(contact);
    doc.moveDown(1.5);
    doc.fillColor('#000000').fontSize(14).font('Helvetica-Bold').text(`Invoice ${inv.number}`);
    doc.fontSize(10).font('Helvetica').moveDown(0.3);
    doc.text(`Date: ${fmtDay(inv.created_at)}`);
    if (inv.period_start) doc.text(`Period: ${fmtDay(inv.period_start)} to ${fmtDay(inv.period_end)}`);
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').text('Billed to:');
    doc.font('Helvetica').text(inv.contact_name);
    if (inv.contact_address) doc.text(inv.contact_address);
    if (inv.contact_email) doc.text(inv.contact_email);
    if (inv.contact_phone) doc.text(inv.contact_phone);
    if (inv.rider_name && inv.rider_name !== inv.contact_name) {
        doc.moveDown(0.4);
        doc.font('Helvetica-Bold').text('For rider: ', { continued: true }).font('Helvetica').text(inv.rider_name);
    }
    doc.moveDown(1.2);

    // Table
    const left = 50, dateW = 80, amountW = 90;
    const right = doc.page.width - 50;
    const descX = left + dateW;
    const amountX = right - amountW;
    const drawRow = (dateTxt, desc, amount, bold) => {
        const y = doc.y;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
        const descW = amountX - descX - 10;
        // The row is as tall as its TALLEST cell. doc.y is left wherever the
        // last cell finished, and the amount is always one line — so a
        // description that wrapped had the next row drawn straight over it.
        const rowH = Math.max(
            doc.heightOfString(String(dateTxt || ''), { width: dateW - 10 }),
            doc.heightOfString(String(desc || ''), { width: descW }),
            doc.heightOfString(String(amount || ''), { width: amountW }));
        doc.text(dateTxt, left, y, { width: dateW - 10 });
        doc.text(desc, descX, y, { width: descW });
        doc.text(amount, amountX, y, { width: amountW, align: 'right' });
        doc.y = y + rowH;
        doc.moveDown(0.4);
    };
    // A lesson section bills the same rate for every seat, so the heading can
    // carry it: "Group Lesson 75 — R 500.00". Left off when the section's seats
    // were not all charged alike (a seat override, a part-billed late
    // cancellation) or when it is not lessons at all, where a single per-ride
    // rate means nothing.
    const sectionRate = (sectionLines) => {
        const seats = sectionLines.filter((l) => l.participant_id || l.cancellation_id);
        if (!seats.length || seats.length !== sectionLines.length) return '';
        const rates = new Set(seats.map((l) => l.amount_cents));
        return rates.size === 1 ? `  —  ${money(seats[0].amount_cents)}` : '';
    };
    // The grouped layout carries dates inside the description ("Nolan: 13, 20,
    // 27 Oct"), so the date column is empty and its heading would label nothing.
    const grouped = lines.some((l) => l.section);
    drawRow(grouped ? '' : 'Date', 'Description', 'Amount', true);
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#999999').stroke();
    doc.moveDown(0.4);
    // Grouped under headings: livery per horse, lessons per type with each
    // rider's dates collapsed onto one row, then the extras. Lines from before
    // this existed have no section and keep the flat list they were sent as.
    if (grouped) {
        const order = [];
        const bySection = new Map();
        for (const l of lines) {
            const key = l.section || EXTRAS_SECTION;
            if (!bySection.has(key)) { bySection.set(key, []); order.push(key); }
            bySection.get(key).push(l);
        }
        // extras last, whatever order they were added in
        order.sort((a, b) => (a === EXTRAS_SECTION ? 1 : 0) - (b === EXTRAS_SECTION ? 1 : 0));
        for (const section of order) {
            if (doc.y > doc.page.height - 150) doc.addPage();
            doc.moveDown(0.3);
            doc.fontSize(10.5).font('Helvetica-Bold').fillColor('#000000')
                .text(section + sectionRate(bySection.get(section)), left, doc.y);
            doc.moveDown(0.25);
            // One row per rider inside a lesson section: "Nolan: 13, 20, 27 Oct".
            // A horse's livery is already one row per charge, so it is left alone.
            const rows = [];
            const byRider = new Map();
            for (const l of bySection.get(section)) {
                const isLesson = l.participant_id || l.cancellation_id;
                if (!isLesson) { rows.push({ label: l.description, dates: [], cents: l.amount_cents }); continue; }
                if (!byRider.has(l.description)) {
                    byRider.set(l.description, { label: l.description, dates: [], cents: 0 });
                    rows.push(byRider.get(l.description));
                }
                const r = byRider.get(l.description);
                r.dates.push(fmtShort(l.ride_date));
                r.cents += l.amount_cents;
            }
            for (const r of rows) {
                if (doc.y > doc.page.height - 120) doc.addPage();
                drawRow('', r.dates.length ? `${r.label}: ${r.dates.join(', ')}` : r.label,
                        money(r.cents), false);
            }
        }
    } else {
        for (const line of lines) {
            if (doc.y > doc.page.height - 120) doc.addPage();
            drawRow(fmtDay(line.ride_date), line.description, money(line.amount_cents), false);
        }
    }
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#999999').stroke();
    doc.moveDown(0.4);
    drawRow('', 'Total', money(inv.total_cents), true);

    if (inv.holiday_note) {
        doc.moveDown(1);
        doc.fontSize(9.5).font('Helvetica').fillColor('#555555')
            .text(inv.holiday_note, left, doc.y, { width: right - left });
    }
    // Explain the arena fee, but only on an invoice that actually carries one —
    // otherwise it is a paragraph about a charge that is not there.
    if (settings.livery_note && lines.some((l) => /^Livery — /.test(l.section || l.description || ''))) {
        doc.moveDown(1);
        doc.fontSize(9.5).font('Helvetica').fillColor('#555555')
            .text(settings.livery_note, left, doc.y, { width: right - left });
    }
    if (settings.arena_fee_note && lines.some((l) => /^(.*— )?Arena fee /.test(l.description || ''))) {
        doc.moveDown(1);
        doc.fontSize(9.5).font('Helvetica').fillColor('#555555')
            .text(settings.arena_fee_note, left, doc.y, { width: right - left });
    }
    if (settings.bank_details) {
        doc.moveDown(1.5);
        if (doc.y > doc.page.height - 140) doc.addPage();
        doc.fillColor('#000000').fontSize(10).font('Helvetica-Bold')
            .text('Banking details', left, doc.y);
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica')
            .text(settings.bank_details, left, doc.y, { width: right - left });
    }
    if (settings.invoice_footer) {
        doc.moveDown(1.5);
        doc.fontSize(12).font('Helvetica').fillColor('#333333')
            .text(settings.invoice_footer, left, doc.y, { width: right - left });
    }
}

// An instructor's own statement: every lesson they led in a period, what each
// one pays, and the total. Same shape as an invoice, but running the other way
// — from the instructor to the school.
function drawGuideStatement(doc, guide, rides, from, to, settings) {
    const cur = settings.currency || 'R';
    const money = (cents) => `${cur} ${(cents / 100).toFixed(2)}`;
    const rate = guide.rate_cents || 0;

    doc.fillColor('#000000').fontSize(20).font('Helvetica-Bold')
        .text(settings.business_name || 'Riding school', 50, 50);
    doc.fontSize(9).font('Helvetica').fillColor('#555555');
    if (settings.business_address) doc.text(settings.business_address);
    const hdr = [settings.business_phone, settings.business_email].filter(Boolean).join('  ·  ');
    if (hdr) doc.text(hdr);
    doc.moveDown(1.5);
    doc.fillColor('#000000').fontSize(14).font('Helvetica-Bold').text('Lessons and pay');
    doc.fontSize(10).font('Helvetica').moveDown(0.3);
    doc.text(`Period: ${fmtDay(from)} to ${fmtDay(to)}`);
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').text('Instructor:');
    doc.font('Helvetica').text(guide.name + (guide.is_assistant ? ' (assistant)' : ''));
    if (guide.phone) doc.text(guide.phone);
    doc.text(rate ? `${money(rate)} per lesson` : 'Pay per lesson not set');
    doc.moveDown(1.2);

    const left = 50, dateW = 80, amountW = 90;
    const right = doc.page.width - 50;
    const descX = left + dateW;
    const amountX = right - amountW;
    const drawRow = (dateTxt, desc, amount, bold) => {
        const y = doc.y;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
        const descW = amountX - descX - 10;
        // The row is as tall as its TALLEST cell. doc.y is left wherever the
        // last cell finished, and the amount is always one line — so a
        // description that wrapped had the next row drawn straight over it.
        const rowH = Math.max(
            doc.heightOfString(String(dateTxt || ''), { width: dateW - 10 }),
            doc.heightOfString(String(desc || ''), { width: descW }),
            doc.heightOfString(String(amount || ''), { width: amountW }));
        doc.text(dateTxt, left, y, { width: dateW - 10 });
        doc.text(desc, descX, y, { width: descW });
        doc.text(amount, amountX, y, { width: amountW, align: 'right' });
        doc.y = y + rowH;
        doc.moveDown(0.4);
    };
    drawRow('Date', 'Lesson', 'Pay', true);
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#999999').stroke();
    doc.moveDown(0.4);
    for (const r of rides) {
        if (doc.y > doc.page.height - 120) doc.addPage();
        const what = [r.start_time.slice(0, 5), r.ride_type_name || 'Lesson',
            r.rider_count ? `${r.rider_count} rider${r.rider_count === 1 ? '' : 's'}` : 'no riders']
            .filter(Boolean).join(' · ');
        drawRow(fmtDay(r.date), what, money(rate), false);
    }
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#999999').stroke();
    doc.moveDown(0.4);
    drawRow('', `Total — ${rides.length} lesson${rides.length === 1 ? '' : 's'}`,
        money(rides.length * rate), true);
    if (!rate) {
        doc.moveDown(1);
        doc.fontSize(9).font('Helvetica').fillColor('#a8541c')
            .text('No pay per lesson is set for this instructor, so the total reads zero.',
                left, doc.y, { width: right - left });
    }
}

app.get('/api/guides/:id/statement.pdf', requireRole('helper'), async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '') || from > to) {
            return res.status(400).json({ error: 'Valid from/to dates are required.' });
        }
        const { rows: gs } = await pool.query('SELECT * FROM guides WHERE id = $1', [req.params.id]);
        const guide = gs[0];
        if (!guide) return res.status(404).json({ error: 'Instructor not found.' });
        await materializeRecurring(from, to);
        const { rows: rides } = await pool.query(
            `SELECT r.date::text AS date, r.start_time::text AS start_time,
                    COALESCE(rt.name, r.ride_type_name) AS ride_type_name,
                    (SELECT count(*)::int FROM ride_participants rp
                      WHERE rp.ride_id = r.id AND rp.contact_id IS NOT NULL) AS rider_count
               FROM ride_guides rg
               JOIN rides r ON r.id = rg.ride_id
               LEFT JOIN ride_types rt ON rt.id = r.ride_type_id
              WHERE rg.guide_id = $1 AND r.date BETWEEN $2 AND $3
                AND r.status = 'active' AND NOT r.is_block
              ORDER BY r.date, r.start_time`,
            [req.params.id, from, to]);
        const settings = await loadSettings();
        const safe = guide.name.replace(/[^a-zA-Z0-9]+/g, '-');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition',
            `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="lessons-${safe}-${from}.pdf"`);
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        doc.pipe(res);
        drawGuideStatement(doc, guide, rides, from, to, settings);
        doc.end();
    } catch (err) {
        handleError(res, err, 'Generating instructor statement');
    }
});

const INVOICE_WITH_CONTACT_SQL = `
    SELECT i.*, c.name AS contact_name, c.email AS contact_email,
           c.phone AS contact_phone, c.address AS contact_address,
           rc.name AS rider_name
      FROM invoices i JOIN contacts c ON c.id = i.contact_id
      LEFT JOIN contacts rc ON rc.id = i.rider_contact_id`;

// What this invoice deliberately does NOT cover. An invoice raised ahead of
// the period cannot know what will be ridden in the holidays or booked ad hoc,
// so rather than guessing it says so — naming the holiday window when there is
// a relevant one, either inside the period or immediately before it.
async function invoiceHolidayNote(inv) {
    if (!inv.period_start || !inv.period_end) return null;
    const { rows: schools } = await pool.query(
        `SELECT DISTINCT s.id, s.name
           FROM invoice_lines il
           JOIN ride_participants rp ON rp.id = il.participant_id
           JOIN contacts rider ON rider.id = rp.contact_id
           JOIN contacts payer ON payer.id = COALESCE(rider.parent_id, rider.id)
           JOIN schools s ON s.id = payer.school_id
          WHERE il.invoice_id = $1`, [inv.id]);
    const from = String(inv.period_start).slice(0, 10);
    const to = String(inv.period_end).slice(0, 10);
    const windows = [];
    for (const s of schools) {
        const { rows: terms } = await pool.query(
            `SELECT period_start::text AS s, period_end::text AS e
               FROM school_terms WHERE school_id = $1 ORDER BY period_start`, [s.id]);
        if (!terms.length) continue;
        // the gaps between terms are the holidays
        const gaps = [];
        for (let i = 1; i < terms.length; i++) {
            const gs = shiftDays(terms[i - 1].e, 1), ge = shiftDays(terms[i].s, -1);
            if (gs <= ge) gaps.push([gs, ge]);
        }
        gaps.push([shiftDays(terms[terms.length - 1].e, 1), null]);
        // Relevant = any holiday near this period: inside it, just before it
        // (a term invoice starts mid-month and leaves that stretch unbilled) or
        // just after it (the holiday the term runs into). A month either side is
        // enough to catch all three without listing distant ones.
        const near = [shiftDays(from, -31), shiftDays(to, 31)];
        const hits = gaps.filter(([gs, ge]) => gs <= near[1] && (!ge || ge >= near[0]));
        hits.forEach(([gs, ge]) => {
            windows.push(`${s.name} school holidays: ${fmtDay(gs)}` +
                (ge ? ` to ${fmtDay(ge)}` : ' onwards'));
        });
    }
    const policy = 'Lessons ridden during the school holidays, and any extra lessons ' +
        'outside the regular weekly schedule, are not billed in advance. They are ' +
        'invoiced the following month, once they have been ridden.';
    return windows.length ? `${windows.join('\n')}\n${policy}` : policy;
}

app.get('/api/invoices/:id/pdf', requireRole('helper'), async (req, res) => {
    try {
        const { rows } = await pool.query(
            `${INVOICE_WITH_CONTACT_SQL} WHERE i.id = $1`, [req.params.id]);
        const inv = rows[0];
        if (!inv) return res.status(404).json({ error: 'Invoice not found.' });
        const { rows: lines } = await pool.query(
            'SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY ride_date, id', [inv.id]);
        const settings = await loadSettings();
        inv.holiday_note = await invoiceHolidayNote(inv);

        res.setHeader('Content-Type', 'application/pdf');
        // ?download=1 saves the file instead of taking over the screen — an
        // inline PDF has no back button in a standalone/installed window.
        res.setHeader('Content-Disposition',
            `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${inv.number}.pdf"`);
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

// ---------- iCal subscription (dated to-dos) ----------
// Calendar apps poll this URL, so it is guarded by its own token rather than
// a session. Only dated, still-open to-dos are published.
function icsEscape(text) {
    return String(text || '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

function icsFold(line) {
    // RFC 5545: fold lines longer than 75 octets with a leading space
    if (line.length <= 73) return line;
    const parts = [];
    for (let i = 0; i < line.length; i += 73) parts.push(i ? ' ' + line.slice(i, i + 73) : line.slice(0, 73));
    return parts.join('\r\n');
}

app.get('/api/ical/todos.ics', async (req, res) => {
    try {
        const { rows: tok } = await pool.query(
            "SELECT value FROM settings WHERE key = 'ical_token'");
        const token = tok[0] && tok[0].value;
        const given = String(req.query.token || '');
        if (!token || given.length !== token.length ||
            !crypto.timingSafeEqual(Buffer.from(given.padEnd(token.length).slice(0, token.length)), Buffer.from(token))) {
            return res.status(404).type('text/plain').send('Not found');
        }
        const { rows: todos } = await pool.query(
            `SELECT id, title, todo_date, todo_time, done_at FROM todos
              WHERE todo_date IS NOT NULL AND done_at IS NULL
              ORDER BY todo_date`);
        const settings = await loadSettings();
        const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

        const lines = [
            'BEGIN:VCALENDAR', 'VERSION:2.0',
            'PRODID:-//SVSH//Stable to-dos//EN',
            'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
            `X-WR-CALNAME:${icsEscape((settings.business_name || 'Stable') + ' to-dos')}`,
            'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'
        ];
        for (const t of todos) {
            const day = String(t.todo_date).replace(/-/g, '');
            lines.push('BEGIN:VEVENT');
            lines.push(`UID:todo-${t.id}@svsh`);
            lines.push(`DTSTAMP:${stamp}`);
            if (t.todo_time) {
                const hm = String(t.todo_time).slice(0, 5).replace(':', '');
                const endMin = parseInt(hm.slice(0, 2), 10) * 60 + parseInt(hm.slice(2), 10) + 60;
                const end = `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}${String(endMin % 60).padStart(2, '0')}`;
                lines.push(`DTSTART:${day}T${hm}00`);
                lines.push(`DTEND:${day}T${end}00`);
            } else {
                lines.push(`DTSTART;VALUE=DATE:${day}`);
                lines.push(`DTEND;VALUE=DATE:${shiftDays(t.todo_date, 1).replace(/-/g, '')}`);
            }
            lines.push(icsFold(`SUMMARY:${icsEscape(t.title)}`));
            lines.push('END:VEVENT');
        }
        lines.push('END:VCALENDAR');

        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', 'inline; filename="svsh-todos.ics"');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(lines.join('\r\n') + '\r\n');
    } catch (err) {
        console.error('iCal feed failed:', err);
        res.status(500).type('text/plain').send('Error');
    }
});

app.post('/api/settings/rotate-ical-token', requireRole('admin'), async (req, res) => {
    try {
        const token = crypto.randomBytes(32).toString('hex');
        await pool.query(
            `INSERT INTO settings (key, value) VALUES ('ical_token', $1)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [token]);
        res.json({ token });
    } catch (err) {
        handleError(res, err, 'Rotating the calendar link');
    }
});

// ---------- Public read-only schedule (instructors, no login) ----------
// Guarded by an unguessable token, not a password: one link to paste into the
// staff WhatsApp group. Shows only what instructors need for the day.
async function requirePublicToken(req, res) {
    const { rows } = await pool.query(
        "SELECT value FROM settings WHERE key = 'public_schedule_token'");
    const token = rows[0] && rows[0].value;
    const given = String(req.query.token || '');
    if (!token || given.length !== token.length ||
        !crypto.timingSafeEqual(Buffer.from(given.padEnd(token.length).slice(0, token.length)), Buffer.from(token))) {
        res.status(404).json({ error: 'Not found.' });
        return false;
    }
    return true;
}

// ---------- Web Push: tell instructors' phones the schedule moved ----------
// Instructors are usually out of signal when a change is made, so we cannot
// rely on them refreshing. A push wakes the service worker on each subscribed
// phone, which re-fetches and replaces its offline copy. If the phone is
// offline the push service holds the message and delivers it on reconnect.
const webpush = require('web-push');
let vapidReady = null;

async function ensureVapid() {
    if (vapidReady) return vapidReady;
    vapidReady = (async () => {
        const { rows } = await pool.query(
            "SELECT key, value FROM settings WHERE key IN ('vapid_public', 'vapid_private')");
        const found = Object.fromEntries(rows.map((r) => [r.key, r.value]));
        let pub = found.vapid_public, priv = found.vapid_private;
        if (!pub || !priv) {
            const keys = webpush.generateVAPIDKeys();
            pub = keys.publicKey; priv = keys.privateKey;
            await pool.query(
                `INSERT INTO settings (key, value) VALUES ('vapid_public', $1), ('vapid_private', $2)
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [pub, priv]);
            console.log('generated a VAPID keypair for web push');
        }
        webpush.setVapidDetails('mailto:info@svsh.co.za', pub, priv);
        return pub;
    })();
    return vapidReady;
}

// Fire-and-forget: a failed push must never break saving a ride.
async function notifyScheduleChanged(date) {
    try {
        await ensureVapid();
        const { rows } = await pool.query('SELECT * FROM push_subscriptions');
        if (!rows.length) return;
        const payload = JSON.stringify({
            date: date || null,
            body: date ? `The schedule for ${date} has changed.`
                       : 'The riding schedule has changed.'
        });
        await Promise.all(rows.map(async (s) => {
            try {
                await webpush.sendNotification(
                    { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
                await pool.query('UPDATE push_subscriptions SET last_ok = now() WHERE id = $1', [s.id]);
            } catch (err) {
                // 404/410 mean the browser rotated or revoked this endpoint
                if (err.statusCode === 404 || err.statusCode === 410) {
                    await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
                } else {
                    console.error('push failed', err.statusCode || err.message);
                }
            }
        }));
    } catch (err) {
        console.error('notifyScheduleChanged', err.message);
    }
}

// The page needs the server's public key to subscribe
app.get('/api/public/push-key', async (req, res) => {
    try {
        if (!await requirePublicToken(req, res)) return;
        res.json({ key: await ensureVapid() });
    } catch (err) {
        handleError(res, err, 'Loading push key');
    }
});

app.post('/api/public/push-subscribe', async (req, res) => {
    try {
        if (!await requirePublicToken(req, res)) return;
        const { endpoint, keys, label } = req.body || {};
        if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
            return res.status(400).json({ error: 'A complete subscription is required.' });
        }
        await pool.query(
            `INSERT INTO push_subscriptions (endpoint, p256dh, auth, label)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
            [endpoint, keys.p256dh, keys.auth, String(label || '').slice(0, 60)]);
        res.json({ ok: true });
    } catch (err) {
        handleError(res, err, 'Subscribing to push');
    }
});

app.post('/api/public/push-unsubscribe', async (req, res) => {
    try {
        if (!await requirePublicToken(req, res)) return;
        await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1',
            [(req.body || {}).endpoint || '']);
        res.json({ ok: true });
    } catch (err) {
        handleError(res, err, 'Unsubscribing from push');
    }
});

// One instructor can run two overlapping rides; both rides carry the clash so
// the schedule can flag it on either side. rideId -> guideId -> minutes.
function staffOverlapMap(dayRides) {
    const toMin = (t) => {
        const [h, m] = String(t).split(':').map(Number);
        return h * 60 + (m || 0);
    };
    const map = {};
    const timed = dayRides.filter((r) => !r.all_day && r.guides.length);
    const mark = (r, gid, mins) => {
        const byGuide = map[r.id] = map[r.id] || {};
        byGuide[gid] = Math.max(byGuide[gid] || 0, mins);
    };
    timed.forEach((a, i) => {
        const aS = toMin(a.start_time), aE = aS + (a.duration_min || 60);
        timed.slice(i + 1).forEach((b) => {
            const bS = toMin(b.start_time), bE = bS + (b.duration_min || 60);
            const mins = Math.min(aE, bE) - Math.max(aS, bS);
            if (mins <= 0) return;
            a.guides.forEach((ga) => b.guides.forEach((gb) => {
                if (String(ga.guide_id) !== String(gb.guide_id)) return;
                mark(a, String(ga.guide_id), mins);
                mark(b, String(gb.guide_id), mins);
            }));
        });
    });
    return map;
}

app.get('/api/public/schedule', async (req, res) => {
    try {
        if (!await requirePublicToken(req, res)) return;
        const { from, to } = req.query;
        if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '') || from > to ||
            datesInRange(from, to).length > 14) {
            return res.status(400).json({ error: 'Valid from/to dates are required (max 14 days).' });
        }
        const rides = await fetchRides(from, to);
        const { rows: settingRows } = await pool.query(
            "SELECT value FROM settings WHERE key = 'business_name'");
        res.json({
            business_name: (settingRows[0] || {}).value || 'Riding school',
            days: datesInRange(from, to).map((date) => ({
                date,
                rides: ((dayRides, clash) => dayRides
                    .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))
                    .map((r) => ({
                        start_time: String(r.start_time).slice(0, 5),
                        duration_min: r.duration_min,
                        level: r.level,
                        venue: r.venue,
                        is_block: r.is_block,
                        instructor_notes: r.instructor_notes || '',
                        riders: r.participants.filter((p) => p.contact_id).map((p) => ({
                            name: p.contact_name,
                            horse: p.horse_name,
                            alt_horse: p.alt_horse_name,
                            pickup: p.needs_collection
                                ? [p.collection_teacher, p.collection_class].filter(Boolean).join(', ') || 'yes'
                                : null
                        })),
                        horses_only: r.participants.filter((p) => !p.contact_id && p.horse_name)
                            .map((p) => p.horse_name),
                        off_riders: (r.off_riders || []).map((o) => ({
                            name: o.contact_name, frequency: o.frequency, next_date: o.next_date
                        })),
                        cancellations: (r.cancellations || []).map((c) => ({
                            name: c.contact_name, kind: c.kind
                        })),
                        staff: r.guides.map((g) => ({
                            name: g.guide_name, assistant: g.is_assistant,
                            color: g.guide_color, mode: g.mode, horse: g.horse_name,
                            overlap_min: (clash[r.id] || {})[String(g.guide_id)] || 0
                        }))
                    })))(rides.filter((r) => r.date === date && !r.all_day),
                         staffOverlapMap(rides.filter((r) => r.date === date)))
            }))
        });
    } catch (err) {
        handleError(res, err, 'Loading public schedule');
    }
});

// The shareable page itself (the token travels in the query string)
app.get('/schedule', (req, res) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.sendFile(path.join(__dirname, 'public', 'schedule.html'));
});

// SPA fallback
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Expired sessions serve no purpose and are one more thing to steal
setInterval(() => {
    pool.query('DELETE FROM sessions WHERE expires_at < now()')
        .catch((err) => console.error('Session cleanup failed:', err));
}, 6 * 3600 * 1000).unref();

// In production only Caddy talks to us, so don't listen on public interfaces
const HOST = process.env.BIND_HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0');
app.listen(PORT, HOST, () => {
    console.log(`SVSH running on http://${HOST}:${PORT}`);
});