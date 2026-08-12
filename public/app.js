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

    const minToHHMM = (m) => `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;

    const shortDate = (d) => new Date(d + 'T00:00:00')
        .toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

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

    // Compact form for the tight day-grid header: "Wed, 12 Aug 2026"
    function fmtDateShort(dateStr) {
        return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB',
            { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
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

    // Small choice overlay that can sit above an open dialog
    function askChoice(title, message, options) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'timepick-backdrop';
            overlay.innerHTML = `
                <div class="timepick" style="max-width:420px">
                    <h2 style="margin:0 0 4px">${esc(title)}</h2>
                    ${message ? `<p class="muted" style="margin:0 0 10px">${esc(message)}</p>` : ''}
                    <div class="assign-list">
                        ${options.map((o) => `<button class="assign-row" data-choice="${esc(o.key)}">
                            <span class="assign-name">${esc(o.label)}</span>
                            <span class="assign-cur">${esc(o.hint || '')}</span>
                        </button>`).join('')}
                    </div>
                    <div class="form-actions"><button class="secondary" data-choice="">Cancel</button></div>
                </div>`;
            document.body.appendChild(overlay);
            const done = (val) => { overlay.remove(); resolve(val); };
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) return done(null);
                const btn = e.target.closest('[data-choice]');
                if (btn) done(btn.getAttribute('data-choice') || null);
            });
        });
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
            if (inp.dataset.timepicker) return; // already wired
            inp.dataset.timepicker = '1';
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

    // ---------- Phone numbers (WhatsApp-first, +27 by default) ----------
    const DEFAULT_CC = '+27';
    // Full dialing-code list, shown as "+27 South Africa". South Africa first,
    // then alphabetical by country.
    const COUNTRIES = [
        ['+27', 'South Africa'],
        ['+93', 'Afghanistan'], ['+355', 'Albania'], ['+213', 'Algeria'], ['+376', 'Andorra'],
        ['+244', 'Angola'], ['+54', 'Argentina'], ['+374', 'Armenia'], ['+61', 'Australia'],
        ['+43', 'Austria'], ['+994', 'Azerbaijan'], ['+973', 'Bahrain'], ['+880', 'Bangladesh'],
        ['+375', 'Belarus'], ['+32', 'Belgium'], ['+501', 'Belize'], ['+229', 'Benin'],
        ['+975', 'Bhutan'], ['+591', 'Bolivia'], ['+387', 'Bosnia & Herzegovina'],
        ['+267', 'Botswana'], ['+55', 'Brazil'], ['+673', 'Brunei'], ['+359', 'Bulgaria'],
        ['+226', 'Burkina Faso'], ['+257', 'Burundi'], ['+855', 'Cambodia'], ['+237', 'Cameroon'],
        ['+1', 'Canada / USA'], ['+238', 'Cape Verde'], ['+236', 'Central African Republic'],
        ['+235', 'Chad'], ['+56', 'Chile'], ['+86', 'China'], ['+57', 'Colombia'],
        ['+269', 'Comoros'], ['+242', 'Congo (Brazzaville)'], ['+243', 'Congo (Kinshasa)'],
        ['+506', 'Costa Rica'], ['+225', "Cote d'Ivoire"], ['+385', 'Croatia'], ['+53', 'Cuba'],
        ['+357', 'Cyprus'], ['+420', 'Czechia'], ['+45', 'Denmark'], ['+253', 'Djibouti'],
        ['+593', 'Ecuador'], ['+20', 'Egypt'], ['+503', 'El Salvador'], ['+240', 'Equatorial Guinea'],
        ['+291', 'Eritrea'], ['+372', 'Estonia'], ['+268', 'Eswatini'], ['+251', 'Ethiopia'],
        ['+679', 'Fiji'], ['+358', 'Finland'], ['+33', 'France'], ['+241', 'Gabon'],
        ['+220', 'Gambia'], ['+995', 'Georgia'], ['+49', 'Germany'], ['+233', 'Ghana'],
        ['+30', 'Greece'], ['+502', 'Guatemala'], ['+224', 'Guinea'], ['+245', 'Guinea-Bissau'],
        ['+592', 'Guyana'], ['+509', 'Haiti'], ['+504', 'Honduras'], ['+852', 'Hong Kong'],
        ['+36', 'Hungary'], ['+354', 'Iceland'], ['+91', 'India'], ['+62', 'Indonesia'],
        ['+98', 'Iran'], ['+964', 'Iraq'], ['+353', 'Ireland'], ['+972', 'Israel'],
        ['+39', 'Italy'], ['+81', 'Japan'], ['+962', 'Jordan'], ['+7', 'Kazakhstan / Russia'],
        ['+254', 'Kenya'], ['+965', 'Kuwait'], ['+996', 'Kyrgyzstan'], ['+856', 'Laos'],
        ['+371', 'Latvia'], ['+961', 'Lebanon'], ['+266', 'Lesotho'], ['+231', 'Liberia'],
        ['+218', 'Libya'], ['+423', 'Liechtenstein'], ['+370', 'Lithuania'], ['+352', 'Luxembourg'],
        ['+853', 'Macau'], ['+261', 'Madagascar'], ['+265', 'Malawi'], ['+60', 'Malaysia'],
        ['+960', 'Maldives'], ['+223', 'Mali'], ['+356', 'Malta'], ['+222', 'Mauritania'],
        ['+230', 'Mauritius'], ['+52', 'Mexico'], ['+373', 'Moldova'], ['+377', 'Monaco'],
        ['+976', 'Mongolia'], ['+382', 'Montenegro'], ['+212', 'Morocco'], ['+258', 'Mozambique'],
        ['+95', 'Myanmar'], ['+264', 'Namibia'], ['+977', 'Nepal'], ['+31', 'Netherlands'],
        ['+64', 'New Zealand'], ['+505', 'Nicaragua'], ['+227', 'Niger'], ['+234', 'Nigeria'],
        ['+389', 'North Macedonia'], ['+47', 'Norway'], ['+968', 'Oman'], ['+92', 'Pakistan'],
        ['+970', 'Palestine'], ['+507', 'Panama'], ['+675', 'Papua New Guinea'], ['+595', 'Paraguay'],
        ['+51', 'Peru'], ['+63', 'Philippines'], ['+48', 'Poland'], ['+351', 'Portugal'],
        ['+974', 'Qatar'], ['+40', 'Romania'], ['+250', 'Rwanda'], ['+966', 'Saudi Arabia'],
        ['+221', 'Senegal'], ['+381', 'Serbia'], ['+248', 'Seychelles'], ['+232', 'Sierra Leone'],
        ['+65', 'Singapore'], ['+421', 'Slovakia'], ['+386', 'Slovenia'], ['+252', 'Somalia'],
        ['+82', 'South Korea'], ['+211', 'South Sudan'], ['+34', 'Spain'], ['+94', 'Sri Lanka'],
        ['+249', 'Sudan'], ['+597', 'Suriname'], ['+46', 'Sweden'], ['+41', 'Switzerland'],
        ['+963', 'Syria'], ['+886', 'Taiwan'], ['+992', 'Tajikistan'], ['+255', 'Tanzania'],
        ['+66', 'Thailand'], ['+228', 'Togo'], ['+676', 'Tonga'], ['+216', 'Tunisia'],
        ['+90', 'Turkiye'], ['+993', 'Turkmenistan'], ['+256', 'Uganda'], ['+380', 'Ukraine'],
        ['+971', 'United Arab Emirates'], ['+44', 'United Kingdom'], ['+598', 'Uruguay'],
        ['+998', 'Uzbekistan'], ['+58', 'Venezuela'], ['+84', 'Vietnam'], ['+967', 'Yemen'],
        ['+260', 'Zambia'], ['+263', 'Zimbabwe']
    ];
    const COUNTRY_CODES = [...new Set(COUNTRIES.map((c) => c[0]))];

    // "+44 7700 900123" -> { cc: '+44', rest: '7700 900123' }
    function splitPhone(value) {
        const s = String(value || '').trim();
        if (s.startsWith('+')) {
            const cc = COUNTRY_CODES.slice().sort((a, b) => b.length - a.length)
                .find((c) => s.startsWith(c));
            if (cc) return { cc, rest: s.slice(cc.length).trim() };
            const m = s.match(/^(\+\d{1,3})\s*(.*)$/);
            if (m) return { cc: m[1], rest: m[2] };
        }
        // local format: 082 555 0101 -> drop the trunk zero
        return { cc: DEFAULT_CC, rest: s.replace(/^0+/, '') };
    }

    function phoneFieldHtml(id, value) {
        const { cc, rest } = splitPhone(value);
        const known = COUNTRIES.some((c) => c[0] === cc);
        const list = known ? COUNTRIES : [[cc, '']].concat(COUNTRIES);
        let picked = false;
        // inline layout so it can't be broken by a stale stylesheet
        return `<div class="phone-field" style="display:flex;gap:6px;align-items:center">
            <select id="${id}-cc" class="phone-cc" style="flex:0 0 112px;width:112px;padding-left:6px;padding-right:2px">
                ${list.map(([c, name]) => {
                    const sel = !picked && c === cc ? (picked = true, 'selected') : '';
                    return `<option value="${c}" ${sel}>${c}${name ? ' ' + esc(name) : ''}</option>`;
                }).join('')}
            </select>
            <input id="${id}" type="tel" inputmode="tel" style="flex:1 1 auto;min-width:0"
                   value="${esc(rest)}" placeholder="82 555 0101">
        </div>`;
    }

    function readPhoneField(id) {
        const rest = (document.getElementById(id).value || '').trim().replace(/^0+/, '');
        const cc = (document.getElementById(id + '-cc') || {}).value || DEFAULT_CC;
        return rest ? `${cc} ${rest}` : '';
    }

    // wa.me wants digits only, in full international form
    function waNumber(phone) {
        let digits = String(phone || '').replace(/[^\d+]/g, '');
        if (digits.startsWith('+')) return digits.slice(1);
        if (digits.startsWith('0')) return DEFAULT_CC.slice(1) + digits.slice(1);
        return digits;
    }

    // The number opens WhatsApp; the small icon still dials.
    function phoneLinks(phone) {
        if (!phone) return '';
        const wa = waNumber(phone);
        return `<a class="wa-link" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener"
                   onclick="event.stopPropagation()" title="Message on WhatsApp">💬 ${esc(phone)}</a>
                <a class="tel-link" href="tel:${esc(phone.replace(/\s+/g, ''))}"
                   onclick="event.stopPropagation()" title="Call">📞</a>`;
    }

    function contactOptions(selectedId, emptyLabel, busy) {
        return `<option value="">${esc(emptyLabel || '')}</option>` +
            state.contacts.filter((c) => keepOption(c.id, selectedId, busy)).map((c) =>
                `<option value="${c.id}" ${String(selectedId) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    }

    function horseOptions(selectedId, busy) {
        return [...activeHorses()].sort((a, b) => a.name.localeCompare(b.name)).filter((h) => keepOption(h.id, selectedId, busy)).map((h) =>
            `<option value="${h.id}" ${String(selectedId) === String(h.id) ? 'selected' : ''}>${esc(h.name)}</option>`).join('');
    }

    function rideTypeOptions(selectedId) {
        return '<option value="">(none)</option>' + activeRideTypes().map((t) =>
            `<option value="${t.id}" ${String(selectedId) === String(t.id) ? 'selected' : ''}>${esc(t.name)} — ${money(t.price_cents)}</option>`).join('');
    }

    // An instructor may run two rides at once, so overlapping ones stay on the
    // list — but below the free ones, labelled with how long the clash is.
    // `busy` only hides instructors already picked on another row of this ride.
    function guideOptions(selectedId, busy, overlaps) {
        const clash = (g) => (overlaps && overlaps[String(g.id)]) || 0;
        const opt = (g) => `<option value="${g.id}" ${String(selectedId) === String(g.id) ? 'selected' : ''}>${esc(g.name)}${g.is_assistant ? ' (ass)' : ''}${clash(g) ? ` (overlaps ${clash(g)} min)` : ''}</option>`;
        const avail = state.guides.filter((g) => g.active && keepOption(g.id, selectedId, busy))
            .sort((a, b) => a.name.localeCompare(b.name));
        let html = '<option value="">(no instructor)</option>' +
            avail.filter((g) => !clash(g)).map(opt).join('');
        const busyNow = avail.filter(clash);
        if (busyNow.length) {
            html += `<optgroup label="⧉ Already on another ride">${busyNow.map(opt).join('')}</optgroup>`;
        }
        return html;
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
        document.body.classList.toggle('page-calendar', parts[0] === 'calendar' || !parts[0]);
        if (parts[0] === 'calendar') {
            if (/^\d{4}-\d{2}-\d{2}$/.test(parts[1] || '') && parts[1] !== state.calendarDate) {
                state.calendarDate = parts[1];
                state.calScroll = null; // a different day starts at the top
            }
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
    const VENUES = { instructor: '', arena: 'Arena', outride: 'Outride' };
    const VENUE_COLORS = { arena: '#e65100', outride: '#2e7d32' };
    const venueOptions = (selected) => Object.entries(VENUES).map(([k, label]) =>
        `<option value="${k}" ${selected === k ? 'selected' : ''}>${label || "Instructor's choice"}</option>`).join('');

    const levelOptions = (selected) => '<option value="">(no level)</option>' +
        LEVELS.map((l) => `<option value="${l}" ${selected === l ? 'selected' : ''}>${LEVEL_LABELS[l]}</option>`).join('');
    const guideDisplayName = (g) => `${g.guide_name || g.name}${(g.is_assistant) ? ' (ass)' : ''}`;
    const guideDot = (g) => `<span class="guide-dot" style="background:${esc(g.guide_color || g.color || '#6a6a66')}"></span>`;
    const guideChip = (g) => `${guideDot(g)}${esc(guideDisplayName(g))}`;

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

    const overlapMin = (aS, aE, bS, bE) => Math.min(aE, bE) - Math.max(aS, bS);

    // How long would each instructor's other rides clash with [time, +duration)?
    // guideId -> minutes (the longest single clash).
    function guideOverlaps(rides, time, durationMin, excludeRideId) {
        const start = toMin(time), end = start + (durationMin || 60);
        const out = {};
        rides.forEach((r) => {
            if (r.all_day || (excludeRideId && String(r.id) === String(excludeRideId))) return;
            const s = toMin(hhmm(r.start_time));
            const mins = overlapMin(start, end, s, s + (r.duration_min || 60));
            if (mins <= 0) return;
            r.guides.forEach((g) => {
                const k = String(g.guide_id);
                out[k] = Math.max(out[k] || 0, mins);
            });
        });
        return out;
    }

    // Same clashes, but keyed for the grid: rideId -> guideId -> minutes, so the
    // badge can be drawn on both rides involved.
    function staffOverlapMap(rides) {
        const map = {};
        const timed = rides.filter((r) => !r.all_day && r.guides.length);
        const mark = (r, gid, mins) => {
            const byGuide = map[r.id] = map[r.id] || {};
            byGuide[gid] = Math.max(byGuide[gid] || 0, mins);
        };
        timed.forEach((a, i) => {
            const aS = toMin(hhmm(a.start_time)), aE = aS + (a.duration_min || 60);
            timed.slice(i + 1).forEach((b) => {
                const bS = toMin(hhmm(b.start_time)), bE = bS + (b.duration_min || 60);
                const mins = overlapMin(aS, aE, bS, bE);
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
        // remember where we were before the view is rebuilt
        const oldScroller = $view.querySelector('.calendar-scroller');
        if (oldScroller) state.calScroll = { x: oldScroller.scrollLeft, y: oldScroller.scrollTop };
        $view.innerHTML = `
            <div id="credit-bar"></div>
            <div id="cal-grid" class="muted">Loading…</div>
`;
        let dayRides = [];

        try {
            const [ridesData, creditsData] = await Promise.all([
                api('GET', `/api/rides?from=${date}&to=${date}`),
                api('GET', '/api/credits')
            ]);
            dayRides = ridesData.rides;
            drawDayGrid(dayRides, date);

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

    // Grid = one row per ride (details in the first column) x one narrow
    // column per horse; a dot marks which horses that ride uses. Tap a horse
    // cell to assign/unassign that horse for the ride.
    function drawDayGrid(rides, date) {
        const grid = document.getElementById('cal-grid');
        if (!grid) return;
        const horses = activeHorses();
        if (!horses.length) {
            grid.innerHTML = '<div class="card">No horses yet — add them under Settings.</div>';
            return;
        }

        // Instructors running two rides at once — flagged on both of them
        const staffClash = staffOverlapMap(rides.filter((r) => !r.is_block));

        // Horses blocked for the whole day
        const dayBlocks = {};
        rides.forEach((r) => {
            if (r.is_block && r.all_day) r.participants.forEach((p) => { dayBlocks[p.horse_id] = r; });
        });

        // Timed blocks are not rides — they shade the horse's cells instead
        const timedBlocks = {};
        rides.filter((r) => r.is_block && !r.all_day).forEach((r) => {
            const s = toMin(hhmm(r.start_time));
            const e = s + (r.duration_min || 60);
            r.participants.forEach((p) => {
                if (!p.horse_id) return;
                (timedBlocks[p.horse_id] = timedBlocks[p.horse_id] || []).push({ s, e, ride: r });
            });
        });
        const blockedAt = (horseId, startMin, durMin) =>
            (timedBlocks[horseId] || []).find((b) => b.s < startMin + durMin && b.e > startMin) || null;

        const dayRides = rides.filter((r) => !r.all_day && !r.is_block)
            .sort((a, b) => hhmm(a.start_time).localeCompare(hhmm(b.start_time)));

        const load = horseDayLoad(rides);
        let html = '<div class="calendar-scroller"><table class="daygrid ridegrid">';
        html += `<tr><th class="ridecol">
            <div class="page-tabs">
                <button class="page-tab active">🐴 Ride schedule</button>
                <button class="page-tab" id="tab-fixed">🔁 Fixed rides</button>
            </div>
            <div class="cal-nav">
                <button class="secondary daynav" id="cal-prev" title="Previous day" aria-label="Previous day">‹</button>
                <button class="secondary" id="cal-date-btn" title="Pick a date">${esc(fmtDateShort(date))}</button>
                <button class="secondary daynav" id="cal-next" title="Next day" aria-label="Next day">›</button>
                <button class="secondary" id="cal-today" title="Jump to today">Today</button>
            </div>
            <div class="cal-actions">
                <button class="small" id="cal-add">＋ New ride</button>
            </div>
        </th>`;
        horses.forEach((h) => {
            const blocked = dayBlocks[h.id];
            const l = load[h.id];
            const usage = blocked ? '<span class="horsecol-use blocked">blocked</span>'
                : l ? `<span class="horsecol-use busy">${l.count} ride${l.count === 1 ? '' : 's'} · ${fmtMinutes(l.minutes)}</span>`
                : '<span class="horsecol-use free">free</span>';
            html += `<th class="horsecol ${blocked ? 'blocked-th' : ''}" data-horse-col="${h.id}">
                <span class="horse-grip" draggable="true" data-grip="${h.id}"
                      title="Drag ${esc(h.name)} left or right to reorder">⠿</span>
                <button class="horse-block-btn ${blocked ? 'is-blocked' : ''}" data-block-horse="${h.id}"
                        title="${blocked ? 'Unblock ' + esc(h.name) : 'Block ' + esc(h.name)}">${blocked ? '🟢' : '🚫'}</button>
                <span class="horsecol-stack">
                    <span class="horsecol-name">${esc(h.name)}</span>
                    ${usage}
                </span>
            </th>`;
        });
        html += '</tr>';

        // One row per hour of the working day: rides sit in their hour, empty
        // hours stay tappable so a day can be planned like a normal calendar.
        const startH = parseInt((state.settings.day_start || '08:00').slice(0, 2), 10);
        const endH = parseInt((state.settings.day_end || '17:00').slice(0, 2), 10);
        const hours = [];
        for (let h = startH; h <= endH; h++) hours.push(pad2(h));
        dayRides.forEach((r) => {
            const hh = hhmm(r.start_time).slice(0, 2);
            if (!hours.includes(hh)) hours.push(hh);
        });
        hours.sort();

        hours.forEach((hour) => {
            const inHour = dayRides.filter((r) => hhmm(r.start_time).slice(0, 2) === hour);
            if (inHour.length) { inHour.forEach(renderRideRow); return; }
            html += `<tr class="hour-row"><td class="ridecol">
                <button class="hour-box" data-new-time="${hour}:00">
                    <span class="hour-label">${hour}:00</span>
                    <span class="hour-add">＋ ride</span>
                </button></td>`;
            horses.forEach((h) => {
                if (dayBlocks[h.id]) { html += '<td class="blocked-col"></td>'; return; }
                const hb = blockedAt(h.id, toMin(hour + ':00'), 60);
                html += hb
                    ? `<td class="horse-cell cell-blocked" data-unblock-ride="${hb.ride.id}" data-horse-name="${esc(h.name)}"
                            title="${esc(h.name)} is blocked ${esc(hhmm(hb.ride.start_time))}–${esc(minToHHMM(hb.e))}"></td>`
                    : `<td class="horse-cell free-cell" data-new-time="${hour}:00" data-new-horse="${h.id}"
                            title="New ride at ${hour}:00 on ${esc(h.name)}"></td>`;
            });
            html += '</tr>';
        });

        function renderRideRow(r) {
            const color = rideColor(r);
            const start = hhmm(r.start_time);
            const endMin = toMin(start) + (r.duration_min || 60);
            const end = `${pad2(Math.floor(endMin / 60) % 24)}:${pad2(endMin % 60)}`;
            const riders = r.participants.filter((p) => p.contact_id);
            const horsesOnly = r.participants.filter((p) => !p.contact_id && p.horse_name);

            const clash = staffClash[r.id] || {};
            const staff = r.guides.map((g) => {
                const mins = clash[String(g.guide_id)];
                return `
                <span class="staff-item">
                    <span class="staff-pill" style="background:${esc(g.guide_color || '#4a4a46')}">
                        ${esc(shortName(g.guide_name))}${g.is_assistant ? ' (ass)' : ''}${MODE_ICON[g.mode] ? ' ' + MODE_ICON[g.mode] : ''}
                    </span>
                    ${mins ? `<span class="staff-overlap" title="${esc(g.guide_name)} is on another ride at the same time — ${mins} min overlap">⧉${mins}′</span>` : ''}
                    ${g.mode === 'horse' && g.horse_name
                        ? `<span class="rider-horse has">${esc(g.horse_name)}</span>` : ''}
                </span>`;
            }).join('');

            let riderRows;
            if (r.is_block) {
                riderRows = `<div class="rider-row"><span class="rider-name">🚫 Blocked</span>
                    <span class="rider-horse">${esc(horsesOnly.map((p) => p.horse_name).join(', '))}</span></div>`;
            } else if (riders.length) {
                riderRows = riders.map((p) => `
                    <div class="rider-row">
                        <span class="rider-name">${esc(p.contact_name)}</span>
                        ${p.horse_name
                            ? `<button class="rider-horse has" data-seat-ride="${r.id}" data-seat-contact="${p.contact_id}">${esc(p.horse_name)}</button>`
                            : `<button class="rider-horse none" data-seat-ride="${r.id}" data-seat-contact="${p.contact_id}">no horse yet</button>`}
                        ${p.alt_horse_name ? `<span class="rider-alt">or ${esc(p.alt_horse_name)}</span>` : ''}
                        ${p.needs_collection
                            ? `<span class="rider-pickup">pick-up${p.collection_teacher ? ': ' + esc(p.collection_teacher) : ''}${p.collection_class ? ', ' + esc(p.collection_class) : ''}</span>` : ''}
                    </div>`).join('');
            } else if (horsesOnly.length) {
                riderRows = `<div class="rider-row"><span class="rider-name muted">Horses only</span>
                    <span class="rider-horse">${esc(horsesOnly.map((p) => p.horse_name).join(', '))}</span></div>`;
            } else {
                riderRows = '<div class="rider-row"><span class="rider-name muted">No riders yet</span></div>';
            }
            // riders in the weekly series who aren't on this week
            const inote = r.instructor_notes
                ? `<div class="rider-row instructor-note">📝 ${esc(r.instructor_notes)}</div>` : '';
            riderRows += (r.off_riders || []).map((o) => `
                <div class="rider-row off-rider">
                    <span class="rider-name">${esc(o.contact_name)}</span>
                    <span class="rider-off">${o.frequency === 'biweekly' ? 'every 2nd week' : 'not riding'}${
                        o.next_date ? ' · next ' + esc(shortDate(o.next_date)) : ''}</span>
                </div>`).join('');

            const flags = [];
            if (!r.is_block && !r.recurring_id) flags.push('once-off');
            if (riders.some(isExtraSeat)) flags.push('extra — billed monthly');

            html += `<tr class="ride-row"><td class="ridecol">
                <div class="ride-box ${r.is_block ? 'blocked' : ''} ${r.invoiced ? 'invoiced' : ''}">
                    <button class="ride-top" data-ride-id="${r.id}">
                        <span class="ride-time">${esc(start)}–${esc(end)}</span>
                        <span class="ride-dur">${r.duration_min} min</span>
                        ${VENUES[r.venue] ? `<span class="ride-venue" style="color:${VENUE_COLORS[r.venue]}">${VENUES[r.venue]}</span>` : ''}
                        <span class="ride-level${r.level ? '' : ' none'}"
                              style="${r.level ? `color:${color}` : ''}">${r.level ? LEVEL_LABELS[r.level] : 'no level assigned'}</span>
                    </button>
                    <div class="ride-cols">
                        <div class="ride-riders-col">${riderRows}${inote}</div>
                        <div class="ride-staff-col">${staff || '<span class="muted">no instructor</span>'}</div>
                    </div>
                    ${flags.length ? `<div class="ride-flags">${esc(flags.join(' · '))}</div>` : ''}
                </div></td>`;

            horses.forEach((h) => {
                if (dayBlocks[h.id]) { html += '<td class="blocked-col"></td>'; return; }
                const seat = r.participants.find((p) => String(p.horse_id) === String(h.id));
                const mount = r.guides.find((g) => g.mode === 'horse' && String(g.horse_id) === String(h.id));
                const altSeat = r.participants.find((p) => String(p.alt_horse_id) === String(h.id));
                const used = seat || mount;
                const label = mount ? shortName(mount.guide_name)
                    : (seat && seat.contact_name) ? shortName(seat.contact_name) : '';
                const tBlock = used ? null : blockedAt(h.id, toMin(start), r.duration_min || 60);
                const clash = used || tBlock ? null : horseUsedBy(dayRides, r, h.id);
                const title = used ? esc(h.name) + (label ? ' — ' + esc(label) : '')
                    : clash ? `${esc(h.name)} is on ${esc(rideLabel(clash))} — tap to move it here`
                    : 'Tap to put ' + esc(h.name) + ' on this ride';
                html += `<td class="horse-cell ${used ? 'used' : ''} ${clash && !altSeat ? 'busy-elsewhere' : ''} ${tBlock ? 'cell-blocked' : ''}"
                            ${tBlock ? `data-unblock-ride="${tBlock.ride.id}" data-horse-name="${esc(h.name)}"` : `data-ride="${r.id}" data-horse="${h.id}"`}
                            title="${tBlock ? `${esc(h.name)} is blocked ${esc(hhmm(tBlock.ride.start_time))}–${esc(minToHHMM(tBlock.e))}`
                                : altSeat && !used ? esc(h.name) + ' — alternative for ' + esc(altSeat.contact_name || 'this ride') : title}">
                    ${used ? `<span class="horse-fill" style="background:${color}"></span>`
                        : altSeat ? `<span class="horse-fill alt" style="border-color:${color};color:${color}">alt</span>` : ''}
                </td>`;
            });
            html += '</tr>';
        }
        html += '</table></div>';
        // restore the scroll position captured before the view was rebuilt
        const inGrid = grid.querySelector('.calendar-scroller');
        const keep = inGrid ? { x: inGrid.scrollLeft, y: inGrid.scrollTop } : state.calScroll;
        grid.classList.remove('muted');
        grid.innerHTML = html;
        if (keep) {
            const next = grid.querySelector('.calendar-scroller');
            if (next) {
                next.scrollLeft = keep.x;
                next.scrollTop = keep.y;
                // a second pass after layout settles (sticky header, fonts)
                requestAnimationFrame(() => { next.scrollLeft = keep.x; next.scrollTop = keep.y; });
            }
        }

        grid.querySelectorAll('[data-unblock-ride]').forEach((td) => {
            td.addEventListener('click', async () => {
                const name = td.getAttribute('data-horse-name');
                const choice = await askChoice(`${name} is blocked`, 'Lift this block?',
                    [{ key: 'yes', label: 'Unblock these hours' }]);
                if (choice !== 'yes') return;
                try {
                    await api('DELETE', `/api/rides/${td.getAttribute('data-unblock-ride')}?scope=one`);
                    toast(`${name} is available again.`);
                    renderCalendar();
                } catch (err) {
                    toast(err.message, true);
                }
            });
        });
        grid.querySelectorAll('[data-new-time]').forEach((el) => {
            el.addEventListener('click', () => openRideDialog(null, {
                date,
                time: el.getAttribute('data-new-time'),
                horseId: el.getAttribute('data-new-horse') || null,
                dayRides: rides
            }));
        });
        document.getElementById('cal-add').addEventListener('click', () =>
            openRideDialog(null, { date, time: (state.settings.day_start || '09:00'), dayRides: rides }));
        document.getElementById('tab-fixed').addEventListener('click', () => { location.hash = '#/fixed'; });
        document.getElementById('cal-prev').addEventListener('click', () => { location.hash = '#/calendar/' + shiftDate(date, -1); });
        document.getElementById('cal-next').addEventListener('click', () => { location.hash = '#/calendar/' + shiftDate(date, 1); });
        document.getElementById('cal-today').addEventListener('click', () => { location.hash = '#/calendar/' + todayStr(); });
        document.getElementById('cal-date-btn').addEventListener('click', () => openDatePicker(date));
        grid.querySelectorAll('[data-seat-contact]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const ride = rides.find((x) => String(x.id) === btn.getAttribute('data-seat-ride'));
                const seat = ride && ride.participants.find((p) =>
                    String(p.contact_id) === btn.getAttribute('data-seat-contact'));
                if (ride && seat) openRiderHorseDialog(ride, seat, date, rides);
            });
        });
        grid.querySelectorAll('[data-ride-id]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const ride = rides.find((x) => String(x.id) === btn.getAttribute('data-ride-id'));
                if (ride) openRideDialog(ride, { date, dayRides: rides });
            });
        });

        // Tap a horse cell: pick which rider (or instructor) gets that horse
        grid.querySelectorAll('.horse-cell').forEach((td) => {
            td.addEventListener('click', () => {
                const ride = rides.find((x) => String(x.id) === td.getAttribute('data-ride'));
                const horse = horses.find((h) => String(h.id) === td.getAttribute('data-horse'));
                if (ride && horse) openHorseAssignDialog(ride, horse, date, rides);
            });
        });

        // Reorder horse columns by moving the cells in place — no re-render, so
        // the grid doesn't flash and the scroll position is kept.
        const moveColumn = (from, to) => {
            grid.querySelectorAll('table.ridegrid tr').forEach((tr) => {
                const cells = [...tr.children];
                const node = cells[1 + from];
                const ref = cells[1 + to];
                if (!node || !ref || node === ref) return;
                if (from < to) ref.after(node);
                else ref.before(node);
            });
            const [moved] = horses.splice(from, 1);
            horses.splice(to, 0, moved);
            // keep the shared list in the same order for the next render
            state.horses.sort((a, b) => {
                const ia = horses.findIndex((h) => String(h.id) === String(a.id));
                const ib = horses.findIndex((h) => String(h.id) === String(b.id));
                return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
            });
            state.horses.forEach((h, i) => { h.sort_order = i; });
            // persist quietly in the background
            api('PUT', '/api/horses/reorder', { horse_ids: horses.map((h) => String(h.id)) })
                .catch((err) => toast(err.message, true));
        };
        let dragId = null;
        grid.querySelectorAll('[data-grip]').forEach((grip) => {
            grip.addEventListener('dragstart', (e) => {
                dragId = grip.getAttribute('data-grip');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', dragId);
            });
        });
        grid.querySelectorAll('[data-horse-col]').forEach((th) => {
            th.addEventListener('dragover', (e) => { e.preventDefault(); th.classList.add('drop-target'); });
            th.addEventListener('dragleave', () => th.classList.remove('drop-target'));
            th.addEventListener('drop', (e) => {
                e.preventDefault();
                th.classList.remove('drop-target');
                const targetId = th.getAttribute('data-horse-col');
                if (!dragId || dragId === targetId) return;
                const from = horses.findIndex((h) => String(h.id) === String(dragId));
                const to = horses.findIndex((h) => String(h.id) === String(targetId));
                if (from < 0 || to < 0) return;
                moveColumn(from, to);
                dragId = null;
            });
        });

        grid.querySelectorAll('[data-block-horse]').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const horse = horses.find((h) => String(h.id) === btn.getAttribute('data-block-horse'));
                if (dayBlocks[horse.id]) openUnblockDialog(horse, date);
                else openBlockDayDialog(horse, date, rides);
            });
        });
    }

    // Reverse picker: which horse does this rider get?
    function openRiderHorseDialog(ride, seat, date, dayRides) {
        if (ride.invoiced) {
            toast('This ride is already invoiced and cannot be changed.', true);
            return;
        }
        const busy = busyAt(dayRides, hhmm(ride.start_time), ride.id, ride.duration_min || 60).horses;
        // Horses already used inside this ride are taken too
        ride.participants.forEach((p) => {
            if (p.horse_id && String(p.contact_id) !== String(seat.contact_id)) busy.add(String(p.horse_id));
        });
        ride.guides.forEach((g) => { if (g.horse_id) busy.add(String(g.horse_id)); });
        const prefs = prefsFor(seat.contact_id);
        const rank = (h) => prefs.preferred.has(String(h.id)) ? 0 : prefs.caution.has(String(h.id)) ? 2 : 1;
        const clashOf = {};
        activeHorses().forEach((h) => { clashOf[h.id] = horseUsedBy(dayRides, ride, h.id); });
        const options = activeHorses()
            .sort((a, b) => (clashOf[a.id] ? 1 : 0) - (clashOf[b.id] ? 1 : 0) ||
                rank(a) - rank(b) || a.name.localeCompare(b.name));

        openDialog(`
            <div class="assign-head">
                <div>
                    <h2 style="margin:0">${esc(seat.contact_name)}</h2>
                    <div class="muted">${hhmm(ride.start_time)} · ${ride.duration_min} min${ride.level ? ' · ' + LEVEL_LABELS[ride.level] : ''}</div>
                </div>
                <button class="secondary assign-x" id="rh-close">${ICON_X}</button>
            </div>
            <p class="muted" style="margin:10px 0 4px">Which horse?</p>
            <div class="assign-list">
                ${options.map((h) => {
                    const mark = prefs.preferred.has(String(h.id)) ? '⭐ '
                        : prefs.caution.has(String(h.id)) ? '⚠ ' : '';
                    const own = String(h.owner_contact_id) === String(seat.contact_id) ? '🏠 ' : '';
                    const has = String(h.id) === String(seat.horse_id);
                    const clash = clashOf[h.id];
                    return `<button class="assign-row ${has ? 'has' : ''} ${clash ? 'busy' : ''}" data-pick-horse="${h.id}">
                        <span class="assign-name">${own}${mark}${esc(h.name)}</span>
                        <span class="assign-cur">${has ? '✓ assigned'
                            : clash ? `busy: ${esc(rideLabel(clash))}`
                            : prefs.caution.has(String(h.id)) ? esc(prefs.caution.get(String(h.id)) || 'caution') : 'free'}</span>
                    </button>`;
                }).join('')}
            </div>
            <div class="form-error"></div>
            <div class="form-actions">
                ${seat.horse_id ? '<button class="danger small" id="rh-clear">Remove horse</button>' : ''}
            </div>`);
        document.getElementById('rh-close').addEventListener('click', closeDialog);

        const save = async (horseId) => {
            const clash = horseId ? horseUsedBy(dayRides, ride, horseId) : null;
            if (clash) {
                const hName = (activeHorses().find((h) => String(h.id) === String(horseId)) || {}).name || 'That horse';
                if (clash.invoiced) {
                    dialogError(`${hName} is on ${rideLabel(clash)}, which is already invoiced and cannot be changed.`);
                    return;
                }
                if (!confirm(`${hName} is on ${rideLabel(clash)}.\n\nTake it off that ride and use it here instead?`)) return;
                try {
                    await api('PUT', `/api/rides/${clash.id}`, {
                        date: clash.date,
                        start_time: hhmm(clash.start_time),
                        duration_min: clash.duration_min,
                        ride_type_id: clash.ride_type_id,
                        is_block: clash.is_block,
                        all_day: clash.all_day,
                        level: clash.level,
                        notes: clash.notes || '',
                        participants: clash.participants.map((p) => ({
                            horse_id: String(p.horse_id) === String(horseId) ? null : p.horse_id,
                            contact_id: p.contact_id
                        })).filter((p) => p.contact_id || p.horse_id),
                        guides: clash.guides.map((g) => String(g.horse_id) === String(horseId)
                            ? { guide_id: g.guide_id, mode: 'foot', horse_id: null }
                            : { guide_id: g.guide_id, mode: g.mode, horse_id: g.horse_id })
                    });
                } catch (err) {
                    dialogError(`Could not free that horse: ${err.message}`);
                    return;
                }
            }
            const parts = ride.participants.map((p) => ({
                horse_id: String(p.contact_id) === String(seat.contact_id) ? horseId : p.horse_id,
                contact_id: p.contact_id
            }));
            try {
                await api('PUT', `/api/rides/${ride.id}`, {
                    date: ride.date,
                    start_time: hhmm(ride.start_time),
                    duration_min: ride.duration_min,
                    ride_type_id: ride.ride_type_id,
                    is_block: ride.is_block,
                    level: ride.level,
                    notes: ride.notes || '',
                    participants: parts.filter((p) => p.contact_id || p.horse_id),
                    guides: ride.guides.map((g) => ({ guide_id: g.guide_id, mode: g.mode, horse_id: g.horse_id }))
                });
                closeDialog();
                renderCalendar();
            } catch (err) {
                dialogError(err.message);
            }
        };
        $dialog.querySelectorAll('[data-pick-horse]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const hid = btn.getAttribute('data-pick-horse');
                save(String(hid) === String(seat.horse_id) ? null : hid);
            });
        });
        const clearBtn = document.getElementById('rh-clear');
        if (clearBtn) clearBtn.addEventListener('click', () => save(null));
    }

    // Which other ride (overlapping in time) is using this horse?
    function horseUsedBy(dayRides, ride, horseId) {
        const start = toMin(hhmm(ride.start_time));
        const end = start + (ride.duration_min || 60);
        return dayRides.find((o) => {
            if (String(o.id) === String(ride.id) || o.status === 'cancelled') return false;
            const s = o.all_day ? 0 : toMin(hhmm(o.start_time));
            const e = o.all_day ? 24 * 60 : s + (o.duration_min || 60);
            if (e <= start || s >= end) return false;
            return o.participants.some((p) => String(p.horse_id) === String(horseId)) ||
                o.guides.some((g) => String(g.horse_id) === String(horseId));
        }) || null;
    }

    function rideLabel(o) {
        if (o.all_day && o.is_block) return 'an all-day block';
        const who = o.participants.filter((p) => p.contact_name).map((p) => shortName(p.contact_name));
        return `the ${hhmm(o.start_time)} ride${who.length ? ' (' + who.join(', ') + ')' : ''}`;
    }

    // Small picker: who on this ride gets this horse?
    function openHorseAssignDialog(ride, horse, date, dayRides) {
        if (ride.invoiced) {
            toast('This ride is already invoiced and cannot be changed.', true);
            return;
        }
        const color = rideColor(ride);
        const riders = ride.participants.filter((p) => p.contact_id);
        const current = ride.participants.find((p) => String(p.horse_id) === String(horse.id));
        const mount = ride.guides.find((g) => g.mode === 'horse' && String(g.horse_id) === String(horse.id));
        const holder = mount ? `${mount.guide_name} (instructor)`
            : current ? (current.contact_name || 'an open seat') : null;

        const rows = riders.map((p) => {
            const has = String(p.horse_id) === String(horse.id);
            const prefs = prefsFor(p.contact_id);
            const mark = prefs.preferred.has(String(horse.id)) ? '⭐ '
                : prefs.caution.has(String(horse.id)) ? '⚠ ' : '';
            return `<button class="assign-row ${has ? 'has' : ''}" data-assign-contact="${p.contact_id}">
                <span class="assign-name">${mark}${esc(p.contact_name)}</span>
                <span class="assign-cur">${has ? `✓ on ${esc(horse.name)} — tap to remove`
                    : p.horse_name ? `<s>${esc(p.horse_name)}</s> → <b>${esc(horse.name)}</b>`
                    : `→ <b>${esc(horse.name)}</b>`}</span>
            </button>`;
        }).join('');
        const guideRows = ride.guides.map((g) => {
            const has = g.mode === 'horse' && String(g.horse_id) === String(horse.id);
            return `<button class="assign-row ${has ? 'has' : ''}" data-assign-guide="${g.guide_id}">
                <span class="assign-name">${guideDot(g)}${esc(g.guide_name)} <span class="muted">(instructor)</span></span>
                <span class="assign-cur">${has ? `✓ on ${esc(horse.name)} — tap to remove`
                    : g.mode === 'horse' && g.horse_name ? `<s>${esc(g.horse_name)}</s> → <b>${esc(horse.name)}</b>`
                    : `→ <b>${esc(horse.name)}</b>`}</span>
            </button>`;
        }).join('');

        openDialog(`
            <div class="assign-head">
                <div>
                    <h2 style="margin:0"><span class="horse-dot" style="background:${esc(horse.color)};width:13px;height:13px"></span>${esc(horse.name)}</h2>
                    <div class="muted">${hhmm(ride.start_time)} · ${ride.duration_min} min${ride.level ? ' · ' + LEVEL_LABELS[ride.level] : ''}</div>
                </div>
                <button class="secondary assign-x" id="as-close">${ICON_X}</button>
            </div>
            <p class="muted" style="margin:10px 0 4px">${holder
                ? `${esc(horse.name)} is on <b>${esc(holder)}</b>. Tap someone else to move the horse to them.`
                : `Tap whoever should ride ${esc(horse.name)} — it replaces the horse they have now.`}</p>
            <div class="assign-list">${rows || '<div class="muted">No riders on this ride.</div>'}${guideRows}</div>
            <div class="form-error"></div>
            <div class="form-actions">
                ${holder ? `<button class="danger small" id="as-clear">Take ${esc(horse.name)} off this ride</button>` : ''}
            </div>`);
        document.getElementById('as-close').addEventListener('click', closeDialog);

        const save = async (mutate) => {
            // If the horse is on another overlapping ride, offer to move it
            const clash = horseUsedBy(dayRides, ride, horse.id);
            if (clash) {
                if (clash.invoiced) {
                    dialogError(`${horse.name} is on ${rideLabel(clash)}, which is already invoiced and cannot be changed.`);
                    return;
                }
                if (!confirm(`${horse.name} is on ${rideLabel(clash)}.\n\nTake ${horse.name} off that ride and use it here instead?`)) return;
                const otherParts = clash.participants.map((p) => ({
                    horse_id: String(p.horse_id) === String(horse.id) ? null : p.horse_id,
                    contact_id: p.contact_id
                })).filter((p) => p.contact_id || p.horse_id);
                const otherGuides = clash.guides.map((g) => String(g.horse_id) === String(horse.id)
                    ? { guide_id: g.guide_id, mode: 'foot', horse_id: null }
                    : { guide_id: g.guide_id, mode: g.mode, horse_id: g.horse_id });
                try {
                    await api('PUT', `/api/rides/${clash.id}`, {
                        date: clash.date,
                        start_time: hhmm(clash.start_time),
                        duration_min: clash.duration_min,
                        ride_type_id: clash.ride_type_id,
                        is_block: clash.is_block,
                        all_day: clash.all_day,
                        level: clash.level,
                        notes: clash.notes || '',
                        participants: otherParts,
                        guides: otherGuides
                    });
                } catch (err) {
                    dialogError(`Could not free ${horse.name}: ${err.message}`);
                    return;
                }
            }
            const parts = ride.participants.map((p) => ({ horse_id: p.horse_id, contact_id: p.contact_id }));
            const guides = ride.guides.map((g) => ({ guide_id: g.guide_id, mode: g.mode, horse_id: g.horse_id }));
            mutate(parts, guides);
            try {
                await api('PUT', `/api/rides/${ride.id}`, {
                    date: ride.date,
                    start_time: hhmm(ride.start_time),
                    duration_min: ride.duration_min,
                    ride_type_id: ride.ride_type_id,
                    is_block: ride.is_block,
                    level: ride.level,
                    notes: ride.notes || '',
                    participants: parts.filter((p) => p.contact_id || p.horse_id),
                    guides
                });
                closeDialog();
                renderCalendar();
            } catch (err) {
                dialogError(err.message);
            }
        };
        // Whoever had the horse loses it first, so one tap always just works
        const freeHorse = (parts, guides) => {
            parts.forEach((p) => { if (String(p.horse_id) === String(horse.id)) p.horse_id = null; });
            guides.forEach((g) => {
                if (String(g.horse_id) === String(horse.id)) { g.horse_id = null; g.mode = 'foot'; }
            });
        };
        $dialog.querySelectorAll('[data-assign-contact]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const cid = btn.getAttribute('data-assign-contact');
                save((parts, guides) => {
                    const already = parts.find((p) => String(p.contact_id) === String(cid) &&
                        String(p.horse_id) === String(horse.id));
                    freeHorse(parts, guides);
                    if (already) return; // tapping the current rider removes the horse
                    const seat = parts.find((p) => String(p.contact_id) === String(cid));
                    if (seat) seat.horse_id = horse.id;
                });
            });
        });
        $dialog.querySelectorAll('[data-assign-guide]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const gid = btn.getAttribute('data-assign-guide');
                save((parts, guides) => {
                    const g = guides.find((x) => String(x.guide_id) === String(gid));
                    const already = g && g.mode === 'horse' && String(g.horse_id) === String(horse.id);
                    freeHorse(parts, guides);
                    if (already || !g) return;
                    g.mode = 'horse';
                    g.horse_id = horse.id;
                });
            });
        });
        const clearBtn = document.getElementById('as-clear');
        if (clearBtn) clearBtn.addEventListener('click', () => save(freeHorse));
    }

    // ---------- Block a horse for a whole day ----------
    async function createDayBlock(horseId, date) {
        await api('POST', '/api/rides', {
            date, start_time: '00:00', is_block: true, all_day: true,
            participants: [{ horse_id: horseId }]
        });
    }

    function openBlockDayDialog(horse, date, dayRides) {
        // Rides on the clicked day that use this horse must be dealt with first
        const involved = dayRides.filter((r) => !(r.is_block && r.all_day) &&
            (r.participants.some((p) => String(p.horse_id) === String(horse.id)) ||
             r.guides.some((g) => String(g.horse_id) === String(horse.id))));
        const anyInvoiced = involved.some((r) => r.invoiced);

        const rows = involved.map((r) => {
            const time = hhmm(r.start_time);
            const part = r.participants.find((p) => String(p.horse_id) === String(horse.id));
            const gd = r.guides.find((g) => String(g.horse_id) === String(horse.id));
            const who = r.is_block ? 'Blocked'
                : part ? (part.contact_name || 'Open seat')
                : gd ? `${gd.guide_name} (instructor)` : '';
            const label = `${time} · ${who}${r.ride_type_name ? ' · ' + r.ride_type_name : ''}`;
            if (r.invoiced) {
                return `<div class="pick-row"><div style="flex:2">${esc(label)}</div>
                        <div class="muted" style="flex:1">🧾 invoiced — cannot move</div></div>`;
            }
            const taken = busyAt(dayRides, time, null, r.duration_min || 60).horses;
            const seatPrefs = part && part.contact_id ? prefsFor(part.contact_id) : null;
            const prefMark = (h) => !seatPrefs ? ''
                : seatPrefs.preferred.has(String(h.id)) ? '⭐ '
                : seatPrefs.caution.has(String(h.id)) ? '⚠ ' : '';
            const free = activeHorses().filter((h) => !taken.has(String(h.id)));
            const cancelLabel = part
                ? (r.participants.length > 1 ? '✕ Remove rider from this ride' : '✕ Cancel this ride')
                : '✕ Remove instructor from this ride';
            return `<div class="pick-row" data-move-ride="${r.id}">
                    <div style="flex:2">${esc(label)}</div>
                    <select class="mv-horse" style="flex:1">
                        ${free.map((h) => `<option value="${h.id}">→ ${prefMark(h)}${esc(h.name)}</option>`).join('')}
                        <option value="__cancel">${cancelLabel}</option>
                    </select>
                </div>`;
        }).join('');

        openDialog(`
            <div class="assign-head">
                <div>
                    <h2 style="margin:0">🚫 Block ${esc(horse.name)}</h2>
                    <div class="muted">The horse is unavailable on these days.</div>
                </div>
                <button class="secondary assign-x" id="bk-close">${ICON_X}</button>
            </div>
            <label>How long</label>
            <select id="bk-mode">
                <option value="day">Whole day(s)</option>
                <option value="part">Part of the day (set hours)</option>
            </select>
            <div class="form-row" style="margin-top:10px">
                <div><label>From</label><input type="date" id="bk-from" value="${date}"></div>
                <div><label>To</label><input type="date" id="bk-to" value="${date}"></div>
            </div>
            <div class="form-actions" id="bk-presets" style="justify-content:flex-start;margin-top:6px">
                <button type="button" class="secondary small" id="bk-1day">Just this day</button>
                <button type="button" class="secondary small" id="bk-week">1 week</button>
                <button type="button" class="secondary small" id="bk-month">1 month</button>
            </div>
            <div class="form-row hidden" id="bk-times">
                <div><label>Start</label><input type="time" id="bk-start" value="09:00"></div>
                <div><label>End</label><input type="time" id="bk-end" value="12:00"></div>
            </div>
            ${involved.length ? `
                <label>${esc(horse.name)} is in ${involved.length} ride${involved.length === 1 ? '' : 's'} on ${esc(date)}</label>
                <div class="muted" style="margin-bottom:6px">Move ${involved.length === 1 ? 'it' : 'them'} to another horse, or cancel.
                    Later days in the range that already have rides are skipped.</div>
                ${rows}` : ''}
            <div class="form-error"></div>
            <div class="form-actions">
                <button class="secondary" id="bk-cancel">Cancel</button>
                ${anyInvoiced ? '' : `<button id="bk-save">Block ${esc(horse.name)}</button>`}
            </div>`);
        document.getElementById('bk-close').addEventListener('click', closeDialog);
        document.getElementById('bk-cancel').addEventListener('click', closeDialog);
        if (anyInvoiced) {
            dialogError('Some rides that day are already invoiced and cannot be moved, so this horse cannot be blocked then.');
            return;
        }
        const modeSel = document.getElementById('bk-mode');
        const syncMode = () => {
            const part = modeSel.value === 'part';
            document.getElementById('bk-times').classList.toggle('hidden', !part);
            document.getElementById('bk-presets').classList.toggle('hidden', part);
            if (part) document.getElementById('bk-to').value = document.getElementById('bk-from').value;
        };
        modeSel.addEventListener('change', syncMode);
        const setTo = (days) => { document.getElementById('bk-to').value = shiftDate(date, days); };
        document.getElementById('bk-1day').addEventListener('click', () => setTo(0));
        document.getElementById('bk-week').addEventListener('click', () => setTo(6));
        document.getElementById('bk-month').addEventListener('click', () => setTo(29));

        document.getElementById('bk-save').addEventListener('click', async () => {
            const from = document.getElementById('bk-from').value;
            const to = document.getElementById('bk-to').value;
            if (!from || !to || from > to) return dialogError('Pick a valid date range.');
            try {
                // clear the clicked day first, as chosen above
                for (const row of $dialog.querySelectorAll('[data-move-ride]')) {
                    const choice = row.querySelector('.mv-horse').value;
                    const r = involved.find((x) => String(x.id) === row.getAttribute('data-move-ride'));
                    const base = {
                        date: r.date, start_time: hhmm(r.start_time), duration_min: r.duration_min,
                        ride_type_id: r.ride_type_id, is_block: r.is_block, level: r.level, notes: r.notes || ''
                    };
                    if (choice === '__cancel') {
                        const others = r.participants.filter((p) => String(p.horse_id) !== String(horse.id));
                        if (!others.length) await api('DELETE', `/api/rides/${r.id}?scope=one`);
                        else await api('PUT', `/api/rides/${r.id}`, {
                            ...base,
                            participants: others.map((p) => ({ horse_id: p.horse_id, contact_id: p.contact_id })),
                            guides: r.guides.filter((g) => String(g.horse_id) !== String(horse.id))
                                .map((g) => ({ guide_id: g.guide_id, mode: g.mode, horse_id: g.horse_id }))
                        });
                    } else {
                        await api('PUT', `/api/rides/${r.id}`, {
                            ...base,
                            participants: r.participants.map((p) => ({
                                horse_id: String(p.horse_id) === String(horse.id) ? choice : p.horse_id,
                                contact_id: p.contact_id
                            })),
                            guides: r.guides.map((g) => ({
                                guide_id: g.guide_id, mode: g.mode,
                                horse_id: String(g.horse_id) === String(horse.id) ? choice : g.horse_id
                            }))
                        });
                    }
                }
                const body = { from, to };
                if (modeSel.value === 'part') {
                    const s = document.getElementById('bk-start').value;
                    const e = document.getElementById('bk-end').value;
                    if (!s || !e || e <= s) return dialogError('Give a start and end time.');
                    body.start_time = s;
                    body.duration_min = toMin(e) - toMin(s);
                }
                const res = await api('POST', `/api/horses/${horse.id}/block`, body);
                closeDialog();
                toast(res.skipped.length
                    ? `${horse.name} blocked on ${res.created} day(s); ${res.skipped.length} skipped (rides booked).`
                    : `${horse.name} blocked on ${res.created} day(s).`);
                renderCalendar();
            } catch (err) {
                dialogError(err.message);
            }
        });
    }

    async function openUnblockDialog(horse, date) {
        let future = [];
        try {
            future = (await api('GET', `/api/horses/${horse.id}/blocks?from=${date}`)).dates;
        } catch (err) { /* fall back to the single day */ }
        const later = future.filter((d) => d > date);
        openDialog(`
            <div class="assign-head">
                <div>
                    <h2 style="margin:0">🟢 Unblock ${esc(horse.name)}</h2>
                    <div class="muted">${esc(horse.name)} is blocked on ${esc(date)}${
                        later.length ? ` and ${later.length} later day${later.length === 1 ? '' : 's'}` : ''}.</div>
                </div>
                <button class="secondary assign-x" id="ub-close">${ICON_X}</button>
            </div>
            <div class="assign-list" style="margin-top:10px">
                <button class="assign-row" data-unblock="one">
                    <span class="assign-name">Just this day</span>
                    <span class="assign-cur">${esc(date)}</span>
                </button>
                ${later.length ? `
                <button class="assign-row" data-unblock="future">
                    <span class="assign-name">This day and all later blocks</span>
                    <span class="assign-cur">${later.length + 1} days · to ${esc(later[later.length - 1])}</span>
                </button>` : ''}
            </div>
            <div class="form-error"></div>
            <div class="form-actions"><button class="secondary" id="ub-cancel">Cancel</button></div>`);
        document.getElementById('ub-close').addEventListener('click', closeDialog);
        document.getElementById('ub-cancel').addEventListener('click', closeDialog);
        $dialog.querySelectorAll('[data-unblock]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                try {
                    const res = await api('DELETE',
                        `/api/horses/${horse.id}/block?from=${date}&scope=${btn.getAttribute('data-unblock')}`);
                    closeDialog();
                    toast(`${horse.name} is available again (${res.removed} day${res.removed === 1 ? '' : 's'}).`);
                    renderCalendar();
                } catch (err) {
                    dialogError(err.message);
                }
            });
        });
    }

    // ---------- Ride dialog ----------
    // Horse options for a rider row: ⭐ preferred first, then standard; the
    // rider's caution horses leave the standard list into a flagged group.
    function partHorseOptions(selectedId, busy, contactId, opts) {
        opts = opts || {};
        const prefs = prefsFor(contactId);
        // Alternatives keep busy horses on the list, just labelled — the instructor
        // may still want one if the other ride frees up. Primary picks hide them.
        const inUse = (h) => busy && busy.has(String(h.id)) && String(h.id) !== String(selectedId);
        const opt = (h, pre) => `<option value="${h.id}" ${String(selectedId) === String(h.id) ? 'selected' : ''}>${pre}${esc(h.name)}${opts.markInUse && inUse(h) ? ' — in use' : ''}</option>`;
        let head = `<option value="">${opts.placeholder || '(no horse yet)'}</option>`;
        const avail = activeHorses().filter((h) => opts.markInUse || keepOption(h.id, selectedId, busy))
            .sort((a, b) => a.name.localeCompare(b.name));
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

    // Every horse stays selectable as an alternative; the ones already booked at
    // that time are flagged rather than hidden.
    function altHorseOptions(selectedId, busy, contactId) {
        return partHorseOptions(selectedId, busy, contactId,
            { placeholder: '(no alternative)', markInUse: true });
    }

    function participantRowHtml(p, withResched, freq) {
        return `
            <div class="pick-row" data-kind="part">
                <select class="pr-contact">${contactOptions(p ? p.contact_id : null, '(no rider — horse only)')}</select>
                <select class="pr-horse">${partHorseOptions(p ? p.horse_id : null, null, p ? p.contact_id : null)}</select>
                <button type="button" class="secondary small pr-alt-toggle" title="Offer an alternative horse">alt</button>
                <select class="pr-alt ${p && p.alt_horse_id ? '' : 'hidden'}" title="Alternative horse — instructor picks on the day">
                    ${altHorseOptions(p ? p.alt_horse_id : null, null, p ? p.contact_id : null)}
                </select>
                <select class="pr-freq hidden" title="How often this rider comes">
                    <option value="weekly" ${freq === 'biweekly' ? '' : 'selected'}>Every week</option>
                    <option value="biweekly" ${freq === 'biweekly' ? 'selected' : ''}>Every 2nd week</option>
                </select>
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
        // The reports page opens this dialog too — redraw whatever opened it
        const afterSave = defaults.onSaved || renderCalendar;
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
            const dialogGuides = new Set();   // same instructor twice on THIS ride
            // Rows marked as rescheduled are leaving the ride — theirs don't count
            $dialog.querySelectorAll('.pr-horse, .gr-horse').forEach((sel) => {
                if (sel !== exceptSel && sel.value && !sel.classList.contains('hidden') &&
                    !sel.closest('.rescheduled')) horses.add(sel.value);
            });
            $dialog.querySelectorAll('.pr-contact').forEach((sel) => {
                if (sel !== exceptSel && sel.value && !sel.closest('.rescheduled')) contacts.add(sel.value);
            });
            $dialog.querySelectorAll('.gr-guide').forEach((sel) => {
                if (sel !== exceptSel && sel.value) { guides.add(sel.value); dialogGuides.add(sel.value); }
            });
            return { horses, contacts, guides, dialogGuides };
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
                const altSel = row.querySelector('.pr-alt');
                if (altSel) altSel.innerHTML = altHorseOptions(altSel.value, takenSets(altSel).horses, contactSel.value);
                contactSel.innerHTML = partContactOptions(contactSel.value, takenSets(contactSel).contacts, weekday, startMin, dur);
            });
            $dialog.querySelectorAll('.gr-horse').forEach((sel) => {
                sel.innerHTML = horseOptions(sel.value, takenSets(sel).horses);
            });
            const gOverlaps = guideOverlaps(dayRides, timeVal(), dur, isEdit ? ride.id : null);
            $dialog.querySelectorAll('.gr-guide').forEach((sel) => {
                sel.innerHTML = guideOptions(sel.value, takenSets(sel).dialogGuides, gOverlaps);
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
            $dialog.querySelectorAll('.gr-guide').forEach((sel) => {
                const mins = sel.value && gOverlaps[String(sel.value)];
                if (!mins) return;
                const g = state.guides.find((x) => String(x.id) === String(sel.value));
                warnings.push(`⧉ ${(g && g.name) || 'This instructor'} is also on another ride — ${mins} min overlap.`);
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

        const removeFromSeries = [];   // contact ids to drop from the weekly template
        function wireRow(row) {
            row.querySelector('.row-x').addEventListener('click', async () => {
                const contactSel = row.querySelector('.pr-contact');
                const cid = contactSel && contactSel.value;
                const inSeries = isEdit && ride.recurring_id && cid;
                if (inSeries) {
                    const name = (contactById(cid) || {}).name || 'this rider';
                    const choice = await askChoice(`Remove ${name}`,
                        'They are on the weekly fixed ride.', [
                            { key: 'week', label: 'Just this week', hint: 'stays on the weekly schedule' },
                            { key: 'series', label: 'Remove from the weekly schedule', hint: 'this week and from now on' }
                        ]);
                    if (!choice) return;
                    if (choice === 'series') removeFromSeries.push(cid);
                }
                row.remove();
                refreshOptions();
            });
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
            const altToggle = row.querySelector('.pr-alt-toggle');
            if (altToggle) altToggle.addEventListener('click', () => {
                row.querySelector('.pr-alt').classList.toggle('hidden');
            });
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
            <label>Notes (private — only visible here)</label>
            <input id="ride-notes" value="${esc(isEdit ? ride.notes || '' : '')}">
            <label>Instructor notes (shown on the ride and the instructor schedule)</label>
            <input id="ride-inotes" value="${esc(isEdit ? ride.instructor_notes || '' : '')}"
                   placeholder="e.g. Nolan on the lunge for the first 10 min">
            <label>Where</label>
            <select id="ride-venue">${venueOptions(isEdit ? (ride.venue || 'instructor') : 'instructor')}</select>
            <label style="display:flex;align-items:center;gap:8px;margin-top:12px;color:var(--text);font-weight:500">
                <input type="checkbox" id="ride-repeat" style="width:auto" ${isEdit && ride.recurring_id ? 'checked' : ''}>
                🔁 Repeats every week (fixed ride)
            </label>
            <div class="muted" id="repeat-note" style="margin-left:26px">${isEdit && ride.recurring_id
                ? 'Set how often each rider comes above. Unticking stops the series from this day on.'
                : 'Makes this a weekly fixed ride from this date. Each rider can then be every week or every 2nd week.'}</div>
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
        const seriesFreq = {};
        if (isEdit) (ride.off_riders || []).forEach((o) => { seriesFreq[String(o.contact_id)] = o.frequency; });
        if (isEdit && ride.rider_freq) Object.assign(seriesFreq, ride.rider_freq);
        parts.forEach((p) => addRow('ride-parts',
            participantRowHtml(p, isEdit, seriesFreq[String(p.contact_id)])));
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
        const repeatBox = document.getElementById('ride-repeat');
        const syncFreqVisibility = () => {
            $dialog.querySelectorAll('.pr-freq').forEach((s) =>
                s.classList.toggle('hidden', !repeatBox || !repeatBox.checked));
        };
        if (repeatBox) repeatBox.addEventListener('change', syncFreqVisibility);
        syncFreqVisibility();
        document.getElementById('ride-parts').addEventListener('input', syncFreqVisibility);
        document.getElementById('ride-guides').addEventListener('change', refreshOptions);
        refreshOptions();
        if (locked) return;

        document.getElementById('ride-save').addEventListener('click', async () => {
            const credits = reschedRows();
            const body = {
                date: defaults.date,
                start_time: document.getElementById('ride-time').value,
                ride_type_id: document.getElementById('ride-type').value || null,
                is_block: isEdit && !!ride.is_block,   // blocks are made with the 🚫 button, not here
                level: document.getElementById('ride-level').value || null,
                venue: document.getElementById('ride-venue').value,
                duration_min: parseInt(document.getElementById('ride-duration').value, 10) || null,
                notes: document.getElementById('ride-notes').value,
                instructor_notes: document.getElementById('ride-inotes').value,
                participants: [...$dialog.querySelectorAll('[data-kind="part"]')]
                    .filter((row) => !row.classList.contains('rescheduled'))
                    .map((row) => ({
                        horse_id: row.querySelector('.pr-horse').value || null,
                        alt_horse_id: (row.querySelector('.pr-alt') || {}).value || null,
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
                let savedId = isEdit ? ride.id : null;
                if (isEdit) await api('PUT', `/api/rides/${ride.id}`, body);
                else savedId = (await api('POST', '/api/rides', body)).ride_id;
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
                for (const cid of removeFromSeries) {
                    await api('DELETE', `/api/rides/${ride.id}/repeat-riders/${cid}`);
                }
                const box = document.getElementById('ride-repeat');
                const freqs = [...$dialog.querySelectorAll('[data-kind="part"]')].map((row) => ({
                    contact_id: row.querySelector('.pr-contact').value || null,
                    frequency: row.querySelector('.pr-freq').value
                })).filter((p) => p.contact_id);
                const targetId = isEdit ? ride.id : savedId;
                if (box && targetId) {
                    const wants = box.checked;
                    const has = isEdit && !!ride.recurring_id;
                    if (wants && !has) await api('POST', `/api/rides/${targetId}/repeat`, { participants: freqs });
                    else if (wants && has) await api('PUT', `/api/rides/${targetId}/repeat-riders`, { participants: freqs });
                    else if (!wants && has) await api('POST', `/api/rides/${targetId}/stop-repeat`, {});
                }
                closeDialog();
                toast(credits.length
                    ? `Saved. ${credits.map((pc) => pc.name).join(', ')} got a reschedule credit.`
                    : (defaults.addContactId ? 'Saved — reschedule credit used.' : 'Saved.'));
                afterSave();
            } catch (err) {
                dialogError(err.message);
            }
        });
        const deleteBtn = document.getElementById('ride-delete');
        if (deleteBtn) deleteBtn.addEventListener('click', () => {
            if (!ride.recurring_id) {
                if (!confirm('Delete this ride?')) return;
                doDelete('one');
                return;
            }
            openDeleteScopeDialog(ride, doDelete);
        });

        async function doDelete(scope) {
            try {
                await api('DELETE', `/api/rides/${ride.id}?scope=${scope}`);
                closeDialog();
                toast(scope === 'all' ? 'The whole series was deleted.'
                    : scope === 'future' ? 'This and all later rides were deleted.'
                    : 'Deleted.');
                afterSave();
            } catch (err) {
                dialogError(err.message);
            }
        }
    }

    // A repeating ride can be deleted at three scopes
    function openDeleteScopeDialog(ride, doDelete) {
        openDialog(`
            <h2>Delete a repeating ride</h2>
            <p class="muted">This ride is part of a weekly fixed ride
               (${esc(WEEKDAYS[isoDow(ride.date) - 1])}s at ${hhmm(ride.start_time)}).
               Rides that are already invoiced are always kept.</p>
            <div class="assign-list">
                <button class="assign-row" data-scope="one">
                    <span class="assign-name">Just this day</span>
                    <span class="assign-cur">${esc(ride.date)}</span>
                </button>
                <button class="assign-row" data-scope="future">
                    <span class="assign-name">This day and all later ones</span>
                    <span class="assign-cur">ends the series here</span>
                </button>
                <button class="assign-row" data-scope="all">
                    <span class="assign-name">The whole series</span>
                    <span class="assign-cur">past and future</span>
                </button>
            </div>
            <div class="form-error"></div>
            <div class="form-actions"><button class="secondary" id="ds-cancel">Cancel</button></div>`);
        document.getElementById('ds-cancel').addEventListener('click', closeDialog);
        $dialog.querySelectorAll('[data-scope]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const scope = btn.getAttribute('data-scope');
                const msg = scope === 'all' ? 'Delete every ride in this series (except invoiced ones)?'
                    : scope === 'future' ? 'Delete this ride and all later ones in the series?'
                    : 'Delete just this day?';
                if (!confirm(msg)) return;
                doDelete(scope);
            });
        });
    }

    // ---------- Fixed (recurring) rides — weekly group templates ----------
    async function renderFixed() {
        $view.innerHTML = `
            <div class="page-tabs" style="margin-bottom:12px">
                <button class="page-tab" id="tab-day">🐴 Ride schedule</button>
                <button class="page-tab active">🔁 Fixed rides</button>
            </div>
            <p class="muted">A fixed ride repeats every week: same day, time, riders and instructors.
               Riders are weekly by default; individual riders can be set to every second week.
               New fixed rides are made in the day calendar — add the ride, then tick
               <b>Repeats every week</b>. Horses are assigned on the day.</p>
            <div id="fixed-list">Loading…</div>`;
        document.getElementById('tab-day').addEventListener('click', () => { location.hash = '#/calendar'; });
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
        if (addBtn) addBtn.addEventListener('click', () => openNewRecord('other'));
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
            const telLink = (p) => phoneLinks(p);
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
                    <div class="list-item" data-dir-guide="${g.id}" style="${canInvoice() ? 'cursor:pointer' : ''}">
                        <span class="horse-dot" style="background:${esc(g.color || '#6a6a66')};width:13px;height:13px"></span>
                        <div class="li-main">
                            <div class="li-title">${esc(g.name)}${g.is_assistant ? ' <span class="chip role">assistant</span>' : ''}</div>
                            <div class="li-sub">${telLink(g.phone) || '<span class="muted">no number yet — tap to add</span>'}</div>
                        </div>
                    </div>`).join('')}`;
            if (canInvoice()) {
                document.querySelectorAll('[data-dir-id]').forEach((el) => {
                    el.addEventListener('click', () => {
                        const e = entries.find((x) => String(x.id) === el.getAttribute('data-dir-id'));
                        openDirectoryDialog(e);
                    });
                });
                document.querySelectorAll('[data-dir-guide]').forEach((el) => {
                    el.addEventListener('click', () => {
                        const g = state.guides.find((x) => String(x.id) === el.getAttribute('data-dir-guide'));
                        if (g) openGuideDialog(g, renderDirectory);
                    });
                });
            }
        };
        draw('');
        document.getElementById('dir-search').addEventListener('input', (e) => draw(e.target.value));
    }

    // One "New" dialog with a type switcher at the top; the tabs on the
    // Contacts page are only filters.
    const NEW_TYPES = [
        { key: 'rider', label: 'Rider / parent' },
        { key: 'interested', label: '🌱 Interested' },
        { key: 'instructor', label: 'Instructor' },
        { key: 'other', label: 'Other contact' }
    ];

    function newTypeTabsHtml(active) {
        return `<div class="page-tabs new-type-tabs">
            ${NEW_TYPES.map((t) => `<button class="page-tab ${t.key === active ? 'active' : ''}"
                data-newtype="${t.key}">${t.label}</button>`).join('')}
        </div>`;
    }

    function wireNewTypeTabs() {
        $dialog.querySelectorAll('[data-newtype]').forEach((btn) => {
            btn.addEventListener('click', () => openNewRecord(btn.getAttribute('data-newtype')));
        });
    }

    function openNewRecord(type) {
        if (type === 'interested') return openIntakeDialog();
        if (type === 'instructor') return openGuideDialog(null, backToContacts, true);
        if (type === 'other') return openDirectoryDialog(null, true);
        return openContactDialog(null, true);
    }

    function backToContacts() {
        if (state.contactsTab === 'directory') return renderDirectory();
        if (state.contactsTab === 'interested') return renderInterested();
        return renderContacts();
    }

    function openDirectoryDialog(entry, withTabs) {
        openDialog(`
            ${withTabs ? newTypeTabsHtml('other') : ''}
            <h2>${entry ? 'Edit directory entry' : 'New contact (vet, farrier, …)'}</h2>
            <label>Name</label>
            <input id="dc-name" value="${esc(entry ? entry.name : '')}">
            <label>What / role (e.g. Vet, Farrier, Handyman)</label>
            <input id="dc-category" value="${esc(entry ? entry.category : '')}">
            <label>Phone (WhatsApp)</label>
            ${phoneFieldHtml('dc-phone', entry ? entry.phone : '')}
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
        wireNewTypeTabs();
        document.getElementById('dc-cancel').addEventListener('click', closeDialog);
        document.getElementById('dc-save').addEventListener('click', async () => {
            const body = {
                name: document.getElementById('dc-name').value,
                category: document.getElementById('dc-category').value,
                phone: readPhoneField('dc-phone'),
                email: document.getElementById('dc-email').value,
                notes: document.getElementById('dc-notes').value
            };
            try {
                if (entry) await api('PUT', `/api/service-contacts/${entry.id}`, body);
                else await api('POST', '/api/service-contacts', body);
                closeDialog();
                toast('Saved.');
                backToContacts();
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
        document.getElementById('intake-add').addEventListener('click', () => openNewRecord('interested'));
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
                    ${parent.phone ? ' · ' + phoneLinks(parent.phone) : ''}</div>` : ''}
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
    function openIntakeDialog(withTabs) {
        const kidRow = () => `
            <div class="intake-kid" data-kind="intake-kid">
                <div class="pick-row" style="margin-bottom:4px">
                    <input class="ik-name" placeholder="Rider name">
                    <input class="ik-age" type="number" inputmode="numeric" placeholder="Age" style="flex:0 0 74px">
                    <select class="ik-level" style="flex:0 0 130px">${levelOptions('')}</select>
                    <button type="button" class="secondary small ik-avail-toggle" title="Availability">🕒</button>
                    <button type="button" class="danger small row-x">${ICON_X}</button>
                </div>
                <div class="ik-avail hidden">
                    <div class="muted" style="margin:2px 0 4px">Availability — tap the hours this rider can come
                        (leave empty for no restriction)</div>
                    ${availGridHtml([])}
                    <button type="button" class="secondary small ik-copy-avail" style="margin-top:6px">Copy to all riders</button>
                </div>
            </div>`;
        openDialog(`
            ${newTypeTabsHtml('interested')}
            <h2>🌱 Interested rider(s)</h2>
            <label>Parent / payer — pick existing or enter a new one</label>
            <select id="in-parent">${parentOptions(null, null)}</select>
            <div class="form-row">
                <div><input id="in-parent-name" placeholder="…or new parent name"></div>
                <div>${phoneFieldHtml('in-parent-phone', '')}</div>
            </div>
            <label>Riders</label>
            <div id="intake-kids">${kidRow()}</div>
            <button type="button" class="secondary small" id="intake-kid-add">＋ Another rider</button>
            <label>Notes</label>
            <input id="in-notes" placeholder="e.g. friends of the Smiths, wants to start in September">
            <div class="form-error"></div>
            <div class="form-actions">
                <button class="secondary" id="in-cancel">Cancel</button>
                <button id="in-save">Save</button>
            </div>`);
        const wire = (row) => {
            row.querySelector('.row-x').addEventListener('click', () => row.remove());
            row.querySelector('.ik-avail-toggle').addEventListener('click', () => {
                row.querySelector('.ik-avail').classList.toggle('hidden');
            });
            row.querySelectorAll('.avail-cell').forEach((cell) =>
                cell.addEventListener('click', () => cell.classList.toggle('on')));
            row.querySelector('.ik-copy-avail').addEventListener('click', () => {
                const on = [...row.querySelectorAll('.avail-cell')]
                    .filter((c) => c.classList.contains('on'))
                    .map((c) => c.getAttribute('data-avail'));
                $dialog.querySelectorAll('[data-kind="intake-kid"]').forEach((other) => {
                    if (other === row) return;
                    other.querySelectorAll('.avail-cell').forEach((c) =>
                        c.classList.toggle('on', on.includes(c.getAttribute('data-avail'))));
                });
                toast('Availability copied to the other riders.');
            });
        };
        wire($dialog.querySelector('[data-kind="intake-kid"]'));
        document.getElementById('intake-kid-add').addEventListener('click', () => {
            document.getElementById('intake-kids').insertAdjacentHTML('beforeend', kidRow());
            wire(document.getElementById('intake-kids').lastElementChild);
        });
        wireNewTypeTabs();
        document.getElementById('in-cancel').addEventListener('click', closeDialog);
        document.getElementById('in-save').addEventListener('click', async () => {
            const kids = [...$dialog.querySelectorAll('[data-kind="intake-kid"]')].map((row) => ({
                name: row.querySelector('.ik-name').value.trim(),
                age: parseInt(row.querySelector('.ik-age').value, 10) || null,
                level: row.querySelector('.ik-level').value || null,
                availability: collectAvailability(row)
            })).filter((k) => k.name);
            if (!kids.length) return dialogError('Add at least one rider.');
            const notes = document.getElementById('in-notes').value;
            const year = new Date().getFullYear();
            try {
                let parentId = document.getElementById('in-parent').value || null;
                const newParentName = document.getElementById('in-parent-name').value.trim();
                if (!parentId && newParentName) {
                    const res = await api('POST', '/api/contacts', {
                        name: newParentName,
                        phone: readPhoneField('in-parent-phone'),
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
                        availability: k.availability,
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
        document.getElementById('contact-add').addEventListener('click', () => openNewRecord('rider'));
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

    function collectAvailability(root) {
        // Merge contiguous toggled hour cells into ranges per weekday
        const byDay = {};
        (root || $dialog).querySelectorAll('.avail-cell.on').forEach((cell) => {
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

    function openContactDialog(contact, withTabs) {
        openDialog(`
            ${withTabs ? newTypeTabsHtml('rider') : ''}
            <h2>${contact ? 'Edit contact' : 'New rider or parent'}</h2>
            <label>Name</label>
            <input id="ct-name" value="${esc(contact ? contact.name : '')}">
            <label>Phone (WhatsApp)</label>
            ${phoneFieldHtml('ct-phone', contact ? contact.phone : '')}
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
        wireNewTypeTabs();
        document.getElementById('ct-cancel').addEventListener('click', closeDialog);
        document.getElementById('ct-save').addEventListener('click', async () => {
            const body = {
                name: document.getElementById('ct-name').value,
                phone: readPhoneField('ct-phone'),
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
                    ${c.phone ? `<div>${phoneLinks(c.phone)}</div>` : ''}
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

    // Edit a draft term pass and its invoice together
    function openEditPassDialog(tp) {
        openDialog(`
            <div class="assign-head">
                <div>
                    <h2 style="margin:0">Edit ${esc(tp.contact_name)}'s term pass</h2>
                    <div class="muted">${esc(tp.invoice_number || 'no invoice')} · draft — the PDF updates when you save.</div>
                </div>
                <button class="secondary assign-x" id="ep-close">${ICON_X}</button>
            </div>
            <div class="form-row" style="margin-top:10px">
                <div><label>From</label><input type="date" id="ep-start" value="${esc(tp.period_start)}"></div>
                <div><label>To</label><input type="date" id="ep-end" value="${esc(tp.period_end)}"></div>
            </div>
            <label>Price (${esc(state.settings.currency || 'R')})</label>
            <input id="ep-amount" type="number" inputmode="decimal" step="0.01"
                   value="${((tp.total_cents || 0) / 100).toFixed(2)}">
            <label>Invoice line text</label>
            <input id="ep-desc" value="${esc(tp.invoice_line || '')}">
            <div class="muted" style="margin-top:6px">${tp.lessons_so_far} lesson${tp.lessons_so_far === 1 ? '' : 's'} ridden so far in this period.
                Changing the dates changes what the pass covers.</div>
            <div class="form-error"></div>
            <div class="form-actions">
                <button class="secondary" id="ep-cancel">Cancel</button>
                <button id="ep-save">Save</button>
            </div>`);
        document.getElementById('ep-close').addEventListener('click', closeDialog);
        document.getElementById('ep-cancel').addEventListener('click', closeDialog);
        document.getElementById('ep-save').addEventListener('click', async () => {
            try {
                await api('PUT', `/api/term-passes/${tp.id}`, {
                    period_start: document.getElementById('ep-start').value,
                    period_end: document.getElementById('ep-end').value,
                    amount_cents: Math.round(parseFloat(document.getElementById('ep-amount').value || '0') * 100),
                    description: document.getElementById('ep-desc').value
                });
                closeDialog();
                toast('Term pass and invoice updated.');
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
                            ${tp.invoice_status === 'draft'
                                ? `<button class="secondary small" data-pass-edit="${tp.id}">Edit</button>` : ''}
                            <a class="btn secondary small" href="/api/invoices/${tp.invoice_id}/pdf" target="_blank">PDF</a>` : ''}
                        <div class="li-right">${money(tp.total_cents || 0)}</div>
                        <button class="danger small" data-pass-del="${tp.id}" data-pass-name="${esc(tp.contact_name)}">${ICON_X}</button>
                    </div>`;
                }).join('');
                $passes.querySelectorAll('[data-pass-edit]').forEach((btn) => {
                    btn.addEventListener('click', () => {
                        const tp = passesData.passes.find((x) => String(x.id) === btn.getAttribute('data-pass-edit'));
                        if (tp) openEditPassDialog(tp);
                    });
                });
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
            <h1>📅 Calendar</h1>
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
            <div class="card" id="ical-card" style="margin-top:12px">
                <div style="font-weight:700">📆 Subscribe in your phone calendar</div>
                <p class="muted" style="margin:4px 0 8px">Dated to-dos appear in Apple/Google Calendar and
                   stay up to date on their own. Keep the link private — anyone with it can read the list.</p>
                <div class="form-actions" style="justify-content:flex-start;margin-top:0">
                    <a class="btn small" id="ical-sub" href="#">Subscribe</a>
                    <button class="secondary small" id="ical-copy">Copy link</button>
                    ${isAdmin() ? '<span class="spacer"></span><button class="secondary small" id="ical-rotate">New link</button>' : ''}
                </div>
            </div>
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
        const icalUrl = () => `${location.origin}/api/ical/todos.ics?token=${state.settings.ical_token || ''}`;
        const subBtn = document.getElementById('ical-sub');
        if (subBtn) {
            subBtn.href = icalUrl().replace(/^https?:/, 'webcal:');
            subBtn.setAttribute('target', '_blank');
        }
        const icalCopy = document.getElementById('ical-copy');
        if (icalCopy) icalCopy.addEventListener('click', () => {
            navigator.clipboard.writeText(icalUrl()).then(() => toast('Calendar link copied.'),
                () => toast(icalUrl(), true));
        });
        const icalRotate = document.getElementById('ical-rotate');
        if (icalRotate) icalRotate.addEventListener('click', async () => {
            if (!confirm('Make a new calendar link? Any device already subscribed stops updating.')) return;
            try {
                const res = await api('POST', '/api/settings/rotate-ical-token');
                state.settings.ical_token = res.token;
                toast('New calendar link created — subscribe again.');
                renderTodos();
            } catch (err) {
                toast(err.message, true);
            }
        });
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
        if (!state.reportTab) state.reportTab = 'horses';
        const [from, to] = state.reportRange;
        const tab = state.reportTab;
        $view.innerHTML = `
            <h1>📊 Reports</h1>
            <div class="page-tabs">
                <button class="page-tab ${tab === 'horses' ? 'active' : ''}" data-rep-tab="horses">🐴 Rides per horse</button>
                <button class="page-tab ${tab === 'types' ? 'active' : ''}" data-rep-tab="types">🏷️ Ride types</button>
            </div>
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
            <p class="muted">${tab === 'horses'
                ? "Counts booked riders plus horses ridden by a guide. Open seats and blocked horses don't count; guide rides earn no income."
                : 'Tap a ride type to break it down by date, then tap a date to see and edit the rides themselves. Blocks are excluded.'}</p>`;
        const rerun = (range) => {
            state.reportRange = range;
            renderReports();
        };
        $view.querySelectorAll('[data-rep-tab]').forEach((b) => b.addEventListener('click', () => {
            state.reportTab = b.getAttribute('data-rep-tab');
            renderReports();
        }));
        document.getElementById('rep-this').addEventListener('click', () => rerun(monthBounds(0)));
        document.getElementById('rep-last').addEventListener('click', () => rerun(monthBounds(-1)));
        document.getElementById('rep-go').addEventListener('click', () => {
            const f = document.getElementById('rep-from').value;
            const t = document.getElementById('rep-to').value;
            if (f && t) rerun([f, t]);
        });

        if (tab === 'types') return renderRideTypeReport(from, to);

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

    // Ride types, drilled down three levels: type → dates → the rides themselves.
    // Expanded rows are remembered in state so a save can redraw without
    // collapsing everything the user opened.
    async function renderRideTypeReport(from, to) {
        const $res = document.getElementById('rep-result');
        state.repOpenTypes = state.repOpenTypes || new Set();
        state.repOpenDates = state.repOpenDates || new Set();
        let data;
        try {
            data = await api('GET', `/api/reports/ride-types?from=${from}&to=${to}`);
        } catch (err) {
            $res.textContent = err.message;
            return;
        }
        if (!data.rows.length) {
            $res.classList.remove('muted');
            $res.innerHTML = '<div class="card">No rides in this period.</div>';
            return;
        }

        const types = [];       // {name, rides, seats, cents, mins, days:[...]}
        const byName = {};
        data.rows.forEach((r) => {
            let t = byName[r.ride_type_name];
            if (!t) {
                t = byName[r.ride_type_name] = { name: r.ride_type_name, rides: 0, seats: 0, cents: 0, mins: 0, days: [] };
                types.push(t);
            }
            t.rides += r.rides; t.seats += r.seats; t.cents += r.cents; t.mins += r.mins;
            t.days.push(r);
        });
        types.sort((a, b) => b.rides - a.rides || a.name.localeCompare(b.name));
        const total = types.reduce((acc, t) => ({
            rides: acc.rides + t.rides, seats: acc.seats + t.seats,
            cents: acc.cents + t.cents, mins: acc.mins + t.mins
        }), { rides: 0, seats: 0, cents: 0, mins: 0 });

        const hours = (m) => (m / 60).toFixed(1);
        const per = (seats, rides) => (rides ? (seats / rides).toFixed(1) : '—');
        const caret = (open) => `<span class="caret">${open ? '▾' : '▸'}</span>`;

        $res.classList.remove('muted');
        $res.innerHTML = `<div class="table-wrap"><table class="plain rep-tree">
            <tr><th>Ride type</th><th class="num">Rides</th><th class="num">Riders</th>
                <th class="num">Per ride</th><th class="num">Hours</th><th class="num">Income</th></tr>
            ${types.map((t) => {
                const open = state.repOpenTypes.has(t.name);
                let rows = `<tr class="rep-type ${open ? 'open' : ''}" data-type="${esc(t.name)}">
                    <td>${caret(open)}${esc(t.name)}</td>
                    <td class="num"><b>${t.rides}</b></td>
                    <td class="num">${t.seats}</td>
                    <td class="num">${per(t.seats, t.rides)}</td>
                    <td class="num">${hours(t.mins)}</td>
                    <td class="num"><b>${money(t.cents)}</b></td></tr>`;
                if (!open) return rows;
                t.days.forEach((d) => {
                    const key = t.name + '|' + d.date;
                    const dOpen = state.repOpenDates.has(key);
                    rows += `<tr class="rep-date ${dOpen ? 'open' : ''}" data-key="${esc(key)}" data-date="${d.date}">
                        <td class="indent1">${caret(dOpen)}${esc(shortDate(d.date))}
                            <span class="muted">${esc(WEEKDAYS[isoDow(d.date) - 1].slice(0, 3))}</span></td>
                        <td class="num">${d.rides}</td>
                        <td class="num">${d.seats}</td>
                        <td class="num">${per(d.seats, d.rides)}</td>
                        <td class="num">${hours(d.mins)}</td>
                        <td class="num">${money(d.cents)}</td></tr>`;
                    if (dOpen) {
                        rows += `<tr class="rep-rides"><td colspan="6" class="indent2">
                            <div class="rep-ride-list" data-for="${esc(key)}">Loading…</div></td></tr>`;
                    }
                });
                return rows;
            }).join('')}
            <tr class="rep-total"><td><b>Total</b></td>
                <td class="num"><b>${total.rides}</b></td>
                <td class="num"><b>${total.seats}</b></td>
                <td class="num"><b>${per(total.seats, total.rides)}</b></td>
                <td class="num"><b>${hours(total.mins)}</b></td>
                <td class="num"><b>${money(total.cents)}</b></td></tr>
        </table></div>`;

        const toggle = (set, key) => {
            if (set.has(key)) set.delete(key); else set.add(key);
            renderRideTypeReport(from, to);
        };
        $res.querySelectorAll('.rep-type').forEach((tr) => tr.addEventListener('click', () =>
            toggle(state.repOpenTypes, tr.getAttribute('data-type'))));
        $res.querySelectorAll('.rep-date').forEach((tr) => tr.addEventListener('click', () =>
            toggle(state.repOpenDates, tr.getAttribute('data-key'))));

        // Third level: the day's actual rides of that type, editable in place
        for (const box of $res.querySelectorAll('.rep-ride-list')) {
            const key = box.getAttribute('data-for');
            const [typeName, date] = key.split('|');
            try {
                const dayRides = (await api('GET', `/api/rides?from=${date}&to=${date}`)).rides
                    .filter((r) => !r.is_block && !r.all_day);
                const mine = dayRides.filter((r) => rideTypeName(r) === typeName)
                    .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
                box.innerHTML = mine.map((r) => reportRideBox(r)).join('') ||
                    '<span class="muted">No rides.</span>';
                box.querySelectorAll('[data-ride-id]').forEach((el) => el.addEventListener('click', () => {
                    const r = mine.find((x) => String(x.id) === el.getAttribute('data-ride-id'));
                    if (r) openRideDialog(r, { date, dayRides, onSaved: () => renderRideTypeReport(from, to) });
                }));
            } catch (err) {
                box.textContent = err.message;
            }
        }
    }

    const rideTypeName = (r) => r.ride_type_name || '(no type)';

    // The calendar's ride box, read-only and standalone (no horse grid around it)
    function reportRideBox(r) {
        const start = hhmm(r.start_time);
        const endMin = toMin(start) + (r.duration_min || 60);
        const end = `${pad2(Math.floor(endMin / 60) % 24)}:${pad2(endMin % 60)}`;
        const color = rideColor(r);
        const riders = r.participants.filter((p) => p.contact_id);
        const staff = r.guides.map((g) => `
            <span class="staff-pill" style="background:${esc(g.guide_color || '#4a4a46')}">
                ${esc(shortName(g.guide_name))}${g.is_assistant ? ' (ass)' : ''}
            </span>`).join(' ');
        return `<div class="ride-box rep-box ${r.invoiced ? 'invoiced' : ''}">
            <button class="ride-top" data-ride-id="${r.id}" title="Edit this ride">
                <span class="ride-time">${esc(start)}–${esc(end)}</span>
                <span class="ride-dur">${r.duration_min} min</span>
                ${VENUES[r.venue] ? `<span class="ride-venue" style="color:${VENUE_COLORS[r.venue]}">${VENUES[r.venue]}</span>` : ''}
                <span class="ride-level${r.level ? '' : ' none'}"
                      style="${r.level ? `color:${color}` : ''}">${r.level ? LEVEL_LABELS[r.level] : 'no level assigned'}</span>
            </button>
            <div class="ride-cols">
                <div class="ride-riders-col">${riders.length ? riders.map((p) => `
                    <div class="rider-row">
                        <span class="rider-name">${esc(p.contact_name)}</span>
                        ${p.horse_name ? `<span class="rider-horse has">${esc(p.horse_name)}</span>`
                            : '<span class="rider-horse none">no horse yet</span>'}
                    </div>`).join('') : '<div class="rider-row"><span class="rider-name muted">No riders</span></div>'}
                    ${r.instructor_notes ? `<div class="rider-row instructor-note">📝 ${esc(r.instructor_notes)}</div>` : ''}
                </div>
                <div class="ride-staff-col">${staff || '<span class="muted">no instructor</span>'}</div>
            </div>
        </div>`;
    }

    // ---------- Settings ----------
    async function renderSettings() {
        const admin = isAdmin();
        $view.innerHTML = `
            <h1>⚙️ Settings</h1>

            <h2>Horses</h2>
            <div id="set-horses" class="settings-grid"></div>
            <button class="secondary small" id="horse-add">＋ Add horse</button>

            <h2>Instructors</h2>
            <div id="set-guides" class="settings-grid"></div>
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

            ${admin ? `
            <h2>Instructor schedule link</h2>
            <div class="card">
                <p class="muted" style="margin-top:0">A read-only schedule for instructors — no login needed.
                   Share this one link (WhatsApp) and it always shows the current schedule.
                   Anyone with the link can see it, so don't post it publicly. Rotate it if it leaks.</p>
                <input id="pub-link" readonly value="${esc(location.origin)}/schedule?token=${esc(state.settings.public_schedule_token || '')}">
                <div class="form-actions" style="justify-content:flex-start">
                    <button class="small" id="pub-copy">Copy link</button>
                    <a class="btn secondary small" id="pub-open" href="/schedule?token=${esc(state.settings.public_schedule_token || '')}" target="_blank">Open</a>
                    <span class="spacer"></span>
                    <button class="secondary small" id="pub-rotate">Rotate link</button>
                </div>
            </div>` : ''}

            <div class="card" style="margin-top:18px">
                Logged in as <b>${esc(state.user.display_name)}</b> <span class="chip role">${esc(state.user.role)}</span>
                <div class="form-actions"><button class="secondary" id="logout-btn">Log out</button></div>
            </div>`;

        const drawHorses = () => {
            document.getElementById('set-horses').innerHTML = [...state.horses]
                .sort((a, b) => a.name.localeCompare(b.name)).map((h) => `
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
            document.getElementById('set-guides').innerHTML = [...state.guides]
                .sort((a, b) => a.name.localeCompare(b.name)).map((g) => `
                <div class="list-item" data-guide-id="${g.id}">
                    <span class="horse-dot" style="background:${esc(g.color || '#6a6a66')};width:14px;height:14px"></span>
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
        const copyBtn = document.getElementById('pub-copy');
        if (copyBtn) copyBtn.addEventListener('click', () => {
            const inp = document.getElementById('pub-link');
            inp.select();
            navigator.clipboard.writeText(inp.value).then(() => toast('Link copied.'),
                () => toast('Select and copy the link.', true));
        });
        const rotateBtn = document.getElementById('pub-rotate');
        if (rotateBtn) rotateBtn.addEventListener('click', async () => {
            if (!confirm('Make a new link? The old one stops working immediately and everyone needs the new one.')) return;
            try {
                const res = await api('POST', '/api/settings/rotate-schedule-token');
                state.settings.public_schedule_token = res.token;
                toast('New link created.');
                renderSettings();
            } catch (err) {
                toast(err.message, true);
            }
        });
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

    function openGuideDialog(guide, onSaved, withTabs) {
        openDialog(`
            ${withTabs ? newTypeTabsHtml('instructor') : ''}
            <h2>${guide ? 'Edit instructor' : 'New instructor'}</h2>
            <label>Name</label>
            <input id="g-name" value="${esc(guide ? guide.name : '')}">
            <label style="display:flex;align-items:center;gap:8px;color:var(--text);font-weight:500">
                <input type="checkbox" id="g-assistant" style="width:auto" ${guide && guide.is_assistant ? 'checked' : ''}>
                Assistant instructor
            </label>
            <label>Phone (WhatsApp)</label>
            ${phoneFieldHtml('g-phone', guide ? guide.phone || '' : '')}
            <label>Notes</label>
            <input id="g-notes" value="${esc(guide ? guide.notes || '' : '')}">
            <label>Colour (dot on the calendar)</label>
            <input type="color" id="g-color" value="${esc(guide ? guide.color || '#6a6a66' : '#6a6a66')}" style="height:44px;padding:4px">
            ${guide ? `<label>Active</label>
            <select id="g-active"><option value="true" ${guide.active ? 'selected' : ''}>Yes</option><option value="false" ${guide.active ? '' : 'selected'}>No</option></select>` : ''}
            <div class="form-error"></div>
            <div class="form-actions">
                <button class="secondary" id="g-cancel">Cancel</button>
                <button id="g-save">Save</button>
            </div>`);
        wireNewTypeTabs();
        document.getElementById('g-cancel').addEventListener('click', closeDialog);
        document.getElementById('g-save').addEventListener('click', async () => {
            const body = {
                name: document.getElementById('g-name').value,
                phone: readPhoneField('g-phone'),
                is_assistant: document.getElementById('g-assistant').checked,
                notes: document.getElementById('g-notes').value,
                color: document.getElementById('g-color').value
            };
            if (guide) body.active = document.getElementById('g-active').value === 'true';
            try {
                if (guide) await api('PUT', `/api/guides/${guide.id}`, body);
                else await api('POST', '/api/guides', body);
                state.guides = (await api('GET', '/api/guides')).guides;
                closeDialog();
                toast('Saved.');
                if (onSaved) onSaved(); else renderSettings();
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