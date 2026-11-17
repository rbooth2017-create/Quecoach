// The "Mix" page: the two decks, "do they mix?" checks and the step-by-step routine.
import { STEPS, compatChecks, deckBpm, fillText, CONTROL_NAMES } from './mixguide.js';
import { emptyController, applyMidi, detectController, findController, CONTROLLERS } from './controller.js';
import { planTransition, structureFromPhrases, fmtTime } from './engine.js';
import * as midi from './midi.js';
import { createBeatCam } from './beatcam.js';
import { beatAdvice } from './beatvision.js';
import { matchDeck } from './deckreader.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function initMix({ getLibrary, nowTrack, nextTrack, toast, phraseBars }) {
  const mix = {
    decks: { 1: null, 2: null },  // tracks on rekordbox deck 1 / 2
    live: 1,                      // the deck the crowd hears
    step: 0, done: new Set(), stepStart: Date.now(), trimAtStart: null,
    fromScreen: { 1: false, 2: false }, // card filled in by reading rekordbox's screen
    ctl: emptyController(), device: '', devices: [], profile: null,
    // Options (saved): which controller, rekordbox tempo range, slider direction
    opts: { controller: 'auto', tempoRange: 10, invertTempo: false, ...loadOpts() },
  };
  function loadOpts() { try { return JSON.parse(localStorage.getItem('cuecoach.controller') || '{}'); } catch { return {}; } }
  function saveOpts() { try { localStorage.setItem('cuecoach.controller', JSON.stringify(mix.opts)); } catch { /* private mode */ } }
  const N = () => (mix.live === 1 ? 2 : 1);
  const root = $('#mixView');

  // ---------- beat view (watches rekordbox's waveforms) ----------
  mix.phaseOkSince = 0;
  mix.screen = { 1: null, 2: null };  // what the deck reader saw on each rekordbox deck
  mix.soloSince = { deck: null, at: 0 };
  const beat = createBeatCam(() => {
    const a = advice();
    mix.phaseOkSince = a?.phaseOk ? (mix.phaseOkSince || Date.now()) : 0;
    const relabelled = followPlayingDeck();
    const stateChanged = root.querySelector('[data-beatstate]')?.dataset.beatstate !== beat.cam.state;
    if (stateChanged || relabelled) render(); else drawBeat();
    advance();
  }, onDeckText);

  /** The deck reader read a deck's header in rekordbox: put that track on the card. */
  function onDeckText(no, text) {
    if (!getLibrary().length) return; // library still loading: read again in a few seconds
    const m = matchDeck(text, getLibrary());
    const before = mix.screen[no];
    mix.screen[no] = { found: !!m.track, bpm: m.bpm, at: Date.now() };
    if (m.track && m.track.id !== mix.decks[no]?.id) {
      mix.decks[no] = m.track; mix.fromScreen[no] = true;
      if (no === N()) restart(false); // a new track on the next deck: start its steps again
      else render();
    } else if (!before || before.found !== mix.screen[no].found) render();
  }

  /** Only one waveform scrolling for 2 s → that's the deck the crowd hears (not mid-mix). */
  function followPlayingDeck() {
    const mv = beat.cam.moving, solo = mv[1] && !mv[2] ? 1 : mv[2] && !mv[1] ? 2 : null;
    if (solo !== mix.soloSince.deck) mix.soloSince = { deck: solo, at: Date.now() };
    if (solo && solo !== mix.live && mix.step <= 1 && Date.now() - mix.soloSince.at > 2000) {
      mix.live = solo; startStep(0); mix.done.clear(); advance();
      return true;
    }
    return false;
  }
  function liveBpm() {
    const t = mix.decks[mix.live];
    return deckBpm(t, mix.ctl.connected ? mix.ctl.decks[mix.live].tempo : null) || mix.screen?.[mix.live]?.bpm || null;
  }
  const advice = () => (beat.cam.state === 'live' ? beatAdvice(beat.cam.result, { next: N(), bpm: liveBpm() }) : null);
  const beatOn = () => { try { localStorage.setItem('cuecoach.beatview', 'on'); } catch { /* ignore */ } beat.start(); };
  const beatOff = () => { try { localStorage.removeItem('cuecoach.beatview'); } catch { /* ignore */ } beat.stop(); render(); };

  // ---------- controller ----------
  /** Pick the profile and the MIDI device to listen to, from the options and what's plugged in. */
  function choose() {
    const names = mix.devices;
    let profile = null, device = '';
    if (mix.opts.controller === 'auto') {
      for (const n of names) { const p = detectController(n); if (p) { profile = p; device = n; break; } }
    } else if (mix.opts.controller !== 'none') {
      profile = findController(mix.opts.controller);
      device = names.find((n) => detectController(n)?.id === profile?.id)
        || (names.length === 1 ? names[0] : ''); // one MIDI device plugged in: assume it's the one chosen
    }
    if (profile !== mix.profile || device !== mix.device) mix.ctl = emptyController();
    mix.profile = profile; mix.device = device;
    mix.ctl.connected = !!(profile && device);
    renderOptions(); render();
  }
  midi.onDevices((names) => { mix.devices = names; choose(); });
  midi.onRaw((bytes, device) => {
    if (!mix.ctl.connected || device !== mix.device) return;
    const ev = applyMidi(mix.profile, mix.ctl, bytes, Date.now(), mix.opts);
    if (ev) { advance(); scheduleRender(); }
  });
  midi.initMIDI().catch(() => { /* no Web MIDI or permission refused: manual ticking still works */ });

  // ---------- steps ----------
  function ctx() {
    const n = N(), L = mix.live, d = mix.ctl.decks[n];
    const live = mix.decks[L], next = mix.decks[n];
    const lt = mix.ctl.decks[L].tempo, nt = d.tempo;
    const tempoMatched = live?.bpm && next?.bpm && lt != null && nt != null && Math.abs(deckBpm(next, nt) - deckBpm(live, lt)) < 0.1;
    return {
      ctl: mix.ctl.connected ? mix.ctl : null, N: n, L, hasNext: !!next, tempoMatched,
      has: (c) => !!mix.profile?.has.includes(c),
      since: (b) => mix.ctl.connected && (d.lastPress[b] || 0) > mix.stepStart,
      vision: advice(),                                                  // beat view, when it's on
      phaseHeld: mix.phaseOkSince && Date.now() - mix.phaseOkSince > 1500, // in phase for 1.5 s
      // TRIM turned since this step began (first reading counts as a turn: the knob only reports when moved)
      trimMoved: d.trim != null && (mix.trimAtStart == null || Math.abs(d.trim - mix.trimAtStart) > 0.03),
    };
  }
  function startStep(i) {
    mix.step = i; mix.stepStart = Date.now();
    mix.trimAtStart = mix.ctl.decks[N()].trim;
  }
  /** Tick the current step (and any after it) when the controller shows they're done. */
  function advance() {
    for (let guard = 0; guard < STEPS.length && mix.step < STEPS.length; guard++) {
      const s = STEPS[mix.step];
      if (!s.auto || s.auto(ctx()) !== true) break;
      mix.done.add(s.id); startStep(mix.step + 1);
    }
  }
  function tick(i) {
    if (i < mix.step) { // un-tick: go back to that step
      for (let j = i; j < STEPS.length; j++) mix.done.delete(STEPS[j].id);
      startStep(i);
    } else { for (let j = mix.step; j <= i; j++) mix.done.add(STEPS[j].id); startStep(i + 1); }
    advance(); render();
  }
  function restart(swap) {
    if (swap) { mix.live = N(); mix.decks[N()] = null; }
    mix.done.clear(); startStep(0); advance(); render();
  }

  // ---------- picking tracks ----------
  const picker = $('#picker');
  let pickFor = null;
  function openPicker(deck) {
    pickFor = deck; $('#pickerTitle').textContent = `Track on Deck ${deck}`;
    $('#pickerSearch').value = ''; renderPicker(); picker.showModal(); $('#pickerSearch').focus();
  }
  function renderPicker() {
    const q = $('#pickerSearch').value.trim().toLowerCase();
    const lib = getLibrary();
    const rows = lib.filter((t) => !q || `${t.title} ${t.artist} ${t.camelot || ''}`.toLowerCase().includes(q)).slice(0, 200);
    $('#pickerList').innerHTML = rows.map((t) => `<button data-pick="${esc(t.id)}"><b>${esc(t.title)}</b> <span class="muted">${esc(t.artist)}</span><span class="muted" style="float:right">${t.bpm ? t.bpm.toFixed(1) : '–'} · ${esc(t.camelot || '?')}</span></button>`).join('')
      || `<div class="empty">${lib.length ? 'No matches.' : 'Your library is empty — connect rekordbox or load the demo library (☰ menu).'}</div>`;
  }
  $('#pickerSearch').addEventListener('input', renderPicker);
  $('#pickerList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]'); if (!b) return;
    mix.decks[pickFor] = getLibrary().find((t) => t.id === b.dataset.pick) || null;
    mix.fromScreen[pickFor] = false;
    picker.close(); advance(); render();
  });
  $('#pickerClose').addEventListener('click', () => picker.close());

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-choose]'); if (t) return openPicker(+t.dataset.choose);
    const l = e.target.closest('[data-live]'); if (l) { mix.live = +l.dataset.live; restart(false); return; }
    const k = e.target.closest('[data-tick]'); if (k) return tick(+k.dataset.tick);
    if (e.target.closest('[data-restart]')) return restart(false);
    if (e.target.closest('[data-options]')) return $('#settings').showModal();
    if (e.target.closest('[data-beat-on]')) return beatOn();
    if (e.target.closest('[data-beat-off]')) return beatOff();
    if (e.target.closest('[data-screen-settings]')) return beat.openSettings();
    if (e.target.closest('[data-nextmix]')) return restart(true);
  });

  // ---------- render ----------
  let pending = false;
  function scheduleRender() { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; render(); }); } }

  function deckCard(no) {
    const t = mix.decks[no], live = no === mix.live, c = mix.ctl.decks[no];
    const bpm = deckBpm(t, mix.ctl.connected ? c.tempo : null) || mix.screen[no]?.bpm;
    const watching = beat.cam.state === 'live';
    const moving = watching && beat.cam.moving[no];
    const src = mix.fromScreen[no] ? '<div class="msrc">📺 read from rekordbox</div>'
      : watching && mix.screen[no] && !mix.screen[no].found ? '<div class="msrc warn">📺 This track isn\'t in your library — pick it yourself</div>' : '';
    const tempo = mix.ctl.connected && c.tempo != null ? ` · ${c.tempo >= 0 ? '+' : ''}${c.tempo.toFixed(1)}%` : '';
    return `<div class="mdeck ${live ? 'live' : 'next'}">
      <div class="eyebrow"><span>Deck ${no}${watching ? (moving ? ' ▶︎' : ' ⏸') : ''}</span><span class="${live ? 'tag-live' : 'tag-next'}">${live ? '● Playing' : 'Next'}</span></div>
      ${t ? `<div class="mtitle">${esc(t.title)}</div><div class="sub">${esc(t.artist)}</div>
        <div class="mstats"><b>${bpm ? bpm.toFixed(1) : '–'}</b> BPM${tempo} · <b>${esc(t.camelot || '?')}</b></div>`
        : '<div class="empty">No track</div>'}
      ${src}
      <button class="mchoose" data-choose="${no}">${t ? 'Change' : 'Choose track'}</button>
    </div>`;
  }

  function beatCard() {
    const st = beat.cam.state, isMac = (window.cueDesktop?.platform || navigator.platform).toLowerCase().includes('mac');
    let body;
    if (st === 'live') {
      body = `<canvas class="bmeter" id="bmeter" width="760" height="120"></canvas>
        <div class="blights"><span>Deck 1</span><span class="bl" id="bl1">${'<i></i>'.repeat(4)}</span><span>Deck 2</span><span class="bl" id="bl2">${'<i></i>'.repeat(4)}</span></div>
        <div class="advice" id="badvice"></div>`;
    } else if (st === 'need-permission') {
      body = `<p class="bnote">${isMac ? 'Your Mac needs to let Cue Coach see rekordbox\'s window.' : 'Cue Coach needs permission to see rekordbox\'s window.'}</p>
        <ol class="bsteps"><li>Open <b>System Settings → Privacy &amp; Security → Screen &amp; System Audio Recording</b>.</li><li>Turn on <b>Cue Coach</b> (it may be listed as <b>Electron</b> while testing).</li><li>Quit and reopen Cue Coach, then press <b>Try again</b>.</li></ol>
        <div class="brow">${isMac ? '<button data-screen-settings>Open the settings</button>' : ''}<button class="primary" data-beat-on>Try again</button></div>`;
    } else if (st === 'searching') {
      body = `<p class="bnote">Looking for rekordbox's waveforms… Use rekordbox's <b>2 Deck Horizontal</b> layout so both zoomed waveforms are visible, and load a track on each deck.</p><div class="brow"><button data-beat-off>Turn off</button></div>`;
    } else if (st === 'no-window' || st === 'error') {
      body = `<p class="bnote">${esc(beat.cam.message || 'Couldn\'t watch rekordbox.')}</p><div class="brow"><button class="primary" data-beat-on>Try again</button><button data-beat-off>Turn off</button></div>`;
    } else {
      body = `<p class="bnote">See which tracks are on your decks and whether the beats match, like a phase meter. Cue Coach watches rekordbox's window (only that window; nothing is saved or sent anywhere).</p>
        <div class="brow"><button class="primary" data-beat-on>Turn on beat view</button></div>${isMac && window.cueDesktop ? '<p class="optnote">Your Mac will ask once for Screen Recording permission.</p>' : ''}`;
    }
    return `<div class="panel card" data-beatstate="${st}"><div class="eyebrow"><span>Beatmatch</span>${st === 'live' ? '<span class="tag-live">● watching rekordbox</span>' : ''}</div>${body}</div>`;
  }

  /** Update the meter in place (called ~15×/s), without rebuilding the page. */
  function drawBeat() {
    const a = advice(), r = beat.cam.result, cv = root.querySelector('#bmeter');
    if (!cv || !a || !r) return;
    const c = cv.getContext('2d'), W = cv.width, H = cv.height, css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#0a0c10'; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(61,220,132,.18)'; c.fillRect(W / 2 - W * 0.03, 0, W * 0.06, H);
    c.fillStyle = 'rgba(255,255,255,.3)'; c.fillRect(W / 2, 0, 1, H);
    for (const q of [-0.25, 0.25]) c.fillRect(W / 2 + q * W, H * 0.35, 1, H * 0.3);
    c.font = '20px system-ui'; c.fillStyle = 'rgba(255,255,255,.5)';
    c.fillText('behind', 10, H - 12); c.fillText('ahead', W - 62, H - 12);
    c.fillText(`Deck ${N()}`, W / 2 + 8, 24);
    const x = W / 2 + a.phase * W;
    c.fillStyle = a.phaseOk ? css('--ok') : css('--warn');
    c.fillRect(x - 6, 10, 12, H - 20);
    for (const no of [1, 2]) {
      const lit = r.decks[no].beatInBar;
      root.querySelectorAll(`#bl${no} i`).forEach((el, i) => el.classList.toggle('lit', i + 1 === lit));
    }
    const line = (ok, txt) => `<div class="${ok ? 'good' : 'warn'}">${ok ? '✓ ' : ''}${esc(txt)}</div>`;
    root.querySelector('#badvice').innerHTML = line(a.tempoOk, a.tempo) + line(a.phaseOk, a.beats)
      + (Math.abs(a.phase) < 0.15 ? line(a.barOk, a.bars) : '');
  }

  function render() {
    if (!root) return;
    // Fill empty decks from the Set tab: now playing → live deck, chosen next → next deck.
    const now = nowTrack(), nx = nextTrack();
    if (!mix.decks[mix.live] && now) mix.decks[mix.live] = now;
    if (!mix.decks[N()] && nx && nx.id !== mix.decks[mix.live]?.id) { mix.decks[N()] = nx; advance(); }

    const n = N(), L = mix.live, live = mix.decks[L], next = mix.decks[n];
    const checks = compatChecks(live, next, {
      liveTempo: mix.ctl.connected ? mix.ctl.decks[L].tempo : null,
      nextTempo: mix.ctl.connected ? mix.ctl.decks[n].tempo : null,
      tempoRange: mix.opts.tempoRange,
    });
    const targetBpm = deckBpm(live, mix.ctl.connected ? mix.ctl.decks[L].tempo : null);
    let outHint = '';
    if (live?.grid && next?.grid) {
      const st = (t) => ({ structure: structureFromPhrases(t.phrases, t.grid) });
      const plan = planTransition(live, next, st(live), st(next), phraseBars());
      if (plan) outHint = ` A good place to start: Deck {L}'s bar ${plan.outBar} (${fmtTime(plan.outTime)} into the track).`;
    }
    const fill = (txt) => fillText(fillText(txt, { N: n, L, bpm: targetBpm, outHint }), { N: n, L, bpm: targetBpm });
    const finished = mix.step >= STEPS.length;
    const ctlLine = mix.ctl.connected
      ? `<span class="ok">🎛 ${esc(mix.profile.name)} connected — steps tick themselves as you go</span>`
      : `<span class="muted">🎛 ${mix.opts.controller === 'none' ? 'No controller' : mix.profile ? `${esc(mix.profile.name)} not plugged in` : 'Controller not connected'} — tick each step when you've done it.</span> <button class="link" data-options>Choose controller</button>`;
    const missing = (s) => (mix.profile && s.needs && !mix.profile.has.includes(s.needs)
      ? `<div class="smissing">Your ${esc(mix.profile.name)} has no ${CONTROL_NAMES[s.needs]} — do this in rekordbox on screen, then press Done.</div>` : '');

    root.innerHTML = `
      <div class="panel card">
        <div class="eyebrow"><span>Your decks</span><span class="seg small">${[1, 2].map((d) => `<button data-live="${d}" class="${mix.live === d ? 'sel' : ''}" title="Which deck is playing to the crowd?">Deck ${d} playing</button>`).join('')}</span></div>
        <div class="mdecks">${deckCard(1)}${deckCard(2)}</div>
        <div class="ctlline">${ctlLine}</div>
      </div>
      ${beatCard()}
      ${checks.length ? `<div class="panel card"><div class="eyebrow"><span>Do they mix?</span></div>
        <ul class="checks">${checks.map((c) => `<li class="${c.ok === true ? 'yes' : c.ok === false ? 'no' : 'unk'}"><span class="box">${c.ok === true ? '✓' : c.ok === false ? '✕' : '?'}</span><span><b>${esc(c.label)}</b><br><span class="muted">${esc(c.detail)}</span></span></li>`).join('')}</ul></div>` : ''}
      <div class="panel card">
        <div class="eyebrow"><span>Mix Deck ${n} in · step ${Math.min(mix.step + 1, STEPS.length)} of ${STEPS.length}</span><button class="link" data-restart>Start over</button></div>
        <ol class="steps2">${STEPS.map((s, i) => {
          const state = i < mix.step ? 'done' : i === mix.step ? 'current' : 'todo';
          return `<li class="${state}">
            <button class="tick" data-tick="${i}" title="${state === 'done' ? 'Untick — go back to this step' : 'Mark as done'}">${state === 'done' ? '✓' : i + 1}</button>
            <div><div class="stitle">${esc(fill(s.title))}</div>
            ${state === 'current' ? `<div class="show">${esc(fill(s.how))}</div><div class="swhy">Why: ${esc(fill(s.why))}</div>${missing(s)}
              <button class="primary sdone" data-tick="${i}">Done ✓</button>` : ''}</div></li>`;
        }).join('')}</ol>
        ${finished ? `<div class="callout">🎉 Mix complete! Deck ${n} is playing now. <button class="primary" data-nextmix>Start the next mix</button></div>` : ''}
      </div>`;
    drawBeat();
  }

  // ---------- Options: controller ----------
  function renderOptions() {
    const box = $('#ctlOptions'); if (!box) return;
    const o = mix.opts;
    const opt = (c) => `<option value="${c.id}" ${o.controller === c.id ? 'selected' : ''}>${esc(c.name)}</option>`;
    const status = mix.ctl.connected
      ? `<div class="ctlstatus ok">✓ Connected: ${esc(mix.device)}</div>`
      : `<div class="ctlstatus muted">${mix.devices.length ? `Plugged in: ${esc(mix.devices.join(', '))} — not recognised as ${o.controller === 'auto' ? 'a supported controller' : 'this controller'}.` : 'No controller plugged in right now. You can still choose it.'}</div>`;
    box.innerHTML = `
      <label>Controller<select id="ctlSelect">
        <option value="auto" ${o.controller === 'auto' ? 'selected' : ''}>Detect automatically</option>
        <optgroup label="Works with rekordbox">${CONTROLLERS.filter((c) => c.rekordbox).map(opt).join('')}</optgroup>
        <optgroup label="Other DJ software (Serato, DJUCED…)">${CONTROLLERS.filter((c) => !c.rekordbox).map(opt).join('')}</optgroup>
        <option value="none" ${o.controller === 'none' ? 'selected' : ''}>No controller — I'll tick the steps myself</option>
      </select></label>
      ${status}
      ${mix.profile ? `<div class="ctlhas">Cue Coach can read its: ${mix.profile.has.map((h) => ({ fader: 'channel faders', trim: 'TRIM', hi: 'HI', mid: 'MID', low: 'LOW', filter: 'FILTER', tempo: 'tempo sliders', headphones: 'headphone CUE', play: 'PLAY', cue: 'CUE', sync: 'BEAT SYNC', jog: 'jog wheels', crossfader: 'crossfader', headMix: 'headphone mix' }[h] || h)).join(', ')}.</div>` : ''}
      <label>Tempo range in rekordbox<select id="ctlRange">${[6, 10, 16, 100].map((r) => `<option value="${r}" ${o.tempoRange === r ? 'selected' : ''}>±${r === 100 ? '100 (WIDE)' : r}%</option>`).join('')}</select></label>
      <label style="display:flex;gap:8px;align-items:center"><input id="ctlInvert" type="checkbox" ${o.invertTempo ? 'checked' : ''}> My tempo slider shows the wrong direction</label>
      <p class="optnote">Tick this if pushing the slider up makes Cue Coach's BPM go up when rekordbox's goes down.</p>
      <p class="optnote">Don't see yours? DDJ-FLX2, FLX6 and REV1 aren't supported yet — choose "No controller" and tick the steps yourself.</p>`;
  }
  $('#ctlOptions')?.addEventListener('change', (e) => {
    if (e.target.id === 'ctlSelect') { mix.opts.controller = e.target.value; saveOpts(); choose(); }
    if (e.target.id === 'ctlRange') { mix.opts.tempoRange = +e.target.value; saveOpts(); }
    if (e.target.id === 'ctlInvert') { mix.opts.invertTempo = e.target.checked; saveOpts(); }
  });

  setInterval(() => { if (mix.ctl.connected) { const before = mix.step; advance(); if (mix.step !== before) render(); } }, 500);
  choose();
  try { if (window.cueDesktop && localStorage.getItem('cuecoach.beatview') === 'on') beat.start(); } catch { /* ignore */ }
  return { render, state: mix, choose, beat };
}
