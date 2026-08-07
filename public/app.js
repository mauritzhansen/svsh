/* StableBook frontend - small hash-routed SPA, no frameworks */
(() => {
    'use strict';

    const state = {
        user: null,
        setupRequired: false,
        horses: [],
        rideTypes: [],
        contacts: [],
        users: [],
        guides: [],
        settings: {},
        calendarDate: todayStr()
    };

    const $view = document.getElementById('view');
    const $topbar = document.getElementById('topbar');
    const $nav = document.getElementById('bottomnav');

    // ---------- Helpers ----------
    function todayStr() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g,
            (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function money(cents) {
        const cur = state.settings.currency || 'R';
        return `${cur} ${((cents || 0) / 100).toFixed(2)}`;
    }

    function hhmm(t) { return String(t || '').slice(0, 5); }

    // Font Awesome Pro 7.1.0 (solid), inlined as SVG
    const ICON_X = '<svg viewBox="0 0 384 512" width="17" height="17" style="fill:currentColor;display:block" aria-hidden="true"><path d="M55.1 73.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L147.2 256 9.9 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192.5 301.3 329.9 438.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.8 256 375.1 118.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192.5 210.7 55.1 73.4z"/></svg>';
    const ICON_ROTATE = '<svg viewBox="0 0 512 512" width="17" height="17" style="fill:currentColor;display:block" aria-hidden="true"><path d="M488 192l-144 0c-9.7 0-18.5-5.8-22.2-14.8s-1.7-19.3 5.2-26.2l46.7-46.7c-75.3-58.6-184.3-53.3-253.5 15.9-75 75-75 196.5 0 271.5s196.5 75 271.5 0c8.2-8.2 15.5-16.9 21.9-26.1 10.1-14.5 30.1-18 44.6-7.9s18 30.1 7.9 44.6c-8.5 12.2-18.2 23.8-29.1 34.7-100 100-262.1 100-362 0S-25 175 75 75c94.3-94.3 243.7-99.6 344.3-16.2L471 7c6.9-6.9 17.2-8.9 26.2-5.2S512 14.3 512 24l0 144c0 13.3-10.7 24-24 24z"/></svg>';

    function shiftDate(dateStr, days) {
        const d = new Date(dateStr + 'T00:00:00');
        d.setDate(d.getDate() + days);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function fmtDate(dateStr) {
        return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB',
            { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }

    const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    let toastTimer = null;
    function toast(msg, isError) {
        const el = document.getElementById('toast');
        el.textContent = msg;
        el.classList.toggle('error', !!isError);
        el.classList.remove('hidden');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
    }

    async function api(method, url, body) {
        const opts = { method, headers: {} };
        if (body !== undefined) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(url, opts);
        let data = null;
        try { data = await res.json(); } catch (e) { /* non-JSON */ }
        if (res.status === 401 && state.user) {
            state.user = null;
            renderLogin();
            throw new Error('Session expired, please log in again.');
        }
        if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
        return data;
    }

    function canInvoice() { return state.user && ['admin', 'helper'].includes(state.user.role); }
    function isAdmin() { return state.user && state.user.role === 'admin'; }

    // ---------- Dialog ----------
    const $backdrop = document.getElementById('dialog-backdrop');
    const $dialog = document.getElementById('dialog');

    function openDialog(html) {
        $dialog.innerHTML = html;
        $backdrop.classList.remove('hidden');
        enhanceTimeInputs($dialog);
    }

    // ---------- Time picker (replaces the platform-dependent native widget) ----------
    const pad2 = (n) => String(n).padStart(2, '0');

    function openTimePicker(current, onPick) {
        let [h, m] = /^\d{2}:\d{2}/.test(current || '') ? current.split(':').map(Number) : [9, 0];
        const oddMinute = [0, 15, 30, 45].includes(m) ? null : m; // keep e.g. 14:55 pickable
        const overlay = document.createElement('div');
        overlay.className = 'timepick-backdrop';
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        const render = () => {
            overlay.innerHTML = `
                <div class="timepick">
                    <div class="timepick-value">${pad2(h)}:${pad2(m)}</div>
                    <div class="timepick-label">Hour</div>
                    <div class="timepick-grid">
                        ${Array.from({ length: 24 }, (_, i) =>
                            `<button class="timepick-btn ${i === h ? 'sel' : ''}" data-h="${i}">${pad2(i)}</button>`).join('')}
                    </div>
                    <div class="timepick-label">Minutes</div>
                    <div class="timepick-grid timepick-mins">
                        ${[0, 15, 30, 45].concat(oddMinute === null ? [] : [oddMinute]).sort((a, b) => a - b).map((mm) =>
                            `<button class="timepick-btn ${mm === m ? 'sel' : ''}" data-m="${mm}">${pad2(mm)}</button>`).join('')}
                    </div>
                    <div class="form-actions">
                        <button class="secondary tp-cancel">Cancel</button>
                        <button class="tp-ok">OK</button>
                    </div>
                </div>`;
            overlay.querySelectorAll('[data-h]').forEach((b) =>
                b.addEventListener('click', () => { h = Number(b.getAttribute('data-h')); render(); }));
            overlay.querySelectorAll('[data-m]').forEach((b) =>
                b.addEventListener('click', () => { m = Number(b.getAttribute('data-m')); render(); }));
            overlay.querySelector('.tp-ok').addEventListener('click', () => { close(); onPick(`${pad2(h)}:${pad2(m)}`); });
            overlay.querySelector('.tp-cancel').addEventListener('click', close);
        };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        render();
    }

    // Turns every native time input inside `root` into a trigger for our picker
    function enhanceTimeInputs(root) {
        root.querySelectorAll('input[type="time"]').forEach((inp) => {
            inp.readOnly = true; // suppresses the platform widget and keyboard
            inp.addEventListener('click', (e) => {
                e.preventDefault();
                inp.blur();
                openTimePicker(inp.value, (val) => {
                    inp.value = val;
                    inp.dispatchEvent(new Event('change', { bubbles: true }));
                });
            });
        });
    }

    function closeDialog() {
        $backdrop.classList.add('hidden');
        $dialog.innerHTML = '';
    }

    $backdrop.addEventListener('click', (e) => { if (e.target === $backdrop) closeDialog(); });

    function dialogError(msg) {
        const el = $dialog.querySelector('.form-error');
        if (el) el.textContent = msg;
    }

    // ---------- Reference data ----------
    async function loadRefData() {
        const [horses, rideTypes, contacts, users, guides, settings] = await Promise.all([
            api('GET', '/api/horses'),
            api('GET', '/api/ride-types'),
            api('GET', '/api/contacts'),
            api('GET', '/api/users'),
            api('GET', '/api/guides'),
            api('GET', '/api/settings')
        ]);
        state.horses = horses.horses;
        state.rideTypes = rideTypes.ride_types;
        state.contacts = contacts.contacts;
        state.users = users.users;
        state.guides = guides.guides;
        state.settings = settings.settings;
    }

    function activeHorses() { return state.horses.filter((h) => h.active); }
    function activeRideTypes() { return state.rideTypes.filter((t) => t.active); }

    // busy (optional Set of ids): hide those entries — except the currently
    // selected one, so an existing choice stays visible when editing.
    function keepOption(id, selectedId, busy) {
        return !busy || !busy.has(String(id)) || String(id) === String(selectedId);
    }

    function contactOptions(selectedId, emptyLabel, busy) {
        return `<option value="">${esc(emptyLabel || '')}</option>` +
            state.contacts.filter((c) => keepOption(c.id, selectedId, busy)).map((c) =>
                `<option value="${c.id}" ${String(selectedId) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    }

    function horseOptions(selectedId, busy) {
        return activeHorses().filter((h) => keepOption(h.id, selectedId, busy)).map((h) =>
            `<option value="${h.id}" ${String(selectedId) === String(h.id) ? 'selected' : ''}>${esc(h.name)}</option>`).join('');
    }

    function rideTypeOptions(selectedId) {
        return '<option value="">(none)</option>' + activeRideTypes().map((t) =>
            `<option value="${t.id}" ${String(selectedId) === String(t.id) ? 'selected' : ''}>${esc(t.name)} — ${money(t.price_cents)}</option>`).join('');
    }

    function guideOptions(selectedId, busy) {
        return '<option value="">(no instructor)</option>' +
            state.guides.filter((g) => g.active && keepOption(g.id, selectedId, busy)).map((g) =>
                `<option value="${g.id}" ${String(selectedId) === String(g.id) ? 'selected' : ''}>${esc(g.name)}${g.is_assistant ? ' (ass)' : ''}</option>`).join('');
    }

    // Possible parents: contacts that are not riders themselves (and not the contact being edited)
    function parentOptions(selectedId, excludeId) {
        return '<option value="">(none — pays own invoices)</option>' +
            state.contacts.filter((c) => !c.parent_id && String(c.id) !== String(excludeId)).map((c) =>
                `<option value="${c.id}" ${String(selectedId) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    }

    // ---------- Router ----------
    function route() {
        const hash = location.hash || '#/calendar';
        const parts = hash.slice(2).split('/');
        document.querySelectorAll('#bottomnav [data-nav]').forEach((btn) => {
            btn.classList.toggle('active', hash.startsWith('#/' + btn.getAttribute('data-nav')) ||
                (btn.getAttribute('data-nav') === 'calendar' && hash.startsWith('#/fixed')));
        });
        if (!state.user) return renderLogin();
        if (parts[0] === 'calendar') {
            if (/^\d{4}-\d{2}-\d{2}$/.test(parts[1] || '')) state.calendarDate = parts[1];
            return renderCalendar();
        }
        if (parts[0] === 'contacts' && parts[1]) return renderContactDetail(parts[1]);
        if (parts[0] === 'contacts') return renderContacts();
        if (parts[0] === 'invoices') return renderInvoices();
        if (parts[0] === 'todos') return renderTodos();
        if (parts[0] === 'reports') return renderReports();
        if (parts[0] === 'fixed') return renderFixed();
        if (parts[0] === 'settings') return renderSettings();
        renderCalendar();
    }

    window.addEventListener('hashchange', route);
    document.querySelectorAll('#bottomnav [data-nav]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const target = '#/' + btn.getAttribute('data-nav');
            if (location.hash === target) route(); // tapping the current tab refreshes it
            else location.hash = target;
        });
    });

    // ---------- Login / setup ----------
    function renderLogin() {
        $topbar.classList.add('hidden');
        $nav.classList.add('hidden');
        const setup = state.setupRequired;
        $view.innerHTML = `
            <div class="login-wrap card">
                <div class="login-logo">🐴</div>
                <h1>Sweet Valley School of Horsemanship</h1>
                ${setup ? '<p class="muted">Welcome! Create the first (admin) account to get started.</p>' : ''}
                ${setup ? '<label>Your name</label><input id="login-name" autocomplete="name">' : ''}
                <label>Email</label>
                <input id="login-email" type="email" autocomplete="username" inputmode="email">
                <label>Password</label>
                <input id="login-password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}">
                <div class="form-error" id="login-error"></div>
                <button id="login-btn">${setup ? 'Create account' : 'Log in'}</button>
            </div>`;
        const submit = async () => {
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            try {
                let data;
                if (setup) {
                    data = await api('POST', '/api/auth/setup',
                        { email, password, display_name: document.getElementById('login-name').value });
                } else {
                    data = await api('POST', '/api/auth/login', { email, password });
                }
                state.user = data.user;
                state.setupRequired = false;
                await loadRefData();
                showShell();
                location.hash = '#/calendar';
                route();
            } catch (err) {
                document.getElementById('login-error').textContent = err.message;
            }
        };
        document.getElementById('login-btn').addEventListener('click', submit);
        $view.querySelectorAll('input').forEach((el) =>
            el.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); }));
    }

    function showShell() {
        $topbar.classList.remove('hidden');
        $nav.classList.remove('hidden');
    }

    // ---------- Calendar ----------
    // Fixed colour per experience level; rides without a level are brown-grey
    const LEVEL_COLORS = {
        'beginner': '#616161',              // gray
        'beginner-intermediate': '#a67f00', // gold
        'intermediate': '#1565c0',          // blue
        'intermediate-advanced': '#e65100', // orange
        'advanced': '#8e24aa'               // purple
    };
    const LEVELS = Object.keys(LEVEL_COLORS);
    const LEVEL_LABELS = {
        'beginner': 'Beginner',
        'beginner-intermediate': 'Beg–Int',
        'intermediate': 'Intermediate',
        'intermediate-advanced': 'Int–Adv',
        'advanced': 'Advanced'
    };
    const DEFAULT_RIDE_COLOR = '#8a6d4f';
    const rideColor = (r) => LEVEL_COLORS[r.level] || DEFAULT_RIDE_COLOR;
    const MODE_ICON = { foot: '', running: '🏃', cycling: '🚴', horse: '' };
    const levelOptions = (selected) => '<option value="">(no level)</option>' +
        LEVELS.map((l) => `<option value="${l}" ${selected === l ? 'selected' : ''}>${LEVEL_LABELS[l]}</option>`).join('');
    const guideDisplayName = (g) => `${g.guide_name || g.name}${(g.is_assistant) ? ' (ass)' : ''}`;

    // "Lily Smith" -> "Lily S"; single-word names stay as they are
    function shortName(full) {
        const parts = String(full || '').trim().split(/\s+/);
        return parts.length > 1 ? `${parts[0]} ${parts[1][0]}` : parts[0];
    }

    function contactById(id) {
        return state.contacts.find((c) => String(c.id) === String(id));
    }

    // {preferred: Set<horse_id>, caution: Map<horse_id, reason>} for a contact
    function prefsFor(contactId) {
        const prefs = { preferred: new Set(), caution: new Map() };
        const c = contactById(contactId);
        (c && c.horse_prefs || []).forEach((p) => {
            if (p.kind === 'preferred') prefs.preferred.add(String(p.horse_id));
            else prefs.caution.set(String(p.horse_id), p.reason || '');
        });
        return prefs;
    }

    function isoDow(dateStr) {
        const d = new Date(dateStr + 'T00:00:00').getDay();
        return d === 0 ? 7 : d;
    }

    // Does this contact have a term pass covering the given date?
    function hasPassOn(c, dateStr) {
        return ((c && c.term_passes) || []).some((tp) =>
            tp.period_start <= dateStr && dateStr <= tp.period_end);
    }

    // A billable "extra" seat: rider has a term pass for the date, but the seat
    // is neither a fixed lesson nor a reschedule make-up
    function isExtraSeat(p) {
        return !!(p.contact_id && p.in_pass_period && !p.from_recurring && !p.credit_used);
    }

    // No availability windows at all = no restriction. With windows, the whole
    // ride [startMin, startMin+durMin) must fall inside one window that weekday.
    function contactAvailable(c, weekday, startMin, durMin) {
        const av = (c && c.availability) || [];
        if (!av.length) return true;
        return av.some((a) => a.weekday === weekday &&
            toMin(a.start_time) <= startMin && toMin(a.end_time) >= startMin + durMin);
    }

    function dayTimes(rides) {
        const set = new Set();
        const startH = parseInt((state.settings.day_start || '08:00').slice(0, 2), 10);
        const endH = parseInt((state.settings.day_end || '17:00').slice(0, 2), 10);
        for (let h = startH; h <= endH; h++) set.add(String(h).padStart(2, '0') + ':00');
        rides.forEach((r) => { if (!r.all_day) set.add(hhmm(r.start_time)); });
        return [...set].sort();
    }

    function toMin(t) {
        const [h, m] = String(t).split(':').map(Number);
        return h * 60 + (m || 0);
    }

    // Who/what is occupied during [time, time + durationMin)? Partial overlaps
    // count — an existing ride blocks its whole duration (60 min if no type).
    // All-day blocks occupy every time of the day.
    function busyAt(rides, time, excludeRideId, durationMin) {
        const start = toMin(time);
        const end = start + (durationMin || 60);
        const horses = new Set(), contacts = new Set(), guides = new Set();
        rides.forEach((r) => {
            if (!r.all_day) {
                const s = toMin(hhmm(r.start_time));
                if (s + (r.duration_min || 60) <= start || s >= end) return;
            }
            if (excludeRideId && String(r.id) === String(excludeRideId)) return;
            r.participants.forEach((p) => {
                horses.add(String(p.horse_id));
                if (p.contact_id) contacts.add(String(p.contact_id));
            });
            r.guides.forEach((g) => {
                guides.add(String(g.guide_id));
                if (g.horse_id) horses.add(String(g.horse_id));
            });
        });
        return { horses, contacts, guides };
    }

    // Rides + minutes per horse for a day (rider seats and instructor mounts;
    // blocks don't count as work)
    function horseDayLoad(rides) {
        const load = {}; // horseId -> {count, minutes}
        rides.forEach((r) => {
            if (r.is_block || r.all_day) return;
            const dur = r.duration_min || 60;
            const add = (hid) => {
                if (!hid) return;
                const l = load[hid] = load[hid] || { count: 0, minutes: 0 };
                l.count++;
                l.minutes += dur;
            };
            r.participants.forEach((p) => add(p.horse_id));
            r.guides.forEach((g) => { if (g.mode === 'horse') add(g.horse_id); });
        });
        return load;
    }

    function fmtMinutes(min) {
        const h = Math.floor(min / 60), m = min % 60;
        return h ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : `${m}min`;
    }

    // Custom month-grid date picker in the app's own dialog (the native
    // input's popover is tiny and unstylable)
    function shiftMonth(view, delta) {
        const [y, m] = view.split('-').map(Number);
        const d = new Date(y, m - 1 + delta, 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    function openDatePicker(current) {
        let view = current.slice(0, 7); // YYYY-MM shown
        const render = () => {
            const [y, m] = view.split('-').map(Number);
            const first = new Date(y, m - 1, 1);
            const label = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
            const startOffset = (first.getDay() + 6) % 7; // Monday-first
            const daysInMonth = new Date(y, m, 0).getDate();
            const fmt = (d) => `${view}-${String(d).padStart(2, '0')}`;
            const cells = [...Array(startOffset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
            openDialog(`
                <div class="datepick-nav">
                    <button class="secondary" id="dp-prev">‹</button>
                    <h2 style="margin:0">${label}</h2>
                    <button class="secondary" id="dp-next">›</button>
                </div>
                <div class="datepick-grid">
                    ${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => `<div class="datepick-head">${d}</div>`).join('')}
                    ${cells.map((d) => d === null ? '<div></div>' : `
                        <button class="datepick-day ${fmt(d) === current ? 'selected' : ''} ${fmt(d) === todayStr() ? 'today' : ''}"
                                data-pick="${fmt(d)}">${d}</button>`).join('')}
                </div>
                <div class="form-actions">
                    <button class="secondary" id="dp-today">Today</button>
                    <span class="spacer"></span>
                    <button class="secondary" id="dp-cancel">Cancel</button>
                </div>`);
            document.getElementById('dp-cancel').addEventListener('click', closeDialog);
            document.getElementById('dp-today').addEventListener('click', () => {
                closeDialog();
                location.hash = '#/calendar/' + todayStr();
            });
            document.getElementById('dp-prev').addEventListener('click', () => { view = shiftMonth(view, -1); render(); });
            document.getElementById('dp-next').addEventListener('click', () => { view = shiftMonth(view, 1); render(); });
            $dialog.querySelectorAll('[data-pick]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    closeDialog();
                    location.hash = '#/calendar/' + btn.getAttribute('data-pick');
                });
            });
        };
        render();
    }

    async function renderCalendar() {
        const date = state.calendarDate;
        const shortDate = new Date(date + 'T00:00:00').toLocaleDateString('en-GB',
            { weekday: 'short', day: 'numeric', month: 'short' });
        $view.innerHTML = `
            <div class="day-header">
                <button class="secondary daynav" id="cal-prev">‹</button>
                <button class="secondary" id="cal-date-btn">📅 ${esc(shortDate)}</button>
                <button class="secondary daynav" id="cal-today">Today</button>
                <button class="secondary daynav" id="cal-next">›</button>
                <span class="spacer"></span>
                <button class="secondary daynav" id="cal-horses">🐴 Horses</button>
                <div class="day-title">${esc(fmtDate(date))}</div>
            </div>
            <div id="horse-drawer-backdrop" class="hidden">
                <div id="horse-drawer"></div>
            </div>
            <div id="credit-bar"></div>
            <div id="cal-grid" class="muted">Loading…</div>
            <p class="muted" style="margin:8px 2px">Tap an <b>empty cell</b> to plan a ride on that horse at that time, or tap a ride to change it. Colours show the ride's level; "(guide)" marks the horse the guide rides.</p>
            <div class="calendar-legend">
                <span class="legend-pill" style="background:var(--open-bg);border-color:#9fcba2;color:var(--open)">Open seat</span>
                ${LEVELS.map((l) => `<span class="legend-pill" style="background:color-mix(in srgb, ${LEVEL_COLORS[l]} 26%, white);border-color:color-mix(in srgb, ${LEVEL_COLORS[l]} 60%, white);color:${LEVEL_COLORS[l]}">${LEVEL_LABELS[l]}</span>`).join('')}
                <span class="legend-pill" style="background:color-mix(in srgb, ${DEFAULT_RIDE_COLOR} 26%, white);border-color:color-mix(in srgb, ${DEFAULT_RIDE_COLOR} 60%, white);color:${DEFAULT_RIDE_COLOR}">No level</span>
                <span class="legend-pill" style="background:var(--blocked-bg);border-color:#ddd;color:#777">Blocked</span>
            </div>
            <div class="fab-row">
                <button id="cal-add">＋ New ride</button>
                <a class="btn secondary" href="#/fixed">🔁 Fixed slots</a>
            </div>`;
        document.getElementById('cal-prev').addEventListener('click', () => { location.hash = '#/calendar/' + shiftDate(date, -1); });
        document.getElementById('cal-next').addEventListener('click', () => { location.hash = '#/calendar/' + shiftDate(date, 1); });
        document.getElementById('cal-today').addEventListener('click', () => { location.hash = '#/calendar/' + todayStr(); });
        document.getElementById('cal-date-btn').addEventListener('click', () => openDatePicker(date));
        let dayRides = [];
        document.getElementById('cal-add').addEventListener('click', () =>
            openRideDialog(null, { date, time: (state.settings.day_start || '08:00'), dayRides }));

        try {
            const [ridesData, creditsData] = await Promise.all([
                api('GET', `/api/rides?from=${date}&to=${date}`),
                api('GET', '/api/credits')
            ]);
            dayRides = ridesData.rides;
            drawDayGrid(dayRides, date);

            // Slide-out horse availability panel (alphabetical, with day load)
            const drawerLoad = horseDayLoad(dayRides);
            const dayBlockedIds = new Set();
            dayRides.forEach((r) => {
                if (r.is_block && r.all_day) r.participants.forEach((p) => dayBlockedIds.add(String(p.horse_id)));
            });
            const $backdrop2 = document.getElementById('horse-drawer-backdrop');
            document.getElementById('horse-drawer').innerHTML =
                `<h2 style="margin-top:0">🐴 Horses — ${esc(shortDate)}</h2>` +
                [...activeHorses()].sort((a, b) => a.name.localeCompare(b.name)).map((h) => {
                    const l = drawerLoad[h.id];
                    const status = dayBlockedIds.has(String(h.id))
                        ? '<span class="chip draft">blocked</span>'
                        : l ? `${l.count} ride${l.count === 1 ? '' : 's'} · ${fmtMinutes(l.minutes)}`
                        : '<span class="chip paid">free</span>';
                    return `<div class="drawer-row">
                        <span class="horse-dot" style="background:${esc(h.color)}"></span>
                        <span class="drawer-name">${esc(h.name)}</span>
                        <span class="drawer-load">${status}</span>
                    </div>`;
                }).join('');
            document.getElementById('cal-horses').addEventListener('click', () => $backdrop2.classList.remove('hidden'));
            $backdrop2.addEventListener('click', (e) => { if (e.target === $backdrop2) $backdrop2.classList.add('hidden'); });
            const $cb = document.getElementById('credit-bar');
            if ($cb && creditsData.credits.length) {
                $cb.innerHTML = `
                    <div class="credit-bar">
                        <b>⟳ To reschedule:</b>
                        ${creditsData.credits.map((cr) => {
                            const c = contactById(cr.contact_id);
                            const lvl = c && c.experience
                                ? ` <span class="chip-level">${LEVEL_LABELS[c.experience]}</span>` : '';
                            return `
                            <button class="month-pill credit-chip" data-credit-contact="${cr.contact_id}">
                                ${esc(cr.name)}${lvl}${cr.count > 1 ? ' ×' + cr.count : ''}</button>`;
                        }).join('')}
                    </div>`;
                $cb.querySelectorAll('[data-credit-contact]').forEach((btn) => {
                    btn.addEventListener('click', () => {
                        const cr = creditsData.credits.find((x) =>
                            String(x.contact_id) === btn.getAttribute('data-credit-contact'));
                        openReschedulePicker(cr, date, dayRides);
                    });
                });
            }
        } catch (err) {
            document.getElementById('cal-grid').textContent = err.message;
        }
    }

    // Pick one of the day's rides to put a rescheduled rider on
    function openReschedulePicker(credit, date, dayRides) {
        const candidates = dayRides.filter((r) => !r.is_block && !r.all_day && !r.invoiced &&
            !r.participants.some((p) => String(p.contact_id) === String(credit.contact_id)));
        openDialog(`
            <h2>⟳ Reschedule ${esc(credit.name)}</h2>
            <p class="muted">${credit.count} open reschedule ride${credit.count === 1 ? '' : 's'}.
               Pick a ride on ${esc(fmtDate(date))} to add ${esc(credit.name)} to —
               the credit is only used when you save the ride.</p>
            ${candidates.length ? candidates.map((r) => `
                <div class="list-item" data-pick-ride="${r.id}">
                    <span class="legend-chip" style="background:color-mix(in srgb, ${rideColor(r)} 26%, white);border:1px solid ${rideColor(r)}"></span>
                    <div class="li-main">
                        <div class="li-title">${hhmm(r.start_time)}${r.level ? ' · ' + LEVEL_LABELS[r.level] : ''}</div>
                        <div class="li-sub">${r.participants.filter((p) => p.contact_id).map((p) => esc(p.contact_name)).join(', ') || 'no riders yet'}</div>
                        <div class="li-sub">${r.guides.map((g) => esc(guideDisplayName(g))).join(', ')}</div>
                    </div>
                </div>`).join('')
                : '<div class="card muted">No suitable rides on this day — go to another day and tap the name there.</div>'}
            <div class="form-actions"><button class="secondary" id="rs-cancel">Cancel</button></div>`);
        document.getElementById('rs-cancel').addEventListener('click', closeDialog);
        $dialog.querySelectorAll('[data-pick-ride]').forEach((el) => {
            el.addEventListener('click', () => {
                const ride = dayRides.find((r) => String(r.id) === el.getAttribute('data-pick-ride'));
                closeDialog();
                openRideDialog(ride, {
                    date, dayRides,
                    addContactId: credit.contact_id,
                    addContactName: credit.name
                });
            });
        });
    }

    function drawDayGrid(rides, date) {
        const grid = document.getElementById('cal-grid');
        if (!grid) return;
        const horses = activeHorses();
        if (!horses.length) {
            grid.innerHTML = '<div class="card">No horses yet — add them under Settings.</div>';
            return;
        }
        const times = dayTimes(rides);

        // Horses blocked for the whole day (all-day block rides)
        const dayBlocks = {};
        rides.forEach((r) => {
            if (r.is_block && r.all_day) r.participants.forEach((p) => { dayBlocks[p.horse_id] = r; });
        });

        // One cell per (horse, time); cells of the same ride share the colour
        // of the ride's experience level. Seats without a horse stack up in
        // the "No horse yet" column instead.
        const cells = {};
        const unassigned = {}; // time -> [{ride, color, seats}]
        rides.filter((r) => !r.all_day).forEach((r) => {
            const color = rideColor(r);
            const time = hhmm(r.start_time);
            const footGuides = r.guides
                .filter((g) => g.mode !== 'horse')
                .map((g) => `${guideDisplayName(g)}${MODE_ICON[g.mode] ? ' ' + MODE_ICON[g.mode] : ''}`).join(', ');
            const onceOff = !r.is_block && !r.recurring_id;
            const horseless = r.participants.filter((p) => !p.horse_id);
            if (horseless.length) {
                (unassigned[time] = unassigned[time] || []).push({ ride: r, color, seats: horseless, footGuides, onceOff });
            } else if (!r.is_block && !r.participants.length && r.guides.length) {
                // Instructor-only booking (no student): show it in the planning column
                (unassigned[time] = unassigned[time] || []).push({ ride: r, color, seats: [], footGuides, onceOff, instructorOnly: true });
            }
            let first = !horseless.length; // instructor names go on the unassigned cell if there is one
            r.participants.filter((p) => p.horse_id).forEach((p) => {
                let label, cls;
                if (r.is_block) { label = 'Blocked'; cls = 'blocked'; }
                else if (p.contact_name) { label = p.contact_name; cls = 'booked'; }
                else { label = 'Open seat'; cls = 'open'; }
                let sub = r.is_block ? '' : (r.ride_type_name || '');
                if (first && footGuides) sub = `${sub ? sub + ' · ' : ''}${footGuides}`;
                cells[`${p.horse_id}|${time}`] = {
                    ride: r, color, cls, label, sub,
                    pickup: !r.is_block && !!p.contact_name && p.needs_collection,
                    onceOff: first && onceOff, // marked once per ride, next to the instructors
                    extra: !r.is_block && isExtraSeat(p)
                };
                first = false;
            });
            r.guides.filter((g) => g.mode === 'horse' && g.horse_id).forEach((g) => {
                cells[`${g.horse_id}|${time}`] = {
                    ride: r, color, cls: 'guide',
                    label: `${g.guide_name} (instructor)`, sub: r.ride_type_name || ''
                };
            });
        });
        // Planning column is always visible: horses are usually assigned only
        // on the morning itself, so future days are planned rider-first here.
        const hasUnassigned = true;

        let html = '<div class="calendar-scroller"><table class="daygrid"><tr><th class="timecol">Time</th>';
        if (hasUnassigned) html += '<th class="unassigned-col">🐴? No horse yet</th>';
        const load = horseDayLoad(rides);
        horses.forEach((h) => {
            const blocked = dayBlocks[h.id];
            const l = load[h.id];
            const loadHtml = blocked ? ''
                : l ? `<div class="horse-load">${l.count} ride${l.count === 1 ? '' : 's'} · ${fmtMinutes(l.minutes)}</div>`
                : '<div class="horse-load free">free</div>';
            html += `<th class="${blocked ? 'blocked-th' : ''}">
                <span class="horse-dot" style="background:${esc(h.color)}"></span>${esc(h.name)}
                <button class="horse-block-btn" data-block-horse="${h.id}"
                        title="${blocked ? 'Unblock ' + esc(h.name) : 'Block ' + esc(h.name) + ' for the whole day'}">
                    ${blocked ? '🔓' : '🚫'}
                </button>${loadHtml}</th>`;
        });
        html += '</tr>';
        const renderUnassigned = (e) => {
            const collect = e.seats.filter((s) => s.needs_collection).length;
            const label = e.instructorOnly
                ? e.ride.guides.map((g) => shortName(g.guide_name)).join(', ')
                : e.seats.map((s) => s.contact_name ? shortName(s.contact_name) : 'Open seat').join(', ');
            const subText = e.instructorOnly ? 'instructor only' : (e.footGuides || '');
            let subHtml = `${esc(subText)}${collect
                ? `${subText ? ' · ' : ''}<b>${collect} pick-up${collect === 1 ? '' : 's'}</b>` : ''}`;
            if (e.onceOff) subHtml += `${subHtml ? ' · ' : ''}<b>once-off</b>`;
            const extraNames = e.seats.filter(isExtraSeat).map((s) => shortName(s.contact_name));
            if (extraNames.length) subHtml += `${subHtml ? ' · ' : ''}<b>extra: ${esc(extraNames.join(', '))}</b>`;
            const border = e.instructorOnly ? `1px solid ${e.color}` : `1.5px dashed ${e.color}`;
            return `<button class="slot booked ${e.instructorOnly ? '' : 'needs-horse'} ${e.ride.invoiced ? 'invoiced' : ''}"
                        style="background:color-mix(in srgb, ${e.color} 26%, white);border:${border};color:${e.color};border-left:4px solid ${e.color}"
                        data-ride-id="${e.ride.id}">
                        <span class="slot-line">${e.instructorOnly ? '👤 ' : '⚠ '}${esc(label)}</span>
                        ${subHtml ? `<span class="slot-line slot-sub">${subHtml}</span>` : ''}
                    </button>`;
        };

        // One sub-row per ride within a time slot, so a ride's horse cells sit
        // on the same line as its "No horse yet" entry.
        times.forEach((time, ti) => {
            const timeRides = rides.filter((r) => !r.all_day && hhmm(r.start_time) === time);
            const subRows = Math.max(1, timeRides.length);
            for (let ri = 0; ri < subRows; ri++) {
                const ride = timeRides[ri] || null;
                html += '<tr>';
                if (ri === 0) html += `<td class="timecol" rowspan="${subRows}">${esc(time)}</td>`;
                if (hasUnassigned) {
                    const entry = ride && (unassigned[time] || []).find((e) => e.ride === ride);
                    html += `<td class="unassigned-cell" data-un-time="${time}">${entry ? renderUnassigned(entry) : ''}</td>`;
                }
                horses.forEach((h, i) => {
                    if (dayBlocks[h.id]) {
                        if (ri === 0) html += `<td class="blocked-col" rowspan="${subRows}">${ti === 0 ? '🚫 Blocked all day' : ''}</td>`;
                        return;
                    }
                    const cell = cells[`${h.id}|${time}`];
                    if (!cell) {
                        // free the whole time row for tapping
                        if (ri === 0) html += `<td class="empty-cell" rowspan="${subRows}" data-time="${time}" data-horse="${h.id}"></td>`;
                        return;
                    }
                    if (!ride || cell.ride !== ride) {
                        // this horse's cell belongs to another ride's sub-row
                        html += '<td class="filler-cell"></td>';
                        return;
                    }
                    const r = cell.ride;
                    // Same-ride cells share the ride colour; adjacent ones fuse
                    // into one continuous bar with a thin internal divider.
                    const joinL = i > 0 && cells[`${horses[i - 1].id}|${time}`]?.ride === r;
                    const joinR = i < horses.length - 1 && cells[`${horses[i + 1].id}|${time}`]?.ride === r;
                    let style = '';
                    if (cell.cls === 'booked' || cell.cls === 'guide') {
                        style += `background:color-mix(in srgb, ${cell.color} 26%, white);` +
                                 `border-color:color-mix(in srgb, ${cell.color} 60%, white);` +
                                 `color:${cell.color};`;
                    }
                    style += joinL
                        ? 'border-top-left-radius:0;border-bottom-left-radius:0;' +
                          'margin-left:-9px;width:calc(100% + 9px);' +
                          `border-left:1px dashed color-mix(in srgb, ${cell.color} 60%, white);`
                        : `border-left:4px solid ${cell.color};`;
                    if (joinR) style += 'border-top-right-radius:0;border-bottom-right-radius:0;';
                    let subHtml = `${esc(cell.sub || '')}${cell.pickup ? `${cell.sub ? ' · ' : ''}<b>pick-up</b>` : ''}`;
                    if (cell.onceOff) subHtml += `${subHtml ? ' · ' : ''}<b>once-off</b>`;
                    if (cell.extra) subHtml += `${subHtml ? ' · ' : ''}<b>extra — billed monthly</b>`;
                    html += `<td><button class="slot ${cell.cls} ${r.invoiced ? 'invoiced' : ''}"
                                style="${style}" data-ride-id="${r.id}">
                                <span class="slot-line">${esc(cell.label)}</span>
                                ${subHtml ? `<span class="slot-line slot-sub">${subHtml}</span>` : ''}
                             </button></td>`;
                });
                html += '</tr>';
            }
        });
        html += '</table></div>';
        grid.classList.remove('muted');
        grid.innerHTML = html;
        grid.querySelectorAll('[data-ride-id]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const ride = rides.find((r) => String(r.id) === btn.getAttribute('data-ride-id'));
                if (ride) openRideDialog(ride, { date, dayRides: rides });
            });
        });
        grid.querySelectorAll('.empty-cell').forEach((td) => {
            td.addEventListener('click', () => openRideDialog(null, {
                date,
                time: td.getAttribute('data-time'),
                horseId: td.getAttribute('data-horse'),
                dayRides: rides
            }));
        });
        // Empty space in the planning column starts a horseless ride at that time
        grid.querySelectorAll('.unassigned-cell').forEach((td) => {
            td.addEventListener('click', (e) => {
                if (e.target.closest('[data-ride-id]')) return;
                openRideDialog(null, {
                    date,
                    time: td.getAttribute('data-un-time'),
                    dayRides: rides
                });
            });
        });
        grid.querySelectorAll('[data-block-horse]').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const horse = horses.find((h) => String(h.id) === btn.getAttribute('data-block-horse'));
                const block = dayBlocks[horse.id];
                if (block) {
                    if (!confirm(`Unblock ${horse.name} for ${date}?`)) return;
                    try {
                        await api('DELETE', `/api/rides/${block.id}`);
                        toast(`${horse.name} is available again.`);
                        renderCalendar();
                    } catch (err) {
                        toast(err.message, true);
                    }
                } else {
                    openBlockDayDialog(horse, date, rides);
                }
            });
        });
    }

    // ---------- Block a horse for a whole day ----------
    async function createDayBlock(horseId, date) {
        await api('POST', '/api/rides', {
            date, start_time: '00:00', is_block: true, all_day: true,
            participants: [{ horse_id: horseId }]
        });
    }

    function openBlockDayDialog(horse, date, dayRides) {
        // Rides where this horse carries a rider or a guide (blocks at specific
        // times are also listed — they get moved or stand in the way the same way)
        const involved = dayRides.filter((r) => !(r.is_block && r.all_day) &&
            (r.participants.some((p) => String(p.horse_id) === String(horse.id)) ||
             r.guides.some((g) => String(g.horse_id) === String(horse.id))));

        if (!involved.length) {
            if (!confirm(`Block ${horse.name} for the whole day (${date})?`)) return;
            createDayBlock(horse.id, date)
                .then(() => { toast(`${horse.name} blocked for ${date}.`); renderCalendar(); })
                .catch((err) => toast(err.message, true));
            return;
        }

        const anyInvoiced = involved.some((r) => r.invoiced);
        const rows = involved.map((r) => {
            const time = hhmm(r.start_time);
            const part = r.participants.find((p) => String(p.horse_id) === String(horse.id));
            const gd = r.guides.find((g) => String(g.horse_id) === String(horse.id));
            const who = r.is_block ? 'Blocked'
                : part ? (part.contact_name || 'Open seat')
                : gd ? `${gd.guide_name} (guide)` : '';
            const label = `${time} · ${who}${r.ride_type_name ? ' · ' + r.ride_type_name : ''}`;
            if (r.invoiced) {
                return `<div class="pick-row"><div style="flex:2">${esc(label)}</div>
                        <div class="muted" style="flex:1">🧾 invoiced — cannot move</div></div>`;
            }
            // Horses still free during this ride's window. Don't exclude this
            // ride: only one seat moves, its other horses (incl. guide mounts)
            // stay occupied — and the moving horse itself is taken by definition.
            const taken = busyAt(dayRides, time, null, r.duration_min || 60).horses;
            const seatPrefs = part && part.contact_id ? prefsFor(part.contact_id) : null;
            const prefMark = (h) => !seatPrefs ? ''
                : seatPrefs.preferred.has(String(h.id)) ? '⭐ '
                : seatPrefs.caution.has(String(h.id)) ? '⚠ ' : '';
            const prefRank = (h) => !seatPrefs ? 1
                : seatPrefs.preferred.has(String(h.id)) ? 0
                : seatPrefs.caution.has(String(h.id)) ? 2 : 1;
            const free = activeHorses().filter((h) => !taken.has(String(h.id)))
                .sort((a, b) => prefRank(a) - prefRank(b));
            // No free horse (or by choice): the seat can be cancelled instead.
            // Whole ride goes only when this horse is its last participant.
            const cancelLabel = part
                ? (r.participants.length > 1 ? '✕ Remove rider from this ride' : '✕ Cancel this ride')
                : '✕ Remove guide from this ride';
            return `<div class="pick-row" data-move-ride="${r.id}">
                    <div style="flex:2">${esc(label)}</div>
                    <select class="mv-horse" style="flex:1">
                        ${free.map((h) => `<option value="${h.id}">${prefMark(h)}→ ${esc(h.name)}</option>`).join('')}
                        <option value="__cancel">${cancelLabel}</option>
                    </select>
                </div>`;
        }).join('');

        openDialog(`
            <h2>🚫 Block ${esc(horse.name)} — ${esc(date)}</h2>
            <p class="muted">${esc(horse.name)} is in ${involved.length} ride${involved.length === 1 ? '' : 's'} on this day.
               Move ${involved.length === 1 ? 'it' : 'them'} to another horse, then ${esc(horse.name)} will be blocked for the whole day.</p>
            ${rows}
            <div class="form-error"></div>
            <div class="form-actions">
                <button class="secondary" id="blk-cancel">Cancel</button>
                ${anyInvoiced ? '' : '<button id="blk-save">Move rides &amp; block</button>'}
            </div>`);
        document.getElementById('blk-cancel').addEventListener('click', closeDialog);
        if (anyInvoiced) {
            dialogError('Some rides are already invoiced and cannot be moved, so this horse cannot be blocked for this day.');
            return;
        }
        document.getElementById('blk-save').addEventListener('click', async () => {
            try {
                for (const row of $dialog.querySelectorAll('[data-move-ride]')) {
                    const choice = row.querySelector('.mv-horse').value;
                    const r = involved.find((x) => String(x.id) === row.getAttribute('data-move-ride'));
                    const basePayload = {
                        date: r.date,
                        start_time: hhmm(r.start_time),
                        ride_type_id: r.ride_type_id,
                        is_block: r.is_block,
                        notes: r.notes || ''
                    };
                    if (choice === '__cancel') {
                        const otherParts = r.participants.filter((p) => String(p.horse_id) !== String(horse.id));
                        if (!otherParts.length) {
                            // Last (or only) seat: the whole ride goes
                            await api('DELETE', `/api/rides/${r.id}`);
                        } else {
                            await api('PUT', `/api/rides/${r.id}`, {
                                ...basePayload,
                                participants: otherParts.map((p) => ({ horse_id: p.horse_id, contact_id: p.contact_id })),
                                guides: r.guides
                                    .filter((g) => String(g.horse_id) !== String(horse.id))
                                    .map((g) => ({ guide_id: g.guide_id, mode: g.mode, horse_id: g.horse_id }))
                            });
                        }
                    } else {
                        await api('PUT', `/api/rides/${r.id}`, {
                            ...basePayload,
                            participants: r.participants.map((p) => ({
                                horse_id: String(p.horse_id) === String(horse.id) ? choice : p.horse_id,
                                contact_id: p.contact_id
                            })),
                            guides: r.guides.map((g) => ({
                                guide_id: g.guide_id,
                                mode: g.mode,
                                horse_id: String(g.horse_id) === String(horse.id) ? choice : g.horse_id
                            }))
                        });
                    }
                }
                await createDayBlock(horse.id, date);
                closeDialog();
                toast(`${horse.name} blocked for ${date}.`);
                renderCalendar();
            } catch (err) {
                dialogError(err.message);
            }
        });
    }

    // ---------- Ride dialog ----------
    // Horse options for a rider row: ⭐ preferred first, then standard; the
    // rider's caution horses leave the standard list into a flagged group.
    function partHorseOptions(selectedId, busy, contactId) {
        const prefs = prefsFor(contactId);
        const opt = (h, pre) => `<option value="${h.id}" ${String(selectedId) === String(h.id) ? 'selected' : ''}>${pre}${esc(h.name)}</option>`;
        let head = '<option value="">(no horse yet)</option>';
        const avail = activeHorses().filter((h) => keepOption(h.id, selectedId, busy));
        const isOwn = (h) => contactId && String(h.owner_contact_id) === String(contactId);
        const ownedByOther = (h) => h.owner_contact_id && !isOwn(h);
        // Rider's own horse first, then ⭐ preferred, then the standard list;
        // other people's horses and caution horses drop into flagged groups.
        let html = head + avail.filter(isOwn).map((h) => opt(h, '🏠 ')).join('') +
                   avail.filter((h) => !isOwn(h) && !ownedByOther(h) && prefs.preferred.has(String(h.id))).map((h) => opt(h, '⭐ ')).join('') +
                   avail.filter((h) => !isOwn(h) && !ownedByOther(h) && !prefs.preferred.has(String(h.id)) && !prefs.caution.has(String(h.id))).map((h) => opt(h, '')).join('');
        const others = avail.filter((h) => ownedByOther(h) && !prefs.caution.has(String(h.id)));
        if (others.length) {
            html += `<optgroup label="🏠 Owned by another rider">${others.map((h) => opt(h, '')).join('')}</optgroup>`;
        }
        const caution = avail.filter((h) => !isOwn(h) && prefs.caution.has(String(h.id)));
        if (caution.length) {
            html += `<optgroup label="⚠ Caution for this rider">${caution.map((h) => opt(h, '⚠ ')).join('')}</optgroup>`;
        }
        return html;
    }

    // Contact options for a rider row: contacts whose availability windows
    // don't cover the ride time drop into a flagged group.
    function partContactOptions(selectedId, busy, weekday, startMin, durMin) {
        const opt = (c, pre) => `<option value="${c.id}" ${String(selectedId) === String(c.id) ? 'selected' : ''}>${pre}${esc(c.name)}${c.experience ? ' · ' + LEVEL_LABELS[c.experience] : ''}${c.is_prospect ? ' (interested)' : ''}</option>`;
        const avail = state.contacts.filter((c) => keepOption(c.id, selectedId, busy));
        const ok = avail.filter((c) => contactAvailable(c, weekday, startMin, durMin));
        const flagged = avail.filter((c) => !contactAvailable(c, weekday, startMin, durMin));
        let html = '<option value="">(open seat)</option>' + ok.map((c) => opt(c, '')).join('');
        if (flagged.length) {
            html += `<optgroup label="⚠ Not usually available then">${flagged.map((c) => opt(c, '⚠ ')).join('')}</optgroup>`;
        }
        return html;
    }

    function participantRowHtml(p, withResched) {
        return `
            <div class="pick-row" data-kind="part">
                <select class="pr-contact">${contactOptions(p ? p.contact_id : null, '(open seat)')}</select>
                <select class="pr-horse">${partHorseOptions(p ? p.horse_id : null, null, p ? p.contact_id : null)}</select>
                ${withResched ? `<button type="button" class="secondary small row-resched" title="Can't make it — give a reschedule credit">${ICON_ROTATE}</button>` : ''}
                <button type="button" class="danger small row-x">${ICON_X}</button>
            </div>`;
    }

    function guideRowHtml(g) {
        const mode = g ? g.mode : 'foot';
        return `
            <div class="pick-row" data-kind="guide">
                <select class="gr-guide">${guideOptions(g ? g.guide_id : null)}</select>
                <select class="gr-mode">
                    <option value="foot" ${mode === 'foot' ? 'selected' : ''}>On foot</option>
                    <option value="horse" ${mode === 'horse' ? 'selected' : ''}>On horse</option>
                    <option value="running" ${mode === 'running' ? 'selected' : ''}>Running 🏃</option>
                    <option value="cycling" ${mode === 'cycling' ? 'selected' : ''}>Cycling 🚴</option>
                </select>
                <select class="gr-horse ${mode === 'horse' ? '' : 'hidden'}">${horseOptions(g ? g.horse_id : null)}</select>
                <button type="button" class="danger small row-x">${ICON_X}</button>
            </div>`;
    }

    function openRideDialog(ride, defaults) {
        const isEdit = !!ride;
        const locked = isEdit && ride.invoiced;
        const time = isEdit ? hhmm(ride.start_time) : (defaults.time || '09:00');
        const dayRides = defaults.dayRides || [];
        const currentDuration = () => {
            const manual = parseInt((document.getElementById('ride-duration') || {}).value, 10);
            if (manual > 0) return manual;
            const rtId = (document.getElementById('ride-type') || {}).value;
            const rt = state.rideTypes.find((t) => String(t.id) === String(rtId));
            return (rt && rt.duration_min) || 60;
        };
        const busyFor = (t) => busyAt(dayRides, t, isEdit ? ride.id : null, currentDuration());

        // Everything taken at the dialog's time — by other rides, or by other
        // rows in this dialog. Option lists only offer what is still free.
        const timeVal = () => (document.getElementById('ride-time') || {}).value || time;
        function takenSets(exceptSel) {
            const busy = busyFor(timeVal());
            const horses = new Set(busy.horses), contacts = new Set(busy.contacts), guides = new Set(busy.guides);
            // Rows marked as rescheduled are leaving the ride — theirs don't count
            $dialog.querySelectorAll('.pr-horse, .gr-horse').forEach((sel) => {
                if (sel !== exceptSel && sel.value && !sel.classList.contains('hidden') &&
                    !sel.closest('.rescheduled')) horses.add(sel.value);
            });
            $dialog.querySelectorAll('.pr-contact').forEach((sel) => {
                if (sel !== exceptSel && sel.value && !sel.closest('.rescheduled')) contacts.add(sel.value);
            });
            $dialog.querySelectorAll('.gr-guide').forEach((sel) => {
                if (sel !== exceptSel && sel.value) guides.add(sel.value);
            });
            return { horses, contacts, guides };
        }

        function firstFreeHorse() {
            const { horses } = takenSets(null);
            const h = activeHorses().find((x) => !horses.has(String(x.id)));
            return h ? h.id : null;
        }

        const weekday = isoDow(defaults.date);
        function refreshOptions() {
            const startMin = toMin(timeVal());
            const dur = currentDuration();
            $dialog.querySelectorAll('[data-kind="part"]').forEach((row) => {
                if (row.classList.contains('rescheduled')) return; // frozen until undone
                const horseSel = row.querySelector('.pr-horse');
                const contactSel = row.querySelector('.pr-contact');
                horseSel.innerHTML = partHorseOptions(horseSel.value, takenSets(horseSel).horses, contactSel.value);
                contactSel.innerHTML = partContactOptions(contactSel.value, takenSets(contactSel).contacts, weekday, startMin, dur);
            });
            $dialog.querySelectorAll('.gr-horse').forEach((sel) => {
                sel.innerHTML = horseOptions(sel.value, takenSets(sel).horses);
            });
            $dialog.querySelectorAll('.gr-guide').forEach((sel) => {
                sel.innerHTML = guideOptions(sel.value, takenSets(sel).guides);
            });
            // Surface why a flagged pick is flagged
            const warnings = [];
            $dialog.querySelectorAll('[data-kind="part"]').forEach((row) => {
                const c = contactById(row.querySelector('.pr-contact').value);
                if (!c) return;
                const hid = row.querySelector('.pr-horse').value;
                const prefs = prefsFor(c.id);
                if (prefs.caution.has(String(hid))) {
                    const h = state.horses.find((x) => String(x.id) === String(hid));
                    warnings.push(`⚠ ${(h && h.name) || 'This horse'} for ${c.name}: ${prefs.caution.get(String(hid)) || 'flagged as problematic'}`);
                }
                if (!contactAvailable(c, weekday, startMin, dur)) {
                    warnings.push(`⚠ ${c.name} is not usually available at this time.`);
                }
                const chosenHorse = state.horses.find((x) => String(x.id) === String(hid));
                if (chosenHorse && chosenHorse.owner_contact_id &&
                    String(chosenHorse.owner_contact_id) !== String(c.id)) {
                    warnings.push(`⚠ ${chosenHorse.name} is ${chosenHorse.owner_name || 'another rider'}'s own horse.`);
                }
                if (c.needs_collection) {
                    warnings.push(`Pick-up: ${c.name} from ${c.collection_teacher || '?'}${c.collection_class ? ', class ' + c.collection_class : ''}.`);
                }
                if (hasPassOn(c, defaults.date)) {
                    const seat = isEdit && ride.participants.find((p) => String(p.contact_id) === String(c.id));
                    if (!(seat && (seat.from_recurring || seat.credit_used))) {
                        warnings.push(`⚠ ${c.name} has a term pass, but this is an extra ride — it will be invoiced separately (monthly).`);
                    }
                }
            });
            const wEl = document.getElementById('ride-warnings');
            if (wEl) wEl.innerHTML = warnings.map((w) => esc(w)).join('<br>');
        }

        // Riders marked via ⟳ stay in the dialog, greyed out; the credit is
        // only created on save. Undo reverts the marking before then.
        function reschedRows() {
            return [...$dialog.querySelectorAll('[data-kind="part"].rescheduled')].map((row) => {
                const cid = row.querySelector('.pr-contact').value;
                const c = contactById(cid);
                return { contact_id: cid, name: (c && c.name) || 'Rider' };
            });
        }
        function updateReschedInfo() {
            const el = document.getElementById('ride-resched-info');
            if (el) {
                el.innerHTML = reschedRows().map((pc) =>
                    `⟳ ${esc(pc.name)} is marked as rescheduled — they get a credit for a new ride when you save.`).join('<br>');
            }
        }

        function wireRow(row) {
            row.querySelector('.row-x').addEventListener('click', () => { row.remove(); refreshOptions(); });
            const reschedBtn = row.querySelector('.row-resched');
            if (reschedBtn) {
                reschedBtn.addEventListener('click', () => {
                    if (row.classList.contains('rescheduled')) {
                        row.classList.remove('rescheduled');
                        row.querySelectorAll('select').forEach((s) => { s.disabled = false; });
                        reschedBtn.innerHTML = ICON_ROTATE;
                        reschedBtn.title = "Can't make it — give a reschedule credit";
                        row.querySelector('.row-x').style.display = '';
                    } else {
                        const cid = row.querySelector('.pr-contact').value;
                        if (!cid) return dialogError('Pick the rider first, then tap ⟳.');
                        row.classList.add('rescheduled');
                        row.querySelectorAll('select').forEach((s) => { s.disabled = true; });
                        reschedBtn.textContent = 'Undo';
                        reschedBtn.title = 'Revert — keep the rider on this ride';
                        row.querySelector('.row-x').style.display = 'none';
                    }
                    refreshOptions();
                    updateReschedInfo();
                });
            }
            const modeSel = row.querySelector('.gr-mode');
            if (modeSel) {
                modeSel.addEventListener('change', () => {
                    row.querySelector('.gr-horse').classList.toggle('hidden', modeSel.value !== 'horse');
                });
            }
        }

        function addRow(containerId, html) {
            const container = document.getElementById(containerId);
            container.insertAdjacentHTML('beforeend', html);
            wireRow(container.lastElementChild);
            refreshOptions();
        }
        openDialog(`
            <h2>${isEdit ? (ride.is_block ? '🚫 Blocked horses' : '🐴 Ride') : 'New ride'} — ${esc(defaults.date)}</h2>
            ${isEdit && ride.recurring_id ? '<p class="muted">🔁 This comes from a fixed weekly slot. Changes here only affect this day.</p>' : ''}
            ${locked ? '<p class="muted">🧾 This ride is on an invoice and can no longer be changed.</p>' : ''}
            <fieldset style="border:none;margin:0;padding:0" ${locked ? 'disabled' : ''}>
            <div class="form-row">
                <div>
                    <label>Time</label>
                    <input type="time" id="ride-time" value="${time}">
                </div>
                <div>
                    <label>Ride type</label>
                    <select id="ride-type">${rideTypeOptions(isEdit ? ride.ride_type_id : null)}</select>
                </div>
            </div>
            <div class="form-row">
                <div>
                    <label>Level (colours the ride)</label>
                    <select id="ride-level">${levelOptions(isEdit ? ride.level : '')}</select>
                </div>
                <div>
                    <label>Duration (min)</label>
                    <input type="number" id="ride-duration" inputmode="numeric"
                           value="${isEdit && ride.duration_min ? ride.duration_min : ''}" placeholder="60">
                </div>
            </div>
            ${defaults.addContactName ? `<p class="muted">⟳ Adding <b>${esc(defaults.addContactName)}</b> using a reschedule credit — the credit is used when you save.</p>` : ''}
            <label>Riders &amp; horses</label>
            ${isEdit ? '<p class="muted" style="margin:0 0 4px">✕ removes the rider · ⟳ reschedules (they get a credit for a new ride)</p>' : ''}
            <div id="ride-parts"></div>
            <button type="button" class="secondary small" id="part-add">＋ Add rider</button>
            <label>Instructors</label>
            <div id="ride-guides"></div>
            <button type="button" class="secondary small" id="guide-add">＋ Add instructor</button>
            <label>Notes</label>
            <input id="ride-notes" value="${esc(isEdit ? ride.notes || '' : '')}">
            <label style="display:flex;align-items:center;gap:8px;margin-top:12px;color:var(--text);font-weight:500">
                <input type="checkbox" id="ride-block" style="width:auto" ${isEdit && ride.is_block ? 'checked' : ''}>
                Block these horses (unavailable, no ride)
            </label>
            </fieldset>
            <div class="form-warning" id="ride-resched-info"></div>
            <div class="form-warning" id="ride-warnings"></div>
            <div class="form-error"></div>
            <div class="form-actions">
                ${isEdit && !locked ? '<button class="danger small" id="ride-delete">Delete</button><span class="spacer"></span>' : ''}
                <button class="secondary" id="ride-cancel">${locked ? 'Close' : 'Cancel'}</button>
                ${locked ? '' : '<button id="ride-save">Save</button>'}
            </div>`);

        // The clicked cell's horse may still be busy once overlap is considered
        const defaultHorse = defaults.horseId && !busyFor(time).horses.has(String(defaults.horseId))
            ? defaults.horseId : null;
        const parts = isEdit
            ? (defaults.addContactId
                ? [...ride.participants, { contact_id: defaults.addContactId, horse_id: null }]
                : ride.participants)
            : [{ horse_id: defaultHorse, contact_id: null }];
        parts.forEach((p) => addRow('ride-parts', participantRowHtml(p, isEdit)));
        (isEdit ? ride.guides : []).forEach((g) => addRow('ride-guides', guideRowHtml(g)));
        document.getElementById('part-add').addEventListener('click', () =>
            addRow('ride-parts', participantRowHtml(null, isEdit)));
        document.getElementById('guide-add').addEventListener('click', () =>
            addRow('ride-guides', guideRowHtml(null)));
        document.getElementById('ride-cancel').addEventListener('click', closeDialog);
        document.getElementById('ride-time').addEventListener('change', refreshOptions);
        document.getElementById('ride-type').addEventListener('change', refreshOptions);
        document.getElementById('ride-duration').addEventListener('change', refreshOptions);
        document.getElementById('ride-parts').addEventListener('change', (e) => {
            // Picking a rider defaults the ride's level to their experience
            if (e.target.classList.contains('pr-contact')) {
                const lvlSel = document.getElementById('ride-level');
                const c = contactById(e.target.value);
                if (lvlSel && !lvlSel.value && c && c.experience) lvlSel.value = c.experience;
            }
            refreshOptions();
        });
        document.getElementById('ride-guides').addEventListener('change', refreshOptions);
        refreshOptions();
        if (locked) return;

        document.getElementById('ride-save').addEventListener('click', async () => {
            const credits = reschedRows();
            const body = {
                date: defaults.date,
                start_time: document.getElementById('ride-time').value,
                ride_type_id: document.getElementById('ride-type').value || null,
                is_block: document.getElementById('ride-block').checked,
                level: document.getElementById('ride-level').value || null,
                duration_min: parseInt(document.getElementById('ride-duration').value, 10) || null,
                notes: document.getElementById('ride-notes').value,
                participants: [...$dialog.querySelectorAll('[data-kind="part"]')]
                    .filter((row) => !row.classList.contains('rescheduled'))
                    .map((row) => ({
                        horse_id: row.querySelector('.pr-horse').value || null,
                        contact_id: row.querySelector('.pr-contact').value || null
                    })).filter((p) => p.horse_id || p.contact_id),
                guides: [...$dialog.querySelectorAll('[data-kind="guide"]')].map((row) => {
                    const mode = row.querySelector('.gr-mode').value;
                    return {
                        guide_id: row.querySelector('.gr-guide').value || null,
                        mode,
                        horse_id: mode === 'horse' ? (row.querySelector('.gr-horse').value || null) : null
                    };
                }).filter((g) => g.guide_id)
            };
            try {
                if (isEdit) await api('PUT', `/api/rides/${ride.id}`, body);
                else await api('POST', '/api/rides', body);
                for (const pc of credits) {
                    await api('POST', '/api/credits', {
                        contact_id: pc.contact_id,
                        note: `Missed ride on ${defaults.date} at ${timeVal()}`
                    });
                }
                if (isEdit && defaults.addContactId) {
                    await api('POST', '/api/credits/consume', {
                        contact_id: defaults.addContactId, ride_id: ride.id
                    });
                }
                closeDialog();
                toast(credits.length
                    ? `Saved. ${credits.map((pc) => pc.name).join(', ')} got a reschedule credit.`
                    : (defaults.addContactId ? 'Saved — reschedule credit used.' : 'Saved.'));
                renderCalendar();
            } catch (err) {
                dialogError(err.message);
            }
        });
        const deleteBtn = document.getElementById('ride-delete');
        if (deleteBtn) deleteBtn.addEventListener('click', async () => {
            if (!confirm('Delete this ride?')) return;
            try {
                await api('DELETE', `/api/rides/${ride.id}`);
                closeDialog();
                toast('Deleted.');
                renderCalendar();
            } catch (err) {
                dialogError(err.message);
            }
        });
    }

    // ---------- Fixed (recurring) rides — weekly group templates ----------
    async function renderFixed() {
        $view.innerHTML = `
            <h1>🔁 Fixed weekly rides</h1>
            <p class="muted">A fixed ride repeats every week: same day, time, riders and instructors.
               Riders are weekly by default; individual riders can be set to every second week.
               Horses are usually assigned on the day, in the calendar.</p>
            <div id="fixed-list">Loading…</div>
            <div class="fab-row">
                <button id="fixed-add">＋ Add fixed ride</button>
                <a class="btn secondary" href="#/calendar">← Back to calendar</a>
            </div>`;
        document.getElementById('fixed-add').addEventListener('click', () => openFixedDialog(null));
        try {
            const data = await api('GET', '/api/recurring');
            const list = document.getElementById('fixed-list');
            if (!data.recurring.length) {
                list.innerHTML = '<div class="card muted">No fixed rides yet.</div>';
                return;
            }
            let lastDay = 0;
            list.innerHTML = data.recurring.map((r) => {
                const dayHeader = r.weekday !== lastDay ? `<h2>${WEEKDAYS[r.weekday - 1]}</h2>` : '';
                lastDay = r.weekday;
                const riders = r.participants.filter((p) => p.contact_id);
                const biweekly = riders.filter((p) => p.frequency === 'biweekly').length;
                const endTime = r.duration_min
                    ? `–${String(Math.floor((toMin(hhmm(r.start_time)) + r.duration_min) / 60)).padStart(2, '0')}:${String((toMin(hhmm(r.start_time)) + r.duration_min) % 60).padStart(2, '0')}`
                    : '';
                return `${dayHeader}
                <div class="list-item" data-rec-id="${r.id}">
                    <span class="legend-chip" style="background:color-mix(in srgb, ${LEVEL_COLORS[r.level] || DEFAULT_RIDE_COLOR} 26%, white);border:1px solid ${LEVEL_COLORS[r.level] || DEFAULT_RIDE_COLOR}"></span>
                    <div class="li-main">
                        <div class="li-title">${hhmm(r.start_time)}${endTime}${r.level ? ' · ' + LEVEL_LABELS[r.level] : ''}</div>
                        <div class="li-sub">${riders.map((p) => esc(p.contact_name)).join(', ') || '(no riders)'}${biweekly ? ` · ${biweekly}× every 2nd week` : ''}</div>
                        <div class="li-sub">${r.guides.map((g) => esc(guideDisplayName(g))).join(', ') || 'no instructor'}</div>
                    </div>
                    <div class="li-right">${riders.length} rider${riders.length === 1 ? '' : 's'}</div>
                </div>`;
            }).join('');
            list.querySelectorAll('[data-rec-id]').forEach((el) => {
                el.addEventListener('click', () => {
                    const t = data.recurring.find((x) => String(x.id) === el.getAttribute('data-rec-id'));
                    openFixedDialog(t);
                });
            });
        } catch (err) {
            document.getElementById('fixed-list').textContent = err.message;
        }
    }

    function fixedRiderRowHtml(p) {
        const freq = p && p.frequency === 'biweekly' ? 'biweekly' : 'weekly';
        return `
            <div class="pick-row" data-kind="fxpart">
                <select class="fp-contact">${contactOptions(p ? p.contact_id : null, '(pick rider)')}</select>
                <select class="fp-freq" style="flex:0 0 128px">
                    <option value="weekly" ${freq === 'weekly' ? 'selected' : ''}>Every week</option>
                    <option value="biweekly" ${freq === 'biweekly' ? 'selected' : ''}>Every 2nd week</option>
                </select>
                <input type="date" class="fp-anchor ${freq === 'biweekly' ? '' : 'hidden'}" style="flex:0 0 130px"
                       title="First week this rider comes" value="${esc(p && p.biweekly_anchor || '')}">
                <button type="button" class="danger small row-x">${ICON_X}</button>
            </div>`;
    }

    function fixedGuideRowHtml(g) {
        return `
            <div class="pick-row" data-kind="fxguide">
                <select class="fg-guide">${guideOptions(g ? g.guide_id : null)}</select>
                <button type="button" class="danger small row-x">${ICON_X}</button>
            </div>`;
    }

    function openFixedDialog(tpl) {
        const isEdit = !!tpl;
        openDialog(`
            <h2>${isEdit ? 'Edit fixed ride' : 'New fixed ride'}</h2>
            <div class="form-row">
                <div>
                    <label>Weekday</label>
                    <select id="fx-weekday">${WEEKDAYS.map((d, i) =>
                        `<option value="${i + 1}" ${isEdit && tpl.weekday === i + 1 ? 'selected' : ''}>${d}</option>`).join('')}</select>
                </div>
                <div>
                    <label>Time</label>
                    <input type="time" id="fx-time" value="${isEdit ? hhmm(tpl.start_time) : '15:00'}">
                </div>
                <div>
                    <label>Duration (min)</label>
                    <input type="number" id="fx-duration" inputmode="numeric" placeholder="60"
                           value="${isEdit && tpl.duration_min ? tpl.duration_min : ''}">
                </div>
            </div>
            <div class="form-row">
                <div>
                    <label>Level</label>
                    <select id="fx-level">${levelOptions(isEdit ? tpl.level : '')}</select>
                </div>
                <div>
                    <label>Ride type (for pricing)</label>
                    <select id="fx-ridetype">${rideTypeOptions(isEdit ? tpl.ride_type_id : null)}</select>
                </div>
            </div>
            <label>Riders — weekly unless marked every 2nd week (then set the date of their first week)</label>
            <div id="fx-parts"></div>
            <button type="button" class="secondary small" id="fx-part-add">＋ Add rider</button>
            <label>Instructors</label>
            <div id="fx-guides"></div>
            <button type="button" class="secondary small" id="fx-guide-add">＋ Add instructor</button>
            <div class="form-row" style="margin-top:10px">
                <div>
                    <label>Starts from</label>
                    <input type="date" id="fx-start" value="${isEdit ? tpl.start_date : todayStr()}">
                </div>
            </div>
            <label>Notes</label>
            <input id="fx-notes" value="${esc(isEdit ? tpl.notes || '' : '')}">
            <div class="form-error"></div>
            <div class="form-actions">
                ${isEdit ? '<button class="danger small" id="fx-delete">Delete</button><span class="spacer"></span>' : ''}
                <button class="secondary" id="fx-cancel">Cancel</button>
                <button id="fx-save">Save</button>
            </div>`);

        const wireFxRow = (row) => {
            row.querySelector('.row-x').addEventListener('click', () => row.remove());
            const freqSel = row.querySelector('.fp-freq');
            if (freqSel) {
                freqSel.addEventListener('change', () => {
                    row.querySelector('.fp-anchor').classList.toggle('hidden', freqSel.value !== 'biweekly');
                });
            }
        };
        const addFxRow = (containerId, html) => {
            const container = document.getElementById(containerId);
            container.insertAdjacentHTML('beforeend', html);
            wireFxRow(container.lastElementChild);
        };
        (isEdit ? tpl.participants.filter((p) => p.contact_id) : [null]).forEach((p) => addFxRow('fx-parts', fixedRiderRowHtml(p)));
        (isEdit ? tpl.guides : []).forEach((g) => addFxRow('fx-guides', fixedGuideRowHtml(g)));
        document.getElementById('fx-part-add').addEventListener('click', () => addFxRow('fx-parts', fixedRiderRowHtml(null)));
        document.getElementById('fx-guide-add').addEventListener('click', () => addFxRow('fx-guides', fixedGuideRowHtml(null)));
        document.getElementById('fx-cancel').addEventListener('click', closeDialog);

        document.getElementById('fx-save').addEventListener('click', async () => {
            const body = {
                weekday: Number(document.getElementById('fx-weekday').value),
                start_time: document.getElementById('fx-time').value,
                duration_min: parseInt(document.getElementById('fx-duration').value, 10) || null,
                level: document.getElementById('fx-level').value || null,
                ride_type_id: document.getElementById('fx-ridetype').value || null,
                start_date: document.getElementById('fx-start').value || null,
                notes: document.getElementById('fx-notes').value,
                participants: [...$dialog.querySelectorAll('[data-kind="fxpart"]')].map((row) => ({
                    contact_id: row.querySelector('.fp-contact').value || null,
                    frequency: row.querySelector('.fp-freq').value,
                    biweekly_anchor: row.querySelector('.fp-anchor').value || null
                })).filter((p) => p.contact_id),
                guides: [...$dialog.querySelectorAll('[data-kind="fxguide"]')].map((row) => ({
                    guide_id: row.querySelector('.fg-guide').value || null,
                    mode: 'foot'
                })).filter((g) => g.guide_id)
            };
            try {
                if (isEdit) await api('PUT', `/api/recurring/${tpl.id}`, body);
                else await api('POST', '/api/recurring', body);
                closeDialog();
                toast('Saved. Future weeks now follow the new setup.');
                renderFixed();
            } catch (err) {
                dialogError(err.message);
            }
        });
        const deleteBtn = document.getElementById('fx-delete');
        if (deleteBtn) deleteBtn.addEventListener('click', async () => {
            if (!confirm('Delete this fixed ride? Future occurrences that are not invoiced yet will be removed from the calendar.')) return;
            try {
                await api('DELETE', `/api/recurring/${tpl.id}`);
                closeDialog();
                toast('Fixed ride deleted.');
                renderFixed();
            } catch (err) {
                dialogError(err.message);
            }
        });
    }

    // ---------- Directory (school phone book) ----------
    // One place for the numbers helpers need: instructors come from the guides
    // table (single source of truth), external services from service_contacts.
    async function renderDirectory() {
        $view.innerHTML = `
            <h1>👥 Contacts</h1>
            <div class="month-pills" style="margin-bottom:10px">
                <button class="month-pill" id="tab-people">Riders &amp; parents</button>
                <button class="month-pill" id="tab-interested">🌱 Interested</button>
                <button class="month-pill active">📖 Directory</button>
            </div>
            <div class="searchbar">
                <input id="dir-search" placeholder="Search…" type="search">
                ${canInvoice() ? '<button id="dir-add">＋ New</button>' : ''}
            </div>
            <div id="dir-list" class="muted">Loading…</div>`;
        document.getElementById('tab-people').addEventListener('click', () => {
            state.contactsTab = 'people';
            renderContacts();
        });
        document.getElementById('tab-interested').addEventListener('click', () => {
            state.contactsTab = 'interested';
            renderContacts();
        });
        const addBtn = document.getElementById('dir-add');
        if (addBtn) addBtn.addEventListener('click', () => openDirectoryDialog(null));
        let entries = [];
        try {
            entries = (await api('GET', '/api/service-contacts')).service_contacts;
        } catch (err) {
            document.getElementById('dir-list').textContent = err.message;
            return;
        }
        const draw = (filter) => {
            const q = (filter || '').toLowerCase();
            const match = (s) => !q || String(s || '').toLowerCase().includes(q);
            const svc = entries.filter((e) => match(e.name) || match(e.category) || match(e.phone));
            const instructors = state.guides.filter((g) => g.active && (match(g.name) || match(g.phone)));
            const telLink = (p) => p ? `<a href="tel:${esc(p)}" onclick="event.stopPropagation()">${esc(p)}</a>` : '';
            document.getElementById('dir-list').classList.remove('muted');
            document.getElementById('dir-list').innerHTML = `
                <h2>School contacts</h2>
                ${svc.length ? svc.map((e) => `
                    <div class="list-item" data-dir-id="${e.id}">
                        <div class="li-main">
                            <div class="li-title">${esc(e.name)}${e.category ? ` <span class="chip role">${esc(e.category)}</span>` : ''}</div>
                            <div class="li-sub">${telLink(e.phone)}${e.phone && e.email ? ' · ' : ''}${esc(e.email || '')}</div>
                            ${e.notes ? `<div class="li-sub">${esc(e.notes)}</div>` : ''}
                        </div>
                    </div>`).join('') : '<div class="card muted">No entries yet — add the vet, farrier, handyman…</div>'}
                <h2>Instructors</h2>
                ${instructors.map((g) => `
                    <div class="list-item">
                        <div class="li-main">
                            <div class="li-title">${esc(g.name)}${g.is_assistant ? ' <span class="chip role">assistant</span>' : ''}</div>
                            <div class="li-sub">${telLink(g.phone) || '<span class="muted">no number — add it under Settings</span>'}</div>
                        </div>
                    </div>`).join('')}`;
            if (canInvoice()) {
                document.querySelectorAll('[data-dir-id]').forEach((el) => {
                    el.addEventListener('click', () => {
                        const e = entries.find((x) => String(x.id) === el.getAttribute('data-dir-id'));
                        openDirectoryDialog(e);
                    });
                });
            }
        };
        draw('');
        document.getElementById('dir-search').addEventListener('input', (e) => draw(e.target.value));
    }

    function openDirectoryDialog(entry) {
        openDialog(`
            <h2>${entry ? 'Edit directory entry' : 'New directory entry'}</h2>
            <label>Name</label>
            <input id="dc-name" value="${esc(entry ? entry.name : '')}">
            <label>What / role (e.g. Vet, Farrier, Handyman)</label>
            <input id="dc-category" value="${esc(entry ? entry.category : '')}">
            <label>Phone</label>
            <input id="dc-phone" type="tel" value="${esc(entry ? entry.phone : '')}">
            <label>Email</label>
            <input id="dc-email" type="email" value="${esc(entry ? entry.email : '')}">
            <label>Notes</label>
            <textarea id="dc-notes">${esc(entry ? entry.notes : '')}</textarea>
            <div class="form-error"></div>
            <div class="form-actions">
                ${entry ? `<button class="danger small" id="dc-delete">${ICON_X}</button><span class="spacer"></span>` : ''}
                <button class="secondary" id="dc-cancel">Cancel</button>
                <button id="dc-save">Save</button>
            </div>`);
        document.getElementById('dc-cancel').addEventListener('click', closeDialog);
        document.getElementById('dc-save').addEventListener('click', async () => {
            const body = {
                name: document.getElementById('dc-name').value,
                category: document.getElementById('dc-category').value,
                phone: document.getElementById('dc-phone').value,
                email: document.getElementById('dc-email').value,
                notes: document.getElementById('dc-notes').value
            };
            try {
                if (entry) await api('PUT', `/api/service-contacts/${entry.id}`, body);
                else await api('POST', '/api/service-contacts', body);
                closeDialog();
                toast('Saved.');
                renderDirectory();
            } catch (err) {
                dialogError(err.message);
            }
        });
        const delBtn = document.getElementById('dc-delete');
        if (delBtn) delBtn.addEventListener('click', async () => {
            if (!confirm(`Delete "${entry.name}" from the directory?`)) return;
            try {
                await api('DELETE', `/api/service-contacts/${entry.id}`);
                closeDialog();
                toast('Deleted.');
                renderDirectory();
            } catch (err) {
                dialogError(err.message);
            }
        });
    }

    // ---------- Interested riders (intake / waiting list) ----------
    const ageOf = (c) => c.birth_year ? new Date().getFullYear() - c.birth_year : null;

    async function renderInterested() {
        $view.innerHTML = `
            <h1>👥 Contacts</h1>
            <div class="month-pills" style="margin-bottom:10px">
                <button class="month-pill" id="tab-people">Riders &amp; parents</button>
                <button class="month-pill active">🌱 Interested</button>
                <button class="month-pill" id="tab-directory">📖 Directory</button>
            </div>
            <p class="muted">Riders who want to join but haven't been placed in a lesson yet.
               Adding them to a fixed ride moves them to the normal rider list automatically.</p>
            <div class="fab-row" style="margin:0 0 12px">
                <button id="intake-add">＋ Add interested rider(s)</button>
            </div>
            <div id="interested-list" class="muted">Loading…</div>`;
        document.getElementById('tab-people').addEventListener('click', () => {
            state.contactsTab = 'people';
            renderContacts();
        });
        document.getElementById('tab-directory').addEventListener('click', () => {
            state.contactsTab = 'directory';
            renderContacts();
        });
        document.getElementById('intake-add').addEventListener('click', openIntakeDialog);
        try {
            state.contacts = (await api('GET', '/api/contacts')).contacts;
        } catch (err) {
            document.getElementById('interested-list').textContent = err.message;
            return;
        }
        const prospects = state.contacts.filter((c) => c.is_prospect);
        const $list = document.getElementById('interested-list');
        if (!prospects.length) {
            $list.innerHTML = '<div class="card muted">Nobody on the interested list.</div>';
            return;
        }
        // Group by parent (payer); prospects without a parent form their own group
        const groups = {};
        prospects.forEach((c) => {
            const key = c.parent_id || `self-${c.id}`;
            (groups[key] = groups[key] || []).push(c);
        });
        const availSummary = (c) => {
            const days = [...new Set((c.availability || []).map((a) => a.weekday))].sort();
            return days.length ? days.map((w) => WEEKDAYS[w - 1].slice(0, 3)).join(', ') : 'availability not set';
        };
        $list.classList.remove('muted');
        $list.innerHTML = Object.entries(groups).map(([key, kids]) => {
            const parent = key.startsWith('self-') ? null : contactById(key);
            return `<div class="card">
                ${parent ? `<div style="font-weight:700">${esc(parent.name)}
                    ${parent.phone ? ` · <a href="tel:${esc(parent.phone)}">${esc(parent.phone)}</a>` : ''}</div>` : ''}
                ${kids.map((c) => `
                    <div class="list-item" data-prospect-id="${c.id}" style="margin:8px 0 0;cursor:pointer">
                        <div class="li-main">
                            <div class="li-title">${esc(c.name)}${ageOf(c) ? ` <span class="muted">(${ageOf(c)})</span>` : ''}</div>
                            <div class="li-sub">${availSummary(c)}</div>
                        </div>
                        ${c.experience ? `<span class="chip" style="background:color-mix(in srgb, ${LEVEL_COLORS[c.experience]} 26%, white);color:${LEVEL_COLORS[c.experience]}">${LEVEL_LABELS[c.experience]}</span>` : ''}
                    </div>`).join('')}
            </div>`;
        }).join('');
        $list.querySelectorAll('[data-prospect-id]').forEach((el) => {
            el.addEventListener('click', () => {
                const c = contactById(el.getAttribute('data-prospect-id'));
                if (c) openContactDialog(c);
            });
        });
    }

    // One dialog for the whole intake call: parent (existing or new) + kids +
    // shared availability, everything created on save.
    function openIntakeDialog() {
        const kidRow = () => `
            <div class="pick-row" data-kind="intake-kid">
                <input class="ik-name" placeholder="Rider name">
                <input class="ik-age" type="number" inputmode="numeric" placeholder="Age" style="flex:0 0 74px">
                <select class="ik-level" style="flex:0 0 130px">${levelOptions('')}</select>
                <button type="button" class="danger small row-x">${ICON_X}</button>
            </div>`;
        openDialog(`
            <h2>🌱 Interested rider(s)</h2>
            <label>Parent / payer — pick existing or enter a new one</label>
            <select id="in-parent">${parentOptions(null, null)}</select>
            <div class="form-row">
                <div><input id="in-parent-name" placeholder="…or new parent name"></div>
                <div><input id="in-parent-phone" type="tel" placeholder="Parent phone"></div>
            </div>
            <label>Riders</label>
            <div id="intake-kids">${kidRow()}</div>
            <button type="button" class="secondary small" id="intake-kid-add">＋ Another rider</button>
            <label>Availability — tap the hours they can ride (applies to all riders above)</label>
            ${availGridHtml([])}
            <label>Notes</label>
            <input id="in-notes" placeholder="e.g. friends of the Smiths, wants to start in September">
            <div class="form-error"></div>
            <div class="form-actions">
                <button class="secondary" id="in-cancel">Cancel</button>
                <button id="in-save">Save</button>
            </div>`);
        const wire = (row) => row.querySelector('.row-x').addEventListener('click', () => row.remove());
        wire($dialog.querySelector('[data-kind="intake-kid"]'));
        document.getElementById('intake-kid-add').addEventListener('click', () => {
            document.getElementById('intake-kids').insertAdjacentHTML('beforeend', kidRow());
            wire(document.getElementById('intake-kids').lastElementChild);
        });
        $dialog.querySelectorAll('.avail-cell').forEach((cell) =>
            cell.addEventListener('click', () => cell.classList.toggle('on')));
        document.getElementById('in-cancel').addEventListener('click', closeDialog);
        document.getElementById('in-save').addEventListener('click', async () => {
            const kids = [...$dialog.querySelectorAll('[data-kind="intake-kid"]')].map((row) => ({
                name: row.querySelector('.ik-name').value.trim(),
                age: parseInt(row.querySelector('.ik-age').value, 10) || null,
                level: row.querySelector('.ik-level').value || null
            })).filter((k) => k.name);
            if (!kids.length) return dialogError('Add at least one rider.');
            const availability = collectAvailability();
            const notes = document.getElementById('in-notes').value;
            const year = new Date().getFullYear();
            try {
                let parentId = document.getElementById('in-parent').value || null;
                const newParentName = document.getElementById('in-parent-name').value.trim();
                if (!parentId && newParentName) {
                    const res = await api('POST', '/api/contacts', {
                        name: newParentName,
                        phone: document.getElementById('in-parent-phone').value,
                        notes
                    });
                    parentId = res.contact.id;
                }
                for (const k of kids) {
                    await api('POST', '/api/contacts', {
                        name: k.name,
                        parent_id: parentId,
                        experience: k.level,
                        birth_year: k.age ? year - k.age : null,
                        is_prospect: true,
                        availability,
                        notes
                    });
                }
                state.contacts = (await api('GET', '/api/contacts')).contacts;
                closeDialog();
                toast(`${kids.length} interested rider${kids.length === 1 ? '' : 's'} added.`);
                renderInterested();
            } catch (err) {
                dialogError(err.message);
            }
        });
    }

    // ---------- Contacts ----------
    async function renderContacts() {
        if (state.contactsTab === 'directory') return renderDirectory();
        if (state.contactsTab === 'interested') return renderInterested();
        if (!state.contactLevelFilter) state.contactLevelFilter = new Set();
        $view.innerHTML = `
            <h1>👥 Contacts</h1>
            <div class="month-pills" style="margin-bottom:10px">
                <button class="month-pill active">Riders &amp; parents</button>
                <button class="month-pill" id="tab-interested">🌱 Interested</button>
                <button class="month-pill" id="tab-directory">📖 Directory</button>
            </div>
            <div class="searchbar">
                <input id="contact-search" placeholder="Search…" type="search">
                <button id="contact-add">＋ New</button>
            </div>
            <div class="month-pills" style="margin-bottom:10px">
                ${LEVELS.map((l) => `
                    <button class="month-pill level-pill ${state.contactLevelFilter.has(l) ? 'active' : ''}"
                            data-level="${l}"
                            style="${state.contactLevelFilter.has(l)
                                ? `background:${LEVEL_COLORS[l]};border-color:${LEVEL_COLORS[l]};color:#fff`
                                : `color:${LEVEL_COLORS[l]}`}">${LEVEL_LABELS[l]}</button>`).join('')}
            </div>
            <div id="contact-list"></div>`;
        document.getElementById('tab-directory').addEventListener('click', () => {
            state.contactsTab = 'directory';
            renderContacts();
        });
        document.getElementById('tab-interested').addEventListener('click', () => {
            state.contactsTab = 'interested';
            renderContacts();
        });
        try {
            const data = await api('GET', '/api/contacts');
            state.contacts = data.contacts;
        } catch (err) {
            toast(err.message, true);
        }
        const draw = (filter) => {
            const q = (filter || '').toLowerCase();
            const levels = state.contactLevelFilter;
            const items = state.contacts.filter((c) =>
                !c.is_prospect &&
                (!q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q)) &&
                (!levels.size || levels.has(c.experience)));
            document.getElementById('contact-list').innerHTML = items.length ? items.map((c) => `
                <div class="list-item" data-contact-id="${c.id}">
                    <div class="avatar">${esc(c.name.trim()[0] || '?').toUpperCase()}</div>
                    <div class="li-main">
                        <div class="li-title">${esc(c.name)}</div>
                        <div class="li-sub">${c.parent_name ? '🧒 rider · pays: ' + esc(c.parent_name) : esc(c.phone || c.email || '')}</div>
                    </div>
                    ${c.experience ? `<span class="chip" style="background:color-mix(in srgb, ${LEVEL_COLORS[c.experience]} 26%, white);color:${LEVEL_COLORS[c.experience]}">${LEVEL_LABELS[c.experience]}</span>` : ''}
                    <div class="li-right">${c.ride_count} ride${c.ride_count === 1 ? '' : 's'}</div>
                </div>`).join('') : '<div class="card muted">No contacts found.</div>';
            document.querySelectorAll('[data-contact-id]').forEach((el) => {
                el.addEventListener('click', () => { location.hash = '#/contacts/' + el.getAttribute('data-contact-id'); });
            });
        };
        draw('');
        document.getElementById('contact-search').addEventListener('input', (e) => draw(e.target.value));
        document.getElementById('contact-add').addEventListener('click', () => openContactDialog(null));
        document.querySelectorAll('.level-pill').forEach((btn) => {
            btn.addEventListener('click', () => {
                const level = btn.getAttribute('data-level');
                if (state.contactLevelFilter.has(level)) state.contactLevelFilter.delete(level);
                else state.contactLevelFilter.add(level);
                const search = document.getElementById('contact-search').value;
                renderContacts().then(() => {
                    const input = document.getElementById('contact-search');
                    if (search) { input.value = search; input.dispatchEvent(new Event('input')); }
                });
            });
        });
    }

    function contactPrefRowHtml(p) {
        return `
            <div class="pick-row" data-kind="ctpref">
                <select class="cp-kind" style="flex:0 0 110px">
                    <option value="preferred" ${p && p.kind === 'preferred' ? 'selected' : ''}>⭐ Prefers</option>
                    <option value="caution" ${p && p.kind === 'caution' ? 'selected' : ''}>⚠ Caution</option>
                </select>
                <select class="cp-horse">${horseOptions(p ? p.horse_id : null)}</select>
                <input class="cp-reason" placeholder="reason" value="${esc(p ? p.reason || '' : '')}">
                <button type="button" class="danger small row-x">${ICON_X}</button>
            </div>`;
    }

    function availGridHtml(availability) {
        const startH = parseInt((state.settings.day_start || '08:00').slice(0, 2), 10);
        const endH = parseInt((state.settings.day_end || '17:00').slice(0, 2), 10);
        const on = new Set();
        (availability || []).forEach((a) => {
            for (let h = Math.floor(toMin(a.start_time) / 60); h < Math.ceil(toMin(a.end_time) / 60); h++) {
                on.add(`${a.weekday}|${h}`);
            }
        });
        let html = '<div class="avail-grid"><div class="avail-corner"></div>' +
            ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => `<div class="avail-head">${d}</div>`).join('');
        for (let h = startH; h <= endH; h++) {
            html += `<div class="avail-hour">${String(h).padStart(2, '0')}</div>`;
            for (let w = 1; w <= 7; w++) {
                html += `<button type="button" class="avail-cell ${on.has(`${w}|${h}`) ? 'on' : ''}" data-avail="${w}|${h}"></button>`;
            }
        }
        return html + '</div>';
    }

    function collectAvailability() {
        // Merge contiguous toggled hour cells into ranges per weekday
        const byDay = {};
        $dialog.querySelectorAll('.avail-cell.on').forEach((cell) => {
            const [w, h] = cell.getAttribute('data-avail').split('|').map(Number);
            (byDay[w] = byDay[w] || []).push(h);
        });
        const out = [];
        Object.keys(byDay).forEach((w) => {
            const hours = byDay[w].sort((a, b) => a - b);
            let start = hours[0], prev = hours[0];
            for (let i = 1; i <= hours.length; i++) {
                if (i < hours.length && hours[i] === prev + 1) { prev = hours[i]; continue; }
                out.push({
                    weekday: Number(w),
                    start_time: `${String(start).padStart(2, '0')}:00`,
                    end_time: `${String(prev + 1).padStart(2, '0')}:00`
                });
                if (i < hours.length) { start = hours[i]; prev = hours[i]; }
            }
        });
        return out;
    }

    function openContactDialog(contact) {
        openDialog(`
            <h2>${contact ? 'Edit contact' : 'New contact'}</h2>
            <label>Name</label>
            <input id="ct-name" value="${esc(contact ? contact.name : '')}">
            <label>Phone</label>
            <input id="ct-phone" type="tel" value="${esc(contact ? contact.phone : '')}">
            <label>Email</label>
            <input id="ct-email" type="email" value="${esc(contact ? contact.email : '')}">
            <label>Address (optional)</label>
            <textarea id="ct-address">${esc(contact ? contact.address || '' : '')}</textarea>
            <label>Parent / pays the invoices (for kid riders)</label>
            <select id="ct-parent">${parentOptions(contact ? contact.parent_id : null, contact ? contact.id : null)}</select>
            <div class="form-row">
                <div>
                    <label>Experience level</label>
                    <select id="ct-exp">
                        <option value="">(not set)</option>
                        ${LEVELS.map((l) => `<option value="${l}" ${contact && contact.experience === l ? 'selected' : ''}>${LEVEL_LABELS[l]}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label>Age (approx.)</label>
                    <input id="ct-age" type="number" inputmode="numeric"
                           value="${contact && contact.birth_year ? new Date().getFullYear() - contact.birth_year : ''}">
                </div>
            </div>
            <label style="display:flex;align-items:center;gap:8px;color:var(--text)">
                <input type="checkbox" id="ct-prospect" style="width:auto" ${contact && contact.is_prospect ? 'checked' : ''}>
                🌱 Interested — not placed in a lesson yet
            </label>
            <label style="display:flex;align-items:center;gap:8px;color:var(--text);font-weight:500">
                <input type="checkbox" id="ct-collect" style="width:auto" ${contact && contact.needs_collection ? 'checked' : ''}>
                Needs to be picked up (from school)
            </label>
            <div class="form-row" id="ct-collect-details" style="${contact && contact.needs_collection ? '' : 'display:none'}">
                <div>
                    <label>Teacher</label>
                    <input id="ct-teacher" value="${esc(contact ? contact.collection_teacher || '' : '')}">
                </div>
                <div>
                    <label>Class</label>
                    <input id="ct-class" value="${esc(contact ? contact.collection_class || '' : '')}">
                </div>
            </div>
            <label>Horse preferences</label>
            <div id="ct-prefs"></div>
            <button type="button" class="secondary small" id="ct-pref-add">＋ Add horse preference</button>
            <label>Availability — tap the hours they can ride (all empty = no restriction)</label>
            ${availGridHtml(contact ? contact.availability : [])}
            <label>Notes</label>
            <textarea id="ct-notes">${esc(contact ? contact.notes : '')}</textarea>
            <div class="form-error"></div>
            <div class="form-actions">
                ${contact ? '<button class="danger small" id="ct-archive">Archive</button><span class="spacer"></span>' : ''}
                <button class="secondary" id="ct-cancel">Cancel</button>
                <button id="ct-save">Save</button>
            </div>`);
        (contact && contact.horse_prefs || []).forEach((p) => {
            document.getElementById('ct-prefs').insertAdjacentHTML('beforeend', contactPrefRowHtml(p));
        });
        $dialog.querySelectorAll('[data-kind="ctpref"] .row-x').forEach((btn) =>
            btn.addEventListener('click', () => btn.closest('.pick-row').remove()));
        document.getElementById('ct-pref-add').addEventListener('click', () => {
            document.getElementById('ct-prefs').insertAdjacentHTML('beforeend', contactPrefRowHtml(null));
            const row = document.getElementById('ct-prefs').lastElementChild;
            row.querySelector('.row-x').addEventListener('click', () => row.remove());
        });
        $dialog.querySelectorAll('.avail-cell').forEach((cell) =>
            cell.addEventListener('click', () => cell.classList.toggle('on')));
        document.getElementById('ct-collect').addEventListener('change', (e) => {
            document.getElementById('ct-collect-details').style.display = e.target.checked ? 'flex' : 'none';
        });
        document.getElementById('ct-cancel').addEventListener('click', closeDialog);
        document.getElementById('ct-save').addEventListener('click', async () => {
            const body = {
                name: document.getElementById('ct-name').value,
                phone: document.getElementById('ct-phone').value,
                email: document.getElementById('ct-email').value,
                address: document.getElementById('ct-address').value,
                parent_id: document.getElementById('ct-parent').value || null,
                experience: document.getElementById('ct-exp').value || null,
                birth_year: parseInt(document.getElementById('ct-age').value, 10)
                    ? new Date().getFullYear() - parseInt(document.getElementById('ct-age').value, 10) : null,
                is_prospect: document.getElementById('ct-prospect').checked,
                needs_collection: document.getElementById('ct-collect').checked,
                collection_teacher: document.getElementById('ct-teacher').value,
                collection_class: document.getElementById('ct-class').value,
                notes: document.getElementById('ct-notes').value,
                horse_prefs: [...$dialog.querySelectorAll('[data-kind="ctpref"]')].map((row) => ({
                    kind: row.querySelector('.cp-kind').value,
                    horse_id: row.querySelector('.cp-horse').value || null,
                    reason: row.querySelector('.cp-reason').value
                })).filter((p) => p.horse_id),
                availability: collectAvailability()
            };
            try {
                if (contact) {
                    await api('PUT', `/api/contacts/${contact.id}`, body);
                } else {
                    await api('POST', '/api/contacts', body);
                }
                state.contacts = (await api('GET', '/api/contacts')).contacts;
                closeDialog();
                toast('Saved.');
                if (contact) renderContactDetail(contact.id);
                else renderContacts();
            } catch (err) {
                dialogError(err.message);
            }
        });
        const archiveBtn = document.getElementById('ct-archive');
        if (archiveBtn) archiveBtn.addEventListener('click', async () => {
            if (!confirm('Archive this contact? They will disappear from lists but their history is kept.')) return;
            try {
                await api('PUT', `/api/contacts/${contact.id}`, { archived: true });
                closeDialog();
                toast('Archived.');
                location.hash = '#/contacts';
            } catch (err) {
                dialogError(err.message);
            }
        });
    }

    async function renderContactDetail(id) {
        $view.innerHTML = '<div class="muted">Loading…</div>';
        try {
            const data = await api('GET', `/api/contacts/${id}`);
            const c = data.contact;
            $view.innerHTML = `
                <a href="#/contacts" class="muted">← All contacts</a>
                <h1>${esc(c.name)}</h1>
                <div class="card">
                    ${c.phone ? `<div>📞 <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></div>` : ''}
                    ${c.email ? `<div>✉️ <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>` : ''}
                    ${c.address ? `<div>🏠 ${esc(c.address)}</div>` : ''}
                    ${c.parent_id ? `<div>🧒 Rider — invoices go to <a href="#/contacts/${c.parent_id}">${esc(c.parent_name)}</a></div>` : ''}
                    ${data.children.length ? `<div>👨‍👧 Pays for: ${data.children.map((k) =>
                        `<a href="#/contacts/${k.id}">${esc(k.name)}</a>`).join(', ')}</div>` : ''}
                    ${c.experience ? `<div>🎓 ${LEVEL_LABELS[c.experience] || esc(c.experience)}</div>` : ''}
                    ${c.birth_year ? `<div>🎂 About ${new Date().getFullYear() - c.birth_year} years old</div>` : ''}
                    ${c.is_prospect ? '<div>🌱 <b>Interested — not placed in a lesson yet</b></div>' : ''}
                    ${state.horses.filter((h) => String(h.owner_contact_id) === String(c.id)).map((h) =>
                        `<div>🏠 Own horse: ${esc(h.name)}</div>`).join('')}
                    ${c.needs_collection ? `<div><b>Pick-up</b> from ${esc(c.collection_teacher || '?')}${c.collection_class ? ', class ' + esc(c.collection_class) : ''}</div>` : ''}
                    ${c.open_credits ? `<div>⟳ <b>${c.open_credits} ride${c.open_credits === 1 ? '' : 's'} to reschedule</b></div>` : ''}
                    ${(c.term_passes || []).map((tp) => {
                        const active = tp.period_start <= todayStr() && todayStr() <= tp.period_end;
                        return `<div>🎫 Term pass ${tp.period_start} – ${tp.period_end}${active ? ' <span class="chip paid">active</span>' : (tp.period_end < todayStr() ? ' <span class="chip draft">expired</span>' : ' <span class="chip sent">upcoming</span>')}</div>`;
                    }).join('')}
                    ${(c.horse_prefs || []).map((p) => p.kind === 'preferred'
                        ? `<div>⭐ Prefers ${esc(p.horse_name)}${p.reason ? ' — ' + esc(p.reason) : ''}</div>`
                        : `<div>⚠ Caution with ${esc(p.horse_name)}${p.reason ? ' — ' + esc(p.reason) : ''}</div>`).join('')}
                    ${(c.availability || []).length ? `<div>🕐 ${c.availability.map((a) =>
                        `${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][a.weekday - 1]} ${hhmm(a.start_time)}–${hhmm(a.end_time)}`).join(' · ')}</div>` : ''}
                    ${c.notes ? `<div class="muted" style="margin-top:6px">${esc(c.notes)}</div>` : ''}
                    <div class="form-actions"><button class="secondary small" id="cd-edit">Edit</button></div>
                </div>
                <h2>Rides</h2>
                <div class="table-wrap">
                ${data.rides.length ? `<table class="plain">
                    <tr><th>Date</th><th>Time</th><th>Horse</th><th>Type</th><th class="num">Price</th><th></th></tr>
                    ${data.rides.map((r) => `
                        <tr>
                            <td><a href="#/calendar/${r.date}">${r.date}</a></td>
                            <td>${hhmm(r.start_time)}</td>
                            <td>${esc(r.horse_name)}</td>
                            <td>${esc(r.ride_type_name || '')}</td>
                            <td class="num">${money(r.amount_cents)}</td>
                            <td>${r.invoice_id ? '🧾' : ''}</td>
                        </tr>`).join('')}
                </table>` : '<div class="card muted">No rides yet.</div>'}
                </div>
                ${canInvoice() ? `
                <h2>Invoices</h2>
                ${c.parent_id && !data.invoices.length
                    ? `<div class="card muted">This rider's rides are invoiced to <a href="#/contacts/${c.parent_id}">${esc(c.parent_name)}</a>.</div>`
                    : ''}
                ${data.invoices.length ? data.invoices.map((inv) => `
                    <div class="list-item">
                        <div class="li-main">
                            <div class="li-title">${esc(inv.number)}</div>
                            <div class="li-sub">${inv.period_start || ''} – ${inv.period_end || ''}</div>
                        </div>
                        <span class="chip ${inv.status}">${inv.status}</span>
                        <div class="li-right">${money(inv.total_cents)}</div>
                        <a class="btn secondary small" href="/api/invoices/${inv.id}/pdf" target="_blank">PDF</a>
                    </div>`).join('') : (c.parent_id ? '' : '<div class="card muted">No invoices yet. They are created automatically after each month.</div>')}` : ''}`;
            document.getElementById('cd-edit').addEventListener('click', () => openContactDialog(c));
        } catch (err) {
            $view.innerHTML = `<div class="card">${esc(err.message)}</div>`;
        }
    }

    // ---------- Invoices ----------
    function currentMonth() { return todayStr().slice(0, 7); }

    function quarterBounds(offset) {
        const now = new Date();
        const q = Math.floor(now.getMonth() / 3) + offset;
        const start = new Date(now.getFullYear(), q * 3, 1);
        const end = new Date(now.getFullYear(), q * 3 + 3, 0);
        const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return [fmt(start), fmt(end)];
    }

    function openTermPassDialog() {
        const [qs, qe] = quarterBounds(0);
        openDialog(`
            <h2>New term pass — invoice in advance</h2>
            <p class="muted">Covers the rider's <b>fixed lessons</b> in the period. Extra rides
               outside the fixed lessons are flagged in the calendar and invoiced monthly.</p>
            <label>Rider</label>
            <select id="tp-contact">${contactOptions(null, '(pick rider)')}</select>
            <div class="form-row">
                <div><label>From</label><input type="date" id="tp-start" value="${qs}"></div>
                <div><label>To</label><input type="date" id="tp-end" value="${qe}"></div>
            </div>
            <div class="form-actions" style="justify-content:flex-start;margin-top:6px">
                <button type="button" class="secondary small" id="tp-thisq">This quarter</button>
                <button type="button" class="secondary small" id="tp-nextq">Next quarter</button>
            </div>
            <label>Price (${esc(state.settings.currency || 'R')})</label>
            <input id="tp-amount" type="number" inputmode="decimal" step="0.01" placeholder="e.g. 3600.00">
            <label>Invoice line text (optional)</label>
            <input id="tp-desc" placeholder="Term fee — fixed lessons for the period">
            <div class="form-error"></div>
            <div class="form-actions">
                <button class="secondary" id="tp-cancel">Cancel</button>
                <button id="tp-save">Create pass &amp; invoice</button>
            </div>`);
        const setPeriod = ([s, e]) => {
            document.getElementById('tp-start').value = s;
            document.getElementById('tp-end').value = e;
        };
        document.getElementById('tp-thisq').addEventListener('click', () => setPeriod(quarterBounds(0)));
        document.getElementById('tp-nextq').addEventListener('click', () => setPeriod(quarterBounds(1)));
        document.getElementById('tp-cancel').addEventListener('click', closeDialog);
        document.getElementById('tp-save').addEventListener('click', async () => {
            try {
                const res = await api('POST', '/api/term-passes', {
                    contact_id: document.getElementById('tp-contact').value || null,
                    period_start: document.getElementById('tp-start').value,
                    period_end: document.getElementById('tp-end').value,
                    amount_cents: Math.round(parseFloat(document.getElementById('tp-amount').value || '0') * 100),
                    description: document.getElementById('tp-desc').value
                });
                closeDialog();
                toast(`Term pass created — invoice ${res.invoice.number} (in advance).`);
                renderInvoices();
            } catch (err) {
                dialogError(err.message);
            }
        });
    }

    function openBulkPassDialog() {
        const [qs, qe] = quarterBounds(0);
        openDialog(`
            <h2>⚡ Term passes for all fixed riders</h2>
            <p class="muted">Creates one pass + advance invoice per rider on the fixed schedule.
               Each rider is charged their <b>planned fixed lessons in the period × price per lesson</b>
               (riders with two lessons a week pay double; every-2nd-week riders half).
               Riders who already have a pass for the period are skipped.</p>
            <div class="form-row">
                <div><label>From</label><input type="date" id="bp-start" value="${qs}"></div>
                <div><label>To</label><input type="date" id="bp-end" value="${qe}"></div>
            </div>
            <label>Price per lesson (${esc(state.settings.currency || 'R')})</label>
            <input id="bp-price" type="number" inputmode="decimal" step="0.01" placeholder="e.g. 300.00">
            <div id="bp-preview" class="muted" style="margin-top:10px"></div>
            <div class="form-error"></div>
            <div class="form-actions">
                <button class="secondary" id="bp-cancel">Cancel</button>
                <button class="secondary" id="bp-run-preview">Preview</button>
                <button id="bp-create" disabled>Create invoices</button>
            </div>`);
        document.getElementById('bp-cancel').addEventListener('click', closeDialog);
        const payload = () => ({
            period_start: document.getElementById('bp-start').value,
            period_end: document.getElementById('bp-end').value,
            price_per_lesson_cents: Math.round(parseFloat(document.getElementById('bp-price').value || '0') * 100)
        });
        document.getElementById('bp-run-preview').addEventListener('click', async () => {
            try {
                const res = await api('POST', '/api/term-passes/bulk', { ...payload(), dry_run: true });
                const $p = document.getElementById('bp-preview');
                if (!res.preview.length) {
                    $p.textContent = 'No riders with fixed lessons in this period.';
                    return;
                }
                const toCreate = res.preview.filter((r) => !r.skipped);
                const total = toCreate.reduce((s, r) => s + r.amount_cents, 0);
                $p.classList.remove('muted');
                $p.innerHTML = `<div class="table-wrap" style="max-height:260px;overflow-y:auto"><table class="plain">
                    <tr><th>Rider</th><th class="num">Lessons</th><th class="num">Invoice</th></tr>
                    ${res.preview.map((r) => `
                        <tr style="${r.skipped ? 'opacity:.45' : ''}">
                            <td>${esc(r.name)}${r.skipped ? ' <span class="chip draft">has pass</span>' : ''}</td>
                            <td class="num">${r.lessons}</td>
                            <td class="num">${r.skipped ? '—' : money(r.amount_cents)}</td>
                        </tr>`).join('')}
                </table></div>
                <p style="margin:8px 0 0"><b>${toCreate.length} invoices · ${money(total)} total</b></p>`;
                document.getElementById('bp-create').disabled = !toCreate.length;
            } catch (err) {
                dialogError(err.message);
            }
        });
        document.getElementById('bp-create').addEventListener('click', async () => {
            if (!confirm('Create these term passes and advance invoices?')) return;
            try {
                const res = await api('POST', '/api/term-passes/bulk', payload());
                closeDialog();
                toast(`${res.created} term passes created${res.skipped ? ` (${res.skipped} skipped — already had one)` : ''}.`);
                renderInvoices();
            } catch (err) {
                dialogError(err.message);
            }
        });
    }

    async function renderInvoices() {
        if (!canInvoice()) {
            $view.innerHTML = '<div class="card">Invoices are only available to admins and helpers.</div>';
            return;
        }
        const month = state.invoiceMonth || currentMonth();
        state.invoiceMonth = month;
        // Last 12 months as tappable pills, newest first
        const now = new Date();
        const monthPills = [];
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            monthPills.push({ value, label: d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) });
        }
        $view.innerHTML = `
            <h1>🧾 Invoices</h1>
            <h2>In advance — term passes</h2>
            <div class="card">
                <p class="muted" style="margin-top:0">A term pass covers a rider's <b>fixed lessons</b> for a period,
                   invoiced up front. Extra rides outside the fixed lessons stay billable per month.
                   Renewal is manual — expired passes stop covering automatically.</p>
                <div id="pass-list" class="muted">Loading…</div>
                <div class="form-actions" style="justify-content:flex-start">
                    <button class="small" id="pass-add">＋ New term pass (invoice in advance)</button>
                    <button class="secondary small" id="pass-bulk">⚡ Passes for all fixed riders</button>
                    <a class="btn secondary small" href="/api/invoices/batch-pdf?kind=advance&status=draft" target="_blank">⬇ All draft PDFs (one file)</a>
                </div>
            </div>
            <h2>After the fact — monthly</h2>
            <p class="muted">Monthly invoices are created automatically once a month has ended.
               Reconcile them with the bank statement and set the status to <b>paid</b>.</p>
            <div class="card">
                <div class="month-pills">
                    ${monthPills.map((m) => `
                        <button class="month-pill ${m.value === month ? 'active' : ''}" data-month="${m.value}">${esc(m.label)}</button>`).join('')}
                </div>
                <h2 style="margin-top:14px">Uninvoiced rides</h2>
                <div id="inv-overview" class="muted">Loading…</div>
            </div>
            <h2>Created invoices</h2>
            <div id="inv-list" class="muted">Loading…</div>`;
        document.getElementById('pass-add').addEventListener('click', openTermPassDialog);
        document.getElementById('pass-bulk').addEventListener('click', openBulkPassDialog);
        document.querySelectorAll('.month-pill').forEach((btn) => {
            btn.addEventListener('click', () => {
                state.invoiceMonth = btn.getAttribute('data-month');
                renderInvoices();
            });
        });
        try {
            const [ov, invs, passesData] = await Promise.all([
                api('GET', `/api/invoices/overview?month=${month}`),
                api('GET', '/api/invoices'),
                api('GET', '/api/term-passes')
            ]);
            const $passes = document.getElementById('pass-list');
            const today = todayStr();
            if (!passesData.passes.length) {
                $passes.innerHTML = 'No term passes yet.';
            } else {
                $passes.classList.remove('muted');
                $passes.innerHTML = passesData.passes.map((tp) => {
                    const expired = tp.period_end < today;
                    const expiringSoon = !expired && tp.period_end <= shiftDate(today, 21);
                    return `
                    <div class="list-item" style="${expired ? 'opacity:.55' : ''}">
                        <div class="li-main">
                            <div class="li-title">${esc(tp.contact_name)}
                                ${expired ? '<span class="chip draft">expired</span>'
                                    : expiringSoon ? '<span class="chip" style="background:#fdecdc;color:#b3542f">expires soon</span>' : ''}</div>
                            <div class="li-sub">${tp.period_start} – ${tp.period_end} · ${tp.lessons_so_far} lesson${tp.lessons_so_far === 1 ? '' : 's'} so far
                                ${tp.invoice_number ? ' · ' + esc(tp.invoice_number) : ''}</div>
                        </div>
                        ${tp.invoice_id ? `
                            <select class="pass-status" data-pass-inv="${tp.invoice_id}" style="width:auto">
                                ${['draft', 'sent', 'paid'].map((s) => `<option value="${s}" ${tp.invoice_status === s ? 'selected' : ''}>${s}</option>`).join('')}
                            </select>
                            <a class="btn secondary small" href="/api/invoices/${tp.invoice_id}/pdf" target="_blank">PDF</a>` : ''}
                        <div class="li-right">${money(tp.total_cents || 0)}</div>
                        <button class="danger small" data-pass-del="${tp.id}" data-pass-name="${esc(tp.contact_name)}">${ICON_X}</button>
                    </div>`;
                }).join('');
                $passes.querySelectorAll('.pass-status').forEach((sel) => {
                    sel.addEventListener('change', async () => {
                        try {
                            await api('PUT', `/api/invoices/${sel.getAttribute('data-pass-inv')}`, { status: sel.value });
                            toast('Status updated.');
                        } catch (err) {
                            toast(err.message, true);
                        }
                    });
                });
                $passes.querySelectorAll('[data-pass-del]').forEach((btn) => {
                    btn.addEventListener('click', async () => {
                        if (!confirm(`Delete ${btn.getAttribute('data-pass-name')}'s term pass? Their fixed lessons become billable per month again (the invoice stays).`)) return;
                        try {
                            await api('DELETE', `/api/term-passes/${btn.getAttribute('data-pass-del')}`);
                            toast('Term pass deleted.');
                            renderInvoices();
                        } catch (err) {
                            toast(err.message, true);
                        }
                    });
                });
            }
            const $ov = document.getElementById('inv-overview');
            if (!ov.overview.length) {
                $ov.innerHTML = 'No uninvoiced rides in this month.';
            } else {
                $ov.classList.remove('muted');
                $ov.innerHTML = `<div class="table-wrap"><table class="plain">
                    <tr><th>Contact</th><th class="num">Rides</th><th class="num">Total</th><th></th></tr>
                    ${ov.overview.map((row) => `
                        <tr>
                            <td><a href="#/contacts/${row.contact_id}">${esc(row.name)}</a>${row.payer_name && row.payer_name !== row.name ? ` <span class="muted">→ ${esc(row.payer_name)}</span>` : ''}</td>
                            <td class="num">${row.ride_count}</td>
                            <td class="num">${money(row.total_cents)}</td>
                            <td class="num"><button class="small" data-inv-contact="${row.contact_id}" data-inv-name="${esc(row.name)}">Create invoice</button></td>
                        </tr>`).join('')}
                </table></div>`;
                $ov.querySelectorAll('[data-inv-contact]').forEach((btn) => {
                    btn.addEventListener('click', async () => {
                        if (!confirm(`Create an invoice for ${btn.getAttribute('data-inv-name')} for ${month}?`)) return;
                        btn.disabled = true;
                        try {
                            const res = await api('POST', '/api/invoices',
                                { contact_id: btn.getAttribute('data-inv-contact'), from: ov.from, to: ov.to });
                            toast(`Invoice ${res.invoice.number} created (${res.line_count} rides).`);
                            renderInvoices();
                        } catch (err) {
                            btn.disabled = false;
                            toast(err.message, true);
                        }
                    });
                });
            }
            const $list = document.getElementById('inv-list');
            if (!invs.invoices.length) {
                $list.innerHTML = '<div class="card muted">No invoices yet.</div>';
            } else {
                $list.classList.remove('muted');
                $list.innerHTML = invs.invoices.map((inv) => `
                    <div class="list-item">
                        <div class="li-main">
                            <div class="li-title">${esc(inv.number)} — ${esc(inv.contact_name)}
                                ${inv.kind === 'advance' ? '<span class="chip" style="background:#e8e2f5;color:#5b4ab8">in advance</span>' : ''}</div>
                            <div class="li-sub">${inv.rider_name && inv.rider_name !== inv.contact_name ? `for ${esc(inv.rider_name)} · ` : ''}${inv.period_start || ''} – ${inv.period_end || ''} · ${inv.kind === 'advance' ? 'term fee' : `${inv.line_count} ride${inv.line_count === 1 ? '' : 's'}`} · ${money(inv.total_cents)}</div>
                        </div>
                        <select class="inv-status" data-inv-id="${inv.id}" style="width:auto">
                            ${['draft', 'sent', 'paid'].map((s) => `<option value="${s}" ${inv.status === s ? 'selected' : ''}>${s}</option>`).join('')}
                        </select>
                        <a class="btn secondary small" href="/api/invoices/${inv.id}/pdf" target="_blank">PDF</a>
                        <button class="danger small" data-inv-del="${inv.id}" data-inv-num="${esc(inv.number)}">✕</button>
                    </div>`).join('');
                $list.querySelectorAll('.inv-status').forEach((sel) => {
                    sel.addEventListener('change', async () => {
                        try {
                            await api('PUT', `/api/invoices/${sel.getAttribute('data-inv-id')}`, { status: sel.value });
                            toast('Status updated.');
                        } catch (err) {
                            toast(err.message, true);
                        }
                    });
                });
                $list.querySelectorAll('[data-inv-del]').forEach((btn) => {
                    btn.addEventListener('click', async () => {
                        if (!confirm(`Delete invoice ${btn.getAttribute('data-inv-num')}? Its rides can then be invoiced again.`)) return;
                        try {
                            await api('DELETE', `/api/invoices/${btn.getAttribute('data-inv-del')}`);
                            toast('Invoice deleted.');
                            renderInvoices();
                        } catch (err) {
                            toast(err.message, true);
                        }
                    });
                });
            }
        } catch (err) {
            document.getElementById('inv-overview').textContent = err.message;
        }
    }

    // ---------- To-dos ----------
    function openTodoDialog(todo, defaults) {
        defaults = defaults || {};
        const isEdit = !!todo;
        openDialog(`
            <h2>${isEdit ? 'Edit to-do' : 'New to-do'}</h2>
            <label>What</label>
            <input id="td-title" value="${esc(isEdit ? todo.title : '')}" placeholder="e.g. Farrier for Sundara">
            <div class="form-row">
                <div><label>Date (optional)</label><input type="date" id="td-date" value="${esc(isEdit ? todo.todo_date || '' : defaults.date || '')}"></div>
                <div><label>Time (optional)</label><input type="time" id="td-time" value="${esc(isEdit ? hhmm(todo.todo_time || '') : defaults.time || '')}"></div>
            </div>
            <div class="form-error"></div>
            <div class="form-actions">
                ${isEdit ? `<button class="danger small" id="td-delete">${ICON_X}</button><span class="spacer"></span>` : ''}
                <button class="secondary" id="td-cancel">Cancel</button>
                ${isEdit && !todo.done_at ? '<button class="secondary" id="td-done">✓ Done</button>' : ''}
                <button id="td-save">Save</button>
            </div>`);
        document.getElementById('td-cancel').addEventListener('click', closeDialog);
        const refresh = () => (location.hash === '#/todos' ? renderTodos() : renderCalendar());
        document.getElementById('td-save').addEventListener('click', async () => {
            const body = {
                title: document.getElementById('td-title').value,
                todo_date: document.getElementById('td-date').value || null,
                todo_time: document.getElementById('td-time').value || null
            };
            try {
                if (isEdit) await api('PUT', `/api/todos/${todo.id}`, body);
                else await api('POST', '/api/todos', body);
                closeDialog();
                toast('Saved.');
                refresh();
            } catch (err) {
                dialogError(err.message);
            }
        });
        const doneBtn = document.getElementById('td-done');
        if (doneBtn) doneBtn.addEventListener('click', async () => {
            try {
                await api('PUT', `/api/todos/${todo.id}`, { done: true });
                closeDialog();
                toast('Done ✓');
                refresh();
            } catch (err) {
                dialogError(err.message);
            }
        });
        const delBtn = document.getElementById('td-delete');
        if (delBtn) delBtn.addEventListener('click', async () => {
            if (!confirm('Delete this to-do?')) return;
            try {
                await api('DELETE', `/api/todos/${todo.id}`);
                closeDialog();
                toast('Deleted.');
                refresh();
            } catch (err) {
                dialogError(err.message);
            }
        });
    }

    function todoDateLabel(t) {
        if (!t.todo_date) return '';
        return `${t.todo_date}${t.todo_time ? ' ' + hhmm(t.todo_time) : ''}`;
    }

    function mondayOf(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }

    async function renderTodos() {
        if (!state.todoWeekStart) state.todoWeekStart = mondayOf(todayStr());
        const weekStart = state.todoWeekStart;
        const days = Array.from({ length: 7 }, (_, i) => shiftDate(weekStart, i));
        const today = todayStr();
        const short = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        $view.innerHTML = `
            <h1>✅ To-dos</h1>
            <div class="day-header">
                <button class="secondary daynav" id="tw-prev">‹</button>
                <div class="day-title" style="width:auto;flex:1">${short(days[0])} – ${short(days[6])}</div>
                <button class="secondary daynav" id="tw-today">This week</button>
                <button class="secondary daynav" id="tw-next">›</button>
            </div>
            <div class="week-grid-scroller">
                <div class="week-grid">
                    ${days.map((d) => `
                        <div class="week-day ${d === today ? 'is-today' : ''}">
                            <div class="week-day-head">${WEEKDAYS[isoDow(d) - 1].slice(0, 3)} ${short(d)}</div>
                            <div class="week-day-body" data-week-date="${d}"></div>
                        </div>`).join('')}
                </div>
            </div>
            <div class="card" style="margin-top:12px">
                <div class="searchbar" style="margin-bottom:0">
                    <input id="td-new-title" placeholder="New to-do…">
                    <input type="date" id="td-new-date" style="flex:0 0 150px">
                    <button id="td-add">Add</button>
                </div>
            </div>
            <div id="todo-overdue"></div>
            <h2>No date yet</h2>
            <div id="todo-list" class="muted">Loading…</div>
            <div class="fab-row">
                <button class="secondary" id="td-show-done"></button>
            </div>
            <div id="todo-done-list"></div>`;
        document.getElementById('tw-prev').addEventListener('click', () => { state.todoWeekStart = shiftDate(weekStart, -7); renderTodos(); });
        document.getElementById('tw-next').addEventListener('click', () => { state.todoWeekStart = shiftDate(weekStart, 7); renderTodos(); });
        document.getElementById('tw-today').addEventListener('click', () => { state.todoWeekStart = mondayOf(todayStr()); renderTodos(); });
        const add = async () => {
            const title = document.getElementById('td-new-title').value;
            if (!title.trim()) return;
            try {
                await api('POST', '/api/todos', {
                    title, todo_date: document.getElementById('td-new-date').value || null
                });
                renderTodos();
            } catch (err) {
                toast(err.message, true);
            }
        };
        document.getElementById('td-add').addEventListener('click', add);
        document.getElementById('td-new-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

        try {
            const data = await api('GET', '/api/todos');
            const openTodo = (id) => openTodoDialog(data.todos.find((x) => String(x.id) === String(id)));

            // Week grid: dated items land on their day, sorted by time
            days.forEach((d) => {
                const body = $view.querySelector(`[data-week-date="${d}"]`);
                const items = data.todos.filter((t) => t.todo_date === d)
                    .sort((a, b) => String(a.todo_time || '99').localeCompare(String(b.todo_time || '99')));
                body.innerHTML = items.map((t) => `
                    <button class="slot todo-slot" data-open-todo="${t.id}">
                        <span class="slot-line">${t.todo_time ? `<b>${hhmm(t.todo_time)}</b> ` : ''}${esc(t.title)}</span>
                    </button>`).join('');
            });
            $view.querySelectorAll('[data-open-todo]').forEach((btn) => {
                btn.addEventListener('click', (e) => { e.stopPropagation(); openTodo(btn.getAttribute('data-open-todo')); });
            });
            $view.querySelectorAll('.week-day-body').forEach((body) => {
                body.addEventListener('click', (e) => {
                    if (e.target.closest('[data-open-todo]')) return;
                    openTodoDialog(null, { date: body.getAttribute('data-week-date') });
                });
            });

            // Overdue: open items dated before today, whatever week they're in
            const overdue = data.todos.filter((t) => t.todo_date && t.todo_date < today);
            document.getElementById('todo-overdue').innerHTML = overdue.length ? `
                <h2 class="overdue">Overdue</h2>
                ${overdue.map((t) => `
                    <div class="list-item">
                        <button class="secondary small todo-check" data-done-id="${t.id}" title="Mark as done">✓</button>
                        <div class="li-main" data-todo-id="${t.id}" style="cursor:pointer">
                            <div class="li-title">${esc(t.title)}</div>
                            <div class="li-sub overdue">${esc(todoDateLabel(t))}</div>
                        </div>
                    </div>`).join('')}` : '';

            // Backlog: undated items
            const $list = document.getElementById('todo-list');
            const undated = data.todos.filter((t) => !t.todo_date);
            if (!undated.length) {
                $list.innerHTML = '<div class="card muted">Nothing without a date.</div>';
            } else {
                $list.classList.remove('muted');
                $list.innerHTML = undated.map((t) => `
                    <div class="list-item">
                        <button class="secondary small todo-check" data-done-id="${t.id}" title="Mark as done">✓</button>
                        <div class="li-main" data-todo-id="${t.id}" style="cursor:pointer">
                            <div class="li-title">${esc(t.title)}</div>
                        </div>
                    </div>`).join('');
            }
            $view.querySelectorAll('[data-done-id]').forEach((btn) => {
                btn.addEventListener('click', async () => {
                    try {
                        await api('PUT', `/api/todos/${btn.getAttribute('data-done-id')}`, { done: true });
                        toast('Done ✓');
                        renderTodos();
                    } catch (err) {
                        toast(err.message, true);
                    }
                });
            });
            $view.querySelectorAll('[data-todo-id]').forEach((el) => {
                el.addEventListener('click', () => openTodo(el.getAttribute('data-todo-id')));
            });

            const $showDone = document.getElementById('td-show-done');
            $showDone.textContent = `Done (${data.done_count})`;
            $showDone.addEventListener('click', async () => {
                const $done = document.getElementById('todo-done-list');
                if ($done.innerHTML) { $done.innerHTML = ''; return; }
                const doneData = await api('GET', '/api/todos?done=1');
                $done.innerHTML = '<h2>Done</h2>' + (doneData.todos.map((t) => `
                    <div class="list-item" style="opacity:.65">
                        <div class="li-main">
                            <div class="li-title" style="text-decoration:line-through">${esc(t.title)}</div>
                            <div class="li-sub">${esc(todoDateLabel(t))}${t.todo_date ? ' · ' : ''}done ${new Date(t.done_at).toISOString().slice(0, 10)}</div>
                        </div>
                        <button class="secondary small" data-undone-id="${t.id}">↩ Reopen</button>
                    </div>`).join('') || '<div class="card muted">Nothing done yet.</div>');
                $done.querySelectorAll('[data-undone-id]').forEach((btn) => {
                    btn.addEventListener('click', async () => {
                        try {
                            await api('PUT', `/api/todos/${btn.getAttribute('data-undone-id')}`, { done: false });
                            renderTodos();
                        } catch (err) {
                            toast(err.message, true);
                        }
                    });
                });
            });
        } catch (err) {
            document.getElementById('todo-list').textContent = err.message;
        }
    }

    // ---------- Reports ----------
    function monthBounds(offset) {
        const now = new Date();
        const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
        const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return [fmt(first), fmt(last)];
    }

    async function renderReports() {
        if (!state.reportRange) state.reportRange = monthBounds(0);
        const [from, to] = state.reportRange;
        $view.innerHTML = `
            <h1>📊 Rides per horse</h1>
            <div class="card">
                <div class="form-row">
                    <div><label>From</label><input type="date" id="rep-from" value="${from}"></div>
                    <div><label>To</label><input type="date" id="rep-to" value="${to}"></div>
                </div>
                <div class="form-actions" style="justify-content:flex-start">
                    <button class="secondary small" id="rep-this">This month</button>
                    <button class="secondary small" id="rep-last">Last month</button>
                    <span class="spacer"></span>
                    <button class="small" id="rep-go">Show</button>
                </div>
            </div>
            <div id="rep-result" class="muted">Loading…</div>
            <p class="muted">Counts booked riders plus horses ridden by a guide. Open seats and blocked horses don't count; guide rides earn no income.</p>`;
        const rerun = (range) => {
            state.reportRange = range;
            renderReports();
        };
        document.getElementById('rep-this').addEventListener('click', () => rerun(monthBounds(0)));
        document.getElementById('rep-last').addEventListener('click', () => rerun(monthBounds(-1)));
        document.getElementById('rep-go').addEventListener('click', () => {
            const f = document.getElementById('rep-from').value;
            const t = document.getElementById('rep-to').value;
            if (f && t) rerun([f, t]);
        });

        try {
            const data = await api('GET', `/api/reports/horse-usage?from=${from}&to=${to}`);
            const $res = document.getElementById('rep-result');
            if (!data.rows.length) {
                $res.innerHTML = '<div class="card">No rides in this period.</div>';
                return;
            }
            // Pivot: rows = horses, columns = ride types, plus totals
            const types = [...new Set(data.rows.map((r) => r.ride_type_name))].sort();
            const horses = [];
            const byHorse = {};
            data.rows.forEach((r) => {
                if (!byHorse[r.horse_name]) {
                    byHorse[r.horse_name] = { counts: {}, rides: 0, cents: 0 };
                    horses.push(r.horse_name);
                }
                const h = byHorse[r.horse_name];
                h.counts[r.ride_type_name] = r.ride_count;
                h.rides += r.ride_count;
                h.cents += r.total_cents;
            });
            const colTotals = {};
            let grandRides = 0, grandCents = 0;
            types.forEach((t) => { colTotals[t] = 0; });
            horses.forEach((name) => {
                const h = byHorse[name];
                types.forEach((t) => { colTotals[t] += h.counts[t] || 0; });
                grandRides += h.rides;
                grandCents += h.cents;
            });
            $res.classList.remove('muted');
            $res.innerHTML = `<div class="table-wrap"><table class="plain">
                <tr><th>Horse</th>${types.map((t) => `<th class="num">${esc(t)}</th>`).join('')}<th class="num">Rides</th><th class="num">Income</th></tr>
                ${horses.map((name) => {
                    const h = byHorse[name];
                    return `<tr><td>${esc(name)}</td>
                        ${types.map((t) => `<td class="num">${h.counts[t] || ''}</td>`).join('')}
                        <td class="num"><b>${h.rides}</b></td>
                        <td class="num"><b>${money(h.cents)}</b></td></tr>`;
                }).join('')}
                <tr><td><b>Total</b></td>
                    ${types.map((t) => `<td class="num"><b>${colTotals[t] || ''}</b></td>`).join('')}
                    <td class="num"><b>${grandRides}</b></td>
                    <td class="num"><b>${money(grandCents)}</b></td></tr>
            </table></div>`;
        } catch (err) {
            document.getElementById('rep-result').textContent = err.message;
        }
    }

    // ---------- Settings ----------
    async function renderSettings() {
        const admin = isAdmin();
        $view.innerHTML = `
            <h1>⚙️ Settings</h1>

            <h2>Horses</h2>
            <div id="set-horses"></div>
            <button class="secondary small" id="horse-add">＋ Add horse</button>

            <h2>Instructors</h2>
            <div id="set-guides"></div>
            <button class="secondary small" id="guide-add">＋ Add instructor</button>

            <h2>Ride types &amp; prices</h2>
            <div id="set-ridetypes"></div>
            <button class="secondary small" id="ridetype-add">＋ Add ride type</button>

            ${admin ? `
            <h2>Users</h2>
            <div id="set-users"></div>
            <button class="secondary small" id="user-add">＋ Add user</button>

            <h2>Business details (on invoices)</h2>
            <div class="card">
                <label>Stable name</label>
                <input id="biz-name" value="${esc(state.settings.business_name || '')}">
                <label>Address / details</label>
                <textarea id="biz-address">${esc(state.settings.business_address || '')}</textarea>
                <div class="form-row">
                    <div>
                        <label>Currency symbol</label>
                        <input id="biz-currency" value="${esc(state.settings.currency || 'R')}">
                    </div>
                    <div>
                        <label>Day starts</label>
                        <input type="time" id="biz-daystart" value="${esc(state.settings.day_start || '08:00')}">
                    </div>
                    <div>
                        <label>Day ends</label>
                        <input type="time" id="biz-dayend" value="${esc(state.settings.day_end || '17:00')}">
                    </div>
                </div>
                <label>Invoice footer text</label>
                <input id="biz-footer" value="${esc(state.settings.invoice_footer || '')}">
                <div class="form-actions"><button id="biz-save">Save</button></div>
            </div>` : ''}

            <div class="card" style="margin-top:18px">
                Logged in as <b>${esc(state.user.display_name)}</b> <span class="chip role">${esc(state.user.role)}</span>
                <div class="form-actions"><button class="secondary" id="logout-btn">Log out</button></div>
            </div>`;

        const drawHorses = () => {
            document.getElementById('set-horses').innerHTML = state.horses.map((h) => `
                <div class="list-item" data-horse-id="${h.id}">
                    <span class="horse-dot" style="background:${esc(h.color)};width:14px;height:14px"></span>
                    <div class="li-main">
                        <div class="li-title">${esc(h.name)}${h.active ? '' : ' <span class="muted">(inactive)</span>'}</div>
                        ${h.owner_name ? `<div class="li-sub">🏠 ${esc(h.owner_name)}'s own horse</div>` : ''}
                        ${h.notes ? `<div class="li-sub">${esc(h.notes)}</div>` : ''}
                    </div>
                </div>`).join('') || '<div class="card muted">No horses yet.</div>';
            document.querySelectorAll('[data-horse-id]').forEach((el) => {
                el.addEventListener('click', () => {
                    const horse = state.horses.find((h) => String(h.id) === el.getAttribute('data-horse-id'));
                    openHorseDialog(horse);
                });
            });
        };
        const drawRideTypes = () => {
            document.getElementById('set-ridetypes').innerHTML = state.rideTypes.map((t) => `
                <div class="list-item" data-rt-id="${t.id}">
                    <div class="li-main">
                        <div class="li-title">${esc(t.name)}${t.active ? '' : ' <span class="muted">(inactive)</span>'}</div>
                        <div class="li-sub">${t.duration_min} min</div>
                    </div>
                    <div class="li-right">${money(t.price_cents)}</div>
                </div>`).join('') || '<div class="card muted">No ride types yet.</div>';
            document.querySelectorAll('[data-rt-id]').forEach((el) => {
                el.addEventListener('click', () => {
                    const rt = state.rideTypes.find((t) => String(t.id) === el.getAttribute('data-rt-id'));
                    openRideTypeDialog(rt);
                });
            });
        };
        const drawGuides = () => {
            document.getElementById('set-guides').innerHTML = state.guides.map((g) => `
                <div class="list-item" data-guide-id="${g.id}">
                    <div class="li-main">
                        <div class="li-title">${esc(g.name)}${g.is_assistant ? ' <span class="chip role">assistant</span>' : ''}${g.active ? '' : ' <span class="muted">(inactive)</span>'}</div>
                        ${g.phone ? `<div class="li-sub">${esc(g.phone)}</div>` : ''}
                    </div>
                </div>`).join('') || '<div class="card muted">No instructors yet.</div>';
            document.querySelectorAll('[data-guide-id]').forEach((el) => {
                el.addEventListener('click', () => {
                    const guide = state.guides.find((g) => String(g.id) === el.getAttribute('data-guide-id'));
                    openGuideDialog(guide);
                });
            });
        };
        drawHorses();
        drawGuides();
        drawRideTypes();
        document.getElementById('horse-add').addEventListener('click', () => openHorseDialog(null));
        document.getElementById('guide-add').addEventListener('click', () => openGuideDialog(null));
        document.getElementById('ridetype-add').addEventListener('click', () => openRideTypeDialog(null));
        document.getElementById('logout-btn').addEventListener('click', async () => {
            await api('POST', '/api/auth/logout');
            state.user = null;
            renderLogin();
        });

        if (admin) {
            document.getElementById('set-users').innerHTML = state.users.map((u) => `
                <div class="list-item" data-user-id="${u.id}">
                    <div class="li-main">
                        <div class="li-title">${esc(u.display_name)}${u.active ? '' : ' <span class="muted">(inactive)</span>'}</div>
                        <div class="li-sub">${esc(u.email)}</div>
                    </div>
                    <span class="chip role">${esc(u.role)}</span>
                </div>`).join('');
            document.querySelectorAll('[data-user-id]').forEach((el) => {
                el.addEventListener('click', () => {
                    const u = state.users.find((x) => String(x.id) === el.getAttribute('data-user-id'));
                    openUserDialog(u);
                });
            });
            document.getElementById('user-add').addEventListener('click', () => openUserDialog(null));
            document.getElementById('biz-save').addEventListener('click', async () => {
                try {
                    const body = {
                        business_name: document.getElementById('biz-name').value,
                        business_address: document.getElementById('biz-address').value,
                        currency: document.getElementById('biz-currency').value,
                        invoice_footer: document.getElementById('biz-footer').value,
                        day_start: document.getElementById('biz-daystart').value,
                        day_end: document.getElementById('biz-dayend').value
                    };
                    await api('PUT', '/api/settings', body);
                    Object.assign(state.settings, body);
                    toast('Saved.');
                } catch (err) {
                    toast(err.message, true);
                }
            });
        }
    }

    function openHorseDialog(horse) {
        openDialog(`
            <h2>${horse ? 'Edit horse' : 'New horse'}</h2>
            <label>Name</label>
            <input id="h-name" value="${esc(horse ? horse.name : '')}">
            <div class="form-row">
                <div>
                    <label>Colour (calendar)</label>
                    <input type="color" id="h-color" value="${esc(horse ? horse.color : '#7c9885')}" style="height:44px;padding:4px">
                </div>
                ${horse ? `<div>
                    <label>Active</label>
                    <select id="h-active"><option value="true" ${horse.active ? 'selected' : ''}>Yes</option><option value="false" ${horse.active ? '' : 'selected'}>No (retired)</option></select>
                </div>` : ''}
            </div>
            <label>Owned by (for contacts riding their own horse)</label>
            <select id="h-owner">${contactOptions(horse ? horse.owner_contact_id : null, '(stable horse)')}</select>
            <label>Notes</label>
            <textarea id="h-notes" style="min-height:110px">${esc(horse ? horse.notes || '' : '')}</textarea>
            <div class="form-error"></div>
            <div class="form-actions">
                <button class="secondary" id="h-cancel">Cancel</button>
                <button id="h-save">Save</button>
            </div>`);
        document.getElementById('h-cancel').addEventListener('click', closeDialog);
        document.getElementById('h-save').addEventListener('click', async () => {
            const body = {
                name: document.getElementById('h-name').value,
                color: document.getElementById('h-color').value,
                owner_contact_id: document.getElementById('h-owner').value || null,
                notes: document.getElementById('h-notes').value
            };
            if (horse) body.active = document.getElementById('h-active').value === 'true';
            try {
                if (horse) await api('PUT', `/api/horses/${horse.id}`, body);
                else await api('POST', '/api/horses', body);
                const data = await api('GET', '/api/horses');
                state.horses = data.horses;
                closeDialog();
                toast('Saved.');
                renderSettings();
            } catch (err) {
                dialogError(err.message);
            }
        });
    }

    function openGuideDialog(guide) {
        openDialog(`
            <h2>${guide ? 'Edit instructor' : 'New instructor'}</h2>
            <label>Name</label>
            <input id="g-name" value="${esc(guide ? guide.name : '')}">
            <label style="display:flex;align-items:center;gap:8px;color:var(--text);font-weight:500">
                <input type="checkbox" id="g-assistant" style="width:auto" ${guide && guide.is_assistant ? 'checked' : ''}>
                Assistant instructor
            </label>
            <label>Phone</label>
            <input id="g-phone" type="tel" value="${esc(guide ? guide.phone || '' : '')}">
            <label>Notes</label>
            <input id="g-notes" value="${esc(guide ? guide.notes || '' : '')}">
            ${guide ? `<label>Active</label>
            <select id="g-active"><option value="true" ${guide.active ? 'selected' : ''}>Yes</option><option value="false" ${guide.active ? '' : 'selected'}>No</option></select>` : ''}
            <div class="form-error"></div>
            <div class="form-actions">
                <button class="secondary" id="g-cancel">Cancel</button>
                <button id="g-save">Save</button>
            </div>`);
        document.getElementById('g-cancel').addEventListener('click', closeDialog);
        document.getElementById('g-save').addEventListener('click', async () => {
            const body = {
                name: document.getElementById('g-name').value,
                phone: document.getElementById('g-phone').value,
                is_assistant: document.getElementById('g-assistant').checked,
                notes: document.getElementById('g-notes').value
            };
            if (guide) body.active = document.getElementById('g-active').value === 'true';
            try {
                if (guide) await api('PUT', `/api/guides/${guide.id}`, body);
                else await api('POST', '/api/guides', body);
                state.guides = (await api('GET', '/api/guides')).guides;
                closeDialog();
                toast('Saved.');
                renderSettings();
            } catch (err) {
                dialogError(err.message);
            }
        });
    }

    function openRideTypeDialog(rt) {
        openDialog(`
            <h2>${rt ? 'Edit ride type' : 'New ride type'}</h2>
            <label>Name</label>
            <input id="rt-name" value="${esc(rt ? rt.name : '')}" placeholder="e.g. Outride 1 hour">
            <div class="form-row">
                <div>
                    <label>Duration (minutes)</label>
                    <input id="rt-duration" type="number" inputmode="numeric" value="${rt ? rt.duration_min : 60}">
                </div>
                <div>
                    <label>Price (${esc(state.settings.currency || 'R')})</label>
                    <input id="rt-price" type="number" inputmode="decimal" step="0.01" value="${rt ? (rt.price_cents / 100).toFixed(2) : ''}">
                </div>
            </div>
            ${rt ? `<label>If the price changed, apply it to</label>
            <select id="rt-scope">
                <option value="future">Future rides only (past keep the old price)</option>
                <option value="past">Also past rides that are not invoiced yet</option>
            </select>
            <p class="muted">Rides that are already on an invoice never change.</p>
            <label>Active</label>
            <select id="rt-active"><option value="true" ${rt.active ? 'selected' : ''}>Yes</option><option value="false" ${rt.active ? '' : 'selected'}>No</option></select>` : ''}
            <div class="form-error"></div>
            <div class="form-actions">
                ${rt ? '<button class="danger small" id="rt-delete">Delete</button><span class="spacer"></span>' : ''}
                <button class="secondary" id="rt-cancel">Cancel</button>
                <button id="rt-save">Save</button>
            </div>`);
        document.getElementById('rt-cancel').addEventListener('click', closeDialog);
        const deleteBtn = document.getElementById('rt-delete');
        if (deleteBtn) deleteBtn.addEventListener('click', async () => {
            if (!confirm(`Delete ride type "${rt.name}"? Existing rides are kept and keep their price and label.`)) return;
            try {
                await api('DELETE', `/api/ride-types/${rt.id}`);
                state.rideTypes = (await api('GET', '/api/ride-types')).ride_types;
                closeDialog();
                toast('Ride type deleted.');
                renderSettings();
            } catch (err) {
                dialogError(err.message);
            }
        });
        document.getElementById('rt-save').addEventListener('click', async () => {
            const body = {
                name: document.getElementById('rt-name').value,
                duration_min: Number(document.getElementById('rt-duration').value) || 60,
                price_cents: Math.round(parseFloat(document.getElementById('rt-price').value || '0') * 100)
            };
            if (rt) {
                body.active = document.getElementById('rt-active').value === 'true';
                body.apply_to_past = document.getElementById('rt-scope').value === 'past';
            }
            try {
                if (rt) await api('PUT', `/api/ride-types/${rt.id}`, body);
                else await api('POST', '/api/ride-types', body);
                const data = await api('GET', '/api/ride-types');
                state.rideTypes = data.ride_types;
                closeDialog();
                toast('Saved.');
                renderSettings();
            } catch (err) {
                dialogError(err.message);
            }
        });
    }

    function openUserDialog(user) {
        openDialog(`
            <h2>${user ? 'Edit user' : 'New user'}</h2>
            <label>Name</label>
            <input id="u-name" value="${esc(user ? user.display_name : '')}">
            ${user ? '' : '<label>Email</label><input id="u-email" type="email">'}
            <label>Role</label>
            <select id="u-role">
                ${['admin', 'helper', 'guide'].map((r) => `<option value="${r}" ${user && user.role === r ? 'selected' : ''}>${r}</option>`).join('')}
            </select>
            <p class="muted">admin: everything · helper: everything except users/business settings · guide: calendar and contacts only</p>
            <label>${user ? 'New password (leave empty to keep current)' : 'Password'}</label>
            <input id="u-password" type="password" autocomplete="new-password">
            ${user ? `<label>Active</label>
            <select id="u-active"><option value="true" ${user.active ? 'selected' : ''}>Yes</option><option value="false" ${user.active ? '' : 'selected'}>No (cannot log in)</option></select>` : ''}
            <div class="form-error"></div>
            <div class="form-actions">
                <button class="secondary" id="u-cancel">Cancel</button>
                <button id="u-save">Save</button>
            </div>`);
        document.getElementById('u-cancel').addEventListener('click', closeDialog);
        document.getElementById('u-save').addEventListener('click', async () => {
            try {
                if (user) {
                    await api('PUT', `/api/users/${user.id}`, {
                        display_name: document.getElementById('u-name').value,
                        role: document.getElementById('u-role').value,
                        active: document.getElementById('u-active').value === 'true',
                        password: document.getElementById('u-password').value || undefined
                    });
                } else {
                    await api('POST', '/api/users', {
                        display_name: document.getElementById('u-name').value,
                        email: document.getElementById('u-email').value,
                        role: document.getElementById('u-role').value,
                        password: document.getElementById('u-password').value
                    });
                }
                const data = await api('GET', '/api/users');
                state.users = data.users;
                closeDialog();
                toast('Saved.');
                renderSettings();
            } catch (err) {
                dialogError(err.message);
            }
        });
    }

    // ---------- Boot ----------
    async function boot() {
        try {
            const me = await api('GET', '/api/auth/me');
            state.setupRequired = me.setup_required;
            state.user = me.user;
            if (state.user) {
                await loadRefData();
                showShell();
            }
            route();
        } catch (err) {
            $view.innerHTML = `<div class="card">Could not reach the server: ${esc(err.message)}</div>`;
        }
    }

    boot();
})();