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
        schools: [],
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

    // "14 Oct 2026" — the house format for a plain date on screen and on paper
    function fmtDay(dateStr) {
        if (!dateStr) return '';
        const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
        if (isNaN(d)) return String(dateStr);
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
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

    // A timestamp as "22 Oct 09:14" — enough to tell whether a note is from
    // this morning or last week, without a full date swamping the line.
    function whenShort(ts) {
        const d = new Date(ts);
        if (isNaN(d)) return '';
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
            + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
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
        let res;
        try {
            res = await fetch(url, opts);
        } catch (netErr) {
            // The connection failed outright. Be explicit about it: a change
            // that looks saved but was not is the worst outcome here.
            setOffline(true);
            const err = new Error(method === 'GET'
                ? 'No signal — could not load that.'
                : 'Not saved — you are offline. Try again once you have signal.');
            err.offline = true;
            throw err;
        }
        let data = null;
        try { data = await res.json(); } catch (e) { /* non-JSON */ }
        // 503 + offline flag is the service worker saying it had nothing cached
        if (res.status === 503 && data && data.offline) {
            setOffline(true);
            const err = new Error('No signal, and this has not been saved to the device yet.');
            err.offline = true;
            throw err;
        }

        if (res.status === 401 && state.user) {
            state.user = null;
            renderLogin();
            throw new Error('Session expired, please log in again.');
        }
        if (!res.ok) {
            // carry the rest of the body (flags like can_detach) onto the error
            const err = new Error((data && data.error) || `Request failed (${res.status})`);
            Object.assign(err, data || {});
            throw err;
        }
        // The worker only falls back to its cache when the network failed, so an
        // X-Cached-At stamp is a reliable "we are offline" signal — a cached 200
        // must never be mistaken for the connection being back.
        const cachedAt = res.headers.get('X-Cached-At');
        if (cachedAt) {
            setOffline(true);
            setStale(cachedAt);
        } else if (res.ok) {
            setOffline(false);
        }
        return data;
    }

    // ---------- Offline state ----------
    // One banner, honest about two different things: that there is no signal,
    // and that what is on screen may be older than the server.
    let staleSince = null;
    function offlineBar() {
        let el = document.getElementById('offline-bar');
        if (!el) {
            el = document.createElement('div');
            el.id = 'offline-bar';
            el.className = 'offline-bar hidden';
            document.body.appendChild(el);
        }
        return el;
    }

    function paintOfflineBar() {
        const el = offlineBar();
        const off = !navigator.onLine || document.body.classList.contains('is-offline');
        if (!off) { el.classList.add('hidden'); return; }
        const when = staleSince ? new Date(staleSince) : null;
        const clock = when
            ? `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
            : null;
        el.innerHTML = `⚠ <b>No signal.</b> ${clock
            ? `Showing the schedule as at ${clock}. Changes will not save until you are back online.`
            : 'Changes will not save until you are back online.'}`;
        el.classList.remove('hidden');
    }

    // A page that LOADED while offline never receives the 'online' event, and on
    // mobile the event is unreliable anyway — so while we believe we are offline,
    // keep asking. Cheap, and it is the only thing that reliably notices the
    // signal coming back.
    let reconnectTimer = null;
    function startReconnectWatch() {
        if (reconnectTimer) return;
        reconnectTimer = setInterval(() => {
            if (!document.body.classList.contains('is-offline')) return stopReconnectWatch();
            confirmOnline();
        }, 5000);
    }
    function stopReconnectWatch() {
        if (reconnectTimer) clearInterval(reconnectTimer);
        reconnectTimer = null;
    }

    function setOffline(off) {
        const was = document.body.classList.contains('is-offline');
        document.body.classList.toggle('is-offline', !!off);
        if (!off) staleSince = null;
        if (off) startReconnectWatch(); else stopReconnectWatch();
        if (was && !off) {
            // the signal is back — refill the device's copy
            warmEssentials().then(() => prewarmDays(21));
        }
        paintOfflineBar();
    }

    function setStale(iso) {
        staleSince = iso;
        paintOfflineBar();
    }

    function canInvoice() { return state.user && ['admin', 'helper'].includes(state.user.role); }
    function isAdmin() { return state.user && state.user.role === 'admin'; }

    // ---------- Dialog ----------
    const $backdrop = document.getElementById('dialog-backdrop');
    const $dialog = document.getElementById('dialog');

    function openDialog(html) {
        $dialog.innerHTML = html;
        // Show it BEFORE resetting the scroll. A dialog carries the scroll
        // position of the last one — replacing innerHTML does not clear it —
        // so a long form opened after a scrolled one came up at its foot, on
        // the Save button. Setting scrollTop while the backdrop is still
        // display:none is silently dropped: the element has no layout to
        // scroll, and the old offset is restored the moment it is shown.
        $backdrop.classList.remove('hidden');
        $dialog.scrollTop = 0;
        enhanceTimeInputs($dialog);
    }

    // A second dialog layered over an open one, so the form underneath keeps
    // its unsaved state (openDialog replaces the main dialog's contents).
    function openSubDialog(html, opts) {
        const overlay = document.createElement('div');
        overlay.className = 'timepick-backdrop';
        overlay.innerHTML = `<div class="timepick subdialog">${html}</div>`;
        // These hold unsaved edits, so a stray tap on the backdrop must not throw
        // them away — the buttons are the only way out. Pass dismissable for
        // read-only pickers where tapping away is harmless.
        if (opts && opts.dismissable) {
            overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        }
        document.body.appendChild(overlay);
        enhanceTimeInputs(overlay);
        return overlay;
    }

    // Yes/no in the app's own overlay instead of the browser's, which shows the
    // hostname and cannot be styled. Returns true only on the confirm button.
    async function askConfirm(title, message, label, hint) {
        const choice = await askChoice(title, message || '',
            [{ key: 'yes', label: label || 'Confirm', hint: hint || '' }]);
        return choice === 'yes';
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
        const [horses, rideTypes, contacts, users, guides, settings, schools, livery] = await Promise.all([
            api('GET', '/api/horses'),
            api('GET', '/api/ride-types'),
            api('GET', '/api/contacts'),
            api('GET', '/api/users'),
            api('GET', '/api/guides'),
            api('GET', '/api/settings'),
            api('GET', '/api/schools'),
            api('GET', '/api/livery-extras')
        ]);
        state.horses = horses.horses;
        state.rideTypes = rideTypes.ride_types;
        state.contacts = contacts.contacts;
        state.users = users.users;
        state.guides = guides.guides;
        state.settings = settings.settings;
        state.schools = schools.schools;
        state.liveryExtras = livery.extras;
    }

    function activeHorses() { return state.horses.filter((h) => h.active); }
    function activeRideTypes() { return state.rideTypes.filter((t) => t.active); }

    // busy (optional Set of ids): hide those entries — except the currently
    // selected one, so an existing choice stays visible when editing.
    function keepOption(id, selectedId, busy) {
        return !busy || !busy.has(String(id)) || String(id) === String(selectedId);
    }

    // ---------- Phone numbers (WhatsApp-first, +27 by default) ----------
    const PAYMENT_TERMS = {
        advance_monthly: 'In advance, per month',
        advance_term: 'In advance, per term',
        arrears: 'In arrears',
        cash_after: 'Cash after lesson'
    };

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
        // The field shows the dial code only — country names live in the picker.
        // inline layout so it can't be broken by a stale stylesheet
        return `<div class="phone-field" style="display:flex;gap:6px;align-items:center">
            <button type="button" id="${id}-cc" class="secondary phone-cc" data-cc="${esc(cc)}"
                    title="Change country" style="flex:0 0 74px;width:74px">${esc(cc)}</button>
            <input id="${id}" type="text" inputmode="tel" name="ct-line-${id}"
                   autocomplete="off" autocorrect="off" spellcheck="false" data-lpignore="true"
                   style="flex:1 1 auto;min-width:0" value="${esc(rest)}">
        </div>`;
    }

    // Country picker: search by name or code, sets the button's dial code
    function openCountryPicker(btn) {
        const overlay = openSubDialog(`
            <h3 style="margin:0 0 8px">Country dialling code</h3>
            <input id="cc-search" type="search" placeholder="Search country or code…" autocomplete="off">
            <div id="cc-list" class="cc-list"></div>
            <div class="form-actions"><button class="secondary" id="cc-cancel">Cancel</button></div>`,
            { dismissable: true });
        const $list = overlay.querySelector('#cc-list');
        const draw = (q) => {
            const term = (q || '').trim().toLowerCase();
            const hits = COUNTRIES.filter(([c, name]) =>
                !term || c.includes(term) || (name || '').toLowerCase().includes(term));
            $list.innerHTML = hits.length ? hits.map(([c, name]) => `
                <button type="button" class="cc-row ${c === btn.dataset.cc ? 'on' : ''}" data-code="${esc(c)}">
                    <span class="cc-code">${esc(c)}</span><span>${esc(name || '')}</span>
                </button>`).join('') : '<div class="muted" style="padding:8px">No match.</div>';
            $list.querySelectorAll('[data-code]').forEach((row) => row.addEventListener('click', () => {
                btn.dataset.cc = row.getAttribute('data-code');
                btn.textContent = row.getAttribute('data-code');
                overlay.remove();
            }));
        };
        draw('');
        overlay.querySelector('#cc-search').addEventListener('input', (e) => draw(e.target.value));
        overlay.querySelector('#cc-cancel').addEventListener('click', () => overlay.remove());
        overlay.querySelector('#cc-search').focus();
    }

    // one delegated handler covers every dialog that renders a phone field
    document.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('.phone-cc');
        if (btn) { e.preventDefault(); openCountryPicker(btn); }
    });

    function readPhoneField(id) {
        const rest = (document.getElementById(id).value || '').trim().replace(/^0+/, '');
        const ccEl = document.getElementById(id + '-cc');
        const cc = (ccEl && ccEl.dataset.cc) || DEFAULT_CC;
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

    // ridersOnly drops contacts who are only a parent — they are about half the
    // list and never take a seat, so they just get in the way when picking who
    // rides. Anyone already selected stays on the list whatever their roles,
    // otherwise opening a ride whose rider is not flagged as one would show a
    // blank picker and saving would quietly drop them from the ride. Those are
    // flagged in the label so the contact can be corrected.
    // Sentinel value for the "add a new rider" entry at the top of a rider
    // picker. Contact ids are bigint strings, so this can never collide with
    // one, and the change handler swaps it straight back out — it is never a
    // value that reaches a save.
    const NEW_RIDER = '__new';
    const newRiderOption = () => `<option value="${NEW_RIDER}">Add new rider…</option>`;

    function contactOptions(selectedId, emptyLabel, busy, ridersOnly, withNew) {
        const isSel = (c) => String(selectedId) === String(c.id);
        return (withNew ? newRiderOption() : '') +
            `<option value=""${selectedId ? '' : ' selected'}>${esc(emptyLabel || '')}</option>` +
            state.contacts
                .filter((c) => keepOption(c.id, selectedId, busy))
                .filter((c) => !ridersOnly || c.is_rider || isSel(c))
                .map((c) => `<option value="${c.id}" ${isSel(c) ? 'selected' : ''}>${esc(c.name)}`
                    + `${ridersOnly && !c.is_rider ? ' — not marked as a rider' : ''}</option>`).join('');
    }

    function horseOptions(selectedId, busy) {
        return [...activeHorses()].sort((a, b) => a.name.localeCompare(b.name)).filter((h) => keepOption(h.id, selectedId, busy)).map((h) =>
            `<option value="${h.id}" ${String(selectedId) === String(h.id) ? 'selected' : ''}>${esc(h.name)}</option>`).join('');
    }

    // Each lesson type carries its own length, so picking one sets the duration
    // to match. It is announced rather than done silently: the box visibly
    // changes, and anyone who had typed a different number needs to know it was
    // replaced so they can put it back.
    function syncDurationToRideType(typeSelId, durationId) {
        const typeSel = document.getElementById(typeSelId);
        const durInput = document.getElementById(durationId);
        if (!typeSel || !durInput) return;
        const rt = state.rideTypes.find((t) => String(t.id) === String(typeSel.value));
        if (!rt || !rt.duration_min) return;
        const before = parseInt(durInput.value, 10) || null;
        if (before === rt.duration_min) return;
        durInput.value = rt.duration_min;
        toast(before
            ? `Duration changed from ${before} to ${rt.duration_min} min to match ${rt.name}.`
            : `Duration set to ${rt.duration_min} min to match ${rt.name}.`);
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
    // Only contacts ticked as Parent can pay — plus whoever is already selected,
    // so an existing link never silently disappears from the picker.
    function parentOptions(selectedId, excludeId) {
        return '<option value="">(choose the parent)</option>' +
            state.contacts
                .filter((c) => String(c.id) !== String(excludeId) && !c.parent_id &&
                    (c.is_parent || String(c.id) === String(selectedId)))
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => `<option value="${c.id}" ${String(selectedId) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`)
                .join('');
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
        document.body.classList.remove('nav-hidden');   // never leave the nav hidden on another page
        document.body.classList.remove('cal-tab-rides', 'cal-tab-horses');
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
                // fill the device's copy now that there is a session to fetch with
                setTimeout(() => warmEssentials().then(() => prewarmDays(21)), 1500);
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
            <div id="day-note-bar"></div>
            <div id="holiday-bar" class="holiday-bar hidden"></div>
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
            drawCreditBar(creditsData.credits || [], date, dayRides);
            drawHolidayBar(date);
            drawDayNote(date);
        } catch (err) {
            document.getElementById('cal-grid').textContent = err.message;
        }
    }


    // What is happening today, for the instructors: "arena closed until 10",
    // "farrier here all morning". It sits at the very top of the day because
    // it is the thing anyone looking at the day needs to know first, and it
    // goes straight to the phones through the same push the rides use.
    async function drawDayNote(date) {
        const bar = document.getElementById('day-note-bar');
        if (!bar) return;
        let note = '', by = '', at = '';
        try {
            const data = await api('GET', `/api/day-notes?from=${date}&to=${date}`);
            const row = (data.notes || [])[0];
            if (row) { note = row.note; by = row.updated_by || ''; at = row.updated_at || ''; }
        } catch (err) { /* the day still works without it */ }

        const show = () => {
            bar.className = note ? 'day-note' : 'day-note is-empty';
            bar.innerHTML = note
                ? `<div class="day-note-text">📋 ${esc(note).replace(/\n/g, '<br>')}</div>
                   <div class="day-note-meta">${by ? 'by ' + esc(by) : ''}${
                       by && at ? ' · ' : ''}${at ? esc(whenShort(at)) : ''}</div>
                   <button class="secondary small" id="dn-edit">Edit note</button>`
                : '<button class="secondary small" id="dn-edit">📋 Add a note for this day</button>';
            const btn = document.getElementById('dn-edit');
            if (btn) btn.addEventListener('click', edit);
        };

        const edit = () => {
            bar.className = 'day-note editing';
            bar.innerHTML = `
                <label>Note for ${esc(fmtDay(date))} — shown to the instructors</label>
                <textarea id="dn-text" rows="3"
                          placeholder="e.g. Arena closed until 10 · farrier here all morning">${esc(note)}</textarea>
                <div class="day-note-actions">
                    <button class="secondary small" id="dn-cancel">Cancel</button>
                    <button class="small" id="dn-save">Save note</button>
                </div>`;
            const ta = document.getElementById('dn-text');
            ta.focus();
            ta.setSelectionRange(ta.value.length, ta.value.length);
            document.getElementById('dn-cancel').addEventListener('click', show);
            document.getElementById('dn-save').addEventListener('click', async () => {
                const btn = document.getElementById('dn-save');
                btn.disabled = true;
                try {
                    const res = await api('PUT', `/api/day-notes/${date}`, { note: ta.value });
                    note = res.note || '';
                    by = res.updated_by || '';
                    at = res.updated_at || '';
                    show();
                    toast(note ? 'Note saved — the instructors will see it.' : 'Note cleared.');
                } catch (err) {
                    btn.disabled = false;
                    toast(err.message, true);
                }
            });
        };
        show();
    }

    // Which schools are on holiday today. The weekly schedule keeps running
    // through the holidays — riders drop in and out — so this is context, not a
    // reason to hide anything.
    async function drawHolidayBar(date) {
        const bar = document.getElementById('holiday-bar');
        if (!bar) return;
        let data;
        try {
            data = await api('GET', `/api/schools/holidays?date=${date}`);
        } catch (err) { bar.classList.add('hidden'); return; }
        const onHoliday = data.schools.filter((s) => s.status === 'holiday');
        const unknown = data.schools.filter((s) => s.status === 'unknown');
        if (!onHoliday.length && !unknown.length) { bar.classList.add('hidden'); return; }
        const parts = [];
        if (onHoliday.length) {
            const names = onHoliday.map((s) => {
                const back = s.next_term_start ? ` <span class="muted">(back ${esc(shortDate(s.next_term_start))})</span>` : '';
                return `<b>${esc(s.name)}</b>${back}`;
            }).join(', ');
            parts.push(`🏖️ School holidays: ${names}`);
        }
        if (unknown.length) {
            parts.push(`<span class="muted">Term dates not set for ${
                unknown.map((s) => esc(s.name)).join(', ')} — set them under Settings.</span>`);
        }
        bar.innerHTML = parts.join('<br>');
        bar.classList.remove('hidden');
    }

    // Riders who missed a lesson hold a credit until they are put on another
    // ride. They sit above the day so they cannot be quietly forgotten.
    function drawCreditBar(credits, date, dayRides) {
        const bar = document.getElementById('credit-bar');
        if (!bar) return;
        if (!credits.length) { bar.className = ''; bar.innerHTML = ''; return; }
        const total = credits.reduce((n, c) => n + c.count, 0);
        bar.className = 'credit-bar';
        bar.innerHTML = `<span>⟳ <b>${total} ride${total === 1 ? '' : 's'}</b> to be rescheduled —
            tap a name to put them on a ride today:</span>` +
            credits.map((c) => `<span class="credit-item">
                <button type="button" class="chip credit-chip" data-credit="${c.contact_id}">
                    ${esc(c.name)}${c.count > 1 ? ` <span class="chip-level">×${c.count}</span>` : ''}
                </button>
                <button type="button" class="credit-drop" data-drop="${c.contact_id}" data-name="${esc(c.name)}"
                        title="Remove this credit — raised by mistake">${ICON_X}</button>
            </span>`).join('');
        bar.querySelectorAll('[data-credit]').forEach((btn) => btn.addEventListener('click', () => {
            const credit = credits.find((c) => String(c.contact_id) === btn.getAttribute('data-credit'));
            if (credit) openReschedulePicker(credit, date, dayRides);
        }));
        bar.querySelectorAll('[data-drop]').forEach((btn) => btn.addEventListener('click', async () => {
            const name = btn.getAttribute('data-name');
            if (!await askConfirm(`Remove ${name}'s reschedule credit?`,
                'Use this when the credit was raised by mistake. It does not give them a ride.',
                'Remove the credit')) return;
            try {
                await api('DELETE', `/api/credits/${btn.getAttribute('data-drop')}`);
                toast(`${name}'s credit removed.`);
                renderCalendar();
            } catch (err) {
                toast(err.message, true);
            }
        }));
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

    // Phones get two views of the day: big readable ride cards (no horse grid),
    // or the grid with a compact ride column for assigning horses. Both are the
    // same DOM — only CSS differs — so tablets and laptops are unaffected.
    function applyCalTab() {
        const horses = state.calTab === 'horses';
        document.body.classList.toggle('cal-tab-horses', horses);
        document.body.classList.toggle('cal-tab-rides', !horses);
    }

    const MOBILE_MQ = '(max-width: 700px), (max-height: 560px)';

    // The date toolbar and the Rides/Horses tabs live in the grid's corner cell
    // on a desktop, but that column is only ~42vw on a phone. Rather than
    // duplicating them, move the same nodes above the grid when the viewport is
    // small — one set of elements, one set of handlers.
    function placeCalControls(grid) {
        const bar = grid.querySelector('.cal-mobile-bar');
        const corner = grid.querySelector('th.ridecol');
        const nav = grid.querySelector('.cal-nav');
        const tabs = grid.querySelector('.cal-mobile-tabs');
        if (!bar || !corner || !nav || !tabs) return;
        if (window.matchMedia(MOBILE_MQ).matches) {
            bar.appendChild(nav);
            bar.appendChild(tabs);
        } else {
            corner.insertBefore(nav, corner.querySelector('.cal-actions'));
            corner.appendChild(tabs);
        }
    }

    let calMqBound = false;
    function bindCalMqListener() {
        if (calMqBound) return;
        calMqBound = true;
        window.matchMedia(MOBILE_MQ).addEventListener('change', () => {
            const grid = document.getElementById('cal-grid');
            if (grid) placeCalControls(grid);
        });
    }

    // On a phone in landscape the nav bar costs a third of the usable height, so
    // it slides away while you scroll down through the day and comes straight
    // back on any upward scroll. CSS decides whether it applies (mobile only).
    function wireNavAutoHide(scroller) {
        if (!scroller || scroller.dataset.navAutoHide) return;
        scroller.dataset.navAutoHide = '1';
        let last = scroller.scrollTop;
        scroller.addEventListener('scroll', () => {
            const y = scroller.scrollTop;
            if (Math.abs(y - last) < 6) return;      // ignore jitter
            document.body.classList.toggle('nav-hidden', y > last && y > 40);
            last = y;
        }, { passive: true });
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
        // On a phone the controls are lifted out of the table's corner cell (see
        // placeCalControls) — a 42vw column cannot hold a date toolbar.
        let html = '<div class="cal-mobile-bar"></div><div class="calendar-scroller"><table class="daygrid ridegrid">';
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
                <button class="small mobile-only" id="cal-add-m" title="New ride" aria-label="New ride">＋</button>
                <button class="secondary mobile-only" id="cal-fixed-m" title="Fixed rides" aria-label="Fixed rides">🔁</button>
            </div>
            <div class="cal-mobile-tabs">
                <button class="mtab ${state.calTab !== 'horses' ? 'active' : ''}" data-mtab="rides">🐴 Rides</button>
                <button class="mtab ${state.calTab === 'horses' ? 'active' : ''}" data-mtab="horses">🐎 Horses</button>
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
            // Three different reasons a rider is not on the ride, and they must
            // not look the same: cancelled, rescheduled (holds a credit), or
            // simply an off week on a fortnightly slot.
            riderRows += (r.cancellations || []).map((c) => `
                <div class="rider-row off-rider ${c.kind}">
                    <span class="rider-name">${esc(c.contact_name)}</span>
                    <span class="rider-off">${c.kind === 'rescheduled'
                        ? '⟳ rescheduled'
                        : c.from_series ? '✕ off the weekly ride'
                        : c.billed ? '✕ cancelled — still charged'
                        : '✕ cancelled — not charged'}</span>
                </div>`).join('');
            riderRows += (r.off_riders || []).map((o) => `
                <div class="rider-row off-rider">
                    <span class="rider-name">${esc(o.contact_name)}</span>
                    <span class="rider-off">${o.frequency === 'biweekly' ? 'every 2nd week' : 'not riding'}${
                        o.next_date ? ' · next ' + esc(shortDate(o.next_date)) : ''}</span>
                </div>`).join('');

            const flags = [];
            if (!r.is_block && !r.recurring_id) flags.push('once-off');

            html += `<tr class="ride-row"><td class="ridecol">
                <div class="ride-box ${r.is_block ? 'blocked' : ''} ${r.invoiced ? 'invoiced' : ''}">
                    <button class="ride-top" data-ride-id="${r.id}">
                        <span class="ride-time">${esc(start)}–${esc(end)}</span>
                        <span class="ride-dur">${r.duration_min} min</span>
                        <span class="ride-count">${r.is_block ? '🚫 blocked'
                            : riders.length ? riders.length + (riders.length === 1 ? ' rider' : ' riders')
                            : horsesOnly.length ? horsesOnly.length + ' horse' + (horsesOnly.length === 1 ? '' : 's')
                            : 'empty'}</span>
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
        wireNavAutoHide(grid.querySelector('.calendar-scroller'));
        applyCalTab();
        placeCalControls(grid);
        bindCalMqListener();

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
        const newRide = () =>
            openRideDialog(null, { date, time: (state.settings.day_start || '09:00'), dayRides: rides });
        document.getElementById('cal-add').addEventListener('click', newRide);
        document.getElementById('cal-add-m').addEventListener('click', newRide);
        grid.querySelectorAll('[data-mtab]').forEach((b) => b.addEventListener('click', () => {
            state.calTab = b.getAttribute('data-mtab');
            applyCalTab();
            grid.querySelectorAll('[data-mtab]').forEach((x) =>
                x.classList.toggle('active', x.getAttribute('data-mtab') === state.calTab));
        }));
        const goFixed = () => { location.hash = '#/fixed'; };
        document.getElementById('tab-fixed').addEventListener('click', goFixed);
        document.getElementById('cal-fixed-m').addEventListener('click', goFixed);
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
                if (!await askConfirm(`${hName} is already booked`, `${hName} is on ${rideLabel(clash)}.`,
                    'Move it to this ride', 'it comes off the other ride')) return;
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
                if (!await askConfirm(`${horse.name} is already booked`, `${horse.name} is on ${rideLabel(clash)}.`,
                    'Move to this ride', 'it comes off the other ride')) return;
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
        // "Theirs" covers the rider and anyone their payer pays for, so a parent's
        // horse is offered to their children as well as to themselves.
        const rider = contactById(contactId);
        const household = rider ? String(rider.parent_id || rider.id) : null;
        const isOwn = (h) => h.owner_contact_id && household
            && (String(h.owner_contact_id) === String(contactId)
                || String(h.owner_contact_id) === household);
        const ownedByOther = (h) => h.owner_contact_id && !isOwn(h);
        // Rider's own horse first, then ⭐ preferred, then the standard list;
        // other people's horses and caution horses drop into flagged groups.
        let html = head + avail.filter(isOwn).map((h) => opt(h, '🏠 ')).join('') +
                   avail.filter((h) => !isOwn(h) && !ownedByOther(h) && prefs.preferred.has(String(h.id))).map((h) => opt(h, '⭐ ')).join('') +
                   avail.filter((h) => !isOwn(h) && !ownedByOther(h) && !prefs.preferred.has(String(h.id)) && !prefs.caution.has(String(h.id))).map((h) => opt(h, '')).join('');
        // Someone else's horse is only offered when its owner has shared it with
        // the school. An unshared one is left off the list entirely rather than
        // flagged, so it cannot be picked by mistake. The one exception is a
        // horse already sitting on this seat, which must stay selectable.
        const others = avail.filter((h) => ownedByOther(h) && !prefs.caution.has(String(h.id))
            && (h.shared_with_school || String(h.id) === String(selectedId)));
        if (others.length) {
            html += `<optgroup label="🏠 Owned by another rider">${others.map((h) => opt(h, '')).join('')}</optgroup>`;
        }
        const caution = avail.filter((h) => !isOwn(h) && prefs.caution.has(String(h.id))
            && (!ownedByOther(h) || h.shared_with_school || String(h.id) === String(selectedId)));
        if (caution.length) {
            html += `<optgroup label="⚠ Caution for this rider">${caution.map((h) => opt(h, '⚠ ')).join('')}</optgroup>`;
        }
        return html;
    }

    // Contact options for a rider row: contacts whose availability windows
    // don't cover the ride time drop into a flagged group.
    //
    // Contacts who are only a parent never take a seat, so they are left out —
    // they are about half the contact list and only get in the way here. Anyone
    // already on the ride stays on the list whatever their roles, or opening a
    // ride whose rider is not flagged as one would blank the picker and saving
    // would drop them; those are labelled so the contact can be corrected.
    function partContactOptions(selectedId, busy, weekday, startMin, durMin) {
        const opt = (c, pre) => `<option value="${c.id}" ${String(selectedId) === String(c.id) ? 'selected' : ''}>${pre}${esc(c.name)}${c.experience ? ' · ' + LEVEL_LABELS[c.experience] : ''}${c.is_prospect ? ' (interested)' : ''}${!c.is_rider ? ' — not marked as a rider' : ''}</option>`;
        const avail = state.contacts.filter((c) => keepOption(c.id, selectedId, busy))
            .filter((c) => c.is_rider || String(c.id) === String(selectedId));
        const ok = avail.filter((c) => contactAvailable(c, weekday, startMin, durMin));
        const flagged = avail.filter((c) => !contactAvailable(c, weekday, startMin, durMin));
        // The empty option must carry `selected` explicitly. "Add new rider" is
        // first in the list, and a <select> with nothing selected falls back to
        // its first option — which both showed the wrong placeholder and meant
        // picking "Add new rider" was not a change, so it fired no event at all.
        let html = newRiderOption()
            + `<option value=""${selectedId ? '' : ' selected'}>(open seat)</option>`
            + ok.map((c) => opt(c, '')).join('');
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
            <div class="pick-row" data-kind="part"${p && p.invoiced
                ? ` data-invoiced="1" data-invoiced-cents="${p.invoiced_cents || 0}"` : ''}>
                <select class="pr-contact">${contactOptions(p ? p.contact_id : null, '(no rider — horse only)', null, true, true)}</select>
                <select class="pr-horse">${partHorseOptions(p ? p.horse_id : null, null, p ? p.contact_id : null)}</select>
                <button type="button" class="secondary small pr-alt-toggle" title="Offer an alternative horse">alt</button>
                <select class="pr-alt ${p && p.alt_horse_id ? '' : 'hidden'}" title="Alternative horse — instructor picks on the day">
                    ${altHorseOptions(p ? p.alt_horse_id : null, null, p ? p.contact_id : null)}
                </select>
                <select class="pr-freq hidden" title="How often this rider comes">
                    <option value="weekly" ${freq === 'biweekly' ? '' : 'selected'}>Every week</option>
                    <option value="biweekly" ${freq === 'biweekly' ? 'selected' : ''}>Every 2nd week</option>
                </select>
                <button type="button" class="secondary small pr-anchor hidden"
                        title="They are riding this week instead — count the fortnight from here, so next week is the off week">↺ from this week</button>
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

    // Adding a rider mid-ride opens the ordinary contact form, over the ride
    // rather than instead of it, so the half-built ride survives. Same dialog
    // as "New" on the contacts page: the cut-down version that used to live
    // here meant riders created this way quietly skipped school, payer and
    // payment terms, which then had to be chased down at invoicing time.
    function openNewRiderForRow(row) {
        openContactDialog(null, false, {
            overlay: true,
            onSaved: (saved) => {
                const sel = row.querySelector('.pr-contact');
                if (!sel) return;
                sel.innerHTML = contactOptions(saved.id, '(no rider — horse only)', null, true, true);
                sel.value = saved.id;
                sel.dataset.prev = String(saved.id);
                sel.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
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
            // A rider leaving the ride frees their HORSE for someone else, but
            // not their own place on the day: they are already on it, struck
            // through, and putting them back is what Undo is for.
            $dialog.querySelectorAll('.pr-horse, .gr-horse').forEach((sel) => {
                if (sel !== exceptSel && sel.value && !sel.classList.contains('hidden') &&
                    !sel.closest('.removed')) horses.add(sel.value);
            });
            $dialog.querySelectorAll('.pr-contact').forEach((sel) => {
                if (sel !== exceptSel && sel.value) contacts.add(sel.value);
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
                if (row.classList.contains('removed')) return; // frozen until undone
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
            return [...$dialog.querySelectorAll('[data-kind="part"].removed')]
                .filter((row) => row.dataset.removeKind === 'rescheduled').map((row) => {
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

        // ---- 3b: nothing to save until something changes ----
        // Saving an untouched ride would ask the series question and write a
        // no-op, so the button stays disabled until the form is actually dirty.
        let dirty = false;
        function markDirty() {
            dirty = true;
            const btn = document.getElementById('ride-save');
            if (btn) { btn.disabled = false; btn.title = ''; }
        }

        // Only the ride's own settings can be pushed to the whole series —
        // rider changes are per-occurrence and carry their own scope.
        let rideFieldsAtOpen = null;
        function rideFieldsNow() {
            const v = (id) => (document.getElementById(id) || {}).value || '';
            return JSON.stringify([v('ride-time'), v('ride-type'), v('ride-level'),
                v('ride-venue'), v('ride-duration'), v('ride-inotes'),
                [...$dialog.querySelectorAll('[data-kind="guide"]')].map((r) => [
                    r.querySelector('.gr-guide').value,
                    r.querySelector('.gr-mode').value,
                    (r.querySelector('.gr-horse') || {}).value || ''
                ])]);
        }
        function rideFieldsChanged() {
            return rideFieldsAtOpen !== null && rideFieldsNow() !== rideFieldsAtOpen;
        }

        // ---- marking riders off the ride (nothing is saved until Save) ----
        // A marked row stays visible, struck through, so she can see what she
        // has done and undo it. kind: 'cancelled' (not riding) or 'rescheduled'
        // (not riding, gets a credit). scope: 'week' or 'series'.
        function markRemoved(row, scope, kind, billed) {
            row.classList.add('removed');
            row.dataset.removeScope = scope;
            row.dataset.removeKind = kind;
            if (billed) row.dataset.removeBilled = '1';
            else delete row.dataset.removeBilled;
            row.querySelectorAll('select').forEach((s) => { s.disabled = true; });
            const x = row.querySelector('.row-x');
            x.textContent = 'Undo';
            x.classList.remove('danger');
            x.classList.add('secondary');
            x.title = 'Put this rider back on the ride';
            const rb = row.querySelector('.row-resched');
            if (rb) rb.style.display = 'none';
            let tag = row.querySelector('.removed-tag');
            if (!tag) {
                tag = document.createElement('span');
                tag.className = 'removed-tag';
                row.appendChild(tag);
            }
            // Name it. Several removed riders stack up as near-identical rows,
            // and "Undo" on its own gives no way to tell which is which.
            const who = contactById((row.querySelector('.pr-contact') || {}).value);
            const name = who ? `${who.name} — ` : '';
            tag.textContent = kind === 'rescheduled'
                ? `⟳ ${name}rescheduled, gets a credit`
                : scope === 'series'
                ? `✕ ${name}removed from the weekly schedule`
                : row.dataset.removeBilled === '1'
                ? `✕ ${name}cancelled late — still charged`
                : `✕ ${name}not riding this week — not charged`;
        }

        // Shown but not on the ride: the save ignores anything that is not
        // data-kind="part", so the row is inert until she joins.
        function markOffWeek(row, o) {
            row.setAttribute('data-kind', 'off');
            row.classList.add('off-week');
            row.querySelectorAll('select').forEach((sel) => { sel.disabled = true; });
            row.querySelectorAll('.row-x, .row-resched, .pr-alt-toggle, .pr-anchor')
                .forEach((b) => { b.style.display = 'none'; });
            const tag = document.createElement('span');
            tag.className = 'removed-tag';
            tag.textContent = `every 2nd week — off this week${o.next_date ? ', next ' + shortDate(o.next_date) : ''}`;
            row.appendChild(tag);
            const join = document.createElement('button');
            join.type = 'button';
            join.className = 'secondary small pr-join';
            join.textContent = '↺ Riding this week instead';
            join.title = 'Put her on this ride and count the fortnight from here — next week becomes the off week';
            row.appendChild(join);
            join.addEventListener('click', () => {
                // Becomes an ordinary seat, fortnightly, re-anchored to today.
                row.setAttribute('data-kind', 'part');
                row.classList.remove('off-week');
                row.querySelectorAll('select').forEach((sel) => { sel.disabled = false; });
                row.querySelectorAll('.row-x, .row-resched, .pr-alt-toggle')
                    .forEach((b) => { b.style.display = ''; });
                tag.remove();
                join.remove();
                const freq = row.querySelector('.pr-freq');
                if (freq) freq.value = 'biweekly';
                row.dataset.reanchor = '1';
                const anchor = row.querySelector('.pr-anchor');
                if (anchor) {
                    anchor.style.display = '';
                    anchor.classList.add('is-on');
                    anchor.textContent = '↺ restarting here';
                }
                refreshOptions();
                syncFreqVisibility();
                markDirty();
            });
        }

        function unmarkRemoved(row) {
            row.classList.remove('removed');
            delete row.dataset.removeScope;
            delete row.dataset.removeKind;
            delete row.dataset.removeBilled;
            row.querySelectorAll('select').forEach((s) => { s.disabled = false; });
            const x = row.querySelector('.row-x');
            x.innerHTML = ICON_X;
            x.classList.add('danger');
            x.classList.remove('secondary');
            x.title = '';
            const rb = row.querySelector('.row-resched');
            if (rb) {
                rb.style.display = '';
                rb.innerHTML = ICON_ROTATE;
                rb.title = "Can't make it — give a reschedule credit";
            }
            const tag = row.querySelector('.removed-tag');
            if (tag) tag.remove();
        }

        function wireRow(row) {
            const xBtn = row.querySelector('.row-x');
            xBtn.addEventListener('click', async () => {
                // Already marked? This click is the undo.
                if (row.classList.contains('removed')) {
                    unmarkRemoved(row);
                    markDirty();
                    refreshOptions();
                    updateReschedInfo();
                    return;
                }
                const contactSel = row.querySelector('.pr-contact');
                const cid = contactSel && contactSel.value;
                // An empty row, or a horse-only seat, is just deleted — there is
                // nobody to record a cancellation against.
                if (!cid) {
                    row.remove();
                    markDirty();
                    refreshOptions();
                    return;
                }
                // Taking a rider off differs only in what it costs them, so ask
                // that rather than assume. Reschedule-with-credit is the ⟳
                // button; these two are the ways a lesson simply does not happen.
                const name = (contactById(cid) || {}).name || 'this rider';
                const billedAlready = row.dataset.invoiced === '1';
                const rowAmount = Number(row.dataset.invoicedCents || 0);
                const options = [
                    { key: 'billed', label: 'Cancelled — still charge for it',
                      hint: billedAlready ? 'the invoice stands as it is'
                          : 'they called off too late to be let off' },
                    billedAlready
                        ? { key: 'free', label: 'Cancel and create a refund',
                            hint: `already invoiced, so the ${money(rowAmount)} comes back as a discount on their next invoice` }
                        : { key: 'free', label: 'Cancelled — do not charge',
                            hint: 'taken off the day, nothing owed' }
                ];
                if (isEdit && ride.recurring_id) {
                    options.push({ key: 'series', label: 'Remove from the weekly schedule',
                                   hint: billedAlready
                                       ? 'this week and from now on; this week is refunded as a discount'
                                       : 'this week and from now on, not charged' });
                }
                const choice = await askChoice(`Remove ${name}`,
                    isEdit && ride.recurring_id ? 'They are on the weekly fixed ride.' : '', options);
                if (!choice) return;
                const scope = choice === 'series' ? 'series' : 'week';
                // Nothing is saved yet — it is shown struck through so it can be
                // undone before saving, and so she can see what she has done.
                markRemoved(row, scope, 'cancelled', choice === 'billed');
                markDirty();
                refreshOptions();
            });
            const reschedBtn = row.querySelector('.row-resched');
            if (reschedBtn) {
                reschedBtn.addEventListener('click', () => {
                    if (row.classList.contains('removed')) unmarkRemoved(row);
                    else {
                        const cid = row.querySelector('.pr-contact').value;
                        if (!cid) return dialogError('Pick the rider first, then tap ⟳.');
                        markRemoved(row, 'week', 'rescheduled');
                    }
                    markDirty();
                    refreshOptions();
                    updateReschedInfo();
                });
            }
            const partSel = row.querySelector('.pr-contact');
            if (partSel) partSel.dataset.prev = partSel.value;
            const anchorBtn = row.querySelector('.pr-anchor');
            if (anchorBtn) anchorBtn.addEventListener('click', () => {
                const on = row.dataset.reanchor === '1';
                if (on) delete row.dataset.reanchor; else row.dataset.reanchor = '1';
                anchorBtn.classList.toggle('is-on', !on);
                anchorBtn.textContent = on ? '↺ from this week' : '↺ restarting here';
                markDirty();
            });
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
            <h2>${isEdit ? (ride.is_block ? '🚫 Blocked horses' : '🐴 Ride') : 'New ride'} — ${esc(fmtDay(defaults.date))}</h2>
            ${isEdit && ride.recurring_id ? '<p class="muted">🔁 This comes from a fixed weekly slot. When you save you can choose to change just this day or the whole series.</p>' : ''}
            ${locked ? `<div class="warn-bar">🧾 <b>Already invoiced.</b>
                ${(ride.invoiced_riders || []).map((r) =>
                    `${esc(r.name || 'A rider')} on ${esc(r.number || 'an invoice')}`).join(', ')}.
                The ride itself — time, type, length — is fixed until that invoice is
                deleted. The riders can still be taken off: cancelled-and-charged or
                rescheduled leave the invoice as it stands, and cancelling an invoiced
                rider creates a refund — a discount on their next invoice.</div>` : ''}
            <fieldset style="border:none;margin:0;padding:0">
            <label>Once-off or weekly? <span class="req">*</span></label>
            <select id="ride-repeat" style="width:auto;min-width:240px;margin-bottom:14px">
                <option value="" ${isEdit ? '' : 'selected'} disabled>— choose —</option>
                <option value="once" ${isEdit && !ride.recurring_id ? 'selected' : ''}>Once off — this day only</option>
                <option value="repeats" ${isEdit && ride.recurring_id ? 'selected' : ''}>🔁 Repeats every week (fixed ride)</option>
            </select>
            <div class="form-row">
                <div>
                    <label>Time</label>
                    <input type="time" id="ride-time" value="${time}">
                </div>
                <div>
                    <label>Ride type <span class="req">*</span></label>
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
            </fieldset>
            <div class="form-warning" id="ride-resched-info"></div>
            <div class="form-warning" id="ride-warnings"></div>
            <div class="form-error"></div>
            <div class="form-actions">
                ${isEdit && !locked ? '<button class="danger small" id="ride-delete">Delete</button>' : ''}
                ${isEdit && !locked ? '<button type="button" class="secondary small" id="ride-bill" title="Invoice this ride now, whatever the date">💳 Bill now</button>' : ''}
                ${isEdit && !locked ? '<span class="spacer"></span>' : ''}
                <button class="secondary" id="ride-cancel">Cancel</button>
                <button id="ride-save">Save</button>
            </div>`);

        // The clicked cell's horse may still be busy once overlap is considered
        const defaultHorse = defaults.horseId && !busyFor(time).horses.has(String(defaults.horseId))
            ? defaults.horseId : null;
        const parts = isEdit
            ? (defaults.addContactId
                ? [...ride.participants, { contact_id: defaults.addContactId, horse_id: null }]
                : ride.participants)
            : [{ horse_id: defaultHorse, contact_id: null }];
        // Cadence comes from two places: riders sitting out this week are in
        // off_riders, riders who are on it carry it on the participant itself.
        const seriesFreq = {};
        if (isEdit) {
            (ride.off_riders || []).forEach((o) => { seriesFreq[String(o.contact_id)] = o.frequency; });
            (ride.participants || []).forEach((p) => {
                if (p.frequency) seriesFreq[String(p.contact_id)] = p.frequency;
            });
        }
        parts.forEach((p) => addRow('ride-parts',
            participantRowHtml(p, isEdit, seriesFreq[String(p.contact_id)])));
        // 3a: riders taken off earlier come back as struck-through rows, so the
        // day still shows what happened and they can be put back.
        if (isEdit) {
            const riding = new Set((parts || []).map((p) => String(p.contact_id)));
            (ride.cancellations || []).filter((c) => !riding.has(String(c.contact_id))).forEach((c) => {
                addRow('ride-parts', participantRowHtml(
                    { contact_id: c.contact_id, horse_id: null }, isEdit,
                    seriesFreq[String(c.contact_id)]));
                const row = document.getElementById('ride-parts').lastElementChild;
                // the row's own X is already the undo (see wireRow)
                markRemoved(row, c.from_series ? 'series' : 'week', c.kind, c.billed);
            });
            // A fortnightly rider on her off week has no seat, so she had no
            // row — and the one time "restart the fortnight from this week"
            // is needed is exactly when she turns up on her off week. Offer
            // her greyed out, with that as the single action.
            const offNow = new Set([...riding, ...(ride.cancellations || []).map((c) => String(c.contact_id))]);
            (ride.off_riders || [])
                .filter((o) => o.frequency === 'biweekly' && !offNow.has(String(o.contact_id)))
                .forEach((o) => {
                    addRow('ride-parts', participantRowHtml(
                        { contact_id: o.contact_id, horse_id: null }, isEdit, 'biweekly'));
                    markOffWeek(document.getElementById('ride-parts').lastElementChild, o);
                });
        }
        (isEdit ? ride.guides : []).forEach((g) => addRow('ride-guides', guideRowHtml(g)));
        document.getElementById('part-add').addEventListener('click', () =>
            addRow('ride-parts', participantRowHtml(null, isEdit)));
        document.getElementById('guide-add').addEventListener('click', () =>
            addRow('ride-guides', guideRowHtml(null)));
        document.getElementById('ride-cancel').addEventListener('click', closeDialog);
        document.getElementById('ride-time').addEventListener('change', refreshOptions);
        document.getElementById('ride-type').addEventListener('change', () => {
            syncDurationToRideType('ride-type', 'ride-duration');
            refreshOptions();
        });
        document.getElementById('ride-duration').addEventListener('change', refreshOptions);
        document.getElementById('ride-parts').addEventListener('change', (e) => {
            if (e.target.classList.contains('pr-contact')) {
                // "Add new rider" is an action, not a choice — put the previous
                // selection back at once so cancelling the dialog leaves the row
                // exactly as it was, then open the form.
                if (e.target.value === NEW_RIDER) {
                    e.target.value = e.target.dataset.prev || '';
                    openNewRiderForRow(e.target.closest('.pick-row'));
                    return;
                }
                e.target.dataset.prev = e.target.value;
                // Picking a rider defaults the ride's level to their experience
                const lvlSel = document.getElementById('ride-level');
                const c = contactById(e.target.value);
                if (lvlSel && !lvlSel.value && c && c.experience) lvlSel.value = c.experience;
            }
            refreshOptions();
        });
        const repeatBox = document.getElementById('ride-repeat');
        const repeats = () => !!repeatBox && repeatBox.value === 'repeats';
        const syncFreqVisibility = () => {
            $dialog.querySelectorAll('[data-kind="part"]').forEach((row) => {
                const freq = row.querySelector('.pr-freq');
                const anchor = row.querySelector('.pr-anchor');
                if (freq) freq.classList.toggle('hidden', !repeats());
                // Only a fortnightly rider has a fortnight to restart.
                if (anchor) anchor.classList.toggle('hidden',
                    !repeats() || !freq || freq.value !== 'biweekly' || row.classList.contains('removed'));
            });
        };
        if (repeatBox) repeatBox.addEventListener('change', syncFreqVisibility);
        syncFreqVisibility();
        document.getElementById('ride-parts').addEventListener('input', syncFreqVisibility);
        document.getElementById('ride-guides').addEventListener('change', refreshOptions);
        refreshOptions();
        // A ride with an invoice line on it is half-frozen, not frozen: the
        // riders nobody has billed yet can still be changed. Anything that
        // would alter what was already invoiced — the time, the type, the
        // length, the invoiced rider's own row — is disabled instead.
        if (locked) lockInvoicedParts();

        function lockInvoicedParts() {
            // Ride-level settings describe every seat, the billed ones too, so
            // none of them can move while an invoice points here.
            ['ride-time', 'ride-type', 'ride-level', 'ride-duration', 'ride-venue', 'ride-repeat']
                .forEach((id) => {
                    const el = document.getElementById(id);
                    if (el) {
                        el.disabled = true;
                        el.title = 'Already invoiced — the ride itself cannot be changed';
                    }
                });
            $dialog.querySelectorAll('[data-kind="part"][data-invoiced="1"]').forEach((row) => {
                // Swapping the rider would move someone else's charge onto
                // this invoice, so that one select is fixed. Taking them off
                // the day is not: that happens all month and each way of doing
                // it has an answer for the money.
                const sel = row.querySelector('.pr-contact');
                if (sel) {
                    sel.disabled = true;
                    sel.title = 'This rider is on an invoice and cannot be swapped for another';
                }
            });
        }

        // Snapshot after the form is fully built, so a redraw is not mistaken
        // for an edit. Any real input from here on enables Save.
        rideFieldsAtOpen = rideFieldsNow();
        const saveBtn = document.getElementById('ride-save');
        if (isEdit) {
            saveBtn.disabled = true;
            saveBtn.title = 'Nothing has changed yet';
        }
        $dialog.addEventListener('input', markDirty);
        $dialog.addEventListener('change', markDirty);


        document.getElementById('ride-save').addEventListener('click', async () => {
            if (!document.getElementById('ride-type').value) {
                return dialogError('Pick a ride type — it sets the price and drives the reports.');
            }
            if (!document.getElementById('ride-repeat').value) {
                return dialogError('Say whether this is a once-off ride or a weekly one.');
            }
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
                cancellations: [...$dialog.querySelectorAll('[data-kind="part"].removed')]
                    .map((row) => ({
                        contact_id: row.querySelector('.pr-contact').value,
                        kind: row.dataset.removeKind || 'cancelled',
                        from_series: row.dataset.removeScope === 'series',
                        billed: row.dataset.removeBilled === '1'
                    })).filter((c) => c.contact_id),
                participants: [...$dialog.querySelectorAll('[data-kind="part"]')]
                    .filter((row) => !row.classList.contains('removed'))
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
            // Only the ride's own settings can apply to the whole series. Taking a
            // rider off already asked its own week/series question, so asking
            // again here would be a second, confusing scope prompt for the same
            // action — and asking at all when nothing changed is just noise.
            if (isEdit && ride.recurring_id && rideFieldsChanged()) {
                const scope = await askChoice('Change the weekly ride',
                    `This is one occurrence of a fixed ${WEEKDAYS[isoDow(defaults.date) - 1]} ride.`, [
                        { key: 'one', label: 'Just this day', hint: `only ${fmtDay(defaults.date)} changes` },
                        { key: 'series', label: 'This day and later weeks',
                          hint: 'updates the weekly slot and every later week that is not invoiced' }
                    ]);
                if (!scope) return;
                body.apply_scope = scope;
            }
            try {
                let savedId = isEdit ? ride.id : null;
                let typedSiblings = 0, seriesRides = 0;
                if (isEdit) {
                    const res = await api('PUT', `/api/rides/${ride.id}`, body);
                    typedSiblings = res.typed_siblings || 0;
                    seriesRides = res.series_rides || 0;
                } else savedId = (await api('POST', '/api/rides', body)).ride_id;
                if (isEdit && defaults.addContactId) {
                    await api('POST', '/api/credits/consume', {
                        contact_id: defaults.addContactId, ride_id: ride.id
                    });
                }
                for (const c of body.cancellations.filter((x) => x.from_series)) {
                    await api('DELETE', `/api/rides/${ride.id}/repeat-riders/${c.contact_id}`);
                }
                const box = document.getElementById('ride-repeat');
                const freqs = [...$dialog.querySelectorAll('[data-kind="part"]')]
                    .filter((row) => !row.classList.contains('removed')).map((row) => ({
                    contact_id: row.querySelector('.pr-contact').value || null,
                    frequency: row.querySelector('.pr-freq').value,
                    reanchor: row.dataset.reanchor === '1'
                })).filter((p) => p.contact_id);
                const targetId = isEdit ? ride.id : savedId;
                if (box && targetId) {
                    const wants = box.value === 'repeats';
                    const has = isEdit && !!ride.recurring_id;
                    if (wants && !has) await api('POST', `/api/rides/${targetId}/repeat`, { participants: freqs });
                    else if (wants && has) await api('PUT', `/api/rides/${targetId}/repeat-riders`, { participants: freqs });
                    else if (!wants && has) await api('POST', `/api/rides/${targetId}/stop-repeat`, {});
                }
                closeDialog();
                toast(credits.length
                    ? `Saved. ${credits.map((pc) => pc.name).join(', ')} got a reschedule credit.`
                    : defaults.addContactId ? 'Saved — reschedule credit used.'
                    : seriesRides ? `Saved. The weekly slot and ${seriesRides} later ride${seriesRides === 1 ? '' : 's'} were updated too.`
                    : typedSiblings ? `Saved. The ride type was also set on ${typedSiblings} other ride${typedSiblings === 1 ? '' : 's'} in this weekly series that had none.`
                    : 'Saved.');
                afterSave();
            } catch (err) {
                dialogError(err.message);
            }
        });
        // ---- Bill now: for the rider who pays on the day ----
        // The cash run only lists lessons that have already happened, which is
        // right for the normal case but useless for someone paying on arrival.
        const billBtn = document.getElementById('ride-bill');
        if (billBtn) billBtn.addEventListener('click', async () => {
            if (dirty && !await askConfirm('Unsaved changes',
                'Billing uses what is already saved on this ride, not what is on screen.',
                'Bill the saved ride anyway')) return;
            // one invoice per payer, covering just this day
            const payers = new Map();
            (ride.participants || []).filter((p) => p.contact_id).forEach((p) => {
                const c = contactById(p.contact_id);
                const payer = (c && c.parent_id) ? contactById(c.parent_id) : c;
                if (!payer) return;
                if (!payers.has(String(payer.id))) payers.set(String(payer.id), { payer, riders: [] });
                payers.get(String(payer.id)).riders.push((c && c.name) || 'rider');
            });
            if (!payers.size) return dialogError('Nobody on this ride to invoice.');
            let pick = [...payers.values()][0];
            if (payers.size > 1) {
                const choice = await askChoice('Who are you billing?',
                    'One invoice is created per payer, for this day only.',
                    [...payers.values()].map((p) => ({
                        key: String(p.payer.id), label: p.payer.name, hint: p.riders.join(', ')
                    })));
                if (!choice) return;
                pick = payers.get(choice);
            }
            try {
                const res = await api('POST', '/api/invoices',
                    { contact_id: pick.payer.id, from: defaults.date, to: defaults.date });
                closeDialog();
                renderCalendar();
                openInvoiceCreatedDialog(res.invoice, res.riders || 1);
            } catch (err) {
                dialogError(err.message);
            }
        });

        const deleteBtn = document.getElementById('ride-delete');
        if (deleteBtn) deleteBtn.addEventListener('click', async () => {
            if (!ride.recurring_id) {
                if (!await askConfirm('Delete this ride?', 'This cannot be undone.', 'Delete')) return;
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
                    <span class="assign-cur">${esc(fmtDay(ride.date))}</span>
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
            btn.addEventListener('click', async () => {
                const scope = btn.getAttribute('data-scope');
                const msg = scope === 'all' ? 'Delete every ride in this series (except invoiced ones)?'
                    : scope === 'future' ? 'Delete this ride and all later ones in the series?'
                    : 'Delete just this day?';
                if (!await askConfirm('Are you sure?', msg, 'Continue')) return;
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
                <select class="fp-contact">${contactOptions(p ? p.contact_id : null, '(pick rider)', null, true)}</select>
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
                    <label>Ride type (for pricing) <span class="req">*</span></label>
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
        document.getElementById('fx-ridetype').addEventListener('change', () =>
            syncDurationToRideType('fx-ridetype', 'fx-duration'));

        document.getElementById('fx-save').addEventListener('click', async () => {
            if (!document.getElementById('fx-ridetype').value) {
                return dialogError('Pick a ride type — every ride this slot creates inherits it.');
            }
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
            if (!await askConfirm('Delete this fixed ride?',
                'Future occurrences that are not invoiced yet are removed from the calendar.',
                'Delete the fixed ride')) return;
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
        // The contact list is a plain page scroll; rebuilding it after an edit
        // would otherwise jump you back to the top of 76 rows.
        if (state.contactScroll) {
            const y = state.contactScroll;
            state.contactScroll = null;
            requestAnimationFrame(() => window.scrollTo(0, y));
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
            if (!await askConfirm(`Delete ${entry.name}?`, 'Removed from the directory.', 'Delete')) return;
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
    // Rider / Parent are worked out from the data rather than stored, so a
    // contact who does both gets both tags and nothing has to be kept in sync.
    const isRider = (c) => !!c.is_rider;
    const isParent = (c) => !!c.is_parent;

    // Riders always state who pays, so an unlinked kid is obvious at a glance.
    // A rider who is also a parent pays their own way, so nothing is missing.
    // Delete outright when the contact has no history; otherwise the server
    // refuses and we offer archiving, which keeps rides and invoices intact.
    async function deleteContact(c) {
        const first = await askChoice(`Delete ${c.name}?`,
            'This cannot be undone.', [{ key: 'del', label: 'Delete', hint: 'remove them completely' }]);
        if (first !== 'del') return;
        try {
            await api('DELETE', `/api/contacts/${c.id}`);
            state.contacts = (await api('GET', '/api/contacts')).contacts;
            toast(`${c.name} deleted.`);
            state.contactScroll = window.scrollY;
            renderContacts();
        } catch (err) {
            const options = [];
            if (err.can_detach) {
                options.push({ key: 'detach', label: 'Take off the schedule and delete',
                    hint: `removes ${err.detail || 'their rides'}, then deletes them` });
            }
            options.push({ key: 'archive', label: 'Archive instead',
                hint: 'hidden from lists, everything kept' });
            const choice = await askChoice(`${c.name} cannot simply be deleted`, err.message, options);
            if (!choice) return;
            try {
                if (choice === 'detach') {
                    await api('DELETE', `/api/contacts/${c.id}?detach=1`);
                } else {
                    await api('PUT', `/api/contacts/${c.id}`, { archived: true });
                }
                state.contacts = (await api('GET', '/api/contacts')).contacts;
                toast(choice === 'detach' ? `${c.name} deleted.` : `${c.name} archived.`);
                state.contactScroll = window.scrollY;
                renderContacts();
            } catch (e2) {
                toast(e2.message, true);
            }
        }
    }

    // The weekly slots a rider holds — shown on the list where there is room
    // for them (hidden by CSS on a phone).
    function fixedSlotsHtml(c) {
        const slots = c.fixed_rides || [];
        if (!slots.length) return '';
        return slots.map((s) => `<span class="fixed-slot">${DAY_ABBR[s.weekday - 1]} ${
            esc(hhmm(s.start_time))}${s.frequency === 'biweekly' ? ' <i>2nd wk</i>' : ''}</span>`).join('');
    }

    function contactSubLine(c) {
        const bits = [];
        if (isRider(c) && !isParent(c)) {
            if (c.parent_name) bits.push(`👤 ${esc(c.parent_name)} pays`);
            else bits.push('<span class="no-parent">no parent assigned</span>');
        }
        if (isParent(c)) {
            // Who this payer's invoice covers. A parent who rides too is on
            // their own invoice, so they belong in the list rather than being
            // described separately as paying their own way.
            const names = (c.children || []).map((k) => k.name);
            if (isRider(c)) names.unshift(c.name);
            if (names.length > (isRider(c) ? 1 : 0)) {
                bits.push(`👥 ${names.map(esc).join(', ')}`);
            } else if (!isRider(c)) {
                bits.push('<span class="no-parent">no riders linked</span>');
            }
        }
        // A rider with no school has no term dates, so the invoicing cannot tell
        // their term lessons from their holiday ones; no level leaves the ride
        // pickers guessing. Both are quick to miss and awkward to find later.
        // The school sits on whoever pays, so only flag it there — a rider whose
        // parent pays follows that parent's and has nothing of their own to set.
        const paysOwnWay = !c.parent_id;
        if (paysOwnWay && !c.school_id) bits.push('<span class="no-parent">school not set</span>');
        if (isRider(c) && !c.experience) bits.push('<span class="no-parent">level not set</span>');
        // Livery is a standing arrangement worth seeing at a glance, and naming
        // the horses saves opening the contact to find out which they are.
        const livery = c.livery_horses || [];
        if (livery.length) {
            bits.push(`🐴 Livery: ${livery.map((h) =>
                esc(h.name) + (h.share === 100 ? '' : ` (${h.share}%)`)).join(', ')}`);
        }
        if ((isParent(c) || (isRider(c) && !c.parent_id)) && !c.payment_terms) {
            bits.push('<span class="no-parent">payment terms not set</span>');
        } else if (c.payment_terms && isParent(c)) {
            bits.push(`💳 ${PAYMENT_TERMS[c.payment_terms]}`);
        }
        if (c.phone || c.email) bits.push(esc(c.phone || c.email));
        return bits.join(' · ');
    }

    function roleTags(c) {
        const tags = [];
        if (isRider(c)) tags.push('<span class="role-tag rider">Rider</span>');
        if (isParent(c)) tags.push('<span class="role-tag parent">Parent</span>');
        return tags.join('');
    }

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
                <button class="month-pill role-pill ${state.contactRoleFilter === 'rider' ? 'active' : ''}"
                        data-role="rider">Riders</button>
                <button class="month-pill role-pill ${state.contactRoleFilter === 'parent' ? 'active' : ''}"
                        data-role="parent">Parents</button>
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
        // The contact list is a plain page scroll; rebuilding it after an edit
        // would otherwise jump you back to the top of 76 rows.
        if (state.contactScroll) {
            const y = state.contactScroll;
            state.contactScroll = null;
            requestAnimationFrame(() => window.scrollTo(0, y));
        }
        const draw = (filter) => {
            const q = (filter || '').toLowerCase();
            const levels = state.contactLevelFilter;
            const role = state.contactRoleFilter;
            const items = state.contacts.filter((c) =>
                !c.is_prospect &&
                (!q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q)) &&
                (!levels.size || levels.has(c.experience)) &&
                (!role || (role === 'rider' ? isRider(c) : isParent(c))));
            document.getElementById('contact-list').innerHTML = items.length ? items.map((c) => `
                <div class="list-item" data-contact-id="${c.id}">
                    <div class="avatar">${esc(c.name.trim()[0] || '?').toUpperCase()}</div>
                    <div class="li-main">
                        <div class="li-title">${esc(c.name)}${roleTags(c)}</div>
                        <div class="li-sub">${contactSubLine(c)}</div>
                    </div>
                    <div class="fixed-slots">${fixedSlotsHtml(c)}</div>
                    ${c.experience ? `<span class="chip" style="background:color-mix(in srgb, ${LEVEL_COLORS[c.experience]} 26%, white);color:${LEVEL_COLORS[c.experience]}">${LEVEL_LABELS[c.experience]}</span>` : ''}
                    <div class="li-right">${c.ride_count} ride${c.ride_count === 1 ? '' : 's'}</div>
                    <button class="row-edit" data-edit-contact="${c.id}"
                            title="Edit ${esc(c.name)}" aria-label="Edit ${esc(c.name)}">✏️</button>
                    <button class="row-del" data-del-contact="${c.id}"
                            title="Delete ${esc(c.name)}" aria-label="Delete ${esc(c.name)}">🗑</button>
                </div>`).join('') : '<div class="card muted">No contacts found.</div>';
            document.querySelectorAll('[data-contact-id]').forEach((el) => {
                el.addEventListener('click', () => { location.hash = '#/contacts/' + el.getAttribute('data-contact-id'); });
            });
            // edit in place — don't let the click fall through to the row
            document.querySelectorAll('[data-edit-contact]').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const c = contactById(btn.getAttribute('data-edit-contact'));
                    if (c) openContactDialog(c);
                });
            });
            document.querySelectorAll('[data-del-contact]').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const c = contactById(btn.getAttribute('data-del-contact'));
                    if (c) deleteContact(c);
                });
            });
        };
        draw('');
        document.getElementById('contact-search').addEventListener('input', (e) => draw(e.target.value));
        document.getElementById('contact-add').addEventListener('click', () => openNewRecord('rider'));
        const redrawKeepingSearch = () => {
            const search = document.getElementById('contact-search').value;
            renderContacts().then(() => {
                const input = document.getElementById('contact-search');
                if (search) { input.value = search; input.dispatchEvent(new Event('input')); }
            });
        };
        document.querySelectorAll('.level-pill').forEach((btn) => {
            btn.addEventListener('click', () => {
                const level = btn.getAttribute('data-level');
                if (state.contactLevelFilter.has(level)) state.contactLevelFilter.delete(level);
                else state.contactLevelFilter.add(level);
                redrawKeepingSearch();
            });
        });
        document.querySelectorAll('.role-pill').forEach((btn) => {
            btn.addEventListener('click', () => {
                const role = btn.getAttribute('data-role');
                state.contactRoleFilter = state.contactRoleFilter === role ? null : role;
                redrawKeepingSearch();
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

    // Availability printed as plain hours per day, so the 7-column grid only has
    // to appear when you actually want to change it.
    const DAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    function availSummary(availability) {
        const rows = (availability || []).slice()
            .sort((a, b) => a.weekday - b.weekday || String(a.start_time).localeCompare(String(b.start_time)));
        if (!rows.length) return '<span class="muted">Any time — no restriction set.</span>';
        const byDay = {};
        rows.forEach((a) => {
            (byDay[a.weekday] = byDay[a.weekday] || [])
                .push(`${hhmm(a.start_time)}–${hhmm(a.end_time)}`);
        });
        return Object.keys(byDay).sort((a, b) => a - b).map((w) =>
            `<span class="avail-day"><b>${DAY_ABBR[w - 1]}</b> ${esc(byDay[w].join(', '))}</span>`).join('');
    }

    // Summary plus a button. The grid itself stays in the form but hidden, so
    // the existing collectAvailability(form) still finds it on save; editing
    // happens on a clone in a sub-dialog, which only writes back on Save.
    function availFieldHtml(availability) {
        return `<div class="avail-field">
            <div class="avail-summary" id="av-summary">${availSummary(availability)}</div>
            <button type="button" class="secondary small" id="av-edit">Edit availability</button>
            <div id="av-store" class="hidden">${availGridHtml(availability)}</div>
        </div>`;
    }

    function wireAvailField(root) {
        const scope = root || $dialog;
        const editBtn = scope.querySelector('#av-edit');
        const store = scope.querySelector('#av-store');
        if (!editBtn || !store) return;
        editBtn.addEventListener('click', () => {
            const overlay = openSubDialog(`
                <h3 style="margin:0 0 4px">Availability</h3>
                <p class="muted" style="margin:0 0 10px">Tap the hours they can ride.
                   All empty means no restriction.
                   <b>Nothing changes until you press Done.</b></p>
                <div id="av-edit-grid"></div>
                <div class="form-actions">
                    <button class="secondary" id="av-clear">Clear all</button>
                    <span class="spacer"></span>
                    <button class="secondary" id="av-cancel">Discard</button>
                    <button id="av-save">Done</button>
                </div>`);
            const holder = overlay.querySelector('#av-edit-grid');
            holder.appendChild(store.firstElementChild.cloneNode(true));
            holder.querySelectorAll('.avail-cell').forEach((cell) =>
                cell.addEventListener('click', () => cell.classList.toggle('on')));
            overlay.querySelector('#av-clear').addEventListener('click', () =>
                holder.querySelectorAll('.avail-cell.on').forEach((c) => c.classList.remove('on')));
            overlay.querySelector('#av-cancel').addEventListener('click', () => overlay.remove());
            overlay.querySelector('#av-save').addEventListener('click', () => {
                store.innerHTML = '';
                store.appendChild(holder.firstElementChild);
                scope.querySelector('#av-summary').innerHTML =
                    availSummary(collectAvailability(store));
                overlay.remove();
            });
        });
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

    // Rider ticked -> they may have a parent who pays. Parent ticked -> they can
    // have riders hung underneath them. Both is fine (a parent who also rides).
    // Which arrangement actually applies to this contact? A parent uses their
    // own; a rider uses their parent's when the parent pays, otherwise theirs.
    function effectivePayerTerms(contact, ownTerms, isParent, paysParent) {
        if (isParent) return ownTerms || null;
        if (paysParent) {
            const sel = document.getElementById('ct-parent');
            const payer = sel && contactById(sel.value);
            return payer ? payer.payment_terms : null;
        }
        return ownTerms || null;
    }

    // One row per horse on livery: which horse, and whether it is a full or a
    // half share. The share scales the base price only — the standard monthly
    // charges are a cost per horse and are billed in full for each one.
    function liveryRowHtml(h) {
        const mine = String(h ? h.horse_id : '');
        return `<div class="pick-row" data-livery-row>
            <select class="lh-horse" style="flex:1 1 auto;min-width:0">
                <option value="">(choose a horse)</option>
                ${state.horses.filter((x) => x.active || String(x.id) === mine)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((x) => `<option value="${x.id}" ${String(x.id) === mine ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
            </select>
            <select class="lh-share" style="flex:0 0 140px">
                <option value="100" ${!h || h.share === 100 ? 'selected' : ''}>Full (100%)</option>
                <option value="50" ${h && h.share === 50 ? 'selected' : ''}>Half (50%)</option>
                <option value="25" ${h && h.share === 25 ? 'selected' : ''}>Quarter (25%)</option>
            </select>
            <input class="lh-discount" type="number" inputmode="decimal" step="0.01" min="0"
                   style="flex:0 0 110px" placeholder="discount"
                   title="Monthly discount off this horse's livery fee"
                   value="${h && h.discount_cents ? (Number(h.discount_cents) / 100).toFixed(2) : ''}">
            <button type="button" class="danger small row-x">${ICON_X}</button>
        </div>`;
    }

    // Extra monthly charges for this one customer. Held in the form and saved
    // with it, the same as horse preferences — they are part of the contact.
    function monthlyRowHtml(m) {
        return `<div class="pick-row" data-monthly-row>
            <input class="mc-name" placeholder="e.g. Extra hay, Monthly donation" value="${esc(m ? m.name : '')}"
                   style="flex:1 1 auto;min-width:0">
            <input class="mc-price" type="number" inputmode="decimal" step="0.01"
                   style="flex:0 0 100px" value="${m ? (Number(m.price_cents) / 100).toFixed(2) : '0.00'}">
            <button type="button" class="danger small row-x">${ICON_X}</button>
        </div>`;
    }

    function wireMonthlyRow(row) {
        row.querySelector('.row-x').addEventListener('click', () => row.remove());
    }

    // This rider's own price for a ride type. The placeholder shows the
    // standard price so it is obvious what is being overridden.
    function ridePriceRowHtml(p) {
        const sel = activeRideTypes().map((t) =>
            `<option value="${t.id}" ${p && String(p.ride_type_id) === String(t.id) ? 'selected' : ''}
             >${esc(t.name)} — ${money(t.price_cents)}</option>`).join('');
        return `<div class="pick-row" data-ridetype-row>
            <select class="rtp-type" style="flex:1 1 auto;min-width:0">
                <option value="">(pick a ride type)</option>${sel}</select>
            <input class="rtp-price" type="number" inputmode="decimal" step="0.01" min="0"
                   style="flex:0 0 100px" value="${p ? (Number(p.price_cents) / 100).toFixed(2) : ''}"
                   placeholder="0.00">
            <button type="button" class="danger small row-x">${ICON_X}</button>
        </div>`;
    }

    // One-off expenses are saved the moment they are added, not with the form:
    // they are a record of something that happened, and losing them to a stray
    // navigation would lose money. Invoiced ones can no longer be removed.
    function renderContactCharges(contact) {
        const el = document.getElementById('ct-charges');
        if (!el) return;
        const list = (contact && contact.charges) || [];
        if (!list.length) { el.innerHTML = '<div class="muted">None yet.</div>'; return; }
        el.innerHTML = list.map((c) => `
            <div class="charge-row${c.invoiced ? ' invoiced' : ''}" data-charge="${c.id}">
                <span class="charge-date">${fmtDay(c.charge_date)}</span>
                <span class="charge-desc">${esc(c.description)}</span>
                <span class="charge-amt${c.amount_cents < 0 ? ' is-discount' : ''}">${money(c.amount_cents)}</span>
                <span class="charge-state">${c.invoiced ? 'invoiced' : 'pending'}</span>
                ${c.invoiced ? '' : `<button type="button" class="danger small ch-del">${ICON_X}</button>`}
            </div>`).join('');
        el.querySelectorAll('.ch-del').forEach((btn) => btn.addEventListener('click', async () => {
            const row = btn.closest('[data-charge]');
            if (!await askConfirm('Remove this expense?', row.querySelector('.charge-desc').textContent,
                'Remove')) return;
            try {
                await api('DELETE', `/api/charges/${row.getAttribute('data-charge')}`);
                state.contacts = (await api('GET', '/api/contacts')).contacts;
                renderContactCharges(contactById(contact.id));
            } catch (e) { toast(e.message, true); }
        }));
    }

    // Show the inline new-parent fields in place of the picker. The picker is
    // hidden rather than disabled so there is one obvious answer on screen to
    // "who pays" — either a chosen contact or the one being typed in.
    function openInlineParent() {
        const np = document.getElementById('ct-np-wrap');
        const pick = document.getElementById('ct-parent-pick');
        if (!np || !pick) return;
        np.classList.remove('hidden');
        pick.classList.add('hidden');
        const name = document.getElementById('np-name');
        if (name) name.focus();
    }

    function closeInlineParent() {
        const np = document.getElementById('ct-np-wrap');
        const pick = document.getElementById('ct-parent-pick');
        if (!np || !pick) return;
        np.classList.add('hidden');
        pick.classList.remove('hidden');
        ['np-name', 'np-email', 'np-address', 'np-terms', 'np-school'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const rides = document.getElementById('np-also-rides');
        if (rides) rides.checked = false;
    }

    const inlineParentOpen = () => {
        const np = document.getElementById('ct-np-wrap');
        return !!np && !np.classList.contains('hidden');
    };

    function wireContactRoles(contact) {
        const rider = document.getElementById('ct-is-rider');
        const parent = document.getElementById('ct-is-parent');
        const parentWrap = document.getElementById('ct-parent-wrap');
        const kidsWrap = document.getElementById('ct-kids-wrap');
        const kids = (state.contacts || []).filter((c) =>
            contact && String(c.parent_id) === String(contact.id));
        document.getElementById('ct-kids').innerHTML = kids.length
            ? kids.map((k) => `<span class="kid-chip">${esc(k.name)}</span>`).join('')
            : 'None yet.';
        // Someone with riders under them IS a parent, and the chain is one level
        // deep — so they cannot also be given a parent. Say so here rather than
        // letting the form be filled in and rejected on save.
        const hasKids = kids.length > 0;
        if (hasKids) {
            parent.checked = true;
            parent.disabled = true;
            parent.title = 'Riders are linked to this contact, so they are a parent.';
        }
        const termsWrap = document.getElementById('ct-terms-wrap');
        const paysWrap = document.getElementById('ct-pays-wrap');
        const paysParent = document.getElementById('ct-pays-parent');
        const paysOwn = document.getElementById('ct-pays-own');
        const sync = () => {
            // Only a rider gets invoiced by someone else, and someone who already
            // has riders under them is the top of the chain.
            const canHaveParent = rider.checked && !hasKids;
            paysWrap.classList.toggle('hidden', !canHaveParent);
            const parentPays = canHaveParent && paysParent.checked;
            parentWrap.classList.toggle('hidden', !parentPays);
            // The payer's details are the ones that matter when they pay, so the
            // rider's own phone/email/address are not asked for. They stay in
            // the DOM pre-filled, so editing an existing contact never blanks
            // details that were already recorded.
            const contactWrap = document.getElementById('ct-contact-wrap');
            if (contactWrap) contactWrap.classList.toggle('hidden', parentPays);
            // Creating a payer inline replaces the picker, not sits beside it
            const np = document.getElementById('ct-np-wrap');
            if (np && !parentPays && !np.classList.contains('hidden')) closeInlineParent();
            kidsWrap.classList.toggle('hidden', !parent.checked);
            const note = document.getElementById('ct-parent-note');
            if (note) note.classList.toggle('hidden', !(rider.checked && hasKids));
            // Terms are for whoever the invoice actually lands on
            const selfPays = !canHaveParent || paysOwn.checked;
            termsWrap.classList.toggle('hidden', !(parent.checked || hasKids || selfPays));
            // Every rider needs a school: term dates decide which of their rides
            // are term-time and which fall in the holidays, and that drives what
            // gets invoiced — not only the per-term payers.
            // Experience, age, pick-up, horse preferences and availability all
            // describe a rider; a contact who only pays is not asked any of it.
            const riderOnly = document.getElementById('ct-rider-only');
            if (riderOnly) riderOnly.classList.toggle('hidden', !rider.checked);
            // The school belongs to whoever pays: one invoice covers all of a
            // payer's children, so they all follow one term calendar. A rider
            // whose parent pays is shown that school rather than setting one.
            const schoolWrap = document.getElementById('ct-school-wrap');
            const inherited = document.getElementById('ct-school-inherited');
            const followsPayer = rider.checked && !parent.checked && !hasKids && paysParent.checked;
            schoolWrap.classList.toggle('hidden', followsPayer);
            // Livery is billed to whoever pays, so a rider whose parent pays is
            // not asked about it. Arena fees and one-off expenses stay visible,
            // because those genuinely belong to the rider.
            const liveryWrap = document.getElementById('ct-livery-wrap');
            if (liveryWrap) liveryWrap.classList.toggle('hidden', followsPayer);
            if (inherited) {
                inherited.classList.toggle('hidden', !followsPayer);
                if (followsPayer) {
                    const payer = contactById(document.getElementById('ct-parent').value);
                    const school = payer && state.schools.find(
                        (s) => String(s.id) === String(payer.school_id));
                    const npSchoolSel = inlineParentOpen() && document.getElementById('np-school');
                    const npSchool = npSchoolSel && state.schools.find(
                        (sc) => String(sc.id) === String(npSchoolSel.value));
                    document.getElementById('ct-school-inherited-text').innerHTML = school
                        ? `${esc(school.name)} <span class="muted">— from ${esc(payer.name)}</span>`
                        : payer
                        ? `<span class="no-parent">${esc(payer.name)} has no school set</span>`
                        // A parent being typed in above has no id yet, so there
                        // is nothing to look up — read their school off the form.
                        : npSchool
                        ? `${esc(npSchool.name)} <span class="muted">— from the new parent</span>`
                        : inlineParentOpen()
                        ? '<span class="no-parent">set the school on the new parent above</span>'
                        : '<span class="no-parent">pick the parent who pays first</span>';
                }
            }
            const needsSchool = !followsPayer && (rider.checked || parent.checked);
            schoolWrap.classList.toggle('needs-school',
                needsSchool && !document.getElementById('ct-school').value);
            document.getElementById('ct-school-req').classList.toggle('hidden', !needsSchool);
            const schNote = document.getElementById('ct-school-note');
            if (schNote) schNote.textContent = needsSchool
                ? "Required — term dates decide which lessons are term-time. Riders you pay for follow this school."
                : "Optional for someone who does not ride.";
            // A brand-new rider paying their own way is almost always a walk-in
            // settling on the day — otherwise they land in "terms not set".
            if (!contact && !termsSel.value && !parent.checked &&
                rider.checked && canHaveParent && paysOwn.checked && !termsTouched) {
                termsSel.value = 'cash_after';
            }
        };
        const termsSel = document.getElementById('ct-terms');
        let termsTouched = false;
        termsSel.addEventListener('change', () => { termsTouched = true; sync(); });
        document.getElementById('ct-school').addEventListener('change', sync);
        const npSchool = document.getElementById('np-school');
        if (npSchool) npSchool.addEventListener('change', sync);
        paysParent.addEventListener('change', sync);
        document.getElementById('ct-parent').addEventListener('change', sync);
        paysOwn.addEventListener('change', sync);
        rider.addEventListener('change', sync);
        parent.addEventListener('change', sync);
        sync();
        document.getElementById('ct-add-parent').addEventListener('click', () => { openInlineParent(); sync(); });
        document.getElementById('ct-np-cancel').addEventListener('click', () => { closeInlineParent(); sync(); });
        document.getElementById('ct-add-kid').addEventListener('click', async () => {
            // Save the parent first so the new rider has something to point at
            const saved = await saveContactForm(contact);
            if (saved) openNewRiderUnder(saved);
        });
    }

    // Riders can be brand new, or someone already in the book who simply had no
    // payer recorded — which is the common case while parents are being added.
    function linkableContacts(parent) {
        return state.contacts.filter((c) =>
            String(c.id) !== String(parent.id) &&      // not themselves
            c.is_rider &&                              // only riders can be linked as one
            !c.parent_id &&                            // not already linked
            !c.is_parent &&                            // parents cannot have parents
            !state.contacts.some((k) => String(k.parent_id) === String(c.id)))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    // The rider's essentials only — the full contact form is a click away later
    function openNewRiderUnder(parent) {
        const existing = linkableContacts(parent);
        const overlay = openSubDialog(`
            <h3 style="margin:0 0 4px">Add a rider under ${esc(parent.name)}</h3>
            <p class="muted" style="margin:0 0 10px">${esc(parent.name)} pays their invoices.</p>
            <div class="page-tabs" style="margin-bottom:12px">
                <button type="button" class="page-tab active" data-kid-mode="new">New rider</button>
                <button type="button" class="page-tab" data-kid-mode="existing">Existing contact</button>
            </div>
            <div id="kid-existing" class="hidden">
                <label>Which contact?</label>
                <select id="kid-pick">
                    <option value="">(choose a contact)</option>
                    ${existing.map((c) => `<option value="${c.id}">${esc(c.name)}${
                        c.experience ? ' · ' + LEVEL_LABELS[c.experience] : ''}</option>`).join('')}
                </select>
                ${existing.length ? '' : '<p class="muted">Every other contact already has a payer or is a parent.</p>'}
            </div>
            <div id="kid-new">
            <label>Name</label>
            <input id="kid-name" autocomplete="off">
            <div class="form-row">
                <div>
                    <label>Experience level</label>
                    <select id="kid-exp">
                        <option value="">(not set)</option>
                        ${LEVELS.map((l) => `<option value="${l}">${LEVEL_LABELS[l]}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label>Age (approx.)</label>
                    <input id="kid-age" type="number" inputmode="numeric">
                </div>
            </div>
            <label style="display:flex;align-items:center;gap:8px;color:var(--text)">
                <input type="checkbox" id="kid-prospect" style="width:auto"> 🌱 Interested — not placed in a lesson yet
            </label>
            <label style="display:flex;align-items:center;gap:8px;color:var(--text);font-weight:500">
                <input type="checkbox" id="kid-collect" style="width:auto"> Needs to be picked up (from school)
            </label>
            <div class="form-row hidden" id="kid-collect-details">
                <div><label>Teacher</label><input id="kid-teacher"></div>
                <div><label>Class</label><input id="kid-class"></div>
            </div>
            <label>Preferred horse</label>
            <select id="kid-horse">
                <option value="">(none)</option>
                ${[...activeHorses()].sort((a, b) => a.name.localeCompare(b.name))
                    .map((h) => `<option value="${h.id}">${esc(h.name)}</option>`).join('')}
            </select>
            <label>Availability</label>
            ${availFieldHtml([])}
            </div>
            <div class="form-error"></div>
            <div class="form-actions">
                <button class="secondary" id="kid-cancel">Cancel</button>
                <button id="kid-save">Add rider</button>
            </div>`);
        let mode = 'new';
        overlay.querySelectorAll('[data-kid-mode]').forEach((tab) => tab.addEventListener('click', () => {
            mode = tab.getAttribute('data-kid-mode');
            overlay.querySelectorAll('[data-kid-mode]').forEach((t) =>
                t.classList.toggle('active', t === tab));
            overlay.querySelector('#kid-new').classList.toggle('hidden', mode !== 'new');
            overlay.querySelector('#kid-existing').classList.toggle('hidden', mode !== 'existing');
            overlay.querySelector('#kid-save').textContent = mode === 'new' ? 'Add rider' : 'Link rider';
        }));
        wireAvailField(overlay);
        overlay.querySelector('#kid-collect').addEventListener('change', (e) =>
            overlay.querySelector('#kid-collect-details').classList.toggle('hidden', !e.target.checked));
        overlay.querySelector('#kid-cancel').addEventListener('click', () => overlay.remove());
        overlay.querySelector('#kid-save').addEventListener('click', async () => {
            const err = overlay.querySelector('.form-error');
            if (mode === 'existing') {
                const pick = overlay.querySelector('#kid-pick').value;
                if (!pick) { err.textContent = 'Choose a contact to link.'; return; }
                try {
                    await api('PUT', `/api/contacts/${pick}`, { parent_id: parent.id, is_rider: true });
                    state.contacts = (await api('GET', '/api/contacts')).contacts;
                    const linked = contactById(pick);
                    overlay.remove();
                    toast(`${(linked && linked.name) || 'Rider'} now linked to ${parent.name}.`);
                    openContactDialog(contactById(parent.id));
                } catch (e3) {
                    err.textContent = e3.message;
                }
                return;
            }
            const name = overlay.querySelector('#kid-name').value.trim();
            if (!name) { err.textContent = 'A name is required.'; return; }
            const age = parseInt(overlay.querySelector('#kid-age').value, 10);
            const horseId = overlay.querySelector('#kid-horse').value;
            try {
                await api('POST', '/api/contacts', {
                    name,
                    parent_id: parent.id,
                    is_rider: true,
                    is_parent: false,
                    experience: overlay.querySelector('#kid-exp').value || null,
                    birth_year: age ? new Date().getFullYear() - age : null,
                    is_prospect: overlay.querySelector('#kid-prospect').checked,
                    needs_collection: overlay.querySelector('#kid-collect').checked,
                    collection_teacher: overlay.querySelector('#kid-teacher').value,
                    collection_class: overlay.querySelector('#kid-class').value,
                    horse_prefs: horseId ? [{ kind: 'preferred', horse_id: horseId, reason: '' }] : [],
                    availability: collectAvailability(overlay)
                });
                state.contacts = (await api('GET', '/api/contacts')).contacts;
                overlay.remove();
                toast(`${name} added under ${parent.name}.`);
                openContactDialog(contactById(parent.id));   // reopen with the new child listed
            } catch (e2) {
                err.textContent = e2.message;
            }
        });
        overlay.querySelector('#kid-name').focus();
    }

    // Shared by Save and by "add a rider" — returns the saved contact or null
    async function saveContactForm(contact) {
        const body = {
            livery_horses: [...(ctHost || $dialog).querySelectorAll('[data-livery-row]')]
                .map((r) => ({ horse_id: r.querySelector('.lh-horse').value,
                               share: Number(r.querySelector('.lh-share').value),
                               discount_cents: parseMoneyCents(r.querySelector('.lh-discount').value) || 0 }))
                .filter((h) => h.horse_id),
            ride_type_prices: [...(ctHost || $dialog).querySelectorAll('[data-ridetype-row]')]
                .map((r) => ({
                    ride_type_id: r.querySelector('.rtp-type').value,
                    price_cents: parseMoneyCents(r.querySelector('.rtp-price').value) || 0
                })).filter((p) => p.ride_type_id),
            monthly_charges: [...(ctHost || $dialog).querySelectorAll('[data-monthly-row]')]
                .map((r) => ({
                    name: r.querySelector('.mc-name').value.trim(),
                    price_cents: parseMoneyCents(r.querySelector('.mc-price').value) || 0
                })).filter((m) => m.name),
            name: document.getElementById('ct-name').value,
            phone: readPhoneField('ct-phone'),
            email: document.getElementById('ct-email').value,
            address: document.getElementById('ct-address').value,
            // "Pays own invoices" means no payer above them, whatever the picker holds
            // Filled in below from the inline form when a parent is being created
            parent_id: document.getElementById('ct-pays-parent').checked &&
                !document.getElementById('ct-parent-wrap').classList.contains('hidden')
                ? (document.getElementById('ct-parent').value || null) : null,
            experience: document.getElementById('ct-exp').value || null,
            birth_year: parseInt(document.getElementById('ct-age').value, 10)
                ? new Date().getFullYear() - parseInt(document.getElementById('ct-age').value, 10) : null,
            is_prospect: document.getElementById('ct-prospect').checked,
            is_rider: document.getElementById('ct-is-rider').checked,
            is_parent: document.getElementById('ct-is-parent').checked,
            payment_terms: document.getElementById('ct-terms').value || null,
            school_id: document.getElementById('ct-school').value || null,
            pays_arena_fee: document.getElementById('ct-arena').checked,
            needs_collection: document.getElementById('ct-collect').checked,
            collection_teacher: document.getElementById('ct-teacher').value,
            collection_class: document.getElementById('ct-class').value,
            notes: document.getElementById('ct-notes').value,
            horse_prefs: [...(ctHost || $dialog).querySelectorAll('[data-kind="ctpref"]')].map((row) => ({
                kind: row.querySelector('.cp-kind').value,
                horse_id: row.querySelector('.cp-horse').value || null,
                reason: row.querySelector('.cp-reason').value
            })).filter((p) => p.horse_id),
            availability: collectAvailability(ctHost || $dialog)
        };
        if (!body.is_rider && !body.is_parent) {
            ctError('Tick rider, parent, or both.');
            return null;
        }
        if (body.is_parent && !body.payment_terms) {
            ctError('Choose how this parent pays before saving.');
            return null;
        }
        const paysParentEl0 = document.getElementById('ct-pays-parent');
        const parentWrapHidden = document.getElementById('ct-parent-wrap').classList.contains('hidden');
        // The school sits on whoever pays. A rider whose parent pays follows that
        // parent's school and has none of their own, so demanding one here was
        // a leftover from when every rider carried one — it made such a rider
        // impossible to save at all.
        const followsPayer = !parentWrapHidden && paysParentEl0 && paysParentEl0.checked;
        const effTerms = effectivePayerTerms(contact, body.payment_terms, body.is_parent, followsPayer);
        if (!followsPayer && effTerms === 'advance_term' && !body.school_id) {
            ctError('Pick the school — per-term invoices need its term dates.');
            return null;
        }
        // A payer being typed in inline is created first, so the rider has a
        // real id to point at. Validated before anything is written, so a bad
        // rider form cannot leave an orphan parent behind.
        if (inlineParentOpen()) {
            const npName = document.getElementById('np-name').value.trim();
            const npTerms = document.getElementById('np-terms').value;
            const npSchool = document.getElementById('np-school').value;
            if (!npName) { ctError('The new parent needs a name.'); return null; }
            if (!npTerms) { ctError('Choose how the new parent pays.'); return null; }
            if (!npSchool) { ctError('Pick the school for the new parent.'); return null; }
            try {
                const made = await api('POST', '/api/contacts', {
                    name: npName,
                    payment_terms: npTerms,
                    phone: readPhoneField('np-phone'),
                    email: document.getElementById('np-email').value,
                    address: document.getElementById('np-address').value,
                    is_parent: true,
                    school_id: npSchool,
                    is_rider: document.getElementById('np-also-rides').checked
                });
                state.contacts = (await api('GET', '/api/contacts')).contacts;
                body.parent_id = made.contact.id;
            } catch (e) {
                ctError(e.message);
                return null;
            }
        }
        // "Parent pays" with nobody picked would leave the invoice with no payer
        const paysParentEl = document.getElementById('ct-pays-parent');
        if (paysParentEl && paysParentEl.checked && !body.parent_id &&
            !document.getElementById('ct-parent-wrap').classList.contains('hidden')) {
            ctError('Pick the parent who pays, or switch to "Pays own invoices".');
            return null;
        }
        try {
            const res = contact
                ? await api('PUT', `/api/contacts/${contact.id}`, body)
                : await api('POST', '/api/contacts', body);
            state.contacts = (await api('GET', '/api/contacts')).contacts;
            return res.contact;
        } catch (err) {
            ctError(err.message);
            return null;
        }
    }

    // The contact form normally fills the main dialog, but it also has to open
    // *over* the ride dialog when a rider is added mid-ride — replacing the main
    // dialog there would throw away the half-built ride. Everything inside is
    // found by id, which stays unique because only one contact form is ever on
    // screen; only the few container-scoped lookups need to know which host
    // they are in, and that is what this points at.
    let ctHost = null;

    // msg into the contact form's own error line, not whichever dialog is behind it
    function ctError(msg) {
        const el = (ctHost || $dialog).querySelector('.form-error');
        if (el) el.textContent = msg;
    }

    // opts.overlay  — render over the current dialog instead of replacing it
    // opts.onSaved  — called with the saved contact instead of re-rendering a page
    // opts.fixedRider — the roles are not up for debate: this is a rider
    function openContactDialog(contact, withTabs, opts) {
        const o = opts || {};
        const html = (`
            ${withTabs ? newTypeTabsHtml('rider') : ''}
            <h2>${contact ? 'Edit contact' : 'New rider or parent'}</h2>
            <!-- Roles come first: they decide which of the fields below are even
                 asked for, so answering them last meant filling in details that
                 then turned out to belong to the parent instead. -->
            <label>This contact is a…</label>
            <div class="role-checks">
                <label class="role-check">
                    <input type="checkbox" id="ct-is-rider" ${!contact || contact.is_rider ? 'checked' : ''}>
                    Rider
                </label>
                <label class="role-check">
                    <input type="checkbox" id="ct-is-parent" ${contact && contact.is_parent ? 'checked' : ''}>
                    Parent
                </label>
                <label class="role-check">
                    <input type="checkbox" id="ct-prospect" ${contact && contact.is_prospect ? 'checked' : ''}>
                    🌱 Interested
                </label>
            </div>
            <label>Name</label>
            <input id="ct-name" value="${esc(contact ? contact.name : '')}">
            <div id="ct-pays-wrap">
                <label>Who pays</label>
                <div class="role-checks">
                    <label class="role-check">
                        <input type="radio" name="ct-pays" id="ct-pays-parent"
                               ${contact && contact.parent_id ? 'checked' : ''}> Parent pays
                    </label>
                    <label class="role-check">
                        <input type="radio" name="ct-pays" id="ct-pays-own"
                               ${contact && contact.parent_id ? '' : 'checked'}> Pays own invoices
                    </label>
                </div>
            </div>
            <div id="ct-parent-wrap">
                <label>Which parent pays</label>
                <div class="pick-row" style="gap:6px" id="ct-parent-pick">
                    <select id="ct-parent" style="flex:1 1 auto;min-width:0">${parentOptions(contact ? contact.parent_id : null, contact ? contact.id : null)}</select>
                    <button type="button" class="secondary small" id="ct-add-parent"
                            style="flex:0 0 auto" title="Create a new parent">＋ New</button>
                </div>
                <!-- A new payer is captured here rather than in a dialog of its
                     own: it is the same handful of fields, and a sub-dialog over
                     a half-filled form is a lot of ceremony for four inputs.
                     Saved together with the rider, so a cancelled rider cannot
                     leave a stray parent behind. -->
                <div id="ct-np-wrap" class="hidden np-inline">
                    <div class="np-inline-head">
                        <b>New parent</b>
                        <button type="button" class="secondary small" id="ct-np-cancel">Cancel</button>
                    </div>
                    <label>Name <span class="req">*</span></label>
                    <input id="np-name" autocomplete="off">
                    <label>Phone (WhatsApp)</label>
                    ${phoneFieldHtml('np-phone', '')}
                    <label>Email</label>
                    <input id="np-email" type="email">
                    <label>Address (optional)</label>
                    <textarea id="np-address"></textarea>
                    <label>School <span class="req">*</span></label>
                    <div class="muted" style="margin:-4px 0 6px">Term dates decide which lessons
                       are term-time. The riders this parent pays for follow it.</div>
                    <select id="np-school">
                        <option value="">(not set)</option>
                        ${state.schools.filter((sc) => sc.active)
                            .map((sc) => `<option value="${sc.id}">${esc(sc.name)}</option>`).join('')}
                    </select>
                    <label>How they pay <span class="req">*</span></label>
                    <select id="np-terms">
                        <option value="">(not assigned)</option>
                        ${Object.entries(PAYMENT_TERMS).map(([k, label]) =>
                            `<option value="${k}">${label}</option>`).join('')}
                    </select>
                    <label class="role-check" style="margin-top:6px">
                        <input type="checkbox" id="np-also-rides"> They ride as well
                    </label>
                </div>
            </div>
            <!-- Hidden when a parent pays: the phone, email and address that
                 matter then are the parent's, and asking twice invited a rider
                 record carrying contact details nobody would ever use. -->
            <div id="ct-contact-wrap">
                <label>Phone (WhatsApp)</label>
                ${phoneFieldHtml('ct-phone', contact ? contact.phone : '')}
                <label>Email</label>
                <input id="ct-email" type="email" value="${esc(contact ? contact.email : '')}">
                <label>Address (optional)</label>
                <textarea id="ct-address">${esc(contact ? contact.address || '' : '')}</textarea>
            </div>
            <!-- How they pay and which school's terms they are billed against:
                 two halves of the same question, so they sit together in a box
                 like the expenses below. -->
            <fieldset class="money-block">
                <legend>Invoicing</legend>
                <div id="ct-terms-wrap">
                    <label>How they pay <span class="req">*</span></label>
                    <select id="ct-terms">
                        <option value="">(not assigned)</option>
                        ${Object.entries(PAYMENT_TERMS).map(([k, label]) =>
                            `<option value="${k}" ${contact && contact.payment_terms === k ? 'selected' : ''}>${label}</option>`).join('')}
                    </select>
                </div>
            <div id="ct-school-wrap">
                <label>School <span class="req" id="ct-school-req">*</span></label>
                <select id="ct-school">
                    <option value="">(not set)</option>
                    ${state.schools.filter((s) => s.active || (contact && String(contact.school_id) === String(s.id)))
                        .map((s) => `<option value="${s.id}" ${contact && String(contact.school_id) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
                </select>
                <div class="muted" id="ct-school-note" style="margin:-4px 0 10px">
                    Per-term invoices use this school's term dates.
                </div>
            </div>
            <div id="ct-school-inherited" class="hidden" style="margin-bottom:10px">
                <label>School</label>
                <div class="inherited-school" id="ct-school-inherited-text"></div>
            </div>
            </fieldset>
            <!-- Everything billed on top of the lessons, kept in one block so it
                 reads as the money section rather than stray tick-boxes: the
                 arena fee, livery, and any expenses for this contact. -->
            <fieldset class="money-block">
                <legend>Additional expenses</legend>
                <label class="role-check">
                    <input type="checkbox" id="ct-arena" ${contact && contact.pays_arena_fee ? 'checked' : ''}>
                    Pays arena fees (charged once a quarter)
                </label>
                <!-- Livery is billed to whoever pays, so a rider with a parent
                     above them is not asked about it. Arena fees and one-off
                     expenses stay, because those do belong to the rider. -->
                <div id="ct-livery-wrap">
                <label style="margin-top:8px">Livery horses</label>
                <div class="muted" style="margin:-4px 0 6px">A customer can stable more than one,
                   each on its own share. The discount is a monthly amount off that horse's
                   livery fee — leave it blank for none.</div>
                <div id="ct-livery-horses"></div>
                <button type="button" class="secondary small" id="ct-livery-add">＋ Add a livery horse</button>
                <div id="ct-livery-extras" class="${contact && (contact.livery_horses || []).length ? '' : 'hidden'}">
                    <div class="muted" style="margin:6px 0">Every livery customer is also charged
                       the standard monthly items from Settings${(state.liveryExtras || []).filter((e) => e.active).length
                        ? ': ' + (state.liveryExtras || []).filter((e) => e.active)
                            .map((e) => `${esc(e.name)} ${money(e.price_cents)}`).join(', ')
                        : ' (none set up yet)'}.</div>
                </div>
                </div>
                <!-- Not part of livery: a standing charge can be a livery extra,
                     a donation, anything billed every month, so it is offered to
                     every payer rather than only to livery customers. -->
                <label style="margin-top:10px">Standard monthly charges</label>
                <div class="muted" style="margin:-4px 0 6px">Billed every month, whether or not
                   they have a horse on livery — a livery extra, a donation, a standing
                   arrangement. Name it so the invoice line reads sensibly.</div>
                <div id="ct-monthly"></div>
                <button type="button" class="secondary small" id="ct-monthly-add">＋ Add a monthly charge</button>
                <label style="margin-top:10px">Lesson prices for this rider</label>
                <div class="muted" style="margin:-4px 0 6px">A discounted or agreed rate for one
                   ride type. It replaces the standard price for this rider only; every other
                   rider on the same lesson pays the usual price.</div>
                <div id="ct-ridetypes"></div>
                <button type="button" class="secondary small" id="ct-ridetype-add">＋ Add a lesson price</button>
                <label style="margin-top:10px">One-off expenses &amp; discounts</label>
                <div class="muted" style="margin:-4px 0 6px">A vet call, a bag of feed, or a
                   discount off a month's lessons. Dated, and settled on the next invoice.</div>
                <div id="ct-charges"></div>
                ${contact ? '<button type="button" class="secondary small" id="ct-charge-add">＋ Add an expense or discount</button>'
                    : '<div class="muted">Save the contact first, then expenses can be added.</div>'}
            </fieldset>
            <!-- Shown only to whoever pays. A rider with a payer above them
                 follows that payer's school; see ct-school-inherited. -->
            <div id="ct-parent-note" class="muted hidden" style="margin-bottom:10px">
                Riders are linked to this contact, so they pay their own invoices —
                a payer can't have a payer of their own.
            </div>
            <div id="ct-kids-wrap">
                <label>Riders under this parent</label>
                <div id="ct-kids" class="muted"></div>
                <button type="button" class="secondary small" id="ct-add-kid">＋ Add a rider under this contact</button>
            </div>
            <!-- Everything from here to Notes describes a RIDER. A contact who
                 only pays is asked none of it: experience, age, school pick-up,
                 horse preferences and availability are meaningless for them and
                 made the form twice as long as it needed to be. -->
            <div id="ct-rider-only">
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
            <label>Availability</label>
            ${availFieldHtml(contact ? contact.availability : [])}
            </div>
            <label>Notes</label>
            <textarea id="ct-notes">${esc(contact ? contact.notes : '')}</textarea>
            <div class="form-error"></div>
            <div class="form-actions">
                ${contact ? '<button class="danger small" id="ct-archive">Archive</button><span class="spacer"></span>' : ''}
                <button class="secondary" id="ct-cancel">Cancel</button>
                <button id="ct-save">Save</button>
            </div>`);
        let overlay = null;
        if (o.overlay) {
            overlay = openSubDialog(html);
            ctHost = overlay;
        } else {
            openDialog(html);
            ctHost = $dialog;
        }
        const dismiss = () => {
            ctHost = null;
            if (overlay) overlay.remove(); else closeDialog();
        };
        (contact && contact.horse_prefs || []).forEach((p) => {
            document.getElementById('ct-prefs').insertAdjacentHTML('beforeend', contactPrefRowHtml(p));
        });
        ctHost.querySelectorAll('[data-kind="ctpref"] .row-x').forEach((btn) =>
            btn.addEventListener('click', () => btn.closest('.pick-row').remove()));
        document.getElementById('ct-pref-add').addEventListener('click', () => {
            document.getElementById('ct-prefs').insertAdjacentHTML('beforeend', contactPrefRowHtml(null));
            const row = document.getElementById('ct-prefs').lastElementChild;
            row.querySelector('.row-x').addEventListener('click', () => row.remove());
        });
        wireAvailField(ctHost);
        wireContactRoles(contact);
        const liveryBox = document.getElementById('ct-livery-horses');
        const syncLivery = () => document.getElementById('ct-livery-extras')
            .classList.toggle('hidden', !liveryBox.querySelector('[data-livery-row]'));
        const addLiveryRow = (h) => {
            liveryBox.insertAdjacentHTML('beforeend', liveryRowHtml(h));
            const row = liveryBox.lastElementChild;
            row.querySelector('.row-x').addEventListener('click', () => { row.remove(); syncLivery(); });
            syncLivery();
        };
        ((contact && contact.livery_horses) || []).forEach(addLiveryRow);
        syncLivery();
        document.getElementById('ct-livery-add').addEventListener('click', () => addLiveryRow(null));
        // per-customer monthly charges
        const monthlyBox = document.getElementById('ct-monthly');
        ((contact && contact.monthly_charges) || []).forEach((m) => {
            monthlyBox.insertAdjacentHTML('beforeend', monthlyRowHtml(m));
            wireMonthlyRow(monthlyBox.lastElementChild);
        });
        const rtBox = document.getElementById('ct-ridetypes');
        ((contact && contact.ride_type_prices) || []).forEach((p) => {
            rtBox.insertAdjacentHTML('beforeend', ridePriceRowHtml(p));
            wireMonthlyRow(rtBox.lastElementChild);
        });
        document.getElementById('ct-ridetype-add').addEventListener('click', () => {
            rtBox.insertAdjacentHTML('beforeend', ridePriceRowHtml(null));
            wireMonthlyRow(rtBox.lastElementChild);
        });
        document.getElementById('ct-monthly-add').addEventListener('click', () => {
            monthlyBox.insertAdjacentHTML('beforeend', monthlyRowHtml(null));
            wireMonthlyRow(monthlyBox.lastElementChild);
        });
        // one-off expenses, saved as they are added
        renderContactCharges(contact);
        const chargeBtn = document.getElementById('ct-charge-add');
        if (chargeBtn) chargeBtn.addEventListener('click', () => {
            // Expense or discount is a choice rather than a minus sign: a
            // mistyped sign turns a R1000 credit into a R1000 charge, and the
            // amount field gives no hint which way round it should be.
            const overlay = openSubDialog(`
                <h3 style="margin:0 0 10px">Add an expense or discount</h3>
                <div class="role-checks" style="margin-bottom:8px">
                    <label class="role-check">
                        <input type="radio" name="ce-kind" id="ce-kind-exp" checked> Expense
                    </label>
                    <label class="role-check">
                        <input type="radio" name="ce-kind" id="ce-kind-disc"> Discount
                    </label>
                </div>
                <label>Date</label>
                <input type="date" id="ce-date" value="${todayStr()}">
                <label>What it is</label>
                <input id="ce-desc" autocomplete="off" placeholder="e.g. Vet call-out">
                <label id="ce-amt-label">Amount (${esc(state.settings.currency || 'R')})</label>
                <input id="ce-amt" type="number" inputmode="decimal" step="0.01" min="0">
                <div class="muted" id="ce-hint" style="margin:-4px 0 4px"></div>
                <div class="form-error"></div>
                <div class="form-actions">
                    <button class="secondary" id="ce-cancel">Cancel</button>
                    <button id="ce-save">Add</button>
                </div>`);
            const isDiscount = () => overlay.querySelector('#ce-kind-disc').checked;
            const syncKind = () => {
                overlay.querySelector('#ce-desc').placeholder = isDiscount()
                    ? 'e.g. Goodwill discount' : 'e.g. Vet call-out';
                overlay.querySelector('#ce-hint').textContent = isDiscount()
                    ? 'Taken off the next invoice.' : 'Added to the next invoice.';
            };
            overlay.querySelectorAll('[name="ce-kind"]').forEach((r) =>
                r.addEventListener('change', syncKind));
            syncKind();
            overlay.querySelector('#ce-cancel').addEventListener('click', () => overlay.remove());
            overlay.querySelector('#ce-save').addEventListener('click', async () => {
                const err = overlay.querySelector('.form-error');
                try {
                    const amount = Math.abs(parseMoneyCents(overlay.querySelector('#ce-amt').value) || 0);
                    await api('POST', `/api/contacts/${contact.id}/charges`, {
                        charge_date: overlay.querySelector('#ce-date').value,
                        description: overlay.querySelector('#ce-desc').value,
                        amount_cents: isDiscount() ? -amount : amount
                    });
                    state.contacts = (await api('GET', '/api/contacts')).contacts;
                    overlay.remove();
                    renderContactCharges(contactById(contact.id));
                    toast(isDiscount() ? 'Discount added.' : 'Expense added.');
                } catch (e) { err.textContent = e.message; }
            });
            overlay.querySelector('#ce-desc').focus();
        });
        document.getElementById('ct-collect').addEventListener('change', (e) => {
            document.getElementById('ct-collect-details').style.display = e.target.checked ? 'flex' : 'none';
        });
        if (!o.overlay) wireNewTypeTabs();
        document.getElementById('ct-cancel').addEventListener('click', dismiss);
        document.getElementById('ct-save').addEventListener('click', async () => {
            const saved = await saveContactForm(contact);
            if (!saved) return;
            dismiss();
            toast('Saved.');
            // Opened from somewhere that wants the contact back (a ride row)
            if (o.onSaved) { o.onSaved(saved); return; }
            if (contact && location.hash.startsWith('#/contacts/')) renderContactDetail(contact.id);
            else {
                state.contactScroll = window.scrollY;
                renderContacts();
            }
        });
        const archiveBtn = document.getElementById('ct-archive');
        if (archiveBtn) archiveBtn.addEventListener('click', async () => {
            if (!await askConfirm('Archive this contact?',
                'They disappear from lists, but their rides and invoices are kept.', 'Archive')) return;
            try {
                await api('PUT', `/api/contacts/${contact.id}`, { archived: true });
                dismiss();
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
                        <tr${r.off_kind ? ' class="ride-off"' : ''}>
                            <td><a href="#/calendar/${r.date}">${esc(fmtDay(r.date))}</a></td>
                            <td>${hhmm(r.start_time)}</td>
                            <td>${r.off_kind
                                ? `<span class="muted">${r.off_kind === 'rescheduled' ? '⟳ rescheduled' : '✕ cancelled late'}</span>`
                                : esc(r.horse_name || '')}</td>
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
                            <div class="li-sub">${esc(fmtDay(inv.period_start))} – ${esc(fmtDay(inv.period_end))}</div>
                        </div>
                        <span class="chip ${inv.status}">${inv.status}</span>
                        <div class="li-right">${money(inv.total_cents)}</div>
                        <a class="btn secondary small" href="/api/invoices/${inv.id}/pdf"
                           target="_blank" rel="noopener" title="Open in a new tab">View</a>
                        <a class="btn secondary small" href="/api/invoices/${inv.id}/pdf?download=1"
                           download="${esc(inv.number)}.pdf" title="Save the PDF to this device">⬇ PDF</a>
                    </div>`).join('') : (c.parent_id ? '' : '<div class="card muted">No invoices yet. They are created automatically after each month.</div>')}` : ''}`;
            document.getElementById('cd-edit').addEventListener('click', () => openContactDialog(c));
        } catch (err) {
            $view.innerHTML = `<div class="card">${esc(err.message)}</div>`;
        }
    }

    // One block per school, each billed over that school's own term dates
    function renderTermRun(data, year, termNo) {
        const $el = document.getElementById('inv-term');
        $el.className = '';
        const missing = data.no_school || [];
        let html = missing.length ? `<div class="warn-bar">⚠ <b>${missing.length}
            rider${missing.length === 1 ? '' : 's'}</b> on per-term billing have no school set,
            so there are no term dates to invoice them for:
            ${missing.map((r) => `<a href="#/contacts/${r.contact_id}">${esc(r.name)}</a>`).join(', ')}.</div>` : '';
        html += data.groups.map((g) => `
            <h3 style="margin:14px 0 4px">${esc(g.name)}
                <span class="muted" style="font-weight:400">${g.no_dates
                    ? '— Term ' + termNo + ' ' + schoolYearLabel(g, year) + ' dates not set'
                    : shortDate(g.period_start) + ' – ' + shortDate(g.period_end)}</span></h3>
            <div id="term-g-${g.id}">${g.no_dates
                ? `<p class="school-missing">Set this school's Term ${termNo} dates under Settings before invoicing.</p>`
                : ''}</div>`).join('');
        $el.innerHTML = html || '<p class="muted">No active schools.</p>';
        data.groups.filter((g) => !g.no_dates).forEach((g) => {
            renderOverviewTable(document.getElementById(`term-g-${g.id}`), g.rows,
                'Nobody at this school has uninvoiced lessons this term.',
                { from: g.period_start, to: g.period_end, mode: 'term',
                  label: `Term ${termNo} ${schoolYearLabel(g, year)}, plus any unbilled lessons from the month before it` });
        });
    }

    // Who is on this payer's invoice and which days they rode — compact enough
    // to sit under the name without turning the table into a wall.
    function riderSummaryHtml(row) {
        const riders = row.riders || [];
        if (!riders.length) return '';
        return `<div class="rider-summary">${riders.map((r) => `
            <span class="rs-rider"><b>${esc(r.name)}</b>
                <span class="rs-dates">${r.dates.map((d) => esc(shortDate(d))).join(', ')}</span>
            </span>`).join('')}</div>`;
    }

    // The same table used by the advance run and the needs-attention list
    function renderOverviewTable($el, rows, emptyText, range) {
        if (!$el) return;
        if (!rows.length) { $el.className = 'muted'; $el.innerHTML = esc(emptyText); return; }
        $el.className = '';
        $el.innerHTML = `<div class="table-wrap"><table class="plain">
            <tr><th>Contact</th><th>Pays</th><th class="num">Rides</th><th class="num">Total</th><th></th></tr>
            ${rows.map((row) => `
                <tr>
                    <td><a href="#/contacts/${row.contact_id}">${esc(row.name)}</a>
                        ${riderSummaryHtml(row)}</td>
                    <td>${row.payment_terms
                        ? `<span class="terms-chip terms-${row.payment_terms}">${PAYMENT_TERMS[row.payment_terms]}</span>`
                        : '<span class="no-parent">not set</span>'}</td>
                    <td class="num">${row.ride_count || (hasStanding(row) ? standingCell(row) : 0)}${row.carried_over
                        ? ` <span class="carried" title="${row.term_ahead} term lesson${row.term_ahead === 1 ? '' : 's'} ahead · ${row.carried_over} ridden last month and not yet billed">${row.term_ahead}+${row.carried_over}</span>` : ''}${row.untyped_rides
                        ? ` <span class="untyped-flag" title="${row.untyped_rides} of these rides have no ride type, so they add nothing to the total">⚠${row.untyped_rides}</span>` : ''}${row.older_unbilled
                        ? ` <span class="older-flag" title="No invoice created for ${missedMonths(row).join(', ')}. ${row.older_unbilled} unbilled lesson${row.older_unbilled === 1 ? '' : 's'} there (earliest ${fmtDay(row.older_from)}) — older than the one-month carry-over, so not on this invoice. Bill these with a custom date range.">⏳${row.older_unbilled}</span>` : ''}</td>
                    <td class="num">${row.ride_count || !hasStanding(row)
                        ? money(row.total_cents) : '<span class="muted">—</span>'}</td>
                    <td class="num">${!row.payment_terms
                        ? '<a class="btn secondary small" href="#/contacts/' + row.contact_id + '">Set terms</a>'
                        // A livery-only customer has no lessons but is still billable
                        : (row.ride_count || hasStanding(row))
                        ? `<button class="small" data-inv-contact="${row.contact_id}" data-inv-name="${esc(row.name)}"
                                   data-inv-missed="${esc(missedMonths(row).join('|'))}"
                                   ${row.first_date ? `data-inv-from="${row.first_date}"` : ''}
                                   ${row.last_date ? `data-inv-to="${row.last_date}"` : ''}>Create invoice</button>`
                        : '<span class="muted">nothing due</span>'}</td>
                </tr>`).join('')}
        </table></div>`;
        wireCreateInvoiceButtons($el, range);
    }

    // Shared by every uninvoiced-rides table on the page
    // A school whose academic year starts mid-year spans two calendar years, so
    // its year 2026 reads "2026/27". A January school's reads plainly "2026".
    function schoolYearLabel(school, y) {
        return (school.year_start_month || 1) > 1
            ? `${y}/${String((y + 1) % 100).padStart(2, '0')}` : String(y);
    }

    // "2026-08" -> "August 2026". Months whose invoice was never raised are
    // named in full: a parent asking "what is this charge" needs the month, and
    // "2026-08" is not how anyone says it out loud.
    const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                         'July', 'August', 'September', 'October', 'November', 'December'];
    // "2026-10" -> "2026-09". An arrears run bills the month before it.
    function prevMonthOf(ym) {
        const [y, m] = String(ym).split('-').map(Number);
        const d = new Date(Date.UTC(y, m - 2, 1));
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    }

    function monthLabel(ym) {
        const [y, m] = String(ym).split('-').map(Number);
        return `${MONTH_NAMES[m - 1]} ${y}`;
    }
    // Join a list the way a person would: "August", "August and September",
    // "August, September and October".
    function joinWords(list) {
        if (list.length <= 1) return list[0] || '';
        return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
    }
    // The months this payer has unbilled lessons in, outside the one-month
    // carry-back — i.e. months whose invoice was never created.
    // A row with no lessons that is on the list anyway: livery, or a standing
    // monthly charge. The amount is not previewed — it comes from their profile
    // and is worked out when the invoice is created.
    function hasStanding(row) {
        const c = contactById(row.contact_id) || {};
        return ((c.livery_horses || []).length > 0) || ((c.monthly_charges || []).length > 0);
    }

    // What a no-lesson row is actually for, named so the row explains itself
    // rather than reading as an empty R0.00 invoice.
    function standingLabel(row) {
        const c = contactById(row.contact_id) || {};
        const bits = [];
        if ((c.livery_horses || []).length) {
            bits.push(`livery for ${c.livery_horses.map((h) => h.name).join(', ')}`);
        }
        if ((c.monthly_charges || []).length) {
            bits.push(c.monthly_charges.map((m) => m.name).join(', '));
        }
        return `No lessons — billed for ${bits.join(' and ')}. The amount is worked out when the invoice is created.`;
    }

    const standingCell = (row) => `<span class="standing-tag" title="${esc(standingLabel(row))}">standing</span>`;

    function missedMonths(row) {
        return (row.older_months || []).map((m) => monthLabel(m.month));
    }

    function wireCreateInvoiceButtons($el, range) {
        $el.querySelectorAll('[data-inv-contact]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                // An invoice only reaches back one month. If this payer has
                // unbilled lessons further back, that month's invoice was never
                // raised and this one will not pick it up — say so by name
                // before the invoice is created, not after.
                const missed = (btn.getAttribute('data-inv-missed') || '').split('|').filter(Boolean);
                const warn = missed.length
                    ? ` ⚠ No invoice has been created for ${joinWords(missed)}. ` +
                      `Lessons already ridden in ${missed.length === 1 ? 'that month' : 'those months'} ` +
                      `will NOT be on this invoice — bill them separately with a custom date range.`
                    : '';
                if (!await askConfirm(`Invoice ${btn.getAttribute('data-inv-name')}?`,
                    `For ${range.label}.${range.note ? ' ⚠ ' + range.note : ''}${warn}`,
                    'Create the invoice')) return;
                btn.disabled = true;
                try {
                    const res = await api('POST', '/api/invoices', {
                        contact_id: btn.getAttribute('data-inv-contact'),
                        // A row's own dates win over the table's: the catch-up
                        // table spans every payer, and billing one of them for
                        // that whole span sweeps up other people's weeks.
                        from: btn.getAttribute('data-inv-from') || range.from,
                        to: btn.getAttribute('data-inv-to') || range.to,
                        mode: range.mode
                    });
                    // Update in place rather than re-rendering — a full redraw
                    // loses your place in a long list, badly so on a phone.
                    const row = btn.closest('tr');
                    if (row) row.remove();
                    addInvoiceToList(res.invoice);
                    openInvoiceCreatedDialog(res.invoice, res.riders || 1);
                } catch (err) {
                    btn.disabled = false;
                    toast(err.message, true);
                }
            });
        });
    }

    // Slot a newly created invoice into the created list without a page redraw
    function addInvoiceToList(inv) {
        const $list = document.getElementById('inv-list');
        if (!$list) return;
        if (!$list.querySelector('.list-item')) $list.innerHTML = '';
        $list.classList.remove('muted');
        $list.insertAdjacentHTML('afterbegin', invoiceRowHtml(inv));
        wireInvoiceRow($list.firstElementChild, inv);
    }

    // ---------- Invoices ----------
    // WhatsApp cannot be handed a file by a link — only text. So do the tedious
    // half automatically: fetch the PDF so it lands in Downloads, then open the
    // chat with the message already written. The user attaches and sends.
    // One created-invoice row. Extracted so a freshly created invoice can be
    // slipped into the list without re-rendering (and re-scrolling) the page.
    function invoiceRowHtml(inv) {
        return `<div class="list-item" data-inv-row="${inv.id}">
            <div class="li-main">
                <div class="li-title">${esc(inv.number)} — ${esc(inv.contact_name)}
                    ${inv.kind === 'advance' ? '<span class="chip" style="background:#e8e2f5;color:#5b4ab8">in advance</span>' : ''}</div>
                <div class="li-sub">${inv.rider_name && inv.rider_name !== inv.contact_name ? `for ${esc(inv.rider_name)} · ` : ''}${
                    esc(fmtDay(inv.period_start))} – ${esc(fmtDay(inv.period_end))} · ${
                    inv.line_count} ride${inv.line_count === 1 ? '' : 's'} · ${money(inv.total_cents)}</div>
            </div>
            <select class="inv-status" data-inv-id="${inv.id}" style="width:auto">
                ${['draft', 'sent', 'paid'].map((s) => `<option value="${s}" ${inv.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
            <a class="btn secondary small" href="/api/invoices/${inv.id}/pdf"
               target="_blank" rel="noopener" title="Open in a new tab">View</a>
            <a class="btn secondary small" href="/api/invoices/${inv.id}/pdf?download=1"
               download="${esc(inv.number)}.pdf" title="Save the PDF to this device">⬇ PDF</a>
            ${waNumber(inv.contact_phone)
                ? `<button class="secondary small" data-inv-wa="${inv.id}">💬 Send</button>`
                : '<span class="muted" style="font-size:12px" title="No phone number on this contact">no number</span>'}
            ${inv.status === 'draft'
                ? `<button class="danger small" data-inv-del="${inv.id}" data-inv-num="${esc(inv.number)}"
                           title="Delete this draft — its rides can then be invoiced again">✕</button>`
                : `<button class="danger small" disabled
                           title="Only drafts can be deleted; this one is marked ${esc(inv.status)}">✕</button>`}
        </div>`;
    }

    function wireInvoiceRow(el, inv) {
        if (!inv) return;
        const wa = el.querySelector('[data-inv-wa]');
        if (wa) wa.addEventListener('click', () => sendInvoiceOnWhatsApp(inv));
        const sel = el.querySelector('.inv-status');
        if (sel) sel.addEventListener('change', async () => {
            try {
                await api('PUT', `/api/invoices/${inv.id}`, { status: sel.value });
                inv.status = sel.value;
                toast('Status updated.');
                // only drafts may be deleted, so the ✕ has to follow the status
                const del = el.querySelector('[data-inv-del], [data-inv-del] , button.danger');
                if (del) del.disabled = sel.value !== 'draft';
            } catch (err) {
                toast(err.message, true);
            }
        });
        const del = el.querySelector('[data-inv-del]');
        if (del) del.addEventListener('click', async () => {
            if (!await askConfirm(`Delete invoice ${inv.number}?`,
                'Its rides go back to the to-invoice list and can be invoiced again.',
                'Delete the draft')) return;
            try {
                await api('DELETE', `/api/invoices/${inv.id}`);
                toast('Invoice deleted.');
                renderInvoices();
            } catch (err) {
                toast(err.message, true);
            }
        });
    }

    // Straight after creating one: offer to send it, let the status be set, done.
    function openInvoiceCreatedDialog(inv, riderCount) {
        const overlay = openSubDialog(`
            <h3 style="margin:0 0 4px">${esc(inv.number)} created</h3>
            <p class="muted" style="margin:0 0 12px">${esc(inv.contact_name)} ·
                ${inv.line_count} ride${inv.line_count === 1 ? '' : 's'}${
                riderCount > 1 ? ` for ${riderCount} riders` : ''} · <b>${money(inv.total_cents)}</b></p>
            <label>Status</label>
            <select id="ic-status">
                ${['draft', 'sent', 'paid'].map((s) => `<option value="${s}" ${inv.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
            <div class="form-actions" style="justify-content:flex-start;flex-wrap:wrap">
                ${waNumber(inv.contact_phone) ? '<button id="ic-send">💬 Send now</button>' : ''}
                <a class="btn secondary small" href="/api/invoices/${inv.id}/pdf?download=1"
                   download="${esc(inv.number)}.pdf">⬇ PDF</a>
                <span class="spacer"></span>
                <button class="secondary" id="ic-close">Close</button>
            </div>`);
        const statusSel = overlay.querySelector('#ic-status');
        statusSel.addEventListener('change', async () => {
            try {
                await api('PUT', `/api/invoices/${inv.id}`, { status: statusSel.value });
                inv.status = statusSel.value;
                // keep the row in the list in step
                const row = document.querySelector(`[data-inv-row="${inv.id}"] .inv-status`);
                if (row) row.value = statusSel.value;
                toast('Status updated.');
            } catch (err) { toast(err.message, true); }
        });
        const send = overlay.querySelector('#ic-send');
        if (send) send.addEventListener('click', () => sendInvoiceOnWhatsApp(inv));
        overlay.querySelector('#ic-close').addEventListener('click', () => overlay.remove());
    }

    // WhatsApp cannot be handed a file by a link — only text. So make the two
    // steps explicit rather than firing a download the user never sees.
    function sendInvoiceOnWhatsApp(inv) {
        const num = waNumber(inv.contact_phone);
        if (!num) return toast('That contact has no phone number.', true);
        const who = inv.rider_name && inv.rider_name !== inv.contact_name
            ? `${inv.rider_name}'s` : 'your';
        const period = inv.period_start
            ? ` for ${shortDate(inv.period_start)} – ${shortDate(inv.period_end)}` : '';
        const text = `Hi ${inv.contact_name.split(' ')[0]}, here is ${who} invoice ${inv.number}` +
            `${period}: ${money(inv.total_cents)}. Thank you! — ${state.settings.business_name || 'SVSH'}`;
        openWhatsAppSteps({
            title: `Send ${inv.number} to ${inv.contact_name}`,
            fileUrl: `/api/invoices/${inv.id}/pdf?download=1`,
            fileName: `${inv.number}.pdf`,
            number: num,
            text
        });
    }

    function openWhatsAppSteps(o) {
        const overlay = openSubDialog(`
            <h3 style="margin:0 0 4px">${esc(o.title)}</h3>
            <p class="muted" style="margin:0 0 12px">WhatsApp cannot receive a file from a link,
               so this is two steps: save the PDF, then attach it in the chat.</p>
            <ol class="wa-steps">
                <li><b>Save the PDF</b> to this device.
                    <div><a class="btn secondary small" id="wa-dl" href="${esc(o.fileUrl)}"
                            download="${esc(o.fileName)}">⬇ ${esc(o.fileName)}</a></div></li>
                <li><b>Open the chat</b> — the message is written for you.
                    <div><a class="btn small" id="wa-open" target="_blank" rel="noopener"
                            href="https://wa.me/${esc(o.number)}?text=${encodeURIComponent(o.text)}">💬 Open WhatsApp</a></div></li>
                <li>In WhatsApp, tap the <b>📎 attach</b> button and pick the file you just saved.</li>
            </ol>
            <div class="form-actions"><button class="secondary" id="wa-close">Close</button></div>`);
        overlay.querySelector('#wa-close').addEventListener('click', () => overlay.remove());
    }

    function currentMonth() { return todayStr().slice(0, 7); }

    function quarterBounds(offset) {
        const now = new Date();
        const q = Math.floor(now.getMonth() / 3) + offset;
        const start = new Date(now.getFullYear(), q * 3, 1);
        const end = new Date(now.getFullYear(), q * 3 + 3, 0);
        const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return [fmt(start), fmt(end)];
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
        const termYear = state.termYear || now.getFullYear();
        const termNo = state.termNo || Math.floor(now.getMonth() / 3) + 1;

        // Advance months are shown oldest first and flagged when still uninvoiced,
        // so a month already under way (August, mid-August) is not missed just
        // because the run defaults to "next month".
        let advStatus = [];
        let firstMonth = null;      // no rides before this, so no invoices either
        try {
            const st = await api('GET', '/api/invoices/advance-outstanding');
            advStatus = st.months;
            firstMonth = st.first_ride_date ? st.first_ride_date.slice(0, 7) : null;
        } catch (err) { /* the section still works, just without the flags */ }
        const inRange = (m) => !firstMonth || m >= firstMonth;
        // a remembered month from before the data starts would select nothing
        const shownMonths = monthPills.filter((m) => inRange(m.value));
        const arrearsMonth = shownMonths.some((m) => m.value === month)
            ? month : (shownMonths[0] ? shownMonths[0].value : month);
        state.invoiceMonth = arrearsMonth;
        // Monthly invoices are raised one month at a time, so a month that has
        // not arrived yet is not outstanding — it is simply not its turn. Only
        // this month and any that were missed count as still to do.
        const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const outstanding = advStatus.filter((m) => m.riders > 0 && m.month <= thisMonth);
        const adv = state.invoiceAdvMonth ||
            (outstanding.length ? outstanding[0].month : (() => {
                const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            })());
        const advPills = advStatus.filter((m) => inRange(m.month)).map((m) => {
            const d = new Date(Number(m.month.slice(0, 4)), Number(m.month.slice(5, 7)) - 1, 1);
            return {
                value: m.month,
                label: d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
                riders: m.riders
            };
        });
        $view.innerHTML = `
            <h1>🧾 Invoices</h1>
            <div id="inv-untyped-warn" class="warn-bar hidden"></div>
            <h2>In advance — per month</h2>
            <p class="muted">Riders whose payer is set to <b>In advance, per month</b>.
               Each invoice covers the <b>term lessons of the coming month</b> plus anything
               still unbilled from before it. Holiday lessons are not billed ahead —
               they appear on the following month's invoice once they have been ridden.</p>
            <div class="card">
                <div class="month-pills">
                    ${advPills.map((m) => `
                        <button class="month-pill adv-pill ${m.value === adv ? 'active' : ''}" data-adv="${m.value}">${esc(m.label)}${
                            m.riders ? ` <span class="pill-badge">${m.riders}</span>` : ' ✓'}</button>`).join('')}
                </div>
                ${outstanding.length > 1 ? `<p class="warn-inline" style="margin:10px 0 0">
                    ⚠ <b>${outstanding.length - 1} earlier month${outstanding.length > 2 ? 's were' : ' was'}</b>
                    never invoiced: ${outstanding.slice(0, -1).map((m) => esc(monthLabel(m.month))).join(', ')}.</p>` : ''}
                <div id="inv-advance" class="muted" style="margin-top:14px">Loading…</div>
            </div>
            <h2>In advance — per term</h2>
            <p class="muted">Riders whose payer is set to <b>In advance, per term</b>, billed for their
               <b>school's</b> term. Term dates are set per school under Settings.</p>
            <div class="card">
                <div class="month-pills">
                    ${[termYear - 1, termYear, termYear + 1].map((y) => `
                        <button class="month-pill ${y === termYear ? 'active' : ''}" data-ty="${y}">${y}</button>`).join('')}
                </div>
                <div class="month-pills" style="margin-top:8px">
                    ${[1, 2, 3, 4].map((n) => `
                        <button class="month-pill ${n === termNo ? 'active' : ''}" data-tn="${n}">Term ${n}</button>`).join('')}
                </div>
                <div id="inv-term" class="muted" style="margin-top:14px">Loading…</div>
            </div>
            <h2>In arrears — monthly</h2>
            <p class="muted">Riders whose payer is set to <b>In arrears</b>, billed once the month has
               ended — so the run for a month covers the <b>month before it</b>.
               Reconcile them with the bank statement and set the status to <b>paid</b>.</p>
            <div class="card">
                <div class="month-pills">
                    ${shownMonths.map((m) => `
                        <button class="month-pill ${m.value === arrearsMonth ? 'active' : ''}" data-month="${m.value}">${esc(m.label)}</button>`).join('')}
                </div>
                <h2 style="margin-top:14px" id="inv-arrears-head">Uninvoiced rides</h2>
                <div id="inv-arrears-warn" class="warn-bar hidden"></div>
                <div id="inv-overview" class="muted">Loading…</div>
            </div>
            <h2>Cash after lesson</h2>
            <p class="muted">Billed once the lesson has happened, so the rider can pay on the day.
               Not tied to a month — everything ridden and not yet invoiced stays here,
               whichever month it falls in.</p>
            <div class="card">
                <div id="inv-cash" class="muted">Loading…</div>
            </div>
            <div class="card hidden" id="inv-unset-card">
                <h2 style="margin-top:0">⚠ Payment terms not set</h2>
                <p class="muted">These riders have uninvoiced rides but nobody has said how they pay,
                   so they appear in neither run above.</p>
                <div id="inv-unset"></div>
            </div>
            <h2>Created invoices</h2>
            <div id="inv-list" class="muted">Loading…</div>`;
        document.querySelectorAll('[data-ty]').forEach((b) => b.addEventListener('click', () => {
            state.termYear = Number(b.getAttribute('data-ty'));
            renderInvoices();
        }));
        document.querySelectorAll('[data-tn]').forEach((b) => b.addEventListener('click', () => {
            state.termNo = Number(b.getAttribute('data-tn'));
            renderInvoices();
        }));
        document.querySelectorAll('.month-pill[data-month]').forEach((btn) => {
            btn.addEventListener('click', () => {
                state.invoiceMonth = btn.getAttribute('data-month');
                renderInvoices();
            });
        });
        document.querySelectorAll('.adv-pill').forEach((btn) => {
            btn.addEventListener('click', () => {
                state.invoiceAdvMonth = btn.getAttribute('data-adv');
                renderInvoices();
            });
        });
        try {
            const [ov, advOv, termOv, cashOv, invs] = await Promise.all([
                api('GET', `/api/invoices/overview?month=${prevMonthOf(arrearsMonth)}`),
                api('GET', `/api/invoices/advance-overview?month=${adv}`),
                api('GET', `/api/invoices/term-overview?year=${termYear}&term=${termNo}`),
                api('GET', '/api/invoices/cash-overview'),
                api('GET', '/api/invoices')
            ]);
            renderTermRun(termOv, termYear, termNo);
            // Everyone lands in exactly one bucket, decided by their payer's terms
            // A ride with no type prices at zero, which would be invoiced silently
            const untyped = [...ov.overview, ...advOv.overview]
                .reduce((n, r) => n + (r.untyped_rides || 0), 0);
            const $warn = document.getElementById('inv-untyped-warn');
            $warn.classList.toggle('hidden', !untyped);
            if (untyped) {
                const who = new Set([...ov.overview, ...advOv.overview]
                    .filter((r) => r.untyped_rides).map((r) => r.name));
                $warn.innerHTML = `⚠ <b>${untyped} ride${untyped === 1 ? '' : 's'}</b> in these periods
                    have no ride type, so they carry no price and would be invoiced at
                    ${money(0)}. Affects ${who.size} rider${who.size === 1 ? '' : 's'}.
                    Set the type on the ride (choose <b>“this day and the whole series”</b> for a
                    weekly slot) before creating these invoices.`;
            }
            const advRange = { from: advOv.from, to: advOv.to, label: adv, mode: 'advance_month' };
            // ov already covers the month BEFORE the pill, so the range is right
            const arrRange = { from: ov.from, to: ov.to,
                               label: monthLabel(prevMonthOf(arrearsMonth)) };
            // the endpoint already applies the month-ahead rule and the filter
            renderOverviewTable(document.getElementById('inv-advance'), advOv.overview,
                'Nothing to bill in advance for this month.', advRange);
            const arrears = ov.overview.filter((r) => r.payment_terms === 'arrears');
            // The month being billed has always ended, so there is nothing to
            // warn about; the heading says which month the lessons are from.
            const $aw = document.getElementById('inv-arrears-warn');
            $aw.classList.add('hidden');
            document.getElementById('inv-arrears-head').textContent =
                `Uninvoiced rides from ${monthLabel(prevMonthOf(arrearsMonth))}`;
            const unset = ov.overview.filter((r) => !r.payment_terms);
            renderOverviewTable(document.getElementById('inv-unset'), unset, '', arrRange);
            document.getElementById('inv-unset-card').classList.toggle('hidden', !unset.length);
            // Cash lessons accumulate regardless of month, so this list comes
            // from its own query rather than a slice of the chosen month. Each
            // row carries its own first/last date, so the invoice covers exactly
            // that payer's outstanding lessons.
            renderOverviewTable(document.getElementById('inv-cash'), cashOv.cash,
                'No lessons to settle in cash yet.',
                { from: todayStr(), to: todayStr(), mode: 'cash',
                  label: 'lessons settled in cash, with anything else outstanding' });

            const $ov = document.getElementById('inv-overview');
            if (!arrears.length) {
                $ov.innerHTML = 'No uninvoiced rides in this month.';
            } else {
                $ov.classList.remove('muted');
                $ov.innerHTML = `<div class="table-wrap"><table class="plain">
                    <tr><th>Contact</th><th>Pays</th><th class="num">Rides</th><th class="num">Total</th><th></th></tr>
                    ${arrears.map((row) => `
                        <tr>
                            <td><a href="#/contacts/${row.contact_id}">${esc(row.name)}</a>
                                ${riderSummaryHtml(row)}</td>
                            <td>${row.payment_terms
                                ? `<span class="terms-chip terms-${row.payment_terms}">${PAYMENT_TERMS[row.payment_terms]}</span>`
                                : '<span class="no-parent">not set</span>'}</td>
                            <td class="num">${row.ride_count || (hasStanding(row) ? standingCell(row) : 0)}${row.untyped_rides
                                ? ` <span class="untyped-flag" title="${row.untyped_rides} of these rides have no ride type, so they add nothing to the total">⚠${row.untyped_rides}</span>` : ''}</td>
                            <td class="num">${row.ride_count || !hasStanding(row)
                                ? money(row.total_cents) : '<span class="muted">—</span>'}</td>
                            <td class="num"><button class="small" data-inv-contact="${row.contact_id}" data-inv-name="${esc(row.name)}">Create invoice</button></td>
                        </tr>`).join('')}
                </table></div>`;
                wireCreateInvoiceButtons($ov, arrRange);
            }
            const $list = document.getElementById('inv-list');
            if (!invs.invoices.length) {
                $list.innerHTML = '<div class="card muted">No invoices yet.</div>';
            } else {
                $list.classList.remove('muted');
                $list.innerHTML = invs.invoices.map(invoiceRowHtml).join('');
                $list.querySelectorAll('.list-item[data-inv-row]').forEach((el) =>
                    wireInvoiceRow(el, invs.invoices.find((i) => String(i.id) === el.getAttribute('data-inv-row'))));
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
            if (!await askConfirm('Delete this to-do?', '', 'Delete')) return;
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
            if (!await askConfirm('Make a new calendar link?',
                'Any device already subscribed stops updating.', 'Make a new link')) return;
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
                <button class="page-tab ${tab === 'lesson' ? 'active' : ''}" data-rep-tab="lesson">📋 One lesson type</button>
                <button class="page-tab ${tab === 'arena' ? 'active' : ''}" data-rep-tab="arena">🏟️ Arena fees</button>
            </div>
            <div class="card">
                <div class="form-row">
                    <div><label>From</label><input type="date" id="rep-from" value="${from}"></div>
                    <div><label>To</label><input type="date" id="rep-to" value="${to}"></div>
                </div>
                ${tab === 'lesson' ? `<label>Lesson type</label>
                    <select id="rep-type">${rideTypeOptions(state.reportTypeId)}</select>` : ''}
                <div class="form-actions" style="justify-content:flex-start">
                    <button class="secondary small" id="rep-this">This month</button>
                    <button class="secondary small" id="rep-last">Last month</button>
                    <span class="spacer"></span>
                    <button class="secondary small" id="rep-pdf" title="Open this report as a PDF">⬇ PDF</button>
                    <button class="small" id="rep-go">Show</button>
                </div>
            </div>
            <div id="rep-result" class="muted">Loading…</div>
            <p class="muted">${
                tab === 'horses' ? "Counts booked riders plus horses ridden by a guide. Open seats and blocked horses don't count; guide rides earn no income."
                : tab === 'types' ? 'Tap a ride type to break it down by date, then tap a date to see and edit the rides themselves. Blocks are excluded.'
                : tab === 'lesson' ? 'Every lesson of one type in the period, grouped by rider, with what each of them came to.'
                : 'Who pays arena fees and what that comes to, so the arena can be paid.'}</p>`;
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
        const typeSel = document.getElementById('rep-type');
        if (typeSel) typeSel.addEventListener('change', () => {
            state.reportTypeId = typeSel.value;
            renderReports();
        });
        // Every report prints through the same route, so this button needs to
        // know nothing about which one is on screen.
        document.getElementById('rep-pdf').addEventListener('click', () => {
            if (tab === 'lesson' && !state.reportTypeId) {
                return toast('Pick a lesson type first.', true);
            }
            window.open(reportUrl(tab, from, to) + '/pdf?' + reportParams(tab, from, to), '_blank');
        });

        if (tab === 'lesson' || tab === 'arena') return renderDocReport(tab, from, to);
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

    // The report engine names each report once; the page just points at it.
    const REPORT_NAMES = { horses: 'horse-usage', types: 'ride-types',
                           lesson: 'lesson-type', arena: 'arena-fees' };
    const reportUrl = (tab) => `/api/reports/${REPORT_NAMES[tab]}`;
    const reportParams = (tab, from, to) => `from=${from}&to=${to}`
        + (tab === 'lesson' ? `&ride_type_id=${state.reportTypeId || ''}` : '');

    // Any report the server can build, drawn as a table. The same document
    // feeds the PDF, so what is on screen is what prints.
    async function renderDocReport(tab, from, to) {
        const $res = document.getElementById('rep-result');
        if (tab === 'lesson' && !state.reportTypeId) {
            $res.classList.remove('muted');
            $res.innerHTML = '<div class="card">Pick a lesson type above.</div>';
            return;
        }
        let doc;
        try {
            doc = await api('GET', `${reportUrl(tab)}/data?${reportParams(tab, from, to)}`);
        } catch (err) { $res.textContent = err.message; return; }
        $res.classList.remove('muted');
        const cell = (c, r) => {
            const v = r[c.key];
            return v === undefined || v === null || v === '' ? ''
                : (c.money ? money(v) : esc(String(v)));
        };
        const line = (r, cls) => `<tr${cls ? ` class="${cls}"` : ''}>${doc.columns.map((c) =>
            `<td${c.align === 'right' ? ' class="num"' : ''}>${cell(c, r)}</td>`).join('')}</tr>`;
        const body = (doc.groups && doc.groups.length)
            ? doc.groups.map((g) => `
                <tr class="rep-group"><td colspan="${doc.columns.length}">${esc(g.heading)}</td></tr>
                ${(g.rows || []).map((r) => line(r)).join('')}
                ${g.totals ? line(g.totals, 'rep-subtotal') : ''}`).join('')
            : (doc.rows || []).map((r) => line(r)).join('');
        $res.innerHTML = (doc.rows && !doc.rows.length) || (doc.groups && !doc.groups.length)
            ? '<div class="card">Nothing to report for this period.</div>'
            : `<div class="card">
                 <table class="rep-table">
                   <thead><tr>${doc.columns.map((c) =>
                       `<th${c.align === 'right' ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead>
                   <tbody>${body}</tbody>
                   ${doc.totals ? `<tfoot>${line(doc.totals, 'rep-total')}</tfoot>` : ''}
                 </table>
                 ${doc.note ? `<div class="muted" style="margin-top:8px">${esc(doc.note)}</div>` : ''}
               </div>`;
    }

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
    // One row per livery cost: rename, re-price, or remove. Prices are per month
    // in full, except on a quarter share where they are split 50/50.
    function renderLiveryExtras() {
        const el = document.getElementById('livery-extras');
        if (!el) return;
        const list = state.liveryExtras || [];
        if (!list.length) { el.innerHTML = '<div class="muted">None yet.</div>'; return; }
        el.innerHTML = list.map((e) => `
            <div class="pick-row" data-livery-extra="${e.id}">
                <input class="lx-name" value="${esc(e.name)}" style="flex:1 1 auto;min-width:0">
                <input class="lx-price" type="number" inputmode="decimal" step="0.01" min="0"
                       style="flex:0 0 100px" value="${(Number(e.price_cents) / 100).toFixed(2)}">
                <button type="button" class="danger small lx-del">${ICON_X}</button>
            </div>`).join('');
        el.querySelectorAll('[data-livery-extra]').forEach((row) => {
            const id = row.getAttribute('data-livery-extra');
            const save = async () => {
                try {
                    await api('PUT', `/api/livery-extras/${id}`, {
                        name: row.querySelector('.lx-name').value,
                        price_cents: parseMoneyCents(row.querySelector('.lx-price').value) || 0
                    });
                    state.liveryExtras = (await api('GET', '/api/livery-extras')).extras;
                    toast('Saved.');
                } catch (e) { toast(e.message, true); }
            };
            row.querySelector('.lx-name').addEventListener('change', save);
            row.querySelector('.lx-price').addEventListener('change', save);
            row.querySelector('.lx-del').addEventListener('click', async () => {
                if (!await askConfirm(`Remove "${row.querySelector('.lx-name').value}"?`,
                    'It is unticked for every customer. Invoices already raised keep their lines.',
                    'Remove')) return;
                try {
                    await api('DELETE', `/api/livery-extras/${id}`);
                    state.liveryExtras = (await api('GET', '/api/livery-extras')).extras;
                    renderLiveryExtras();
                } catch (e) { toast(e.message, true); }
            });
        });
    }

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

            <h2>Schools &amp; term dates</h2>
            <p class="muted">Per-term invoices bill each rider for their own school's term,
               so the dates are kept per school.</p>
            <div id="set-schools"></div>
            <button class="secondary small" id="school-add">＋ Add school</button>

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
                <div class="form-row">
                    <div>
                        <label>Contact number (on invoices)</label>
                        ${phoneFieldHtml('biz-phone', state.settings.business_phone || '')}
                    </div>
                    <div>
                        <label>Contact email (on invoices)</label>
                        <input id="biz-email" type="email" value="${esc(state.settings.business_email || '')}">
                    </div>
                </div>
                <label>Banking details (shown on every invoice, under the rides)</label>
                <textarea id="biz-bank" rows="5"
                    placeholder="Bank: FNB&#10;Account name: Sweet Valley School of Horsemanship&#10;Account no: 1234567890&#10;Branch code: 250655&#10;Reference: the invoice number">${esc(state.settings.bank_details || '')}</textarea>
                <label>Invoice footer text</label>
                <textarea id="biz-footer" rows="3">${esc(state.settings.invoice_footer || '')}</textarea>
                <div class="form-actions"><button id="biz-save">Save</button></div>
            </div>` : ''}

            ${admin ? `
            <h2>Livery &amp; arena fees</h2>
            <div class="card">
                <label>Arena fee per quarter (${esc(state.settings.currency || 'R')})</label>
                <input id="biz-arena" type="number" inputmode="decimal" step="0.01" min="0"
                       placeholder="leave blank for none"
                       value="${state.settings.arena_fee_cents ? (Number(state.settings.arena_fee_cents) / 100).toFixed(2) : ''}">
                <div class="muted" style="margin:-4px 0 10px">Added once a quarter, on the invoice
                   covering January, April, July or October, for riders marked as paying it.</div>
                <label>Arena fee explanation (printed on invoices that include the fee)</label>
                <textarea id="biz-arena-note" rows="3"
                    placeholder="e.g. The arena fee is charged once a quarter and covers the upkeep of the arena, jumps and footing. It is not a lesson fee and is payable by all riders using the arena.">${esc(state.settings.arena_fee_note || '')}</textarea>
                <label>Livery per month (${esc(state.settings.currency || 'R')})</label>
                <input id="biz-livery" type="number" inputmode="decimal" step="0.01" min="0"
                       placeholder="leave blank for none"
                       value="${state.settings.livery_price_cents ? (Number(state.settings.livery_price_cents) / 100).toFixed(2) : ''}">
                <div class="muted" style="margin:-4px 0 10px">Charged monthly per livery horse,
                   scaled to its full, half or quarter share.</div>
                <label>Standard monthly livery charges</label>
                <div class="muted" style="margin:-4px 0 6px">Bedding, feed and the like. Every
                   livery horse is charged all of these in full — except a quarter share, which
                   splits them 50/50. Charges for one customer only go on their own profile.</div>
                <div id="livery-extras"></div>
                <button type="button" class="secondary small" id="livery-extra-add">＋ Add a livery cost</button>
                <label style="margin-top:10px">Livery explanation (printed on invoices that include livery)</label>
                <textarea id="biz-livery-note" rows="2"
                    placeholder="e.g. Livery is charged monthly in advance and covers stabling, turnout and daily care.">${esc(state.settings.livery_note || '')}</textarea>
                <div class="form-actions"><button id="fees-save">Save</button></div>
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

        // Four years ahead, never behind: term dates are entered as schools
        // publish them, and a year that has passed is only clutter. The window
        // rolls forward on its own, so 2030 appears once 2027 arrives.
        const SCHOOL_YEAR_FROM = Math.max(2026, new Date().getFullYear());
        const schoolYears = [0, 1, 2, 3].map((i) => SCHOOL_YEAR_FROM + i);
        const schoolYear = () => {
            const y = state.schoolYear;
            return schoolYears.includes(y) ? y : SCHOOL_YEAR_FROM;
        };
        const drawSchools = () => {
            const y = schoolYear();
            document.getElementById('set-schools').innerHTML = `
                <div class="month-pills" style="margin-bottom:10px">
                    ${schoolYears.map((yy) => `
                        <button class="month-pill ${yy === y ? 'active' : ''}" data-sy="${yy}">${yy}</button>`).join('')}
                </div>
                ${state.schools.map((s) => {
                    const byNo = {};
                    (s.terms || []).filter((t) => t.year === y).forEach((t) => { byNo[t.term_no] = t; });
                    // One compact row per term: 4 rows of two small date inputs,
                    // not a full table each.
                    return `<div class="school-row${s.active ? '' : ' inactive'}">
                        <div class="school-head">
                            <input class="sc-name" data-school="${s.id}" value="${esc(s.name)}">
                            <select class="sc-ysm" data-school="${s.id}"
                                    title="When this school's academic year starts. AISCT runs August to July, so its Terms 1–4 span two calendar years.">
                                <option value="1"${(s.year_start_month || 1) === 1 ? ' selected' : ''}>Jan–Dec</option>
                                <option value="8"${(s.year_start_month || 1) === 8 ? ' selected' : ''}>Aug–Jul</option>
                            </select>
                            <span class="muted school-count">${s.rider_count}</span>
                            <button class="secondary small sc-toggle" data-school="${s.id}"
                                    data-active="${s.active}" title="${s.active ? 'Active' : 'Inactive'}">${s.active ? '✓' : '–'}</button>
                            <button class="danger small sc-del" data-school="${s.id}" data-name="${esc(s.name)}">${ICON_X}</button>
                        </div>
                        <div class="term-year muted">Academic year ${schoolYearLabel(s, y)}</div>
                        <div class="term-grid">
                            ${[1, 2, 3, 4].map((n) => `
                                <span class="term-cell${byNo[n] ? ' set' : ''}">
                                    <b>T${n}</b>
                                    <input type="date" class="st-from" data-school="${s.id}" data-term="${n}"
                                           title="Term ${n} start" value="${byNo[n] ? byNo[n].period_start : ''}">
                                    <input type="date" class="st-to" data-school="${s.id}" data-term="${n}"
                                           title="Term ${n} end" value="${byNo[n] ? byNo[n].period_end : ''}">
                                </span>`).join('')}
                        </div>
                    </div>`;
                }).join('') || '<div class="card muted">No schools yet.</div>'}`;

            document.querySelectorAll('[data-sy]').forEach((b) => b.addEventListener('click', () => {
                state.schoolYear = Number(b.getAttribute('data-sy'));
                drawSchools();
            }));
            const reloadSchools = async () => {
                state.schools = (await api('GET', '/api/schools')).schools;
                drawSchools();
            };
            document.querySelectorAll('.sc-name').forEach((inp) => inp.addEventListener('change', async () => {
                try {
                    await api('PUT', `/api/schools/${inp.getAttribute('data-school')}`, { name: inp.value });
                    await reloadSchools();
                    toast('School renamed.');
                } catch (e) { toast(e.message, true); }
            }));
            // Changing the academic year re-files which year a term belongs to, so
            // the terms already captured are worth a second look afterwards.
            document.querySelectorAll('.sc-ysm').forEach((sel) => sel.addEventListener('change', async () => {
                const hasTerms = (state.schools.find((s) => String(s.id) === sel.getAttribute('data-school'))
                                 || {}).terms || [];
                if (hasTerms.length && !await askConfirm('Change the academic year?',
                    `This school has ${hasTerms.length} term date${hasTerms.length === 1 ? '' : 's'} saved. ` +
                    'Changing this does not move them — check they are still filed under the right year.',
                    'Change it')) { renderSettings(); return; }
                try {
                    await api('PUT', `/api/schools/${sel.getAttribute('data-school')}`,
                        { year_start_month: Number(sel.value) });
                    await reloadSchools();
                    toast('Academic year updated.');
                } catch (e) { toast(e.message, true); }
            }));
            document.querySelectorAll('.sc-toggle').forEach((btn) => btn.addEventListener('click', async () => {
                try {
                    await api('PUT', `/api/schools/${btn.getAttribute('data-school')}`,
                        { active: btn.getAttribute('data-active') !== 'true' });
                    await reloadSchools();
                } catch (e) { toast(e.message, true); }
            }));
            renderLiveryExtras();
            document.getElementById('livery-extra-add').addEventListener('click', () => {
                const overlay = openSubDialog(`
                    <h3 style="margin:0 0 10px">New livery cost</h3>
                    <label>Name</label>
                    <input id="nl-name" autocomplete="off" placeholder="e.g. Bedding">
                    <label>Price per month (${esc(state.settings.currency || 'R')})</label>
                    <input id="nl-price" type="number" inputmode="decimal" step="0.01" min="0" value="0.00">
                    <div class="form-error"></div>
                    <div class="form-actions">
                        <button class="secondary" id="nl-cancel">Cancel</button>
                        <button id="nl-save">Add</button>
                    </div>`);
                overlay.querySelector('#nl-cancel').addEventListener('click', () => overlay.remove());
                overlay.querySelector('#nl-save').addEventListener('click', async () => {
                    const v = overlay.querySelector('#nl-name').value.trim();
                    if (!v) { overlay.querySelector('.form-error').textContent = 'A name is required.'; return; }
                    try {
                        await api('POST', '/api/livery-extras', {
                            name: v,
                            price_cents: parseMoneyCents(overlay.querySelector('#nl-price').value) || 0
                        });
                        state.liveryExtras = (await api('GET', '/api/livery-extras')).extras;
                        overlay.remove();
                        renderLiveryExtras();
                    } catch (e) { overlay.querySelector('.form-error').textContent = e.message; }
                });
                overlay.querySelector('#nl-name').focus();
            });
            document.querySelectorAll('.sc-del').forEach((btn) => btn.addEventListener('click', async () => {
                if (!await askConfirm(`Delete ${btn.getAttribute('data-name')}?`,
                    'Only possible if no rider is at this school.', 'Delete')) return;
                try {
                    await api('DELETE', `/api/schools/${btn.getAttribute('data-school')}`);
                    await reloadSchools();
                    toast('School deleted.');
                } catch (e) { toast(e.message, true); }
            }));
            // saving one date saves the pair, so both inputs share a handler
            const saveTerm = async (sid, n) => {
                const from = document.querySelector(`.st-from[data-school="${sid}"][data-term="${n}"]`).value;
                const to = document.querySelector(`.st-to[data-school="${sid}"][data-term="${n}"]`).value;
                if ((from && !to) || (!from && to)) return;   // wait for the pair
                try {
                    await api('PUT', `/api/schools/${sid}/terms/${schoolYear()}/${n}`,
                        { period_start: from, period_end: to });
                    await reloadSchools();
                    toast(from ? `Term ${n} saved.` : `Term ${n} cleared.`);
                } catch (e) { toast(e.message, true); }
            };
            document.querySelectorAll('.st-from, .st-to').forEach((inp) => inp.addEventListener('change', () =>
                saveTerm(inp.getAttribute('data-school'), inp.getAttribute('data-term'))));
        };

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
                        <div class="li-sub">${g.rate_cents != null
                            ? money(g.rate_cents) + ' per lesson'
                            : '<span class="no-parent">pay per lesson not set</span>'}</div>
                    </div>
                </div>`).join('') || '<div class="card muted">No instructors yet.</div>';
            document.querySelectorAll('[data-guide-id]').forEach((el) => {
                el.addEventListener('click', () => {
                    const guide = state.guides.find((g) => String(g.id) === el.getAttribute('data-guide-id'));
                    openGuideDialog(guide);
                });
            });
        };
        drawSchools();
        document.getElementById('school-add').addEventListener('click', async () => {
            const overlay = openSubDialog(`
                <h3 style="margin:0 0 10px">New school</h3>
                <label>Name</label>
                <input id="ns-name" autocomplete="off">
                <div class="form-error"></div>
                <div class="form-actions">
                    <button class="secondary" id="ns-cancel">Cancel</button>
                    <button id="ns-save">Add school</button>
                </div>`);
            overlay.querySelector('#ns-cancel').addEventListener('click', () => overlay.remove());
            overlay.querySelector('#ns-save').addEventListener('click', async () => {
                const v = overlay.querySelector('#ns-name').value.trim();
                if (!v) { overlay.querySelector('.form-error').textContent = 'A name is required.'; return; }
                try {
                    await api('POST', '/api/schools', { name: v });
                    state.schools = (await api('GET', '/api/schools')).schools;
                    overlay.remove();
                    drawSchools();
                    toast('School added.');
                } catch (e) { overlay.querySelector('.form-error').textContent = e.message; }
            });
            overlay.querySelector('#ns-name').focus();
        });
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
            if (!await askConfirm('Make a new schedule link?',
                'The old one stops working immediately and every instructor needs the new one.',
                'Make a new link')) return;
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
            // the cache holds contact details; it must not outlive the session
            if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ type: 'clear-data' });
            }
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
            // Each card saves its own fields, so the Save button next to a
            // section does what it looks like it does.
            const saveSettings = async (body) => {
                try {
                    await api('PUT', '/api/settings', body);
                    Object.assign(state.settings, body);
                    toast('Saved.');
                } catch (err) {
                    toast(err.message, true);
                }
            };
            document.getElementById('biz-save').addEventListener('click', () => saveSettings({
                business_name: document.getElementById('biz-name').value,
                business_address: document.getElementById('biz-address').value,
                currency: document.getElementById('biz-currency').value,
                invoice_footer: document.getElementById('biz-footer').value,
                bank_details: document.getElementById('biz-bank').value,
                business_phone: readPhoneField('biz-phone'),
                business_email: document.getElementById('biz-email').value,
                day_start: document.getElementById('biz-daystart').value,
                day_end: document.getElementById('biz-dayend').value
            }));
            document.getElementById('fees-save').addEventListener('click', () => saveSettings({
                arena_fee_cents: String(parseMoneyCents(document.getElementById('biz-arena').value) || ''),
                arena_fee_note: document.getElementById('biz-arena-note').value,
                livery_price_cents: String(parseMoneyCents(document.getElementById('biz-livery').value) || ''),
                livery_note: document.getElementById('biz-livery-note').value
            }));
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
                    <select id="h-active"><option value="true" ${horse.active ? 'selected' : ''}>Yes</option><option value="false" ${horse.active ? '' : 'selected'}>Retired</option></select>
                </div>` : ''}
            </div>
            <label>Owned by (for contacts riding their own horse)</label>
            <select id="h-owner">${contactOptions(horse ? horse.owner_contact_id : null, '(school horse)')}</select>
            <!-- Only meaningful for an owned horse: a school horse is already
                 available to everyone. -->
            <label class="role-check" id="h-shared-wrap" style="margin:6px 0 10px">
                <input type="checkbox" id="h-shared" ${horse && horse.shared_with_school ? 'checked' : ''}>
                Shared with the school
            </label>
            <div class="muted" id="h-shared-note" style="margin:-6px 0 10px"></div>
            <label>Notes</label>
            <textarea id="h-notes" style="min-height:110px">${esc(horse ? horse.notes || '' : '')}</textarea>
            <div class="form-error"></div>
            <div class="form-actions">
                <button class="secondary" id="h-cancel">Cancel</button>
                <button id="h-save">Save</button>
            </div>`);
        document.getElementById('h-cancel').addEventListener('click', closeDialog);
        const ownerSel = document.getElementById('h-owner');
        const syncShared = () => {
            const owned = !!ownerSel.value;
            document.getElementById('h-shared-wrap').classList.toggle('hidden', !owned);
            document.getElementById('h-shared-note').textContent = !owned
                ? 'A school horse — available for anyone\u2019s lessons.'
                : document.getElementById('h-shared').checked
                ? 'Available for anyone\u2019s lessons, like a school horse.'
                : 'Only offered when planning a ride for the owner or someone they pay for.';
        };
        ownerSel.addEventListener('change', syncShared);
        document.getElementById('h-shared').addEventListener('change', syncShared);
        syncShared();
        document.getElementById('h-save').addEventListener('click', async () => {
            const body = {
                name: document.getElementById('h-name').value,
                color: document.getElementById('h-color').value,
                owner_contact_id: document.getElementById('h-owner').value || null,
                shared_with_school: document.getElementById('h-shared').checked,
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

    // First and last day of a YYYY-MM
    function monthBoundsOf(month) {
        const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
        const last = new Date(y, m, 0).getDate();
        return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
    }

    // Same pattern as an invoice: download the statement, open the chat
    function sendStatementOnWhatsApp(guide, from, to, count, totalCents) {
        const num = waNumber(guide.phone);
        if (!num) return toast('That instructor has no phone number.', true);
        const text = `Hi ${guide.name.split(' ')[0]}, here are your ${count} lesson` +
            `${count === 1 ? '' : 's'} for ${shortDate(from)} – ${shortDate(to)}: ${money(totalCents)}. ` +
            `— ${state.settings.business_name || 'SVSH'}`;
        openWhatsAppSteps({
            title: `Send ${guide.name}'s lessons`,
            fileUrl: `/api/guides/${guide.id}/statement.pdf?from=${from}&to=${to}&download=1`,
            fileName: `lessons-${guide.name.replace(/[^a-zA-Z0-9]+/g, '-')}-${from}.pdf`,
            number: num,
            text
        });
    }

    // "650" or "650.50" -> whole cents; blank -> null (not set)
    function parseMoneyCents(value) {
        const s = String(value == null ? '' : value).trim();
        if (!s) return null;
        const n = Number(s);
        if (!Number.isFinite(n) || n < 0) return null;
        return Math.round(n * 100);
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
            <label>Pay per lesson (${esc(state.settings.currency || 'R')})</label>
            <input id="g-rate" type="number" inputmode="decimal" step="0.01" min="0"
                   placeholder="not set"
                   value="${guide && guide.rate_cents != null ? (guide.rate_cents / 100).toFixed(2) : ''}">
            <label>Notes</label>
            <input id="g-notes" value="${esc(guide ? guide.notes || '' : '')}">
            <label>Colour (dot on the calendar)</label>
            <input type="color" id="g-color" value="${esc(guide ? guide.color || '#6a6a66' : '#6a6a66')}" style="height:44px;padding:4px">
            ${guide ? `<label>Active</label>
            <select id="g-active"><option value="true" ${guide.active ? 'selected' : ''}>Yes</option><option value="false" ${guide.active ? '' : 'selected'}>No</option></select>` : ''}
            ${guide ? `
            <label style="margin-top:14px">Lessons and pay</label>
            <div class="month-pills" id="g-months">
                ${[0, -1, -2].map((off) => {
                    const d = new Date(new Date().getFullYear(), new Date().getMonth() + off, 1);
                    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    return `<button type="button" class="month-pill ${off === 0 ? 'active' : ''}" data-gm="${v}">${
                        d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</button>`;
                }).join('')}
            </div>
            <div id="g-lessons" class="muted" style="margin-top:8px">Loading…</div>` : ''}
            <div class="form-error"></div>
            <div class="form-actions">
                <button class="secondary" id="g-cancel">Cancel</button>
                <button id="g-save">Save</button>
            </div>`);
        wireNewTypeTabs();
        if (guide) {
            const loadLessons = async (month) => {
                const $l = document.getElementById('g-lessons');
                const [from, to] = monthBoundsOf(month);
                $l.className = 'muted';
                $l.textContent = 'Loading…';
                try {
                    const { rides } = await api('GET', `/api/guides/${guide.id}/rides?from=${from}&to=${to}`);
                    // read the rate from the form, so an unsaved change previews too
                    const rate = parseMoneyCents(document.getElementById('g-rate').value) || 0;
                    $l.className = '';
                    $l.innerHTML = rides.length ? `<div class="table-wrap"><table class="plain">
                        <tr><th>Date</th><th>Lesson</th><th class="num">Pay</th></tr>
                        ${rides.map((r) => `<tr>
                            <td>${esc(shortDate(r.date))} <span class="muted">${esc(r.start_time.slice(0, 5))}</span></td>
                            <td>${esc(r.ride_type_name || 'Lesson')}
                                <span class="muted">${r.rider_count} rider${r.rider_count === 1 ? '' : 's'}${
                                    r.riders ? ' · ' + esc(r.riders) : ''}</span></td>
                            <td class="num">${money(rate)}</td></tr>`).join('')}
                        <tr><td><b>Total</b></td>
                            <td><b>${rides.length} lesson${rides.length === 1 ? '' : 's'}</b></td>
                            <td class="num"><b>${money(rides.length * rate)}</b></td></tr>
                    </table></div>
                    ${rate ? '' : '<p class="no-parent">No pay per lesson set, so the total is zero.</p>'}
                    <div class="form-actions" style="justify-content:flex-start">
                        <a class="btn secondary small" href="/api/guides/${guide.id}/statement.pdf?from=${from}&to=${to}"
                           target="_blank" rel="noopener">View</a>
                        <a class="btn secondary small" href="/api/guides/${guide.id}/statement.pdf?from=${from}&to=${to}&download=1"
                           download="lessons-${esc(guide.name.replace(/[^a-zA-Z0-9]+/g, '-'))}-${from}.pdf">⬇ PDF</a>
                        ${waNumber(guide.phone) ? `<button type="button" class="secondary small" id="g-wa">💬 Send</button>` : ''}
                    </div>` : 'No lessons in this month.';
                    const wa = document.getElementById('g-wa');
                    if (wa) wa.addEventListener('click', () =>
                        sendStatementOnWhatsApp(guide, from, to, rides.length, rides.length * rate));
                } catch (err) {
                    $l.textContent = err.message;
                }
            };
            $dialog.querySelectorAll('[data-gm]').forEach((btn) => btn.addEventListener('click', () => {
                $dialog.querySelectorAll('[data-gm]').forEach((b) => b.classList.toggle('active', b === btn));
                loadLessons(btn.getAttribute('data-gm'));
            }));
            document.getElementById('g-rate').addEventListener('change', () => {
                const active = $dialog.querySelector('[data-gm].active');
                if (active) loadLessons(active.getAttribute('data-gm'));
            });
            loadLessons(currentMonth());
        }
        document.getElementById('g-cancel').addEventListener('click', closeDialog);
        document.getElementById('g-save').addEventListener('click', async () => {
            const body = {
                name: document.getElementById('g-name').value,
                phone: readPhoneField('g-phone'),
                is_assistant: document.getElementById('g-assistant').checked,
                notes: document.getElementById('g-notes').value,
                color: document.getElementById('g-color').value,
                rate_cents: parseMoneyCents(document.getElementById('g-rate').value)
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
            if (!await askConfirm(`Delete ride type "${rt.name}"?`,
                'Existing rides are kept and keep their price and label.', 'Delete the type')) return;
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
    // Keep the device's copy of the days she is likely to open. The calendar
    // asks for one day at a time, so warm exactly those URLs — and because
    // /api/rides materializes the weekly templates, this also makes sure the
    // rides EXIST server-side before she loses signal.
    async function prewarmDays(days) {
        if (!navigator.onLine) return;
        const today = todayStr();
        for (let i = -1; i < days; i++) {
            const d = shiftDate(today, i);
            try {
                await fetch(`/api/rides?from=${d}&to=${d}`, { credentials: 'same-origin' });
            } catch (err) {
                return;   // signal went; the rest will warm next time
            }
        }
    }

    // The worker only starts intercepting AFTER it activates, so the requests the
    // app made while booting were never cached. Re-fetch them once it is in
    // charge, or the first offline reload has nothing to boot from.
    const ESSENTIAL_GETS = ['/api/auth/me', '/api/users', '/api/horses', '/api/contacts',
                            '/api/guides', '/api/ride-types', '/api/settings', '/api/schools'];
    async function warmEssentials() {
        // Pointless before login — every request would 401 and the worker only
        // caches successful responses.
        if (!state.user || !navigator.onLine) return;
        if (navigator.serviceWorker) {
            try { await navigator.serviceWorker.ready; } catch (err) { /* unsupported */ }
        }
        for (const url of ESSENTIAL_GETS) {
            try {
                await fetch(url, { credentials: 'same-origin' });
            } catch (err) { return; }
        }
    }

    // navigator.onLine only means "there is a network interface" — on a phone it
    // goes true the moment it sees a tower, well before anything can be fetched.
    // So confirm with a real request before telling her the connection is back.
    async function confirmOnline() {
        try {
            const res = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
            if (!res.ok && res.status !== 401) return false;
            if (res.headers.get('X-Cached-At')) return false;   // still the cache
            setOffline(false);
            return true;
        } catch (err) {
            setOffline(true);
            return false;
        }
    }

    function wireOfflineSignals() {
        window.addEventListener('online', async () => {
            if (await confirmOnline()) {
                await warmEssentials();
                prewarmDays(21);
            }
        });
        window.addEventListener('offline', () => setOffline(true));
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && document.body.classList.contains('is-offline')) confirmOnline();
        });
        // she is usually tapping something when the signal returns
        let lastProbe = 0;
        document.addEventListener('pointerdown', () => {
            if (!document.body.classList.contains('is-offline')) return;
            const now = Date.now();
            if (now - lastProbe < 3000) return;
            lastProbe = now;
            confirmOnline();
        }, true);
        if (!navigator.onLine) setOffline(true);
        if ('serviceWorker' in navigator) {
            // updateViaCache 'none': Caddy serves *.js with a day's max-age, and
            // without this the browser would honour that for sw.js itself — so a
            // deploy could take up to 24h to reach a phone that already has the
            // old worker installed.
            navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
                .catch(() => { /* http, or blocked */ });
        }
    }

    async function boot() {
        wireOfflineSignals();
        try {
            const me = await api('GET', '/api/auth/me');
            state.setupRequired = me.setup_required;
            state.user = me.user;
            if (state.user) {
                await loadRefData();
                showShell();
                // in the background — never block the first paint on it
                setTimeout(() => warmEssentials().then(() => prewarmDays(21)), 1500);
            }
            route();
        } catch (err) {
            $view.innerHTML = `<div class="card">Could not reach the server: ${esc(err.message)}</div>`;
        }
    }

    boot();
})();