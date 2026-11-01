import { db, auth, fs, au } from './firebase-init.js';
import { RAZORPAY_KEY_ID } from './firebase-config.js';

/* ───────── helpers ───────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = n => Math.round(n * 100) / 100;
const money = n => '₹' + r2(n).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(r2(n)) ? 0 : 2, maximumFractionDigits: 2 });
const col = n => fs.collection(db, n);
const ts = x => x?.seconds || 0;
const fmtDate = x => x?.seconds ? new Date(x.seconds * 1000).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Just now';
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
const GST = 0.18;
const ico = (n, c = '') => `<svg class="i ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const ICONS = new Set(['cup', 'box', 'leaf', 'card', 'clock', 'heart', 'star', 'pin', 'phone', 'mail', 'user', 'bag']);
const featIcon = s => ICONS.has(s) ? ico(s) : esc(s);
const debounce = (fn, ms = 120) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const toast = (msg, type = 'ok') => { const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg; $('#toast').append(t); setTimeout(() => t.classList.add('out'), 2600); setTimeout(() => t.remove(), 3100); };
const km = (a, b, c, d) => { const R = 6371, t = x => x * Math.PI / 180, dLa = t(c - a), dLo = t(d - b); const h = Math.sin(dLa / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const LIBS = { three: 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', leaflet: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js' };
const libP = {};
const loadLib = k => libP[k] ||= new Promise((res, rej) => {
  if (k === 'leaflet') { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.append(l); }
  const s = document.createElement('script'); s.src = LIBS[k]; s.onload = res; s.onerror = () => { delete libP[k]; rej(); }; document.head.append(s);
});
const skel = (n = 6, cls = '') => `<div class="grid">${Array.from({ length: n }, () => `<div class="sk ${cls}"></div>`).join('')}</div>`;
const empty = (t, sub = '') => `<div class="empty"><h3>${t}</h3><p>${sub}</p></div>`;

/* ───────── defaults ───────── */
const D = {
  delivery: { enabled: true, charge: 40, radiusKm: 5, minOrder: 150, cafeLat: 28.6139, cafeLng: 77.2090, cafeName: 'The Yaari Cafe' },
  home: {
    heroTitle: 'Chai, coffee and the people you love',
    heroSub: "Fresh food, slow brews and warm corners. Order from The Yaari Cafe and we'll bring it to your door.",
    banner: '',
    features: [
      { icon: 'cup', title: 'Brewed to order', text: 'Small-batch coffee and chai, made when you order it.' },
      { icon: 'box', title: 'Home delivery', text: 'Hot food from our kitchen to your doorstep.' },
      { icon: 'leaf', title: 'Honest ingredients', text: 'Seasonal produce and no shortcuts in the kitchen.' },
      { icon: 'card', title: 'Easy payments', text: 'UPI, cards and netbanking through Razorpay.' }
    ]
  },
  about: {
    title: 'A corner café built for long conversations',
    story: "The Yaari Cafe started with one idea: a place where friends can sit for hours over good coffee.\n\nToday we cook fresh every day and deliver the same food to your home, so the yaari never has to stop.",
    hours: [{ days: 'Monday to Friday', time: '9:00 AM – 11:00 PM' }, { days: 'Saturday and Sunday', time: '8:00 AM – 12:00 AM' }],
    phone: '', email: 'theyaari@cafe.com', address: '',
    team: [{ name: 'Head chef', role: 'Kitchen' }, { name: 'Barista lead', role: 'Coffee bar' }, { name: 'Delivery captain', role: 'Home delivery' }]
  }
};

/* ───────── state ───────── */
const state = {
  delivery: D.delivery, home: D.home, about: D.about,
  cats: [], menu: [], gallery: [], reviews: [], orders: [],
  user: null, profile: null, confirm: null, loaded: { menu: false },
  cart: JSON.parse(localStorage.getItem('yaari_cart') || '{}'),
  form: JSON.parse(localStorage.getItem('yaari_form') || '{}')
};
let cur = null, hero = null, map = null, marker = null, circle = null, cafeMk = null;
const persistCart = () => localStorage.setItem('yaari_cart', JSON.stringify(state.cart));
const saveForm = () => localStorage.setItem('yaari_form', JSON.stringify(state.form));
const cartCount = () => Object.entries(state.cart).reduce((a, [id, q]) => a + (state.loaded.menu && !state.menu.some(m => m.id === id) ? 0 : q), 0);
function sortedMenu() {
  const idx = n => { const i = state.cats.findIndex(c => c.name === n); return i < 0 ? 99 : i; };
  return [...state.menu].sort((a, b) => idx(a.category) - idx(b.category) || a.name.localeCompare(b.name));
}
function getBill() {
  const lines = []; for (const [id, qty] of Object.entries(state.cart)) { const it = state.menu.find(m => m.id === id); if (it) lines.push({ ...it, qty }); }
  const subtotal = r2(lines.reduce((s, l) => s + l.price * l.qty, 0)), gst = r2(subtotal * GST);
  const d = state.delivery, dc = d.enabled && lines.length ? Number(d.charge) || 0 : 0;
  return { lines, subtotal, gst, dc, total: r2(subtotal + gst + dc) };
}

/* ───────── cart ───────── */
const ctl = it => {
  if (!it) return '';
  if (it.status === 'out') return `<button class="add off" disabled>Unavailable</button>`;
  const q = state.cart[it.id] || 0;
  return q ? `<div class="qty"><button data-act="dec" data-id="${it.id}" aria-label="Remove one">${ico('minus')}</button><span>${q}</span><button data-act="inc" data-id="${it.id}" aria-label="Add one">${ico('plus')}</button></div>`
    : `<button class="add" data-act="add" data-id="${it.id}">${ico('plus')}<span>Add</span></button>`;
};
const syncCtl = id => { const it = state.menu.find(m => m.id === id); $$(`[data-ctl="${id}"]`).forEach(el => el.innerHTML = ctl(it)); };
function onCartChange(id) {
  persistCart(); if (id) syncCtl(id); renderChrome();
  if (cur === 'order' && !state.confirm && $('#oCart')) { fillCart(); fillBill(); }
}
function addToCart(id) {
  const it = state.menu.find(m => m.id === id);
  if (!it || it.status === 'out') return toast('This item is out of stock', 'bad');
  state.cart[id] = (state.cart[id] || 0) + 1; onCartChange(id); toast(`${it.name} added`);
}
function setQty(id, q) { if (q <= 0) delete state.cart[id]; else state.cart[id] = q; onCartChange(id); }

/* ───────── realtime data ───────── */
let errShown = false;
const listen = (q, fn) => fs.onSnapshot(q, fn, e => { console.warn('Firestore:', e.message); state.loaded.menu = true; changed('menu'); if (!errShown) { errShown = true; toast('Could not load data. Check internet and Firestore rules.', 'bad'); } });
listen(fs.doc(db, 'settings', 'delivery'), s => { state.delivery = { ...D.delivery, ...(s.data() || {}) }; changed('delivery'); });
listen(fs.doc(db, 'content', 'home'), s => { state.home = { ...D.home, ...(s.data() || {}) }; changed('home'); });
listen(fs.doc(db, 'content', 'about'), s => { state.about = { ...D.about, ...(s.data() || {}) }; changed('about'); });
listen(col('categories'), s => { state.cats = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); changed('menu'); });
listen(col('menu'), s => {
  state.menu = s.docs.map(d => ({ id: d.id, ...d.data() })); state.loaded.menu = true;
  if (!s.metadata.fromCache) { let ch = false; for (const id of Object.keys(state.cart)) if (!state.menu.some(m => m.id === id)) { delete state.cart[id]; ch = true; } if (ch) persistCart(); }
  changed('menu');
});
listen(col('gallery'), s => { state.gallery = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ts(b.createdAt) - ts(a.createdAt)); changed('gallery'); });
listen(col('reviews'), s => { state.reviews = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ts(b.createdAt) - ts(a.createdAt)); changed('reviews'); });

let unsubOrders = null, unsubProfile = null;
au.onAuthStateChanged(auth, u => {
  state.user = u; unsubOrders?.(); unsubProfile?.(); state.orders = []; state.profile = null;
  if (u) {
    unsubProfile = listen(fs.doc(db, 'users', u.uid), s => { state.profile = s.data() || null; if (state.profile?.phone && !state.form.phone) state.form.phone = state.profile.phone; changed('profile'); });
    unsubOrders = listen(fs.query(col('orders'), fs.where('uid', '==', u.uid)), s => { state.orders = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ts(b.createdAt) - ts(a.createdAt)); changed('orders'); });
  }
  changed('auth');
});

const pend = new Set(); let sched = 0;
function changed(kind) {
  pend.add(kind); if (sched) return;
  sched = requestAnimationFrame(() => {
    sched = 0; const ks = [...pend]; pend.clear(); renderChrome();
    const p = pages[cur]; if (!p) return;
    p.updateMany ? p.updateMany(ks) : ks.forEach(k => p.update?.(k));
  });
}

/* ───────── chrome ───────── */
const LINKS = [['home', 'Home'], ['menu', 'Menu'], ['order', 'Order'], ['gallery', 'Gallery'], ['reviews', 'Reviews'], ['about', 'About']];
function renderChrome() {
  const d = state.delivery, name = d.cafeName || 'The Yaari Cafe', n = cartCount(), a = state.about;
  const initial = (state.profile?.name || state.user?.displayName || state.user?.email || '').trim()[0]?.toUpperCase();
  $('#nav').innerHTML = `
    <a class="brand" href="#/home"><span class="mark">${ico('cup')}</span>${esc(name)}</a>
    <nav class="links" aria-label="Main">${LINKS.map(([k, l]) => `<a href="#/${k}" class="${cur === k ? 'active' : ''}">${l}</a>`).join('')}</nav>
    <div class="nav-actions">
      <a class="icon-btn" href="#/order" aria-label="Your order">${ico('bag')}${n ? `<b>${n}</b>` : ''}</a>
      <a class="avatar-btn" href="#/profile" aria-label="${state.user ? 'Your profile' : 'Login or register'}">${initial || ico('user')}</a>
      <button class="icon-btn burger" data-act="burger" aria-label="Menu">${ico('menu')}</button>
    </div>`;
  $('#footer').innerHTML = `<div><div class="brand"><span class="mark">${ico('cup')}</span>${esc(name)}</div><p style="max-width:34ch">Fresh food and slow brews, delivered to your door.</p><small>© ${new Date().getFullYear()} ${esc(name)}. Prices exclude 18% GST.</small></div>
    <div><h4>Explore</h4>${LINKS.map(([k, l]) => `<a href="#/${k}">${l}</a>`).join('')}</div>
    <div><h4>Visit</h4><p>${esc(a.address || 'Order online for home delivery')}</p>${a.phone ? `<a href="tel:${esc(a.phone)}">${esc(a.phone)}</a>` : ''}${a.email ? `<a href="mailto:${esc(a.email)}">${esc(a.email)}</a>` : ''}</div>`;
  const bar = $('#cartBar');
  if (n) { bar.innerHTML = `${ico('bag')}<span>${n} item${n > 1 ? 's' : ''}</span><i class="sep"></i><b>${money(getBill().subtotal)}</b><span class="go">${cur === 'order' ? 'Checkout' : 'View order'}${ico('arrow')}</span>`; bar.classList.add('show'); }
  else { bar.classList.remove('show'); bar.innerHTML = ''; }
}

/* ───────── dish card ───────── */
function dishCard(it) {
  const out = it.status === 'out';
  return `<article class="dish tilt ${out ? 'is-out' : ''}">
    <div class="dish-img">${it.image ? `<img src="${it.image}" alt="${esc(it.name)}" loading="lazy" decoding="async">` : `<div class="ph">${esc(it.name[0] || '?')}</div>`}
      <span class="state ${out ? 'bad' : 'ok'}"><i></i>${out ? 'Out of stock' : 'Available'}</span></div>
    <div class="dish-body"><div class="dish-title"><h3>${esc(it.name)}</h3><span class="veg ${it.veg ? 'v' : 'n'}" title="${it.veg ? 'Vegetarian' : 'Non-vegetarian'}"></span></div>
      <p>${esc(it.desc || '')}</p>
      <div class="dish-foot"><b class="price">${money(it.price)}</b><div data-ctl="${it.id}">${ctl(it)}</div></div></div></article>`;
}
const reviewCard = r => `<article class="rcard"><span class="stars">${stars(r.rating)}</span><p>${esc(r.text)}</p><header><span class="av">${esc((r.name || '?')[0].toUpperCase())}</span><div><b>${esc(r.name)}</b><small>${fmtDate(r.createdAt)}</small></div></header></article>`;

/* ───────── HOME ───────── */
const CUP_SVG = `<svg class="fallback" viewBox="0 0 400 400" aria-hidden="true"><ellipse cx="200" cy="322" rx="140" ry="26" fill="rgba(19,37,31,.14)"/><ellipse cx="200" cy="304" rx="122" ry="24" fill="#fff"/><path d="M296 190h12a26 26 0 0 1 0 52h-26" fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round"/><path d="M118 172H282L264 266Q259 296 228 296H172Q141 296 136 266Z" fill="#fff"/><ellipse cx="200" cy="172" rx="82" ry="15" fill="#5B3622"/><path d="M170 140q-10-22 0-44M200 134q-10-26 0-52M230 140q-10-22 0-44" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="6" stroke-linecap="round"/></svg>`;
function mountHome() {
  $('#app').innerHTML = `<div class="page"><div id="hBanner"></div>
    <section class="hero"><div><h1 id="hTitle"></h1><p class="lead" id="hSub"></p>
      <div class="cta-row"><a class="btn btn-dark btn-lg" href="#/order">Order now ${ico('arrow')}</a><a class="btn btn-soft btn-lg" href="#/menu">See the menu</a></div><div class="proof" id="hProof"></div></div>
      <div class="stage" id="stage"><div class="disc"></div>${CUP_SVG}<canvas id="heroCanvas" aria-label="Interactive 3D coffee cup"></canvas>
        <div class="chip-float c1" id="chipA"></div><div class="chip-float c2" id="chipB"></div><span class="hint">Drag to spin the cup</span></div></section>
    <section class="facts" id="hFacts"></section>
    <section class="sec" id="hFeat"></section><section class="sec" id="hPop"></section>
    <section class="sec" id="hSteps"></section><section class="sec" id="hRev"></section>
    <section class="cta"><h2>Hungry? Your table is at home.</h2><a class="btn btn-gold btn-lg" href="#/order">Start your order ${ico('arrow')}</a></section></div>`;
  fillHome();
  const stage = $('#stage');
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches && !navigator.connection?.saveData) {
    loadLib('three').then(() => { if (cur === 'home' && !hero) hero = initHero($('#heroCanvas'), stage); }).catch(() => { });
  }
}
function fillHome() {
  if (!$('#hTitle')) return;
  const h = state.home, d = state.delivery, rv = state.reviews, n = rv.length, avg = n ? rv.reduce((s, r) => s + r.rating, 0) / n : 0, avail = state.menu.filter(m => m.status !== 'out').length;
  $('#hBanner').innerHTML = h.banner ? `<div class="announce">${ico('star')}${esc(h.banner)}</div>` : '';
  $('#hTitle').textContent = h.heroTitle; $('#hSub').textContent = h.heroSub;
  $('#hProof').innerHTML = n ? `<span class="stars">${stars(Math.round(avg))}</span><span><b>${avg.toFixed(1)}</b> from ${n} review${n > 1 ? 's' : ''}</span>` : '';
  $('#chipA').innerHTML = n ? `${ico('star', 'gold')}<span><b>${avg.toFixed(1)} rating</b><br>${n} review${n > 1 ? 's' : ''}</span>` : `${ico('cup')}<span><b>${avail} dishes</b><br>on the menu today</span>`;
  $('#chipB').innerHTML = `${ico('box')}<span>${d.enabled ? `<b>Home delivery</b><br>within ${d.radiusKm} km` : '<b>Delivery paused</b><br>back soon'}</span>`;
  $('#hFacts').innerHTML = `<div><b>${n ? avg.toFixed(1) : 'New'}</b><span>Guest rating</span></div><div><b>${avail}</b><span>Dishes available now</span></div><div><b>${d.enabled ? d.radiusKm + ' km' : 'Paused'}</b><span>Home delivery range</span></div><div><b>${d.enabled ? money(d.charge) : '–'}</b><span>Delivery charge</span></div>`;
  $('#hFeat').innerHTML = `<div class="ledger">${(h.features || []).map(f => `<div><div class="tile-ic">${featIcon(f.icon)}</div><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p></div>`).join('')}</div>`;
  const pop = sortedMenu().filter(m => m.featured && m.status !== 'out'), list = (pop.length ? pop : sortedMenu().filter(m => m.status !== 'out')).slice(0, 6);
  $('#hPop').innerHTML = `<div class="sec-head"><div><h2>Popular right now</h2><p>What our guests keep coming back for.</p></div><a class="btn btn-soft" href="#/menu">Full menu ${ico('arrow')}</a></div>` + (!state.loaded.menu ? skel(3) : list.length ? `<div class="grid cols3">${list.map(dishCard).join('')}</div>` : empty('Menu is being prepared', 'Check back in a few minutes.'));
  $('#hSteps').innerHTML = `<div class="sec-head"><h2>Three steps to your door</h2></div><ol class="steps">
    <li><span class="sn">1</span><h3>Pick your food</h3><p>Browse the menu and add what you like. Out-of-stock items are marked clearly.</p></li>
    <li><span class="sn">2</span><h3>Pin your location</h3><p>Drop a pin on the map so our rider finds your exact door.</p></li>
    <li><span class="sn">3</span><h3>Pay and wait</h3><p>Pay securely with Razorpay. Your order is confirmed instantly.</p></li></ol>`;
  $('#hRev').innerHTML = n ? `<div class="sec-head"><h2>Kind words</h2><a class="btn btn-soft" href="#/reviews">All reviews ${ico('arrow')}</a></div><div class="grid">${rv.slice(0, 3).map(reviewCard).join('')}</div>` : '';
}
function leaveHome() { hero?.destroy(); hero = null; }

/* 3D hero: cup, saucer, donut, macaron, beans, steam */
function initHero(canvas, stage) {
  if (!window.THREE || !canvas) return null;
  const T = THREE;
  let renderer; try { renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' }); } catch { return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  const scene = new T.Scene(), cam = new T.PerspectiveCamera(32, 1, .1, 100); cam.position.set(0, 5.2, 15); cam.lookAt(0, 1.1, 0);
  scene.add(new T.HemisphereLight(0xffffff, 0xf2d9a8, 1));
  const sun = new T.DirectionalLight(0xffffff, .85); sun.position.set(4, 8, 6); scene.add(sun);
  const warm = new T.PointLight(0xffc36b, .6, 30); warm.position.set(-5, 3, 4); scene.add(warm);
  const root = new T.Group(); root.scale.setScalar(.95); scene.add(root);
  const std = (c, r = .35, m = 0) => new T.MeshStandardMaterial({ color: c, roughness: r, metalness: m, side: T.DoubleSide });
  const V = a => a.map(p => new T.Vector2(p[0], p[1]));
  const ceramic = std(0xffffff, .2, .05), ink = std(0x13251F, .3);
  root.add(new T.Mesh(new T.LatheGeometry(V([[0, 0], [1.5, 0], [2.3, .22], [2.36, .32], [2.26, .32], [1.4, .13], [0, .13]]), 56), ceramic));
  const cupG = new T.Group(); cupG.position.y = .13; root.add(cupG);
  cupG.add(new T.Mesh(new T.LatheGeometry(V([[0, 0], [.75, 0], [.95, .08], [1.28, 1.45], [1.32, 1.6], [1.22, 1.6], [1.2, 1.5], [.9, .3], [0, .25]]), 56), ceramic));
  const band = new T.Mesh(new T.CylinderGeometry(1.19, 1.12, .22, 56, 1, true), ink); band.position.y = .85; cupG.add(band);
  const coffee = new T.Mesh(new T.CircleGeometry(1.2, 40), std(0x5b3622, .4)); coffee.rotation.x = -Math.PI / 2; coffee.position.y = 1.48; cupG.add(coffee);
  const foam = new T.Mesh(new T.RingGeometry(.35, .75, 40), new T.MeshStandardMaterial({ color: 0xf6e3c8, roughness: .6 })); foam.rotation.x = -Math.PI / 2; foam.position.y = 1.485; cupG.add(foam);
  const handle = new T.Mesh(new T.TorusGeometry(.5, .11, 14, 36, Math.PI * 1.25), ceramic); handle.position.set(1.25, .95, 0); handle.rotation.z = -Math.PI * .625; cupG.add(handle);
  const donut = new T.Group(); donut.position.set(-3.1, 1.3, 1.4); root.add(donut);
  const dBase = new T.Mesh(new T.TorusGeometry(.62, .27, 20, 40), std(0xd99a5b, .6)); dBase.scale.z = .8; donut.add(dBase);
  const dIce = new T.Mesh(new T.TorusGeometry(.62, .29, 20, 40), std(0xff8fa3, .35)); dIce.scale.z = .6; dIce.position.z = .08; donut.add(dIce);
  const sc = [0xffffff, 0xf4a81d, 0x13251f, 0xbfe6f2];
  for (let i = 0; i < 14; i++) { const a = Math.random() * 6.28, o = (Math.random() - .5) * .36, r = .62 + o, z = Math.sqrt(Math.max(.29 * .29 - o * o, 0)) * .6 + .09;
    const s = new T.Mesh(new T.BoxGeometry(.13, .035, .035), std(sc[i % 4], .5)); s.position.set(Math.cos(a) * r, Math.sin(a) * r, z); s.rotation.z = a + Math.random(); donut.add(s); }
  donut.rotation.x = Math.PI / 2.6;
  const mac = new T.Group(); mac.position.set(3.1, 2.1, .6); root.add(mac);
  [.14, -.14].forEach(y => { const m = new T.Mesh(new T.SphereGeometry(.5, 24, 14), std(0xf4a81d, .5)); m.scale.y = .38; m.position.y = y; mac.add(m); });
  mac.add(new T.Mesh(new T.CylinderGeometry(.44, .44, .16, 24), std(0xfff3d9, .8))); mac.rotation.set(.5, 0, .3);
  const beans = []; for (let i = 0; i < 7; i++) { const b = new T.Mesh(new T.SphereGeometry(.2, 12, 10), std(0x4a2c1a, .5)); b.scale.set(1, .7, .62);
    b.userData = { a: i / 7 * 6.28, r: 2.8 + Math.random() * .9, y: .6 + Math.random() * 2.6, s: .4 + Math.random() * .5 }; scene.add(b); beans.push(b); }
  const steam = []; for (let i = 0; i < 9; i++) { const m = new T.Mesh(new T.SphereGeometry(.2, 10, 8), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })); m.userData = { t: i / 9, x: (Math.random() - .5) * .8, z: (Math.random() - .5) * .8 }; cupG.add(m); steam.push(m); }
  const sh = document.createElement('canvas'); sh.width = sh.height = 128; const g = sh.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(120,70,0,.32)'); gr.addColorStop(1, 'rgba(120,70,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const shadow = new T.Mesh(new T.PlaneGeometry(8, 8), new T.MeshBasicMaterial({ map: new T.CanvasTexture(sh), transparent: true, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; shadow.position.y = -.02; scene.add(shadow);

  let tx = 0, ty = 0, drag = false, lx = 0, spin = 0, raf = 0, vis = true, pm = 0; const t0 = performance.now();
  const down = e => { drag = true; lx = e.clientX; }, up = () => drag = false;
  const move = e => {
    if (drag) { spin += (e.clientX - lx) * .012; lx = e.clientX; }
    if (pm) return; pm = requestAnimationFrame(() => { pm = 0; const r = stage.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - .5, py = (e.clientY - r.top) / r.height - .5; tx = py * .25; ty = px * .3; stage.style.setProperty('--px', (px * 2).toFixed(2)); stage.style.setProperty('--py', (py * 2).toFixed(2)); });
  };
  stage.addEventListener('pointerdown', down); addEventListener('pointerup', up); stage.addEventListener('pointermove', move);
  const size = () => { const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); cam.aspect = w / h; cam.fov = w / h < .9 ? 42 : 32; cam.updateProjectionMatrix(); };
  const ro = new ResizeObserver(size); ro.observe(canvas); size();
  let first = true;
  const frame = () => {
    const t = (performance.now() - t0) / 1000;
    if (!drag) spin += .004;
    root.rotation.y += (spin + ty - root.rotation.y) * .08; root.rotation.x += (tx - root.rotation.x) * .08;
    root.position.y = Math.sin(t * 1.2) * .08;
    donut.position.y = 1.3 + Math.sin(t * 1.5) * .22; donut.rotation.z = t * .5;
    mac.position.y = 2.1 + Math.sin(t * 1.3 + 2) * .2; mac.rotation.y = t * .6;
    beans.forEach(b => { const u = b.userData, a = u.a + t * .25 * u.s; b.position.set(Math.cos(a) * u.r, u.y + Math.sin(t * u.s * 3) * .15, Math.sin(a) * u.r); b.rotation.set(t * u.s, t * u.s * .7, 0); });
    steam.forEach(s => { const u = s.userData; u.t = (u.t + .004) % 1; s.position.set(u.x + Math.sin(u.t * 9) * .15, 1.6 + u.t * 2.4, u.z); s.scale.setScalar(.6 + u.t * 1.8); s.material.opacity = Math.sin(u.t * Math.PI) * .22; });
    renderer.render(scene, cam);
    if (first) { first = false; stage.classList.add('ready'); }
    raf = (vis && !document.hidden) ? requestAnimationFrame(frame) : 0;
  };
  const wake = () => { if (vis && !document.hidden && !raf) raf = requestAnimationFrame(frame); };
  const io = new IntersectionObserver(en => { vis = en[0].isIntersecting; wake(); }); io.observe(stage);
  document.addEventListener('visibilitychange', wake);
  frame();
  return { destroy() { cancelAnimationFrame(raf); cancelAnimationFrame(pm); raf = 0; vis = false; io.disconnect(); ro.disconnect(); document.removeEventListener('visibilitychange', wake); removeEventListener('pointerup', up); renderer.dispose(); } };
}

/* ───────── MENU ───────── */
const mf = { q: '', cat: 'All', veg: false };
function mountMenu() {
  $('#app').innerHTML = `<div class="page"><header class="page-head"><h1>Our menu</h1><p>Everything we cook, with live availability. Prices are before 18% GST.</p></header>
    <div class="menu-bar"><div class="toolbar"><label class="search"><span class="sr">Search dishes</span>${ico('search')}<input id="mQ" placeholder="Search dishes" value="${esc(mf.q)}" autocomplete="off"></label>
      <label class="switch"><input type="checkbox" id="mVeg" ${mf.veg ? 'checked' : ''}>Veg only</label></div><div class="chips" id="mChips"></div></div>
    <div id="mGrid"></div></div>`;
  $('#mQ').oninput = debounce(e => { mf.q = e.target.value; fillMenu(); }); $('#mVeg').onchange = e => { mf.veg = e.target.checked; fillMenu(); };
  fillMenu();
}
const filtered = () => sortedMenu().filter(m => (mf.cat === 'All' || m.category === mf.cat) && (!mf.veg || m.veg) && (m.name + ' ' + (m.desc || '')).toLowerCase().includes(mf.q.toLowerCase()));
function chips(el, f, after) {
  if (!el) return;
  el.innerHTML = ['All', ...state.cats.map(c => c.name)].map(c => `<button class="chip ${f.cat === c ? 'on' : ''}" data-chip="${esc(c)}">${esc(c)}</button>`).join('');
  $$('.chip', el).forEach(b => b.onclick = () => { f.cat = b.dataset.chip; after(); });
}
function fillMenu() {
  const el = $('#mGrid'); if (!el) return; chips($('#mChips'), mf, fillMenu);
  if (!state.loaded.menu) return el.innerHTML = skel(6);
  const l = filtered(); if (!l.length) return el.innerHTML = empty('Nothing found', state.menu.length ? 'Try a different search or category.' : 'The menu is being prepared.');
  const groups = new Map(); l.forEach(m => { if (!groups.has(m.category)) groups.set(m.category, []); groups.get(m.category).push(m); });
  el.innerHTML = [...groups].map(([c, items]) => `<section class="cat"><div class="cat-head"><h2>${esc(c)}</h2><span>${items.length} item${items.length > 1 ? 's' : ''}</span></div><div class="grid">${items.map(dishCard).join('')}</div></section>`).join('');
}

/* ───────── ORDER ───────── */
let rzpLoaded; const of = { q: '', cat: 'All' };
function mountOrder() {
  if (state.confirm) return mountConfirm();
  $('#app').innerHTML = `<div class="page"><header class="page-head"><h1>Order for home delivery</h1></header><div id="oBanner"></div><div id="oGate"></div>
    <div class="olayout" id="oLayout"><div><div class="menu-bar"><label class="search"><span class="sr">Search dishes</span>${ico('search')}<input id="oQ" placeholder="Search dishes" value="${esc(of.q)}" autocomplete="off"></label><div class="chips" id="oChips"></div></div><div class="olist" id="oList"></div></div>
      <aside class="oside" id="oSide"><section class="panel" id="oCart"></section><form class="panel" id="oForm" autocomplete="on"></form><section class="panel" id="oBill"></section></aside></div></div>`;
  $('#oQ').oninput = debounce(e => { of.q = e.target.value; fillOrderList(); });
  renderOrderAll(true);
}
function renderOrderAll(full) {
  fillBanner(); const gate = $('#oGate'), layout = $('#oLayout'); if (!gate) return;
  if (!state.user) { layout.style.display = 'none'; gate.innerHTML = `<div class="panel auth" style="text-align:center;padding:40px 28px"><h3>Login to place an order</h3><p style="color:var(--ink2);margin-bottom:22px">Only registered customers can order. It takes less than a minute.</p><a class="btn btn-dark" href="#/profile">Login or register ${ico('arrow')}</a></div>`; return; }
  gate.innerHTML = ''; layout.style.display = '';
  fillOrderList(); fillCart(); fillBill(); if (full) { fillForm(); initMap(); }
}
function fillBanner() {
  const d = state.delivery, el = $('#oBanner'); if (!el) return;
  el.innerHTML = d.enabled
    ? `<div class="info-bar"><div>${ico('box')}<p><span>Delivery charge</span><b>${money(d.charge)}</b></p></div><div>${ico('pin')}<p><span>We deliver within</span><b>${d.radiusKm} km</b></p></div><div>${ico('bag')}<p><span>Minimum order</span><b>${money(d.minOrder)}</b></p></div><div>${ico('card')}<p><span>GST</span><b>18% at checkout</b></p></div></div>`
    : `<div class="info-bar off"><div>${ico('clock')}<p><span>You can browse, but ordering is switched off. Please check back soon.</span><b>Home delivery is paused right now</b></p></div></div>`;
}
function fillOrderList() {
  const el = $('#oList'); if (!el) return; chips($('#oChips'), of, fillOrderList);
  if (!state.loaded.menu) return el.innerHTML = Array.from({ length: 5 }, () => '<div class="sk row"></div>').join('');
  const l = sortedMenu().filter(m => (of.cat === 'All' || m.category === of.cat) && (m.name + (m.desc || '')).toLowerCase().includes(of.q.toLowerCase()));
  el.innerHTML = l.length ? l.map(it => { const out = it.status === 'out';
    return `<div class="orow ${out ? 'is-out' : ''}"><div class="th">${it.image ? `<img src="${it.image}" alt="" loading="lazy" decoding="async">` : `<div class="ph">${esc(it.name[0])}</div>`}</div>
      <div><h4>${esc(it.name)} <span class="tag ${out ? 'bad' : 'ok'}">${out ? 'Out of stock' : 'Available'}</span></h4><p>${esc(it.desc || '')}</p><strong>${money(it.price)}</strong></div>
      <div data-ctl="${it.id}">${ctl(it)}</div></div>`; }).join('') : empty('No dishes found');
}
function fillCart() {
  const el = $('#oCart'); if (!el) return; const b = getBill();
  el.innerHTML = `<div class="sp-head"><span class="sp-n">1</span><h3>Your order</h3></div>` + (b.lines.length ? b.lines.map(l => `<div class="cline"><div><b>${esc(l.name)}</b>${l.status === 'out' ? ' <span class="tag bad">Out of stock</span>' : ''}<br><small>${money(l.price)} each</small></div>
    <div class="qty"><button data-act="dec" data-id="${l.id}" aria-label="Remove one">${ico('minus')}</button><span>${l.qty}</span><button data-act="inc" data-id="${l.id}" aria-label="Add one">${ico('plus')}</button></div><b>${money(l.price * l.qty)}</b></div>`).join('') : `<p style="color:var(--mute)">Your order is empty. Add something from the list.</p>`);
}
function fillForm() {
  const el = $('#oForm'); if (!el) return; const f = state.form;
  el.innerHTML = `<div class="sp-head"><span class="sp-n">2</span><h3>Delivery details</h3></div>
    <div class="row2"><div class="field"><label for="fName">Full name</label><input id="fName" name="name" autocomplete="name" value="${esc(f.name || state.profile?.name || state.user?.displayName || '')}" required></div>
    <div class="field"><label for="fPhone">Mobile number</label><input id="fPhone" name="tel" autocomplete="tel-national" inputmode="numeric" maxlength="10" placeholder="10-digit number" value="${esc(f.phone || '')}" required></div></div>
    <div class="mapbar"><input id="mapQ" placeholder="Search your area, street or landmark" aria-label="Search location"><button type="button" class="btn btn-soft btn-sm" id="mapGo">Search</button><button type="button" class="btn btn-gold btn-sm" id="mapMe">${ico('locate')}Use my location</button><div class="results" id="mapRes" hidden></div></div>
    <div id="map" role="application" aria-label="Delivery location map"></div><div class="distance" id="distBox">Drag the pin or tap the map to set your exact location.</div>
    <div class="field"><label for="fFlat">House, flat or floor</label><input id="fFlat" value="${esc(f.flat || '')}" placeholder="e.g. Flat 302, Green Apartments"></div>
    <div class="field"><label for="fAddr">Full address</label><textarea id="fAddr" rows="2" placeholder="Filled from the pin, edit if needed">${esc(f.address || '')}</textarea></div>
    <div class="field"><label for="fLand">Landmark (optional)</label><input id="fLand" value="${esc(f.landmark || '')}"></div>`;
  const bind = (id, k) => $(id).oninput = e => { state.form[k] = e.target.value; saveForm(); };
  bind('#fName', 'name'); bind('#fPhone', 'phone'); bind('#fFlat', 'flat'); bind('#fAddr', 'address'); bind('#fLand', 'landmark');
  $('#fPhone').oninput = e => { e.target.value = e.target.value.replace(/\D/g, ''); state.form.phone = e.target.value; saveForm(); };
  el.onsubmit = e => e.preventDefault();
  $('#mapGo').onclick = searchPlace; $('#mapQ').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); searchPlace(); } };
  $('#mapMe').onclick = locateMe;
  state.form.name = $('#fName').value; saveForm();
}
function validate(b) {
  const d = state.delivery, f = state.form, e = [];
  if (!d.enabled) e.push('Home delivery is currently off.');
  if (!b.lines.length) e.push('Add at least one item.');
  if (b.lines.some(l => l.status === 'out')) e.push('Remove out-of-stock items from your order.');
  if (b.lines.length && b.subtotal < d.minOrder) e.push(`Minimum order is ${money(d.minOrder)} (before GST).`);
  if (!f.name?.trim()) e.push('Enter your name.');
  if (!/^[6-9]\d{9}$/.test(f.phone || '')) e.push('Enter a valid 10-digit mobile number.');
  if (f.lat == null) e.push('Set your delivery location on the map.');
  else if (km(d.cafeLat, d.cafeLng, f.lat, f.lng) > d.radiusKm) e.push(`Your location is outside our ${d.radiusKm} km delivery area.`);
  if (!f.address?.trim()) e.push('Enter your full delivery address.');
  if (/X{5,}/i.test(RAZORPAY_KEY_ID)) e.push('Payments are not set up yet (Razorpay key missing). Please contact the café.');
  return e;
}
function fillBill() {
  const el = $('#oBill'); if (!el) return; const b = getBill(), d = state.delivery;
  el.innerHTML = `<div class="sp-head"><span class="sp-n">3</span><h3>Bill and payment</h3></div>
    <div class="billrow"><span>Items total</span><span>${money(b.subtotal)}</span></div>
    <div class="billrow"><span>GST (18%)</span><span>${money(b.gst)}</span></div>
    <div class="billrow"><span>Delivery charge</span><span>${d.enabled ? money(b.dc) : '–'}</span></div>
    <div class="billrow total"><span>To pay</span><span>${money(b.total)}</span></div>
    <ul class="errs" id="oErrs" hidden></ul>
    <button class="btn btn-dark btn-lg btn-block" id="payBtn" style="margin-top:18px" ${d.enabled ? '' : 'disabled'}>Pay ${money(b.total)} securely</button>
    <p class="note">Payments are processed by Razorpay. Your order is confirmed right after payment succeeds.</p>`;
  $('#payBtn').onclick = payNow; updateDistance();
}
function updateDistance() {
  const box = $('#distBox'), f = state.form, d = state.delivery; if (!box) return;
  if (f.lat == null) { box.className = 'distance'; return; }
  const k = km(d.cafeLat, d.cafeLng, f.lat, f.lng), ok = k <= d.radiusKm; box.className = 'distance ' + (ok ? 'good' : 'bad');
  box.textContent = ok ? `${k.toFixed(1)} km from the café. We deliver to this location.` : `${k.toFixed(1)} km from the café. This is outside our ${d.radiusKm} km delivery area.`;
}
async function initMap() {
  try { await loadLib('leaflet'); } catch { return toast('Map could not load. Check your internet.', 'bad'); }
  const el = $('#map'); if (!el || cur !== 'order') return; if (map) { map.remove(); map = null; }
  const d = state.delivery, f = state.form, has = f.lat != null, c = [d.cafeLat, d.cafeLng], start = has ? [f.lat, f.lng] : c;
  map = L.map(el, { zoomControl: true }).setView(start, has ? 16 : 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  cafeMk = L.circleMarker(c, { radius: 9, color: '#13251F', fillColor: '#F4A81D', fillOpacity: 1, weight: 3 }).addTo(map).bindTooltip(d.cafeName || 'Café');
  circle = L.circle(c, { radius: d.radiusKm * 1000, color: '#E09406', weight: 1.5, fillOpacity: .07 }).addTo(map);
  marker = L.marker(start, { draggable: true, icon: L.divIcon({ className: 'pin', html: '<span></span>', iconSize: [28, 28], iconAnchor: [14, 28] }) }).addTo(map);
  marker.on('dragend', () => setLoc(marker.getLatLng(), true)); map.on('click', e => { marker.setLatLng(e.latlng); setLoc(e.latlng, true); });
  setTimeout(() => map?.invalidateSize(), 250); updateDistance();
}
function syncMapDelivery() { if (!map) return; const d = state.delivery; cafeMk.setLatLng([d.cafeLat, d.cafeLng]); circle.setLatLng([d.cafeLat, d.cafeLng]).setRadius(d.radiusKm * 1000); }
async function setLoc(ll, reverse) {
  state.form.lat = +ll.lat.toFixed(6); state.form.lng = +ll.lng.toFixed(6); saveForm(); updateDistance();
  if (reverse) { try { const r = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${ll.lat}&lon=${ll.lng}`)).json(); if (r.display_name) { state.form.address = r.display_name; saveForm(); const a = $('#fAddr'); if (a) a.value = r.display_name; } } catch { } }
}
function flyTo(lat, lng) { if (!map) return; marker.setLatLng([lat, lng]); map.setView([lat, lng], 17); setLoc({ lat, lng }, true); }
async function searchPlace() {
  const q = $('#mapQ').value.trim(); if (!q) return; const box = $('#mapRes');
  try { const r = await (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=in&q=${encodeURIComponent(q)}`)).json();
    box.hidden = false; box.innerHTML = r.length ? r.map(x => `<button type="button" data-lat="${x.lat}" data-lng="${x.lon}">${esc(x.display_name)}</button>`).join('') : '<button type="button">No place found</button>';
    $$('button[data-lat]', box).forEach(b => b.onclick = () => { box.hidden = true; flyTo(+b.dataset.lat, +b.dataset.lng); });
  } catch { toast('Search failed. Check your internet connection.', 'bad'); }
}
function locateMe() {
  if (!navigator.geolocation) return toast('Location is not supported on this device', 'bad');
  toast('Finding your exact location…');
  navigator.geolocation.getCurrentPosition(p => { flyTo(p.coords.latitude, p.coords.longitude); toast(`Location set (accurate to about ${Math.round(p.coords.accuracy)} m)`); },
    () => toast('Could not get your location. Allow location access or drop the pin manually.', 'bad'), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
}
const loadRazorpay = () => rzpLoaded ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = res; s.onerror = () => { rzpLoaded = null; rej(); }; document.head.append(s); });
async function payNow() {
  const b = getBill(), errs = validate(b), box = $('#oErrs');
  if (errs.length) { box.hidden = false; box.innerHTML = errs.map(e => `<li>${esc(e)}</li>`).join(''); return; } box.hidden = true;
  const btn = $('#payBtn'); btn.disabled = true; btn.textContent = 'Opening payment…';
  try { await loadRazorpay(); } catch { fillBill(); return toast('Could not load Razorpay. Check your internet.', 'bad'); }
  const f = state.form, d = state.delivery, snap = { b, f: { ...f }, dist: km(d.cafeLat, d.cafeLng, f.lat, f.lng) };
  const rzp = new Razorpay({
    key: RAZORPAY_KEY_ID, amount: Math.round(b.total * 100), currency: 'INR', name: d.cafeName || 'The Yaari Cafe', description: `${b.lines.length} item order incl. 18% GST`,
    prefill: { name: f.name, email: state.user.email || '', contact: f.phone }, theme: { color: '#13251F' },
    handler: r => saveOrder(r.razorpay_payment_id, snap), modal: { ondismiss: () => fillBill() }
  });
  rzp.on('payment.failed', e => { toast(e.error?.description || 'Payment failed. Please try again.', 'bad'); fillBill(); });
  rzp.open();
}
async function saveOrder(paymentId, { b, f, dist }) {
  const data = { uid: state.user.uid, email: state.user.email || '', items: b.lines.map(l => ({ id: l.id, name: l.name, price: l.price, qty: l.qty })),
    subtotal: b.subtotal, gstPercent: 18, gst: b.gst, deliveryCharge: b.dc, total: b.total, paymentId, paymentStatus: 'paid', status: 'confirmed',
    customer: { name: f.name, phone: f.phone, flat: f.flat || '', address: f.address, landmark: f.landmark || '', lat: f.lat, lng: f.lng, distanceKm: +dist.toFixed(2) }, createdAt: fs.serverTimestamp() };
  try {
    const ref = await fs.addDoc(col('orders'), data);
    state.cart = {}; persistCart(); state.confirm = { id: ref.id, total: b.total, paymentId }; renderChrome(); mountOrder(); scrollTo(0, 0);
  } catch {
    $('#app').innerHTML = `<div class="page"><div class="panel auth" style="text-align:center"><h3>Payment received, order not saved</h3><p>Your payment (ID <b>${esc(paymentId)}</b>) went through but we could not record the order. Please call the café with this payment ID and we will confirm your order immediately.</p></div></div>`;
  }
}
function mountConfirm() {
  const c = state.confirm;
  $('#app').innerHTML = `<div class="page"><div class="confirm">
    <div class="tick"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
    <h1>Order confirmed</h1><div class="wait"><i></i>Wait for delivery</div>
    <div class="track"><div class="on"><i></i>Confirmed</div><div><i></i>Preparing</div><div><i></i>On the way</div><div><i></i>Delivered</div></div>
    <p>Order <b>#${esc(c.id.slice(-6).toUpperCase())}</b> · Paid ${money(c.total)}<br><small style="color:var(--mute)">Payment ID ${esc(c.paymentId)}</small></p>
    <p style="margin-top:10px;color:var(--ink2)">We are preparing your food. Follow its status in your profile.</p>
    <div class="cactions"><button class="btn btn-dark btn-lg" data-act="orderMore">${ico('arrow')}Back to menu to order more</button><a class="btn btn-soft btn-lg" href="#/profile">Track my order</a></div></div></div>`;
}
function updOrderMany(ks) {
  if (state.confirm) return;
  if (!$('#oLayout')) return mountOrder();
  if (ks.includes('auth')) return renderOrderAll(true);
  if (ks.includes('delivery')) { fillBanner(); fillBill(); syncMapDelivery(); }
  if (ks.includes('menu')) { fillOrderList(); fillCart(); fillBill(); }
}

/* ───────── GALLERY ───────── */
function mountGallery() { $('#app').innerHTML = `<div class="page"><header class="page-head"><h1>Gallery</h1><p>A look inside the café, the kitchen and the food.</p></header><div id="gGrid"></div></div>`; fillGallery(); }
function fillGallery() {
  const el = $('#gGrid'); if (!el) return;
  el.innerHTML = state.gallery.length ? `<div class="masonry">${state.gallery.map(g => `<figure class="gitem" data-lb="${g.id}"><img src="${g.image}" alt="${esc(g.caption || 'Café photo')}" loading="lazy" decoding="async">${g.caption ? `<figcaption>${esc(g.caption)}</figcaption>` : ''}</figure>`).join('')}</div>` : empty('Photos are coming soon', 'We are adding pictures of the café and our food.');
}
function openLightbox(id) { const g = state.gallery.find(x => x.id === id); if (!g) return; const lb = $('#lightbox'); lb.innerHTML = `<button class="x" aria-label="Close">${ico('x')}</button><div><img src="${g.image}" alt="${esc(g.caption || '')}"><p>${esc(g.caption || '')}</p></div>`; lb.classList.add('open'); }

/* ───────── REVIEWS ───────── */
let myRating = 5;
function mountReviews() {
  $('#app').innerHTML = `<div class="page"><header class="page-head"><h1>Reviews</h1><p>Real words from people who ate with us.</p></header>
    <div class="rev-top"><div class="panel" id="rSide"></div><div class="grid" id="rList"></div></div></div>`;
  fillReviewForm();
}
function fillReviews() {
  const n = state.reviews.length, avg = n ? state.reviews.reduce((s, r) => s + r.rating, 0) / n : 0;
  const bars = [5, 4, 3, 2, 1].map(s => { const c = state.reviews.filter(r => r.rating === s).length; return `<div class="bar-row"><span>${s}★</span><div class="meter"><i style="width:${n ? c / n * 100 : 0}%"></i></div><span>${c}</span></div>`; }).join('');
  const st = $('#rStats'); if (st) st.innerHTML = `<div class="avg">${n ? avg.toFixed(1) : '–'}</div><div class="stars" style="margin:6px 0 4px">${stars(Math.round(avg))}</div><p style="color:var(--mute);margin-bottom:14px">${n} review${n === 1 ? '' : 's'}</p>${bars}`;
  const l = $('#rList'); if (l) l.innerHTML = n ? state.reviews.map(reviewCard).join('') : empty('No reviews yet', 'Be the first to share your experience.');
}
function fillReviewForm() {
  const side = $('#rSide'); if (!side) return;
  const mine = state.user && state.reviews.find(r => r.id === state.user.uid); if (mine) myRating = mine.rating;
  side.innerHTML = `<div id="rStats"></div><hr style="border:0;border-top:1px solid var(--line);margin:22px 0">` + (state.user ? `<h3>${mine ? 'Update your review' : 'Write a review'}</h3>
    <div class="starpick" id="sp" style="margin-bottom:14px">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-s="${i}" class="${i <= myRating ? 'on' : ''}" aria-label="${i} stars">★</button>`).join('')}</div>
    <div class="field"><textarea id="rText" rows="4" maxlength="500" placeholder="What did you love?" aria-label="Your review">${esc(mine?.text || '')}</textarea></div>
    <button class="btn btn-dark btn-block" id="rSend">${mine ? 'Save changes' : 'Post review'}</button>` : `<h3>Share your experience</h3><p style="color:var(--ink2);margin-bottom:16px">Login to post a review.</p><a class="btn btn-dark btn-block" href="#/profile">Login or register</a>`);
  fillReviews();
  $$('#sp button').forEach(b => b.onclick = () => { myRating = +b.dataset.s; $$('#sp button').forEach(x => x.classList.toggle('on', +x.dataset.s <= myRating)); });
  const send = $('#rSend'); if (send) send.onclick = async () => {
    const text = $('#rText').value.trim(); if (text.length < 3) return toast('Write a few words first', 'bad');
    try { await fs.setDoc(fs.doc(db, 'reviews', state.user.uid), { uid: state.user.uid, name: state.profile?.name || state.user.displayName || 'Guest', rating: myRating, text, createdAt: fs.serverTimestamp() }); toast('Thanks for your review!'); } catch { toast('Could not save review', 'bad'); }
  };
}

/* ───────── ABOUT ───────── */
function mountAbout() {
  const a = state.about, d = state.delivery, maps = d.cafeLat ? `https://www.google.com/maps?q=${d.cafeLat},${d.cafeLng}` : '#';
  $('#app').innerHTML = `<div class="page"><header class="page-head"><h1>${esc(a.title)}</h1></header><div class="about-grid">
    <div class="panel" style="padding:36px"><p class="story">${esc(a.story)}</p></div>
    <div class="panel"><h3>Opening hours</h3><div class="hours">${(a.hours || []).map(h => `<div><span>${esc(h.days)}</span><b>${esc(h.time)}</b></div>`).join('')}</div>
      <h3 style="margin-top:28px">Find us</h3>${a.address ? `<div class="contact">${ico('pin')}<span>${esc(a.address)}</span></div>` : ''}${a.phone ? `<div class="contact">${ico('phone')}<a href="tel:${esc(a.phone)}">${esc(a.phone)}</a></div>` : ''}${a.email ? `<div class="contact">${ico('mail')}<span>${esc(a.email)}</span></div>` : ''}
      <a class="btn btn-dark" style="margin-top:20px" target="_blank" rel="noopener" href="${maps}">Open in Google Maps ${ico('arrow')}</a></div></div>
    ${(a.team || []).length ? `<section class="sec"><div class="sec-head"><h2>The people behind the counter</h2></div><div class="team">${a.team.map(t => `<div class="member tilt"><div class="av">${esc((t.name || '?')[0])}</div><b>${esc(t.name)}</b><br><small>${esc(t.role)}</small></div>`).join('')}</div></section>` : ''}</div>`;
}

/* ───────── PROFILE ───────── */
let authTab = 'login';
const STEPS = ['confirmed', 'preparing', 'out_for_delivery', 'delivered'], LABEL = { confirmed: 'Confirmed', preparing: 'Preparing', out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled' };
function mountProfile() { $('#app').innerHTML = `<div class="page"><div id="pBox"></div></div>`; fillProfile(); }
function fillProfile() {
  const box = $('#pBox'); if (!box) return;
  if (!state.user) {
    box.innerHTML = `<div class="auth"><div class="brandmark"><span class="mark">${ico('cup')}</span></div><h1>Welcome</h1><p>Login or register to order, review and track your deliveries.</p><div class="panel" style="padding:30px">
      <div class="tabs" role="tablist"><button data-tab="login" class="${authTab === 'login' ? 'on' : ''}">Login</button><button data-tab="register" class="${authTab === 'register' ? 'on' : ''}">Register</button></div>
      <form id="aForm">${authTab === 'register' ? `<div class="field"><label for="aName">Full name</label><input id="aName" autocomplete="name" required></div><div class="field"><label for="aPhone">Mobile number</label><input id="aPhone" autocomplete="tel-national" inputmode="numeric" maxlength="10" required></div>` : ''}
      <div class="field"><label for="aMail">Email</label><input id="aMail" type="email" autocomplete="email" required></div>
      <div class="field"><label for="aPass">Password</label><input id="aPass" type="password" minlength="6" autocomplete="${authTab === 'login' ? 'current-password' : 'new-password'}" required></div>
      <button class="btn btn-dark btn-block btn-lg" id="aGo">${authTab === 'login' ? 'Login' : 'Create account'}</button>
      ${authTab === 'login' ? '<p class="note"><a href="#" data-act="forgot" style="text-decoration:underline">Forgot password?</a></p>' : ''}</form>
      <div class="divider">or</div><button class="btn btn-soft btn-block" data-act="google">Continue with Google</button></div></div>`;
    $$('.tabs button').forEach(b => b.onclick = () => { authTab = b.dataset.tab; fillProfile(); });
    $('#aForm').onsubmit = submitAuth; return;
  }
  if (box.contains(document.activeElement) && $('#pName')) return fillOrders();
  const name = state.profile?.name || state.user.displayName || 'Guest';
  box.innerHTML = `<header class="page-head"><h1>Hi, ${esc(name.split(' ')[0])}</h1></header><div class="profile-grid">
    <div class="panel"><div class="big-av">${esc(name[0].toUpperCase())}</div>
      <div class="field"><label for="pName">Name</label><input id="pName" value="${esc(name)}"></div><div class="field"><label for="pPhone">Mobile number</label><input id="pPhone" inputmode="numeric" maxlength="10" value="${esc(state.profile?.phone || '')}"></div>
      <div class="field"><label>Email</label><input value="${esc(state.user.email || '')}" disabled></div>
      <button class="btn btn-dark btn-block" id="pSave">Save profile</button><button class="btn btn-soft btn-block" style="margin-top:10px" data-act="logout">Logout</button></div>
    <div><h2 style="margin-bottom:18px;font-size:1.8rem">Your orders</h2><div id="pOrders"></div></div></div>`;
  $('#pSave').onclick = async () => { try { await fs.setDoc(fs.doc(db, 'users', state.user.uid), { name: $('#pName').value.trim(), phone: $('#pPhone').value.replace(/\D/g, ''), email: state.user.email || '' }, { merge: true }); toast('Profile saved'); } catch { toast('Could not save', 'bad'); } };
  fillOrders();
}
function fillOrders() {
  const el = $('#pOrders'); if (!el) return;
  el.innerHTML = state.orders.length ? state.orders.map(o => { const i = STEPS.indexOf(o.status);
    return `<div class="ocard"><header><b>Order #${esc(o.id.slice(-6).toUpperCase())}</b><span class="pill ${o.status}">${LABEL[o.status] || o.status}</span></header>
      <small style="color:var(--mute)">${fmtDate(o.createdAt)}</small>
      ${o.status === 'cancelled' ? '' : `<div class="timeline">${STEPS.map((s, k) => `<i class="${k <= i ? 'on' : ''}" title="${LABEL[s]}"></i>`).join('')}</div>`}
      <p>${(o.items || []).map(x => `${x.qty}× ${esc(x.name)}`).join(', ')}</p><p style="margin-top:6px"><b>Paid ${money(o.total)}</b> <small style="color:var(--mute)">(incl. GST ${money(o.gst)})</small></p></div>`; }).join('')
    : empty('No orders yet', 'Your orders will show up here.');
}
async function submitAuth(e) {
  e.preventDefault(); const btn = $('#aGo'); btn.disabled = true;
  const mail = $('#aMail').value.trim(), pass = $('#aPass').value;
  try {
    if (authTab === 'login') await au.signInWithEmailAndPassword(auth, mail, pass);
    else {
      const name = $('#aName').value.trim(), phone = $('#aPhone').value.replace(/\D/g, '');
      if (!/^[6-9]\d{9}$/.test(phone)) { btn.disabled = false; return toast('Enter a valid 10-digit mobile number', 'bad'); }
      const c = await au.createUserWithEmailAndPassword(auth, mail, pass); await au.updateProfile(c.user, { displayName: name });
      await fs.setDoc(fs.doc(db, 'users', c.user.uid), { name, phone, email: mail, createdAt: fs.serverTimestamp() });
    }
    toast('Welcome!'); if (cartCount()) location.hash = '#/order';
  } catch (err) { btn.disabled = false; toast(authMsg(err), 'bad'); }
}
const authMsg = e => ({ 'auth/invalid-credential': 'Wrong email or password', 'auth/email-already-in-use': 'This email is already registered. Try logging in.', 'auth/weak-password': 'Password must be at least 6 characters', 'auth/user-not-found': 'No account with this email', 'auth/wrong-password': 'Wrong password', 'auth/popup-closed-by-user': 'Login cancelled', 'auth/too-many-requests': 'Too many attempts. Try again later.' }[e.code] || 'Something went wrong. Please try again.');

/* ───────── router ───────── */
const pages = {
  home: { mount: mountHome, updateMany: ks => { if (ks.some(k => ['home', 'menu', 'delivery', 'reviews'].includes(k))) fillHome(); }, leave: leaveHome },
  menu: { mount: mountMenu, updateMany: ks => { if (ks.includes('menu')) fillMenu(); } },
  order: { mount: mountOrder, updateMany: updOrderMany, leave: () => { map?.remove(); map = null; } },
  gallery: { mount: mountGallery, updateMany: ks => { if (ks.includes('gallery')) fillGallery(); } },
  reviews: { mount: mountReviews, updateMany: ks => { if (ks.some(k => ['auth', 'profile'].includes(k))) fillReviewForm(); else if (ks.includes('reviews')) fillReviews(); } },
  about: { mount: mountAbout, updateMany: ks => { if (ks.some(k => ['about', 'delivery'].includes(k))) mountAbout(); } },
  profile: { mount: mountProfile, updateMany: ks => { if (ks.some(k => ['auth', 'profile'].includes(k))) fillProfile(); else if (ks.includes('orders')) fillOrders(); } }
};
function route() {
  const r = location.hash.replace(/^#\/?/, '').split('?')[0], name = pages[r] ? r : 'home';
  if (cur) pages[cur].leave?.(); cur = name; $('#nav').classList.remove('open');
  if (name !== 'order') state.confirm = null;
  pages[name].mount(); renderChrome(); scrollTo(0, 0);
  document.title = (name === 'home' ? '' : name[0].toUpperCase() + name.slice(1) + ' | ') + (state.delivery.cafeName || 'The Yaari Cafe');
}
addEventListener('hashchange', route);

/* ───────── global events ───────── */
document.addEventListener('click', async e => {
  const a = e.target.closest('[data-act]'), lb = e.target.closest('[data-lb]');
  if (e.target.id === 'lightbox' || e.target.closest('#lightbox .x')) $('#lightbox').classList.remove('open');
  if (lb) openLightbox(lb.dataset.lb);
  if (!e.target.closest('.mapbar') && $('#mapRes')) $('#mapRes').hidden = true;
  if (!e.target.closest('.nav')) $('#nav').classList.remove('open');
  if (e.target.closest('#cartBar') && cur === 'order') { e.preventDefault(); $('#oSide')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if (!a) return; const id = a.dataset.id;
  switch (a.dataset.act) {
    case 'add': addToCart(id); break;
    case 'inc': setQty(id, (state.cart[id] || 0) + 1); break;
    case 'dec': setQty(id, (state.cart[id] || 0) - 1); break;
    case 'burger': $('#nav').classList.toggle('open'); break;
    case 'orderMore': state.confirm = null; mountOrder(); renderChrome(); scrollTo(0, 0); break;
    case 'logout': await au.signOut(auth); toast('Logged out'); break;
    case 'google': try { const c = await au.signInWithPopup(auth, new au.GoogleAuthProvider()); const ref = fs.doc(db, 'users', c.user.uid); if (!(await fs.getDoc(ref)).exists()) await fs.setDoc(ref, { name: c.user.displayName || '', email: c.user.email || '', createdAt: fs.serverTimestamp() }); } catch (err) { toast(authMsg(err), 'bad'); } break;
    case 'forgot': e.preventDefault(); { const m = $('#aMail')?.value.trim(); if (!m) return toast('Type your email first', 'bad'); try { await au.sendPasswordResetEmail(auth, m); toast('Password reset email sent'); } catch (err) { toast(authMsg(err), 'bad'); } } break;
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('#lightbox').classList.remove('open'); $('#nav').classList.remove('open'); } });
if (matchMedia('(hover:hover) and (pointer:fine)').matches) {
  let busy = false;
  document.addEventListener('pointermove', e => {
    if (busy) return; const t = e.target.closest?.('.tilt'); if (!t) return; busy = true; const x = e.clientX, y = e.clientY;
    requestAnimationFrame(() => { busy = false; const r = t.getBoundingClientRect(); t.style.setProperty('--ry', ((x - r.left) / r.width - .5) * 6 + 'deg'); t.style.setProperty('--rx', (.5 - (y - r.top) / r.height) * 6 + 'deg'); });
  }, { passive: true });
  document.addEventListener('pointerout', e => { const t = e.target.closest?.('.tilt'); if (t && !t.contains(e.relatedTarget)) { t.style.setProperty('--rx', '0deg'); t.style.setProperty('--ry', '0deg'); } });
}

route();
