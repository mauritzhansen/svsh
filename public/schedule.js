/* Read-only schedule for instructors. Opened from one shared link; the token
   in the URL is the only credential. Deliberately plain: big text, no editing. */
(() => {
    'use strict';

    const token = new URLSearchParams(location.search).get('token') || '';
    const $out = document.getElementById('out');
    const LEVEL_LABELS = {
        'beginner': 'Beginner', 'beginner-intermediate': 'Beg–Int', 'intermediate': 'Intermediate',
        'intermediate-advanced': 'Int–Adv', 'advanced': 'Advanced'
    };
    const LEVEL_COLORS = {
        'beginner': '#616161', 'beginner-intermediate': '#a67f00', 'intermediate': '#1565c0',
        'intermediate-advanced': '#e65100', 'advanced': '#8e24aa'
    };
    const MODE = { running: ' 🏃', cycling: ' 🚴', horse: '', foot: '' };

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
                <span class="ride-level${r.level ? '' : ' none'}"
                      style="${r.level ? `color:${color}` : ''}">${r.level ? LEVEL_LABELS[r.level] : 'no level assigned'}</span>
            </div>
            <div class="ride-cols">
                <div class="ride-riders-col">${riderRows}</div>
                <div class="ride-staff-col">${staff || '<span class="muted">no instructor</span>'}</div>
            </div>
        </div>`;
    }

    async function load() {
        const from = week ? mondayOf(date) : date;
        const to = week ? shift(mondayOf(date), 6) : date;
        document.getElementById('mode-btn').textContent = week ? 'Day' : 'Week';
        try {
            const res = await fetch(`/api/public/schedule?token=${encodeURIComponent(token)}&from=${from}&to=${to}`);
            if (!res.ok) {
                $out.innerHTML = '<div class="card">This link is not valid. Ask the office for the current one.</div>';
                return;
            }
            const data = await res.json();
            document.getElementById('biz-name').textContent = data.business_name;
            document.title = `Schedule — ${data.business_name}`;
            $out.classList.remove('muted');
            $out.innerHTML = data.days.map((d) => `
                <h2 class="pub-day ${d.date === todayStr() ? 'is-today' : ''}">${esc(longDate(d.date))}</h2>
                ${d.rides.length ? d.rides.map(rideHtml).join('')
                    : '<div class="card muted">Nothing scheduled.</div>'}`).join('');
        } catch (err) {
            $out.innerHTML = `<div class="card">Could not load the schedule. ${esc(err.message)}</div>`;
        }
    }

    document.getElementById('prev').addEventListener('click', () => { date = shift(date, week ? -7 : -1); load(); });
    document.getElementById('next').addEventListener('click', () => { date = shift(date, week ? 7 : 1); load(); });
    document.getElementById('today-btn').addEventListener('click', () => { date = todayStr(); load(); });
    document.getElementById('mode-btn').addEventListener('click', () => { week = !week; load(); });
    load();
})();
