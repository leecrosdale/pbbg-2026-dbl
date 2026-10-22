import { Application, Container, Graphics } from 'pixi.js';
import { AlarmSound } from './alarm-sound.js';
import './style.css';
import './theme.css';

const arrow = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.6"/></svg>';
const clockIcon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="13" r="8" stroke="currentColor" stroke-width="1.6"/><path d="M12 8v5l3 2M4 3 1 6m19-3 3 3" stroke="currentColor" stroke-width="1.6"/></svg>';
document.querySelector('#app').innerHTML = `
  <div class="site-shell">
    <header class="site-header">
      <a class="brand" href="/" aria-label="Just in Time home"><span class="brand-mark">${clockIcon}</span><span>just in time<span class="brand-period">.</span></span></a>
      <nav aria-label="Main navigation"><button class="nav-link active" data-view="live">The game <span class="nav-dot"></span></button><button class="nav-link" data-view="archive">Past rounds</button><button class="nav-link" data-view="community">Community</button></nav>
      <div class="connection"><span class="status-dot" id="connection-dot"></span><span id="connection-text">Connecting</span></div>
    </header>

    <main id="live-view">
      <section class="hero">
        <div class="hero-copy"><div class="eyebrow"><span class="tiny-cross">✳</span> CIVIL DEFENCE / LIVE ALARM NETWORK</div><h1>Don’t be late<span class="orange">.</span></h1><button class="text-button" id="practice-button">Run a practice drill ${arrow}</button></div>
        <div class="time-panel"><div class="time-label"><span class="status-dot orange-dot"></span> THE CLOCK IS TICKING</div><div class="uk-clock" id="uk-clock">--:--:--</div><div class="time-meta"><span>LONDON, UK</span><span id="uk-zone">EUROPE / LONDON</span></div><div class="clock-rule"></div><div class="round-end"><span id="end-label">Today’s round ends in</span><strong id="round-countdown">--h --m --s</strong></div></div>
      </section>

      <section class="player-profile" aria-label="Player profile"><div><span class="eyebrow">OPERATOR IDENTIFICATION</span><h2>Playing as <span id="current-name">…</span></h2><p>Your saves follow this browser. Practice doesn’t count.</p></div><form id="profile-form"><label for="username">Your username</label><div class="profile-fields"><input id="username" name="username" minlength="3" maxlength="20" pattern="[A-Za-z0-9_-]{3,20}" autocomplete="nickname" placeholder="Choose a name" required aria-describedby="profile-feedback"/><button id="profile-submit" type="submit">Save name ${arrow}</button></div><p id="profile-feedback" aria-live="polite">3–20 letters, numbers, underscores or hyphens.</p></form></section>

      <section class="game-board" aria-label="Live alarm board">
        <div class="board-header"><div class="round-name"><span class="live-tag" id="phase-tag"><span class="status-dot"></span> LIVE ROUND</span><span class="round-date" id="round-date">Connecting to the round…</span></div><div class="watchers"><span class="people-icon">♧</span><span id="player-count">—</span> here right now</div></div>
        <div class="practice-banner" id="practice-banner" hidden>YOU’RE IN PRACTICE MODE <span>A quick local round. The daily game keeps running.</span><button id="exit-practice">Back to live ${arrow}</button></div>
        <div class="alarm-scroll"><div class="alarm-stage" id="alarm-stage"><div id="pixi-board" aria-hidden="true"></div><div class="alarm-grid" id="alarm-grid"></div></div></div>
        <div class="board-footer"><div class="legend"><span><i class="legend-dot disabled"></i>Waiting</span><span><i class="legend-dot ringing"></i>Ringing</span><span><i class="legend-dot activated"></i>Saved</span><span><i class="legend-dot destroyed"></i>Lost</span></div><div class="board-sound"><span class="schedule-note">UNPREDICTABLE BY DESIGN.</span><button class="sound-toggle" id="sound-toggle" type="button" aria-pressed="true" title="Mute alarm sound. Playback unlocks after your first click or keypress.">Sound on</button></div></div>
      </section>

      <section class="under-board"><div class="action-panel" id="action-panel" aria-live="polite"></div><div class="progress-panel"><div class="eyebrow">SYSTEM INTEGRITY</div><div class="progress-head"><h2>Keep the signal alive.</h2><span><strong id="saved-count">0</strong><span class="out-of"> / 10</span></span></div><div class="progress-track" id="progress-track"></div><div class="progress-meta"><span id="progress-copy">Awaiting intervention.</span><span id="lost-count">0 lost</span></div></div></section>

    </main>

    <main id="archive-view" hidden><section class="archive-heading"><span class="eyebrow">THE RECORD OF SHOWING UP</span><h1>Time well spent<span class="orange">.</span></h1><p>Every round has a story. Here’s how we did together.</p></section><div id="archive-content" class="archive-content"></div></main>
    <main id="community-view" hidden><section class="archive-heading"><span class="eyebrow">THE PEOPLE WHO BEAT THE CLOCK</span><h1>Right on time<span class="orange">.</span></h1><p>The most alarms saved, and the people behind each little victory.</p></section><div id="community-content" class="community-content" aria-live="polite"></div></main>

    <footer class="site-footer"><a class="footer-brand" href="/">just in time.</a><span>ALL TIMES ARE UK TIME <span class="footer-star">✳</span></span></footer>
  </div><div class="toast" id="toast" role="status" hidden></div>`;

const $ = selector => document.querySelector(selector);
const alarmSound = new AlarmSound();
let unlockingAudio = false;
async function unlockAlarmAudio(event) {
  // Browsers need a user gesture. Unlock silently so quiet rounds stay quiet.
  if (event.target instanceof Element && event.target.closest('#sound-toggle')) return;
  if (!alarmSound.enabled || unlockingAudio || alarmSound.context?.state === 'running') return;
  unlockingAudio = true;
  try {
    await alarmSound.unlock();
    $('#sound-toggle').title = 'Mute alarm sound';
    alarmSound.update(alarmSound.ringing);
  } catch {
    $('#sound-toggle').title = 'Sound is on. Click or press a key to allow browser audio.';
  } finally { unlockingAudio = false; }
}
document.addEventListener('click', unlockAlarmAudio);
document.addEventListener('keydown', unlockAlarmAudio);
$('#sound-toggle').addEventListener('click', async () => {
  const button = $('#sound-toggle');
  button.disabled = true;
  try {
    if (alarmSound.enabled) alarmSound.disable();
    else await alarmSound.enable();
  } catch (error) {
    alarmSound.disable();
    toast(error.message);
  } finally {
    button.textContent = alarmSound.enabled ? 'Sound on' : 'Sound off';
    button.setAttribute('aria-pressed', String(alarmSound.enabled));
    button.title = alarmSound.enabled ? 'Mute alarm sound' : 'Enable alarm sound';
    button.disabled = false;
  }
});
window.addEventListener('pagehide', () => alarmSound.stop());
let liveState = null;
let practiceState = null;
let state = null;
let player = null;
let selected = null;
let connected = false;
let serverOffset = 0;
let socket;
let pending = false;
let toastTimeout;
let currentPanelKey = '';
let renderSignature = '';
let app;
let reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const colors = { disabled: 0x657175, ringing: 0xff5846, activated: 0x79bb8b, destroyed: 0x986267 };
const names = { disabled: 'Waiting', ringing: 'Ringing', activated: 'Saved', destroyed: 'Lost' };
const now = () => Date.now() + (practiceState ? 0 : serverOffset);
const ukTime = value => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(value);
const ukDate = value => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short', year: 'numeric' }).format(value);
const pad = value => String(value).padStart(2, '0');
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function updatePlayer(next) {
  player = next;
  $('#current-name').textContent = player.username;
  if (document.activeElement !== $('#username')) $('#username').value = player.username;
}
$('#profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#profile-submit');
  button.disabled = true;
  try {
    const response = await fetch('/api/profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('#username').value.trim() }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Couldn’t save your name. Try again.');
    updatePlayer(result);
    $('#profile-feedback').textContent = 'Name saved. Your alarm totals stay with you when you rename.';
  } catch (error) { $('#profile-feedback').textContent = error.message; }
  finally { button.disabled = false; }
});

async function loadCommunity() {
  try {
    const response = await fetch('/api/community');
    if (!response.ok) throw new Error();
    const { leaders, activity } = await response.json();
    $('#community-content').innerHTML = `<section><div class="community-section-heading"><h2>The ones who show up.</h2><span class="eyebrow">ALL-TIME SAVES · TOP 50</span></div>${leaders.length ? `<div class="community-table"><div class="leader-row community-table-head"><span>RANK</span><span>PLAYER</span><span>SAVED</span><span>ROUNDS</span><span>FASTEST</span></div>${leaders.map((p, i) => `<div class="leader-row ${p.id === player?.id ? 'you-row' : ''}"><span class="rank">${pad(i + 1)}</span><span>${escapeHtml(p.username)}${p.id === player?.id ? '<small>YOU</small>' : ''}</span><strong>${p.saved}</strong><span>${p.rounds}</span><span>${(p.fastestMs / 1000).toFixed(1)}s</span></div>`).join('')}</div>` : '<div class="community-empty"><h3>The first save is still up for grabs.</h3><p>Save an alarm in the live game to start the leaderboard.</p></div>'}</section><section><div class="community-section-heading"><h2>A record of good timing.</h2><span class="eyebrow">LATEST 50 SAVES · UK TIME</span></div>${activity.length ? `<div class="community-table"><div class="activity-row community-table-head"><span>WHEN</span><span>PLAYER AT THE TIME</span><span>ALARM</span><span>RESPONSE</span></div>${activity.map(save => `<div class="activity-row"><span>${ukDate(save.savedAt)}<small>${ukTime(save.savedAt)}</small></span><span>${escapeHtml(save.username)}</span><span>${pad(save.alarmId)}</span><span>${(save.responseMs / 1000).toFixed(1)}s</span></div>`).join('')}</div>` : '<div class="community-empty"><p>Every live save will be logged here with its player, alarm, time and response speed. Practice saves stay in practice.</p></div>'}</section>`;
  } catch { $('#community-content').innerHTML = '<p class="archive-empty">The community record is unavailable. Please try again in a moment.</p>'; }
}
function duration(ms, long = false) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  return long ? `${pad(h)}h ${pad(m)}m ${pad(s)}s` : `${pad(Math.floor(total / 60))}:${pad(s)}`;
}
function toast(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimeout); toastTimeout = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}

async function connect() {
  try {
    const response = await fetch('/api/profile');
    if (!response.ok) throw new Error();
    updatePlayer(await response.json());
  } catch {
    $('#connection-text').textContent = 'Reconnecting';
    setTimeout(connect, 2000);
    return;
  }
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  socket.addEventListener('open', () => {
    connected = true; $('#connection-text').textContent = 'Connected'; $('#connection-dot').classList.add('online');
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.type === 'state') {
      serverOffset = message.now - Date.now();
      liveState = message;
      if (!practiceState) applyState(message);
      if (!$('#community-view').hidden) loadCommunity();
    } else if (message.type === 'profile') {
      updatePlayer(message.player);
      if (!$('#community-view').hidden) loadCommunity();
    } else if (message.type === 'result') {
      pending = false;
      toast(message.message);
      if (!message.ok) { $('#code-feedback')?.replaceChildren(document.createTextNode(message.message)); }
      const button = $('#code-submit'); if (button) button.disabled = false;
    }
  });
  socket.addEventListener('close', () => {
    connected = false; pending = false;
    if (!practiceState) alarmSound.stop();
    $('#connection-text').textContent = 'Reconnecting'; $('#connection-dot').classList.remove('online');
    if (!practiceState) { currentPanelKey = ''; updatePanel(); }
    setTimeout(connect, 2000);
  });
  socket.addEventListener('error', () => socket.close());
}

function applyState(next) {
  const previousId = state?.round.id;
  state = next;
  if (previousId !== state.round.id) { selected = null; renderSignature = ''; }
  const { round } = state;
  document.body.classList.toggle('alarm-active', round.phase === 'live' && round.alarms.some(a => a.status === 'ringing'));
  if (selected && !round.alarms.some(a => a.id === selected && a.status === 'ringing')) selected = null;
  if (!selected) selected = round.alarms.find(a => a.status === 'ringing')?.id || null;
  $('#player-count').textContent = practiceState ? '1' : state.players;
  $('#round-date').textContent = practiceState ? 'A little rehearsal' : `${ukDate(round.start)} — ${ukDate(round.end)}`;
  const results = round.phase === 'results';
  $('#phase-tag').innerHTML = `<span class="status-dot"></span> ${practiceState ? 'PRACTICE' : results ? 'ROUND COMPLETE' : 'LIVE ROUND'}`;
  $('#phase-tag').classList.toggle('results', results);
  const saved = round.alarms.filter(a => a.status === 'activated').length;
  const lost = round.alarms.filter(a => a.status === 'destroyed').length;
  $('#saved-count').textContent = saved;
  $('#lost-count').textContent = `${lost} lost`;
  $('#progress-copy').textContent = saved === 10 ? 'Ten out of ten. Everyone showed up.' : results ? 'A new chance at 1pm. See you there.' : `${10 - saved - lost} still in play. We’re in this together.`;
  $('#progress-track').innerHTML = round.alarms.map(a => `<span class="progress-segment ${a.status}"></span>`).join('');
  renderAlarms(); updatePanel(); tick();
}

function renderAlarms() {
  if (!state) return;
  const signature = state.round.alarms.map(a => `${a.status}-${a.activatedBy}`).join('|') + selected;
  if (signature === renderSignature) return;
  renderSignature = signature;
  $('#alarm-grid').innerHTML = state.round.alarms.map(a => `<button class="alarm-card ${a.status} ${selected === a.id ? 'selected' : ''}" data-alarm="${a.id}" aria-label="Alarm ${pad(a.id)}, ${names[a.status]}${a.status === 'ringing' ? ', enter code' : a.status === 'activated' ? ` by ${escapeHtml(a.activatedBy)}` : ''}" ${a.status !== 'ringing' ? 'disabled' : ''}><span class="alarm-id">ALARM ${pad(a.id)}</span><span class="alarm-art-space"></span><span class="alarm-status"><i></i>${names[a.status]}</span><span class="alarm-detail" data-timer="${a.id}" ${a.status === 'activated' ? `title="Saved by ${escapeHtml(a.activatedBy)}"` : ''}>${a.status === 'activated' ? `by ${escapeHtml(a.activatedBy)}` : a.status === 'destroyed' ? 'Time ran out.' : a.status === 'ringing' ? duration(a.deadline - now()) : 'Not a peep. Yet.'}</span>${a.status === 'ringing' ? '<span class="alarm-cta">ENTER CODE ↗</span>' : ''}</button>`).join('');
  document.querySelectorAll('[data-alarm]').forEach(button => button.addEventListener('click', () => {
    selected = Number(button.dataset.alarm); renderSignature = ''; renderAlarms(); updatePanel();
  }));
  drawBoard();
}

function updatePanel() {
  if (!state) { $('#action-panel').innerHTML = '<div class="idle-icon">⌛</div><div><span class="eyebrow">GETTING OUR CLOCKS IN SYNC</span><h3>Connecting to the community…</h3><p>The live alarm board will be here in a moment.</p></div>'; return; }
  const { round } = state;
  const alarm = round.alarms.find(a => a.id === selected && a.status === 'ringing');
  const key = `${round.id}-${round.phase}-${alarm?.id}-${connected}-${round.alarms.every(a => ['activated', 'destroyed'].includes(a.status))}`;
  if (key === currentPanelKey) return;
  currentPanelKey = key;
  const panel = $('#action-panel');
  panel.classList.toggle('urgent', Boolean(alarm));
  if (alarm && (connected || practiceState)) {
    panel.innerHTML = `<div class="code-panel"><div class="code-heading"><span class="eyebrow"><i class="legend-dot ringing"></i> ALARM ${pad(alarm.id)} NEEDS YOU</span><strong id="code-timer">${duration(alarm.deadline - now())}</strong></div><div class="code-content"><div><label class="code-label" for="alarm-code">Enter this code to save it</label><div class="challenge-code">${alarm.code}</div></div><form id="code-form"><div class="code-fields"><input id="alarm-code" name="code" aria-label="Four-digit alarm code" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" minlength="4" autocomplete="off" placeholder="0000" required/><button id="code-submit" aria-label="Save alarm" type="submit">Save alarm ${arrow}</button></div><p id="code-feedback" aria-live="polite">One person is all it takes.</p></form></div></div>`;
    $('#code-form').addEventListener('submit', event => {
      event.preventDefault();
      if (pending) return;
      const code = $('#alarm-code').value;
      if (practiceState) {
        advancePractice();
        const current = practiceState.round.alarms.find(a => a.id === alarm.id);
        if (current.status !== 'ringing') { toast('Time ran out for that alarm.'); return; }
        if (code !== current.code) { toast('That code isn’t right. Try again.'); return; }
        current.status = 'activated'; current.resolvedAt = Date.now(); current.activatedBy = 'You';
        toast(`Alarm ${pad(alarm.id)} saved. Just in time.`); applyState(practiceState);
      } else if (connected && socket.readyState === WebSocket.OPEN) {
        pending = true; $('#code-submit').disabled = true;
        socket.send(JSON.stringify({ type: 'activate', alarmId: alarm.id, code }));
      } else { toast('Reconnect to the live game to enter a code.'); }
    });
    $('#alarm-code').focus();
  } else {
    const done = round.alarms.every(a => ['activated', 'destroyed'].includes(a.status));
    const title = !connected && !practiceState ? 'Signal lost. Reconnecting.' : round.phase === 'results' ? `${round.alarms.filter(a => a.status === 'activated').length} saved. Round debrief.` : done ? 'That’s the last alarm.' : 'No signal. Stay on watch.';
    const copy = !connected && !practiceState ? 'Code entry will resume when the live connection returns.' : round.phase === 'results' ? practiceState ? 'Practice complete. Another rehearsal begins in a moment, or head back to the live game.' : 'The results are in. A new round begins at 1pm UK time.' : done ? practiceState ? 'Nicely done. Your practice results arrive when the timer runs out.' : 'Your results will be recorded at midday UK time.' : 'Nothing’s ringing right now. The next alarm could wake up any moment.';
    panel.innerHTML = `<div class="idle-icon">${clockIcon}</div><div><span class="eyebrow">${round.phase === 'results' ? 'TRANSMISSION COMPLETE' : 'STANDBY / MONITORING FREQUENCY'}</span><h3>${title}</h3><p>${copy}</p></div>`;
  }
}

function tick() {
  $('#uk-clock').textContent = ukTime(Date.now());
  $('#uk-zone').textContent = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeZoneName: 'short' }).formatToParts(Date.now()).find(p => p.type === 'timeZoneName').value;
  if (!state) return;
  const { round } = state;
  alarmSound.update(
    (connected || Boolean(practiceState)) && round.phase === 'live' &&
    round.alarms.some(a => a.status === 'ringing' && a.deadline > now())
  );
  $('#end-label').textContent = round.phase === 'results' ? practiceState ? 'Next practice begins in' : 'Next round begins in' : practiceState ? 'Practice round ends in' : 'This round ends in';
  $('#round-countdown').textContent = duration((round.phase === 'results' ? round.restart : round.end) - now(), true);
  for (const a of round.alarms) if (a.status === 'ringing') {
    const timer = document.querySelector(`[data-timer="${a.id}"]`); if (timer) timer.textContent = duration(a.deadline - now());
    if (a.id === selected && $('#code-timer')) $('#code-timer').textContent = duration(a.deadline - now());
  }
}

function startPractice() {
  const start = Date.now();
  practiceState = { players: 1, round: { id: 'practice', start, end: start + 105000, restart: start + 125000, phase: 'live', responseMs: 15000,
    alarms: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, status: i === 0 ? 'ringing' : 'disabled', scheduledAt: start + i * 9000, deadline: start + i * 9000 + 15000, code: String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0'), resolvedAt: null, activatedBy: null })) } };
  selected = null; currentPanelKey = ''; $('#practice-banner').hidden = false; $('#practice-button').disabled = true;
  applyState(practiceState);
}
function advancePractice() {
  if (!practiceState) return;
  if (Date.now() >= practiceState.round.restart) { startPractice(); return; }
  let changed = false;
  for (const a of practiceState.round.alarms) {
    if (['disabled', 'ringing'].includes(a.status) && Date.now() >= a.deadline) { a.status = 'destroyed'; changed = true; }
    else if (a.status === 'disabled' && Date.now() >= a.scheduledAt) { a.status = 'ringing'; changed = true; }
  }
  if (Date.now() >= practiceState.round.end && practiceState.round.phase !== 'results') { practiceState.round.phase = 'results'; changed = true; }
  if (changed) applyState(practiceState);
}
$('#practice-button').addEventListener('click', startPractice);
$('#exit-practice').addEventListener('click', () => {
  practiceState = null; selected = null; currentPanelKey = ''; $('#practice-banner').hidden = true; $('#practice-button').disabled = false;
  if (liveState) applyState(liveState);
});

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', async () => {
  const archive = button.dataset.view === 'archive';
  const community = button.dataset.view === 'community';
  $('#live-view').hidden = archive || community; $('#archive-view').hidden = !archive;
  $('#community-view').hidden = !community;
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b === button));
  if (community) { $('#community-content').innerHTML = '<p class="archive-empty">Finding the people who showed up…</p>'; await loadCommunity(); return; }
  if (archive) {
    $('#archive-content').innerHTML = '<p class="archive-empty">Opening the record book…</p>';
    try {
      const response = await fetch('/api/history'); if (!response.ok) throw new Error();
      const rounds = await response.json();
      $('#archive-content').innerHTML = rounds.length ? `<div class="archive-table"><div class="archive-row archive-table-head"><span>ROUND ENDING</span><span>SAVED</span><span>LOST</span><span>THE VERDICT</span></div>${rounds.map(r => `<div class="archive-row"><span>${ukDate(r.end)}</span><strong>${r.activated} / 10</strong><span>${r.destroyed}</span><span class="verdict">${r.endReason === 'admin_restart' ? 'Restarted by admin.' : r.activated === 10 ? 'A perfect ten.' : r.activated >= 5 ? 'Time well spent.' : 'We’ll be back.'}</span></div>`).join('')}</div>` : '<div class="archive-empty"><span class="empty-clock">◷</span><h2>A little history in the making.</h2><p>Our first results will appear here when a round finishes at midday UK time.</p><button class="text-button" id="return-live">Back to the game →</button></div>';
      $('#return-live')?.addEventListener('click', () => $('[data-view="live"]').click());
    } catch { $('#archive-content').innerHTML = '<p class="archive-empty">The record book is unavailable. Please try again in a moment.</p>'; }
  } else { requestAnimationFrame(drawBoard); }
}));

// Pixi draws the alarm hardware; DOM controls keep the game keyboard accessible.
async function initBoard() {
  try {
    app = new Application();
    await app.init({ backgroundAlpha: 0, antialias: true, resolution: Math.min(devicePixelRatio, 2), autoDensity: true, preference: 'webgl' });
    $('#pixi-board').appendChild(app.canvas);
    new ResizeObserver(drawBoard).observe($('#alarm-stage'));
    drawBoard();
    let elapsed = 0;
    app.ticker.add(ticker => {
      if (!state || reducedMotion) return;
      elapsed += ticker.deltaMS;
      app.stage.children.forEach((container, i) => {
        if (state.round.alarms[i]?.status === 'ringing') container.rotation = Math.sin(elapsed / 55) * 0.025;
      });
    });
  } catch {
    $('#pixi-board').innerHTML = '<div class="canvas-fallback">Your browser couldn’t draw the alarm illustrations. All game controls remain available below.</div>';
  }
}

function drawBoard() {
  if (!app?.renderer || !state || !$('#alarm-stage').clientWidth) return;
  const width = $('#alarm-stage').clientWidth;
  app.renderer.resize(width, 240);
  app.stage.removeChildren().forEach(child => child.destroy({ children: true }));
  state.round.alarms.forEach((alarm, index) => {
    const cell = width / 10;
    const c = new Container(); c.position.set(cell * (index + 0.5), 109);
    const g = new Graphics(); const color = colors[alarm.status];
    const active = alarm.status === 'activated' || alarm.status === 'ringing';
    // Dark instrument housings and a warning glow around active alarms.
    g.ellipse(0, 43, 29, 4).fill({ color: 0x000000, alpha: .5 });
    if (alarm.status === 'ringing' || alarm.status === 'activated') {
      g.circle(0, 0, 43).fill({ color, alpha: .035 });
      g.circle(0, 0, 38).fill({ color, alpha: .06 });
      g.circle(0, 0, 43).stroke({ color, width: 1, alpha: .25 });
    }
    g.moveTo(-17, 28).lineTo(-22, 39).stroke({ color, width: 5, cap: 'round' });
    g.moveTo(17, 28).lineTo(22, 39).stroke({ color, width: 5, cap: 'round' });
    if (alarm.status !== 'destroyed') {
      g.moveTo(-22, -23).lineTo(-27, -30).moveTo(22, -23).lineTo(27, -30).stroke({ color, width: 3 });
      g.ellipse(-25, -29, 12, 7).fill(color);
      g.ellipse(25, -29, 12, 7).fill(color);
      g.roundRect(-3, -40, 6, 10, 2).fill(color);
    }
    g.circle(0, 0, 33).fill(color);
    g.circle(0, 0, 28).fill(alarm.status === 'ringing' ? 0x271312 : alarm.status === 'activated' ? 0x14251b : 0x121719);
    g.circle(0, 0, 25).stroke({ color, width: 1, alpha: .3 });
    for (let h = 0; h < 12; h++) {
      const a = h * Math.PI / 6;
      g.moveTo(Math.sin(a) * 22, -Math.cos(a) * 22).lineTo(Math.sin(a) * (h % 3 === 0 ? 18 : 20), -Math.cos(a) * (h % 3 === 0 ? 18 : 20)).stroke({ color, width: h % 3 === 0 ? 1.7 : 1 });
    }
    if (alarm.status === 'activated') {
      g.moveTo(-10, 0).lineTo(-2, 8).lineTo(12, -8).stroke({ color, width: 3, cap: 'round', join: 'round' });
    } else if (alarm.status === 'destroyed') {
      g.moveTo(-10, -10).lineTo(10, 10).moveTo(10, -10).lineTo(-10, 10).stroke({ color, width: 2, cap: 'round' });
      g.moveTo(5, -32).lineTo(-2, -18).lineTo(6, -12).lineTo(1, -3).stroke({ color, width: 2 });
    } else {
      g.moveTo(0, -16).lineTo(0, 0).lineTo(11, 7).stroke({ color: active ? 0xff8c6f : 0xa3afb2, width: 2.5, cap: 'round', join: 'round' });
      g.circle(0, 0, 2.5).fill(color);
    }
    if (alarm.status === 'ringing') {
      g.moveTo(-39, -19).lineTo(-43, -24).moveTo(39, -19).lineTo(43, -24).moveTo(-41, -8).lineTo(-47, -10).moveTo(41, -8).lineTo(47, -10).stroke({ color, width: 2, cap: 'round' });
    }
    c.addChild(g); app.stage.addChild(c);
  });
}

updatePanel(); connect(); initBoard(); tick();
setInterval(() => { advancePractice(); tick(); }, 250);
