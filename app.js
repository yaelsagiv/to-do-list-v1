/* To do list — personal task manager (vanilla JS, localStorage, PWA) */
(() => {
  'use strict';

  const STORAGE_KEY = 'todo-list-v1';
  const TAB_KEY = 'todo-list-active-tab';
  const SOUND_KEY = 'todo-list-sound';
  const CATS = [
    { id: 'today', label: 'היום', add: 'משימה חדשה להיום…', empty: 'אין משימות להיום 🎉' },
    { id: 'tomorrow', label: 'מחר', add: 'משימה חדשה למחר…', empty: 'אין משימות למחר' },
    { id: 'week', label: 'השבוע', add: 'משימה חדשה לשבוע…', empty: 'אין משימות לשבוע הזה' },
    { id: 'later', label: 'להמשך', add: 'משימה חדשה להמשך…', empty: 'אין משימות להמשך' },
  ];
  const CAT_IDS = CATS.map(c => c.id);
  const catLabel = id => (CATS.find(c => c.id === id) || CATS[0]).label;
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Dates (local time, Israeli week starts Sunday) ---------- */
  const pad = n => String(n).padStart(2, '0');
  const dayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return dayStr(d); };
  const weekStartStr = (d = new Date()) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - x.getDay()); return dayStr(x); };
  const tsDay = ts => (ts ? dayStr(new Date(ts)) : null);
  const maxDay = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---------- State ---------- */
  let state = load();
  let activeCat = readTab();

  function emptyState() {
    return { version: 1, lastDay: dayStr(), lastWeekStart: weekStartStr(), tasks: [] };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      return normalize(JSON.parse(raw));
    } catch (e) {
      console.warn('load failed', e);
      return emptyState();
    }
  }

  // `order` is new: older saves/backups have no order, so the array position
  // (which was the previous display order) becomes the initial order.
  function normalize(data) {
    if (!data || !Array.isArray(data.tasks)) throw new Error('invalid data');
    const today = dayStr();
    return {
      version: 1,
      lastDay: typeof data.lastDay === 'string' ? data.lastDay : today,
      lastWeekStart: typeof data.lastWeekStart === 'string' ? data.lastWeekStart : weekStartStr(),
      tasks: data.tasks.filter(t => t && typeof t.title === 'string').map((t, i) => ({
        id: String(t.id || uid()),
        title: t.title,
        description: typeof t.description === 'string' ? t.description : '',
        category: CAT_IDS.includes(t.category) ? t.category : 'today',
        done: !!t.done,
        doneAt: t.done ? (Number(t.doneAt) || Date.now()) : null,
        createdAt: Number(t.createdAt) || Date.now(),
        categorySetDay: typeof t.categorySetDay === 'string' ? t.categorySetDay : today,
        order: Number.isFinite(t.order) ? t.order : i,
        subtasks: Array.isArray(t.subtasks) ? t.subtasks.filter(s => s && typeof s.title === 'string')
          .map(s => ({ id: String(s.id || uid()), title: s.title, done: !!s.done })) : [],
      })),
    };
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast('שגיאה בשמירה – ייתכן שהאחסון מלא'); }
  }

  function readTab() {
    try { const t = localStorage.getItem(TAB_KEY); if (CAT_IDS.includes(t)) return t; } catch (e) {}
    return 'today';
  }

  const nextOrder = cat => state.tasks.reduce((m, t) => (t.category === cat && t.order > m ? t.order : m), -1) + 1;

  /* ---------- Period rollover ----------
     Idempotent: decisions are based on each task's own dates, so it is safe
     to run any number of times (load, focus, every minute).
     - today:    done tasks are removed once a new day starts (the day after they were done
                 / moved into "today").
     - tomorrow: when the target day (categorySetDay + 1) arrives, the task moves to "today".
                 Done tasks whose target day already passed are removed.
     - week:     done tasks are removed once a new week (Sunday) starts.
     - later:    never auto-removed.                                                       */
  function runRollover() {
    const today = dayStr();
    const weekStart = weekStartStr();
    let changed = false;
    const keep = [];

    for (const t of state.tasks) {
      if (t.category === 'today') {
        if (t.done && maxDay(tsDay(t.doneAt), t.categorySetDay) < today) { changed = true; continue; }
      } else if (t.category === 'tomorrow') {
        const target = addDays(t.categorySetDay, 1);
        if (target < today && t.done) { changed = true; continue; }
        if (target <= today) {
          t.order = nextOrder('today');
          t.category = 'today';
          t.categorySetDay = today;
          changed = true;
        }
      } else if (t.category === 'week') {
        if (t.done && maxDay(tsDay(t.doneAt), t.categorySetDay) < weekStart) { changed = true; continue; }
      }
      keep.push(t);
    }
    state.tasks = keep;

    if (state.lastDay !== today || state.lastWeekStart !== weekStart) {
      state.lastDay = today;
      state.lastWeekStart = weekStart;
      changed = true;
    }
    if (changed) { save(); render(); }
    return changed;
  }

  /* ---------- Task operations ---------- */
  const findTask = id => state.tasks.find(t => t.id === id);

  function addTask(title, category = activeCat) {
    title = title.trim();
    if (!title) return null;
    const task = {
      id: uid(), title, description: '', category, done: false, doneAt: null,
      createdAt: Date.now(), categorySetDay: dayStr(), order: nextOrder(category), subtasks: [],
    };
    state.tasks.push(task);
    save(); render();
    Sound.play('add');
    return task;
  }

  function toggleDone(id, fromEl) {
    const t = findTask(id); if (!t) return;
    t.done = !t.done;
    t.doneAt = t.done ? Date.now() : null;
    save();
    if (t.done) {
      const left = state.tasks.filter(x => x.category === t.category && !x.done).length;
      const r = fromEl && fromEl.getBoundingClientRect();
      if (!left) { Sound.play('all'); r && burst(r.left + r.width / 2, r.top + r.height / 2, 26); }
      else { Sound.play('done'); r && burst(r.left + r.width / 2, r.top + r.height / 2, 10); }
    } else Sound.play('undo');
    render();
    popCheck(listEl.querySelector(`.task[data-id="${CSS.escape(id)}"] .check`));
    if (sheetTaskId === id) { fillSheet(); popCheck($('#sheet-done-toggle')); }
  }

  function moveTask(id, category) {
    const t = findTask(id); if (!t || !CAT_IDS.includes(category)) return;
    if (t.category === category) return;
    t.order = nextOrder(category); // lands at the end of its new list
    t.category = category;
    t.categorySetDay = dayStr();
    save(); render();
    Sound.play('move');
    bumpTab(category);
  }

  // ids: the new sequence of the open tasks in `cat`. Done tasks keep their relative order after them.
  function reorder(cat, ids) {
    const done = sortedTasks(cat).done;
    ids.forEach((id, i) => { const t = findTask(id); if (t) t.order = i; });
    done.forEach((t, i) => { t.order = ids.length + i; });
    save();
  }

  let lastDeleted = null;
  function deleteTask(id) {
    const idx = state.tasks.findIndex(t => t.id === id);
    if (idx < 0) return;
    const [task] = state.tasks.splice(idx, 1);
    lastDeleted = { task, idx };
    save(); render();
    Sound.play('del');
    toast('המשימה נמחקה', 'ביטול', () => {
      if (!lastDeleted) return;
      state.tasks.splice(Math.min(lastDeleted.idx, state.tasks.length), 0, lastDeleted.task);
      lastDeleted = null;
      save(); render();
      Sound.play('add');
    });
  }

  /* ---------- Sounds (Web Audio, synthesized — no files, works offline) ---------- */
  const Sound = (() => {
    let ctx = null, master = null;
    let enabled = (() => { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch (e) { return true; } })();

    function ensure() {
      if (!enabled) return null;
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.55;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(freq, start, dur, { type = 'sine', gain = 0.16, to = null } = {}) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, start);
      if (to) o.frequency.exponentialRampToValueAtTime(to, start + dur);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(gain, start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      o.connect(g); g.connect(master);
      o.start(start); o.stop(start + dur + 0.03);
    }
    const sounds = {
      done: t => { tone(784, t, 0.16, { type: 'triangle' }); tone(1175, t + 0.08, 0.26, { type: 'triangle', gain: 0.13 }); },
      all: t => [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.08, 0.32, { type: 'triangle', gain: 0.12 })),
      undo: t => tone(520, t, 0.14, { to: 380, gain: 0.1 }),
      sub: t => tone(1047, t, 0.12, { type: 'triangle', gain: 0.11 }),
      subAll: t => { tone(880, t, 0.12, { type: 'triangle', gain: 0.11 }); tone(1319, t + 0.07, 0.22, { type: 'triangle', gain: 0.1 }); },
      add: t => tone(420, t, 0.12, { to: 760, gain: 0.12 }),
      move: t => { tone(660, t, 0.09, { gain: 0.1 }); tone(990, t + 0.06, 0.15, { gain: 0.09 }); },
      del: t => tone(330, t, 0.2, { to: 190, type: 'triangle', gain: 0.11 }),
      pick: t => tone(700, t, 0.06, { type: 'triangle', gain: 0.07 }),
      drop: t => tone(520, t, 0.09, { to: 360, type: 'triangle', gain: 0.1 }),
      on: t => { tone(600, t, 0.08, { gain: 0.1 }); tone(900, t + 0.06, 0.12, { gain: 0.1 }); },
    };
    function play(name) {
      const c = ensure(); if (!c || !sounds[name]) return;
      try { sounds[name](c.currentTime + 0.01); } catch (e) { /* audio is optional */ }
    }
    function setEnabled(v) {
      enabled = v;
      try { localStorage.setItem(SOUND_KEY, v ? 'on' : 'off'); } catch (e) {}
      if (v) play('on');
    }
    return { play, setEnabled, get enabled() { return enabled; } };
  })();

  const soundBtn = document.getElementById('sound-btn');
  function renderSoundBtn() {
    const on = Sound.enabled;
    soundBtn.classList.toggle('off', !on);
    soundBtn.setAttribute('aria-pressed', String(on));
    soundBtn.setAttribute('aria-label', on ? 'צלילים פועלים – לחיצה להשתקה' : 'צלילים מושתקים – לחיצה להפעלה');
    soundBtn.title = on ? 'השתקת צלילים' : 'הפעלת צלילים';
  }
  soundBtn.addEventListener('click', () => {
    Sound.setEnabled(!Sound.enabled);
    renderSoundBtn();
    toast(Sound.enabled ? 'הצלילים הופעלו' : 'הצלילים הושתקו');
  });
  renderSoundBtn();

  /* ---------- Small animations ---------- */
  const BURST_COLORS = ['#ff7aac', '#ffdf3d', '#99c5ff', '#121117'];
  let fxLayer = null;
  function burst(x, y, count = 10) {
    if (reducedMotion()) return;
    if (!fxLayer) { fxLayer = document.createElement('div'); fxLayer.className = 'fx-layer'; document.body.append(fxLayer); }
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      p.className = 'confetti';
      p.style.left = x + 'px'; p.style.top = y + 'px';
      p.style.background = BURST_COLORS[i % BURST_COLORS.length];
      const size = 5 + Math.random() * 5;
      p.style.width = size + 'px'; p.style.height = size * (0.6 + Math.random() * 0.8) + 'px';
      fxLayer.append(p);
      const ang = Math.random() * Math.PI * 2;
      const dist = (count > 12 ? 60 : 32) + Math.random() * (count > 12 ? 90 : 40);
      const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist - 18;
      const rot = (Math.random() - 0.5) * 540;
      p.animate([
        { transform: 'translate(-50%,-50%) rotate(0)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${rot}deg)`, opacity: 1, offset: 0.7 },
        { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + 26}px)) rotate(${rot * 1.2}deg)`, opacity: 0 },
      ], { duration: 650 + Math.random() * 250, easing: 'cubic-bezier(.15,.7,.3,1)' }).onfinish = () => p.remove();
    }
  }
  function replayClass(node, cls) {
    if (!node || reducedMotion()) return;
    node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls);
    node.addEventListener('animationend', () => node.classList.remove(cls), { once: true });
  }
  const popCheck = node => replayClass(node, 'pop');
  const bumpTab = cat => replayClass(document.querySelector(`.tab[data-cat="${cat}"]`), 'bump');

  // Slide a task card out before it leaves the list (e.g. quick move to another tab)
  function animateOut(id) {
    const li = listEl.querySelector(`.task[data-id="${CSS.escape(id)}"]`);
    if (!li || reducedMotion() || !li.animate) return Promise.resolve();
    const anim = li.animate([
      { transform: 'none', opacity: 1 },
      { transform: 'translateX(-48px) rotate(-2deg)', opacity: 0 },
    ], { duration: 220, easing: 'ease-in', fill: 'forwards' });
    // never let a throttled animation hold the move back
    return Promise.race([anim.finished.catch(() => {}), new Promise(r => setTimeout(r, 260))]);
  }

  /* ---------- Rendering ---------- */
  const $ = sel => document.querySelector(sel);
  const DATE_FMT = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
  const listEl = $('#task-list');
  const emptyEl = $('#empty');

  function el(tag, props = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'role' || k === 'type') e.setAttribute(k, v);
      else e[k] = v;
    }
    for (const c of children) if (c != null) e.append(c);
    return e;
  }

  function sortedTasks(cat) {
    const list = state.tasks.filter(t => t.category === cat);
    const open = list.filter(t => !t.done).sort((a, b) => (a.order - b.order) || (a.createdAt - b.createdAt));
    const done = list.filter(t => t.done).sort((a, b) => (a.doneAt || 0) - (b.doneAt || 0));
    return { open, done };
  }

  function taskItem(t) {
    const meta = el('span', { class: 'task-meta' });
    if (t.description.trim()) meta.append(el('span', { class: 'chip', text: '📝 תיאור' }));
    if (t.subtasks.length) {
      const d = t.subtasks.filter(s => s.done).length;
      meta.append(el('span', {
        class: 'chip' + (d === t.subtasks.length ? ' complete' : ''),
        text: `☑ ${d}/${t.subtasks.length}`,
      }));
    }
    return el('li', { class: 'task' + (t.done ? ' done' : ''), 'data-id': t.id },
      el('button', {
        class: 'check' + (t.done ? ' on' : ''), type: 'button', 'data-act': 'toggle',
        'aria-label': t.done ? 'בטל סימון השלמה' : 'סמן כהושלמה', 'aria-pressed': String(t.done),
      }),
      el('button', { class: 'task-body', type: 'button', 'data-act': 'open', 'aria-label': 'פרטי המשימה: ' + t.title },
        el('span', { class: 'task-title', text: t.title }),
        meta),
      el('button', {
        class: 'move-btn', type: 'button', 'data-act': 'move', 'data-cat': t.category, 'aria-haspopup': 'true',
        'aria-label': `קטגוריה: ${catLabel(t.category)}. העברה לקטגוריה אחרת`,
      }, catLabel(t.category), el('span', { class: 'chev', 'aria-hidden': 'true', text: '▾' })),
      t.done
        ? el('span', { class: 'grip-space', 'aria-hidden': 'true' })
        : el('button', {
          class: 'grip', type: 'button', 'data-act': 'grip',
          'aria-label': 'שינוי סדר: גרירה, או חיצים למעלה ולמטה', title: 'גרירה לשינוי הסדר',
        }),
    );
  }

  // opts.fresh: the whole list is new (tab switch) → staggered entrance.
  // Otherwise cards that stayed glide from their old position (FLIP) and new cards pop in.
  function render(opts = {}) {
    const animate = !reducedMotion() && !!listEl.animate;
    const prev = new Map();
    if (animate && !opts.fresh) listEl.querySelectorAll('.task').forEach(li => prev.set(li.dataset.id, li.getBoundingClientRect().top));

    const { open, done } = sortedTasks(activeCat);
    listEl.replaceChildren();
    open.forEach(t => listEl.append(taskItem(t)));
    if (done.length) {
      listEl.append(el('li', { class: 'done-sep', text: `הושלמו (${done.length})` }));
      done.forEach(t => listEl.append(taskItem(t)));
    }

    if (animate) {
      let i = 0;
      listEl.querySelectorAll('.task').forEach(li => {
        const oldTop = prev.get(li.dataset.id);
        if (oldTop == null) {
          if (opts.fresh) li.style.animationDelay = Math.min(i++, 10) * 22 + 'ms';
          li.classList.add(opts.fresh ? 'enter' : 'enter-new');
          return;
        }
        const dy = oldTop - li.getBoundingClientRect().top;
        if (Math.abs(dy) > 1) {
          li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
            { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' });
        }
      });
    }

    const cat = CATS.find(c => c.id === activeCat);
    emptyEl.hidden = open.length + done.length > 0;
    emptyEl.dataset.cat = activeCat;
    $('#empty-text').textContent = cat.empty;
    const heading = $('#tab-heading');
    heading.textContent = cat.label;
    heading.dataset.cat = activeCat;
    $('#date-line').textContent = DATE_FMT.format(new Date());
    const count = $('#open-count');
    count.textContent = open.length ? `${open.length} פתוחות` : (done.length ? 'הכול הושלם ✓' : '');
    count.classList.toggle('complete', !open.length && done.length > 0);
    $('#add-input').placeholder = cat.add;

    document.querySelectorAll('.tab').forEach(tab => {
      const c = tab.dataset.cat;
      const isActive = c === activeCat;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
      const n = state.tasks.filter(t => t.category === c && !t.done).length;
      tab.querySelector('.badge').textContent = n ? String(n) : '';
    });
  }

  function setTab(cat) {
    if (!CAT_IDS.includes(cat)) return;
    const changed = cat !== activeCat;
    activeCat = cat;
    try { localStorage.setItem(TAB_KEY, cat); } catch (e) {}
    closeMovePop();
    render({ fresh: changed });
    window.scrollTo({ top: 0 });
  }

  /* ---------- Toast ---------- */
  let toastTimer = null;
  function toast(text, actionLabel = '', onAction = null) {
    const t = $('#toast');
    $('#toast-text').textContent = text;
    const btn = $('#toast-action');
    btn.textContent = actionLabel;
    btn.onclick = () => { hideToast(); onAction && onAction(); };
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 4500);
  }
  function hideToast() { $('#toast').hidden = true; }

  /* ---------- Quick move popover ---------- */
  const movePop = $('#move-pop');
  let moveTaskId = null;

  function openMovePop(id, anchor) {
    const t = findTask(id); if (!t) return;
    moveTaskId = id;
    movePop.replaceChildren(...CATS.map(c => el('button', {
      type: 'button', role: 'menuitem', 'data-cat': c.id,
      class: c.id === t.category ? 'current' : '',
    }, el('span', { text: c.label }), c.id === t.category ? el('span', { class: 'tick', text: '✓' }) : null)));
    movePop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const pw = movePop.offsetWidth, ph = movePop.offsetHeight;
    const vw = window.innerWidth;
    const limit = bottomEl.getBoundingClientRect().top - 8;
    let left = Math.min(Math.max(8, r.left), vw - pw - 8);
    let top = r.bottom + 6;
    if (top + ph > limit) top = Math.max(8, r.top - ph - 6);
    movePop.style.left = left + 'px';
    movePop.style.top = top + 'px';
    movePop.querySelector('button')?.focus({ preventScroll: true });
  }
  function closeMovePop() { movePop.hidden = true; moveTaskId = null; }

  movePop.addEventListener('click', e => {
    const b = e.target.closest('button[data-cat]'); if (!b) return;
    const id = moveTaskId, cat = b.dataset.cat;
    closeMovePop();
    const t = findTask(id);
    if (t && t.category !== cat) {
      animateOut(id).then(() => {
        moveTask(id, cat);
        toast(`הועבר ל"${catLabel(cat)}"`);
      });
    }
  });

  /* ---------- Task details sheet ---------- */
  const sheet = $('#sheet');
  const sheetTitle = $('#sheet-title');
  const sheetDesc = $('#sheet-desc');
  const subList = $('#sub-list');
  const subInput = $('#sub-input');
  let sheetTaskId = null;

  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + ta.offsetHeight - ta.clientHeight) + 'px'; }

  function openSheet(id) {
    if (!findTask(id)) return;
    sheetTaskId = id;
    fillSheet();
    if (typeof sheet.showModal === 'function') sheet.showModal(); else sheet.setAttribute('open', '');
    autoGrow(sheetTitle);
    autoGrow(sheetDesc);
    sheet.scrollTop = 0;
  }

  function fillSheet() {
    const t = findTask(sheetTaskId); if (!t) return;
    if (document.activeElement !== sheetTitle) sheetTitle.value = t.title;
    if (document.activeElement !== sheetDesc) sheetDesc.value = t.description;
    const toggle = $('#sheet-done-toggle');
    toggle.classList.toggle('on', t.done);
    toggle.setAttribute('aria-pressed', String(t.done));

    $('#sheet-cats').replaceChildren(...CATS.map(c => el('button', {
      type: 'button', role: 'radio', 'data-cat': c.id, 'aria-checked': String(c.id === t.category), text: c.label,
    })));
    renderSubtasks();
    autoGrow(sheetDesc);
  }

  function renderSubtasks() {
    const t = findTask(sheetTaskId); if (!t) return;
    subList.replaceChildren(...t.subtasks.map(s => el('li', { class: 'sub-item' + (s.done ? ' done' : ''), 'data-sid': s.id },
      el('button', { type: 'button', class: 'check small' + (s.done ? ' on' : ''), 'data-sact': 'toggle', 'aria-label': 'סימון תת-משימה', 'aria-pressed': String(s.done) }),
      el('input', { type: 'text', value: s.title, 'aria-label': 'תת-משימה', maxLength: 300 }),
      el('button', { type: 'button', class: 'sub-del', 'data-sact': 'delete', 'aria-label': 'מחיקת תת-משימה', text: '✕' }),
    )));
    const d = t.subtasks.filter(s => s.done).length;
    $('#sub-count').textContent = t.subtasks.length ? `(${d}/${t.subtasks.length})` : '';
    // With subtasks, the description box shrinks to its content so more subtasks fit on screen
    sheet.classList.toggle('has-subs', t.subtasks.length > 0);
  }

  function closeSheet() {
    const t = findTask(sheetTaskId);
    if (t && !t.title.trim()) { t.title = 'משימה ללא כותרת'; save(); }
    sheetTaskId = null;
    if (sheet.open) sheet.close();
    render();
  }

  sheetTitle.addEventListener('input', () => {
    const t = findTask(sheetTaskId); if (!t) return;
    sheetTitle.value = sheetTitle.value.replace(/\n/g, ' ');
    t.title = sheetTitle.value;
    autoGrow(sheetTitle);
    save();
  });
  sheetTitle.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sheetTitle.blur(); } });
  sheetDesc.addEventListener('input', () => {
    const t = findTask(sheetTaskId); if (!t) return;
    t.description = sheetDesc.value;
    autoGrow(sheetDesc);
    save();
  });
  sheetDesc.addEventListener('focus', () => autoGrow(sheetDesc));
  sheetDesc.addEventListener('blur', () => autoGrow(sheetDesc));
  $('#sheet-done-toggle').addEventListener('click', e => sheetTaskId && toggleDone(sheetTaskId, e.currentTarget));
  $('#sheet-cats').addEventListener('click', e => {
    const b = e.target.closest('button[data-cat]'); if (!b || !sheetTaskId) return;
    moveTask(sheetTaskId, b.dataset.cat);
    fillSheet();
  });

  function addSubtask() {
    const t = findTask(sheetTaskId); const title = subInput.value.trim();
    if (!t || !title) return;
    t.subtasks.push({ id: uid(), title, done: false });
    subInput.value = '';
    save(); renderSubtasks();
    Sound.play('add');
    replayClass(subList.lastElementChild, 'enter-new');
    subInput.focus();
  }
  $('#sub-add-btn').addEventListener('click', addSubtask);
  subInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addSubtask(); } });

  subList.addEventListener('click', e => {
    const b = e.target.closest('[data-sact]'); if (!b) return;
    const t = findTask(sheetTaskId); if (!t) return;
    const sid = b.closest('[data-sid]').dataset.sid;
    const s = t.subtasks.find(x => x.id === sid); if (!s) return;
    if (b.dataset.sact === 'toggle') {
      s.done = !s.done;
      if (s.done) {
        const all = t.subtasks.every(x => x.done);
        Sound.play(all ? 'subAll' : 'sub');
        const r = b.getBoundingClientRect();
        burst(r.left + r.width / 2, r.top + r.height / 2, all ? 18 : 7);
      } else Sound.play('undo');
    } else if (b.dataset.sact === 'delete') {
      t.subtasks = t.subtasks.filter(x => x !== s);
      Sound.play('del');
    }
    save(); renderSubtasks();
    popCheck(subList.querySelector(`[data-sid="${CSS.escape(sid)}"] .check`));
  });
  subList.addEventListener('input', e => {
    if (e.target.tagName !== 'INPUT') return;
    const t = findTask(sheetTaskId); if (!t) return;
    const s = t.subtasks.find(x => x.id === e.target.closest('[data-sid]').dataset.sid);
    if (s) { s.title = e.target.value; save(); }
  });
  subList.addEventListener('change', e => {
    // an emptied subtask title is removed on blur
    if (e.target.tagName !== 'INPUT' || e.target.value.trim()) return;
    const t = findTask(sheetTaskId); if (!t) return;
    const sid = e.target.closest('[data-sid]').dataset.sid;
    t.subtasks = t.subtasks.filter(x => x.id !== sid);
    save(); renderSubtasks();
  });
  subList.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); e.target.blur(); }
  });

  $('#sheet-delete').addEventListener('click', () => {
    const t = findTask(sheetTaskId); if (!t) return;
    if (!confirm(`למחוק את המשימה "${t.title}"?`)) return;
    const id = sheetTaskId;
    sheetTaskId = null;
    sheet.close();
    deleteTask(id);
  });

  $('#sheet-form').addEventListener('submit', e => { e.preventDefault(); closeSheet(); });
  sheet.addEventListener('cancel', e => { e.preventDefault(); closeSheet(); });
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
  sheet.addEventListener('close', () => { if (sheetTaskId) closeSheet(); });
  // keep the focused field visible above the on-screen keyboard
  sheet.addEventListener('focusin', e => {
    if (!e.target.matches('input, textarea')) return;
    setTimeout(() => e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 320);
  });

  /* ---------- List interactions ---------- */
  listEl.addEventListener('click', e => {
    if (drag.suppressClick) { e.preventDefault(); e.stopPropagation(); drag.suppressClick = false; return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.closest('[data-id]').dataset.id;
    const act = b.dataset.act;
    if (act === 'toggle') toggleDone(id, b);
    else if (act === 'open') openSheet(id);
    else if (act === 'move') {
      if (!movePop.hidden && moveTaskId === id) closeMovePop(); else openMovePop(id, b);
    }
  });

  /* ---------- Drag & drop reordering ----------
     - Grip (⋮⋮) at the card's end: drag immediately (touch or mouse).
     - Anywhere on the card text: long-press on touch, or press-and-move with a mouse.
     - Keyboard: ArrowUp / ArrowDown on the grip.
     Only open tasks are reordered; done tasks stay at the bottom.                    */
  const drag = { pending: null, active: null, suppressClick: false, raf: 0 };
  const LONG_PRESS = 380;

  listEl.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const li = e.target.closest('.task'); if (!li || li.classList.contains('done')) return;
    const onGrip = !!e.target.closest('.grip');
    if (!onGrip && !e.target.closest('.task-body')) return;
    const p = { li, id: li.dataset.id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, type: e.pointerType };
    if (onGrip) { e.preventDefault(); startDrag(p, e.clientY); return; }
    if (e.pointerType !== 'mouse') {
      p.timer = setTimeout(() => { if (drag.pending === p) startDrag(p, p.y); }, LONG_PRESS);
      li.classList.add('pressing');
    }
    drag.pending = p;
  });

  window.addEventListener('pointermove', e => {
    const p = drag.pending;
    if (p && e.pointerId === p.pointerId) {
      const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
      p.y = e.clientY;
      if (moved > 8) {
        if (p.type === 'mouse') startDrag(p, e.clientY);
        else cancelPending(); // the user is scrolling
      }
    }
    if (drag.active && e.pointerId === drag.active.pointerId) {
      e.preventDefault();
      updateDrag(e.clientY);
    }
  }, { passive: false });

  window.addEventListener('pointerup', e => {
    cancelPending();
    if (drag.active && e.pointerId === drag.active.pointerId) endDrag(true);
  });
  window.addEventListener('pointercancel', e => {
    cancelPending();
    if (drag.active && e.pointerId === drag.active.pointerId) endDrag(true);
  });
  // stop the page from scrolling while a card is held (touch long-press drag)
  document.addEventListener('touchmove', e => { if (drag.active) e.preventDefault(); }, { passive: false });
  listEl.addEventListener('contextmenu', e => { if (e.target.closest('.task')) e.preventDefault(); });

  function cancelPending() {
    const p = drag.pending; if (!p) return;
    clearTimeout(p.timer);
    p.li.classList.remove('pressing');
    drag.pending = null;
  }

  function startDrag(p, clientY) {
    cancelPending();
    closeMovePop();
    const items = [...listEl.querySelectorAll('.task:not(.done)')];
    const idx = items.indexOf(p.li);
    if (idx < 0) return;
    const sy = window.scrollY;
    const rects = items.map(x => { const r = x.getBoundingClientRect(); return { top: r.top + sy, h: r.height }; });
    const gap = items.length > 1 ? rects[1].top - (rects[0].top + rects[0].h) : 6;
    drag.active = { li: p.li, id: p.id, items, rects, idx, to: idx, gap, pointerId: p.pointerId, startDocY: clientY + sy, curY: clientY };
    p.li.classList.add('dragging');
    listEl.classList.add('reordering');
    document.body.classList.add('is-dragging');
    if (navigator.vibrate && p.type !== 'mouse') try { navigator.vibrate(12); } catch (e) {}
    Sound.play('pick');
    drag.raf = requestAnimationFrame(autoScroll);
  }

  function updateDrag(clientY) {
    const a = drag.active; if (!a) return;
    a.curY = clientY;
    const dy = clientY + window.scrollY - a.startDocY;
    a.li.style.transform = `translateY(${dy}px) scale(1.02) rotate(-1deg)`;
    const me = a.rects[a.idx];
    const center = me.top + dy + me.h / 2;
    let to = 0;
    a.rects.forEach((r, j) => { if (j !== a.idx && r.top + r.h / 2 < center) to++; });
    if (to === a.to) return;
    a.to = to;
    const shift = me.h + a.gap;
    a.items.forEach((item, j) => {
      if (j === a.idx) return;
      let s = 0;
      if (a.idx < to && j > a.idx && j <= to) s = -shift;
      else if (to < a.idx && j >= to && j < a.idx) s = shift;
      item.style.transform = s ? `translateY(${s}px)` : '';
    });
  }

  function autoScroll() {
    const a = drag.active; if (!a) return;
    const edgeTop = 80, bottomTop = bottomEl.getBoundingClientRect().top;
    let v = 0;
    if (a.curY < edgeTop) v = -Math.ceil((edgeTop - a.curY) / 6);
    else if (a.curY > bottomTop - 60) v = Math.ceil((a.curY - (bottomTop - 60)) / 6);
    if (v) {
      const before = window.scrollY;
      window.scrollBy(0, Math.max(-18, Math.min(18, v)));
      if (window.scrollY !== before) updateDrag(a.curY);
    }
    drag.raf = requestAnimationFrame(autoScroll);
  }

  function endDrag(commit) {
    const a = drag.active; if (!a) return;
    drag.active = null;
    cancelAnimationFrame(drag.raf);
    listEl.classList.remove('reordering');
    document.body.classList.remove('is-dragging');
    drag.suppressClick = true;
    setTimeout(() => { drag.suppressClick = false; }, 0);
    const ids = a.items.map(x => x.dataset.id);
    if (commit && a.to !== a.idx) {
      ids.splice(a.to, 0, ids.splice(a.idx, 1)[0]);
      reorder(activeCat, ids);
      Sound.play('drop');
    }
    render(); // FLIP glides every card from where it is shown now into place
  }

  // Keyboard reordering on the grip
  listEl.addEventListener('keydown', e => {
    if (!e.target.matches('.grip') || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const id = e.target.closest('.task').dataset.id;
    const ids = sortedTasks(activeCat).open.map(t => t.id);
    const i = ids.indexOf(id), j = i + (e.key === 'ArrowUp' ? -1 : 1);
    if (i < 0 || j < 0 || j >= ids.length) return;
    ids.splice(j, 0, ids.splice(i, 1)[0]);
    reorder(activeCat, ids);
    render();
    Sound.play('drop');
    listEl.querySelector(`.task[data-id="${CSS.escape(id)}"] .grip`)?.focus();
  });

  document.addEventListener('click', e => {
    if (!movePop.hidden && !e.target.closest('#move-pop') && !e.target.closest('[data-act="move"]')) closeMovePop();
    if (!menu.hidden && !e.target.closest('#menu') && !e.target.closest('#menu-btn')) toggleMenu(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeMovePop(); toggleMenu(false); }
  });
  window.addEventListener('scroll', () => { if (!drag.active) closeMovePop(); }, { passive: true });
  window.addEventListener('resize', closeMovePop);

  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => setTab(tab.dataset.cat)));

  $('#add-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#add-input');
    if (addTask(input.value)) {
      input.value = '';
      input.focus();
      requestAnimationFrame(() => {
        const items = listEl.querySelectorAll('.task:not(.done)');
        const last = items[items.length - 1];
        last && last.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }
  });

  /* ---------- On-screen keyboard ----------
     The add bar is fixed to the bottom of the *visible* viewport, so the keyboard
     lifts only the bar instead of pushing the whole page around. While typing a new
     task on a phone the tabs hide, leaving one clean input row above the keyboard. */
  const root = document.documentElement;
  const bottomEl = $('.bottom');
  const addInput = $('#add-input');
  const coarse = window.matchMedia('(pointer: coarse)');

  function syncViewport() {
    const vv = window.visualViewport;
    const kb = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
    root.style.setProperty('--kb', kb + 'px');
    root.style.setProperty('--vvh', Math.round(vv ? vv.height : window.innerHeight) + 'px');
    document.body.classList.toggle('kb-open', kb > 80);
  }
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', syncViewport);
    visualViewport.addEventListener('scroll', syncViewport);
  }
  window.addEventListener('resize', syncViewport);
  syncViewport();

  addInput.addEventListener('focus', () => {
    if (!coarse.matches) return;
    document.body.classList.add('typing');
    // iOS scrolls the page to "reveal" a focused fixed input — undo that jump
    const y = window.scrollY;
    setTimeout(() => { if (Math.abs(window.scrollY - y) > 2) window.scrollTo({ top: y }); syncViewport(); }, 60);
  });
  addInput.addEventListener('blur', () => {
    setTimeout(() => { if (document.activeElement !== addInput) document.body.classList.remove('typing'); }, 120);
  });

  // reserve room under the list for the fixed bottom bar, whatever its height
  const setBottomH = () => root.style.setProperty('--bottom-h', bottomEl.offsetHeight + 'px');
  if ('ResizeObserver' in window) new ResizeObserver(setBottomH).observe(bottomEl);
  setBottomH();

  /* ---------- Menu: export / import / clear ---------- */
  const menu = $('#menu');
  const menuBtn = $('#menu-btn');
  function toggleMenu(force) {
    const show = force ?? menu.hidden;
    menu.hidden = !show;
    menuBtn.setAttribute('aria-expanded', String(show));
  }
  menuBtn.addEventListener('click', () => toggleMenu());

  menu.addEventListener('click', e => {
    const b = e.target.closest('[data-action]'); if (!b) return;
    toggleMenu(false);
    const a = b.dataset.action;
    if (a === 'export') exportJSON();
    else if (a === 'import') $('#import-file').click();
    else if (a === 'clear-done') clearDone();
  });

  function exportJSON() {
    const data = JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `todo-backup-${dayStr()}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('הגיבוי יוצא');
  }

  $('#import-file').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = normalize(JSON.parse(await file.text()));
      if (!confirm(`לשחזר ${data.tasks.length} משימות מהגיבוי? הנתונים הנוכחיים יוחלפו.`)) return;
      state = data;
      save();
      runRollover();
      render({ fresh: true });
      toast('הגיבוי שוחזר בהצלחה');
    } catch (err) {
      toast('הקובץ אינו גיבוי תקין');
    }
  });

  function clearDone() {
    const n = state.tasks.filter(t => t.category === activeCat && t.done).length;
    if (!n) { toast('אין משימות שהושלמו בלשונית זו'); return; }
    if (!confirm(`למחוק ${n} משימות שהושלמו מ"${catLabel(activeCat)}"?`)) return;
    state.tasks = state.tasks.filter(t => !(t.category === activeCat && t.done));
    save(); render();
    Sound.play('del');
    toast(`נמחקו ${n} משימות`);
  }

  /* ---------- Lifecycle ---------- */
  runRollover();
  render({ fresh: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) runRollover(); });
  window.addEventListener('focus', runRollover);
  setInterval(runRollover, 60 * 1000);
  // keep multiple open tabs in sync
  window.addEventListener('storage', e => {
    if (e.key === STORAGE_KEY && !drag.active) { state = load(); render(); if (sheetTaskId) fillSheet(); }
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW registration failed', err));
    });
  }

  // exposed for debugging / testing in the console
  window.todoApp = { get state() { return state; }, runRollover, save, render, reorder };
})();
