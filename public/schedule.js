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

    function rideHtml(r) {
        if (r.is_block) {
            return `<div class="pub-ride blocked">
                <div class="pub-time">${esc(r.start_time)}</div>
                <div class="pub-body"><b>Blocked</b> — ${esc(r.horses_only.join(', ') || 'horses unavailable')}</div>
            </div>`;
        }
        const color = LEVEL_COLORS[r.level] || '#8a6d4f';
        const staff = r.staff.map((s) =>
            `<span class="pub-staff"><span class="guide-dot" style="background:${esc(s.color || '#6a6a66')}"></span>${esc(s.name)}${s.assistant ? ' (assistant)' : ''}${s.mode === 'horse' && s.horse ? ' on ' + esc(s.horse) : MODE[s.mode] || ''}</span>`
        ).join(' ');
        const riders = r.riders.length ? r.riders.map((rd) => `
            <li>
                <span class="pub-rider">${esc(rd.name)}</span>
                <span class="pub-horse">${rd.horse ? esc(rd.horse) : '<i>horse not assigned</i>'}</span>
                ${rd.pickup ? `<span class="pub-pickup">Pick-up: ${esc(rd.pickup)}</span>` : ''}
            </li>`).join('') : '<li class="muted">No riders on this one yet</li>';
        return `<div class="pub-ride" style="border-left-color:${color}">
            <div class="pub-time">${esc(r.start_time)}<span class="pub-end">–${esc(endTime(r.start_time, r.duration_min))}</span></div>
            <div class="pub-body">
                ${r.level ? `<span class="pub-level" style="background:color-mix(in srgb, ${color} 20%, white);color:${color}">${LEVEL_LABELS[r.level]}</span>` : ''}
                ${staff ? `<div class="pub-staffline">${staff}</div>` : ''}
                <ul class="pub-riders">${riders}</ul>
                ${r.horses_only.length ? `<div class="pub-extra">Horses: ${esc(r.horses_only.join(', '))}</div>` : ''}
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
