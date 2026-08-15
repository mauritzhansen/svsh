/* Read-only schedule for instructors. Opened from one shared link; the token
   in the URL is the only credential. Deliberately plain: big text, no editing. */
(() => {
    'use strict';

    // The token normally arrives in the link, but a Home Screen install opens
    // /schedule with no query string — so remember it on first visit.
    const urlToken = new URLSearchParams(location.search).get('token') || '';
    if (urlToken) { try { localStorage.setItem('svsh_token', urlToken); } catch (e) { /* private mode */ } }
    let stored = '';
    try { stored = localStorage.getItem('svsh_token') || ''; } catch (e) { /* private mode */ }
    const token = urlToken || stored;
    const $out = document.getElementById('out');
    const $status = document.getElementById('status');
    let lastPayload = '';      // to tell a real change from an identical refetch
    let cachedAt = null;
    const LEVEL_LABELS = {
        'beginner': 'Beginner', 'beginner-intermediate': 'Beg–Int', 'intermediate': 'Intermediate',
        'intermediate-advanced': 'Int–Adv', 'advanced': 'Advanced'
    };
    const LEVEL_COLORS = {
        'beginner': '#616161', 'beginner-intermediate': '#a67f00', 'intermediate': '#1565c0',
        'intermediate-advanced': '#e65100', 'advanced': '#8e24aa'
    };
    const MODE = { running: ' 🏃', cycling: ' 🚴', horse: '', foot: '' };
    const VENUES = { instructor: '', arena: 'Arena', outride: 'Outride' };
    const VENUE_COLORS = { arena: '#e65100', outride: '#2e7d32' };

    let date = todayStr();
    let week = false;

    function todayStr() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function shift(dateStr, days) {
        const d = new Date(dateStr + 'T00:00:00');
        d.setDate(d.getDate() + days);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function mondayOf(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const longDate = (d) => new Date(d + 'T00:00:00')
        .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

    function endTime(start, dur) {
        const [h, m] = start.split(':').map(Number);
        const t = h * 60 + m + (dur || 60);
        return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    }

    // Same ride-box UI as the office calendar, minus the editing
    function rideHtml(r) {
        const color = LEVEL_COLORS[r.level] || '#8a6d4f';
        const staff = r.staff.map((s) => `
            <span class="staff-item">
                <span class="staff-pill" style="background:${esc(s.color || '#4a4a46')}">
                    ${esc(s.name)}${s.assistant ? ' (ass)' : ''}${MODE[s.mode] || ''}
                </span>
                ${s.overlap_min ? `<span class="staff-overlap"
                    title="Also on another ride at the same time — ${s.overlap_min} min overlap">⧉${s.overlap_min}′</span>` : ''}
                ${s.mode === 'horse' && s.horse ? `<span class="rider-horse has">${esc(s.horse)}</span>` : ''}
            </span>`).join('');

        let riderRows;
        if (r.is_block) {
            riderRows = `<div class="rider-row"><span class="rider-name">🚫 Blocked</span>
                <span class="rider-horse has">${esc(r.horses_only.join(', ') || 'horses unavailable')}</span></div>`;
        } else if (r.riders.length) {
            riderRows = r.riders.map((rd) => `
                <div class="rider-row">
                    <span class="rider-name">${esc(rd.name)}</span>
                    ${rd.horse ? `<span class="rider-horse has">${esc(rd.horse)}</span>`
                        : '<span class="rider-horse none">no horse yet</span>'}
                    ${rd.alt_horse ? `<span class="rider-alt">or ${esc(rd.alt_horse)}</span>` : ''}
                    ${rd.pickup ? `<span class="rider-pickup">pick-up: ${esc(rd.pickup)}</span>` : ''}
                </div>`).join('');
        } else if (r.horses_only.length) {
            riderRows = `<div class="rider-row"><span class="rider-name muted">Horses only</span>
                <span class="rider-horse has">${esc(r.horses_only.join(', '))}</span></div>`;
        } else {
            riderRows = '<div class="rider-row"><span class="rider-name muted">No riders yet</span></div>';
        }
        riderRows += (r.off_riders || []).map((o) => `
            <div class="rider-row off-rider">
                <span class="rider-name">${esc(o.name)}</span>
                <span class="rider-off">${o.frequency === 'biweekly' ? 'every 2nd week' : 'not riding'}${
                    o.next_date ? ' · next ' + esc(o.next_date) : ''}</span>
            </div>`).join('');

        return `<div class="ride-box pub-box ${r.is_block ? 'blocked' : ''}">
            <div class="ride-top">
                <span class="ride-time">${esc(r.start_time)}–${esc(endTime(r.start_time, r.duration_min))}</span>
                <span class="ride-dur">${r.duration_min} min</span>
                ${VENUES[r.venue] ? `<span class="ride-venue" style="color:${VENUE_COLORS[r.venue]}">${VENUES[r.venue]}</span>` : ''}
                <span class="ride-level${r.level ? '' : ' none'}"
                      style="${r.level ? `color:${color}` : ''}">${r.level ? LEVEL_LABELS[r.level] : 'no level assigned'}</span>
            </div>
            <div class="ride-cols">
                <div class="ride-riders-col">${riderRows}${r.instructor_notes
                    ? `<div class="rider-row instructor-note">📝 ${esc(r.instructor_notes)}</div>` : ''}</div>
                <div class="ride-staff-col">${staff || '<span class="muted">no instructor</span>'}</div>
            </div>
        </div>`;
    }

    function showStatus(kind, text) {
        if (!$status) return;
        $status.className = `sched-status ${kind}`;
        $status.textContent = text;
        $status.classList.toggle('hidden', !text);
    }

    const clockOf = (iso) => {
        const d = new Date(iso);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    async function load(quiet) {
        const from = week ? mondayOf(date) : date;
        const to = week ? shift(mondayOf(date), 6) : date;
        document.getElementById('mode-btn').textContent = week ? 'Day' : 'Week';
        try {
            const res = await fetch(`/api/public/schedule?token=${encodeURIComponent(token)}&from=${from}&to=${to}`);
            if (res.status === 503) {          // service worker has nothing cached yet
                showStatus('offline', 'No signal, and this day has not been saved to the phone yet.');
                if (!quiet) $out.innerHTML = '<div class="card">Not available offline yet. Open this once with signal.</div>';
                return;
            }
            if (!res.ok) {
                $out.innerHTML = '<div class="card">This link is not valid. Ask the office for the current one.</div>';
                return;
            }
            // The service worker stamps responses it served from its cache
            cachedAt = res.headers.get('X-Cached-At');
            const data = await res.json();
            const fingerprint = JSON.stringify(data.days);
            if (quiet && fingerprint === lastPayload) { markFreshness(); return; }
            const changed = quiet && lastPayload && fingerprint !== lastPayload;
            lastPayload = fingerprint;
            document.getElementById('biz-name').textContent = data.business_name;
            document.title = `Schedule — ${data.business_name}`;
            $out.classList.remove('muted');
            $out.innerHTML = data.days.map((d) => `
                <h2 class="pub-day ${d.date === todayStr() ? 'is-today' : ''}">${esc(longDate(d.date))}</h2>
                ${d.rides.length ? d.rides.map(rideHtml).join('')
                    : '<div class="card muted">Nothing scheduled.</div>'}`).join('');
            markFreshness(changed);
        } catch (err) {
            showStatus('offline', 'No signal — showing the last schedule saved on this phone.');
            if (!quiet && !$out.innerHTML.trim()) {
                $out.innerHTML = `<div class="card">Could not load the schedule. ${esc(err.message)}</div>`;
            }
        }
    }

    // A stale schedule shown as if it were live is worse than none, so always
    // say where this copy came from.
    function markFreshness(justChanged) {
        if (!navigator.onLine) {
            showStatus('offline', cachedAt
                ? `No signal — showing the schedule as at ${clockOf(cachedAt)}.`
                : 'No signal — showing the last schedule saved on this phone.');
        } else if (justChanged) {
            showStatus('changed', 'Schedule updated just now.');
            setTimeout(() => { if (navigator.onLine) showStatus('', ''); }, 6000);
        } else {
            showStatus('', '');
        }
    }

    const reset = () => { lastPayload = ''; };
    document.getElementById('prev').addEventListener('click', () => { date = shift(date, week ? -7 : -1); reset(); load(); });
    document.getElementById('next').addEventListener('click', () => { date = shift(date, week ? 7 : 1); reset(); load(); });
    document.getElementById('today-btn').addEventListener('click', () => { date = todayStr(); reset(); load(); });
    document.getElementById('mode-btn').addEventListener('click', () => { week = !week; reset(); load(); });

    // ---- keep it current ----
    // Polling rather than a live socket: on patchy rural signal a long-lived
    // connection spends its time dropping and reconnecting, while a poll simply
    // succeeds the next time it can. Paused when the page is not on screen.
    const POLL_MS = 30000;
    let timer = null;
    const startPolling = () => {
        stopPolling();
        timer = setInterval(() => { if (!document.hidden) load(true); }, POLL_MS);
    };
    const stopPolling = () => { if (timer) clearInterval(timer); timer = null; };
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return stopPolling();
        load(true);                    // catch up on whatever changed while away
        startPolling();
    });
    window.addEventListener('online', () => { showStatus('', ''); load(true); });
    window.addEventListener('offline', () => markFreshness());

    // ---- offline + background updates ----
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').then(prefetchWeek).catch(() => { /* http, or blocked */ });
        navigator.serviceWorker.addEventListener('message', (e) => {
            if (e.data && e.data.type === 'schedule-changed') load(true);
        });
    }

    // Warm the cache with the surrounding week so tomorrow also works offline
    function prefetchWeek() {
        const from = mondayOf(todayStr());
        fetch(`/api/public/schedule?token=${encodeURIComponent(token)}&from=${from}&to=${shift(from, 13)}`)
            .catch(() => { /* no signal now; it will warm on the next load */ });
    }

    // ---- notifications ----
    const notifyBtn = document.getElementById('notify-btn');
    function syncNotifyBtn() {
        if (!notifyBtn) return;
        const supported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
        if (!supported) { notifyBtn.classList.add('hidden'); return; }
        if (Notification.permission === 'granted') {
            notifyBtn.textContent = '🔔 On';
            notifyBtn.classList.add('on');
        } else if (Notification.permission === 'denied') {
            notifyBtn.textContent = '🔕 Blocked';
        } else {
            notifyBtn.textContent = '🔔 Notify me';
        }
    }
    if (notifyBtn) {
        syncNotifyBtn();
        notifyBtn.addEventListener('click', async () => {
            if (Notification.permission === 'denied') {
                alert('Notifications are blocked for this page. Turn them back on in your phone settings.');
                return;
            }
            try {
                const perm = await Notification.requestPermission();
                syncNotifyBtn();
                if (perm !== 'granted') return;
                const reg = await navigator.serviceWorker.ready;
                const keyRes = await fetch(`/api/public/push-key?token=${encodeURIComponent(token)}`);
                const { key } = await keyRes.json();
                const sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(key)
                });
                await fetch(`/api/public/push-subscribe?token=${encodeURIComponent(token)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.toJSON().keys })
                });
                showStatus('changed', "You'll be told when the schedule changes.");
                setTimeout(() => showStatus('', ''), 5000);
            } catch (err) {
                alert('Could not switch notifications on: ' + err.message);
            }
        });
    }

    function urlBase64ToUint8Array(base64) {
        const padded = (base64 + '='.repeat((4 - base64.length % 4) % 4))
            .replace(/-/g, '+').replace(/_/g, '/');
        const raw = atob(padded);
        return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
    }

    load();
    startPolling();
})();
