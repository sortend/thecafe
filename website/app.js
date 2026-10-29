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
const LIBS = { three: 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', leaflet: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js' };
const libP = {};
const loadLib = k => libP[k] ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = LIBS[k]; s.onload = res; s.onerror = () => { delete libP[k]; rej(); }; document.head.append(s); });
const skel = (n = 6, cls = '') => `<div class="grid">${Array.from({ length: n }, () => `<div class="sk ${cls}"></div>`).join('')}</div>`;
const toast = (msg, type = 'ok') => { const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg; $('#toast').append(t); setTimeout(() => t.classList.add('out'), 2600); setTimeout(() => t.remove(), 3100); };
const km = (a, b, c, d) => { const R = 6371, t = x => x * Math.PI / 180, dLa = t(c - a), dLo = t(d - b); const h = Math.sin(dLa / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

/* ───────── defaults (site looks good even before admin edits anything) ───────── */
const D = {
  delivery: { enabled: true, charge: 40, radiusKm: 5, minOrder: 150, cafeLat: 28.6139, cafeLng: 77.2090, cafeName: 'The Yaari Cafe' },
  home: {
    heroTitle: 'Chai, coffee and the people you love',
    heroSub: "Fresh food, slow brews and warm corners. Order from The Yaari Cafe and we'll bring it to your door.",
    banner: '',
    features: [
      { icon: '☕', title: 'Brewed to order', text: 'Small-batch coffee and chai, made when you order it.' },
      { icon: '🛵', title: 'Home delivery', text: 'Hot food from our kitchen to your doorstep.' },
      { icon: '🥗', title: 'Honest ingredients', text: 'Seasonal produce and no shortcuts in the kitchen.' },
      { icon: '💳', title: 'Easy payments', text: 'UPI, cards and netbanking through Razorpay.' }
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
const saveCart = () => { localStorage.setItem('yaari_cart', JSON.stringify(state.cart)); renderChrome(); };
const saveForm = () => localStorage.setItem('yaari_form', JSON.stringify(state.form));
const cartCount = () => Object.values(state.cart).reduce((a, b) => a + b, 0);

function sortedMenu() {
  const idx = n => { const i = state.cats.findIndex(c => c.name === n); return i < 0 ? 99 : i; };
  return [...state.menu].sort((a, b) => idx(a.category) - idx(b.category) || a.name.localeCompare(b.name));
}
function addToCart(id) {
  const it = state.menu.find(m => m.id === id);
  if (!it || it.status === 'out') return toast('This item is out of stock', 'bad');
  state.cart[id] = (state.cart[id] || 0) + 1; saveCart(); toast(`${it.name} added to your order`);
  if (cur === 'order') { updOrder('cart'); }
}
function setQty(id, q) { if (q <= 0) delete state.cart[id]; else state.cart[id] = q; saveCart(); if (cur === 'order') updOrder('cart'); }
function getBill() {
  const lines = []; for (const [id, qty] of Object.entries(state.cart)) { const it = state.menu.find(m => m.id === id); if (it) lines.push({ ...it, qty }); }
  const subtotal = r2(lines.reduce((s, l) => s + l.price * l.qty, 0)), gst = r2(subtotal * GST);
  const d = state.delivery, dc = d.enabled && lines.length ? Number(d.charge) || 0 : 0;
  return { lines, subtotal, gst, dc, total: r2(subtotal + gst + dc) };
}

/* ───────── realtime data ───────── */
let errShown = false;
const listen = (q, fn) => fs.onSnapshot(q, fn, e => { console.warn('Firestore:', e.message); state.loaded.menu = true; changed('menu'); if (!errShown) { errShown = true; toast('Could not load data. Check internet and Firestore rules.', 'bad'); } });
listen(fs.doc(db, 'settings', 'delivery'), s => { state.delivery = { ...D.delivery, ...(s.data() || {}) }; changed('delivery'); });
listen(fs.doc(db, 'content', 'home'), s => { state.home = { ...D.home, ...(s.data() || {}) }; changed('home'); });
listen(fs.doc(db, 'content', 'about'), s => { state.about = { ...D.about, ...(s.data() || {}) }; changed('about'); });
listen(col('categories'), s => { state.cats = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); changed('menu'); });
listen(col('menu'), s => { state.menu = s.docs.map(d => ({ id: d.id, ...d.data() })); state.loaded.menu = true; changed('menu'); });
listen(col('gallery'), s => { state.gallery = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ts(b.createdAt) - ts(a.createdAt)); changed('gallery'); });
listen(col('reviews'), s => { state.reviews = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => ts(b.createdAt) - ts(a.createdAt)); changed('reviews'); });

let unsubOrders = null, unsubProfile = null;
au.onAuthStateChanged(auth, u => {
  state.user = u; unsubOrders?.(); unsubProfile?.(); state.orders = []; state.profile = null;
  if (u) {
    unsubProfile = listen(fs.doc(db, 'users', u.uid), s => { state.profile = s.data() || null; if (state.profile?.phone && !state.form.phone) { state.form.phone = state.profile.phone; } changed('profile'); });
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
    if (!p.update && !p.updateMany) return p.mount();
    p.updateMany ? p.updateMany(ks) : ks.forEach(k => p.update(k));
  });
}

/* ───────── chrome: nav, footer, cart bar ───────── */
const LINKS = [['home', 'Home'], ['menu', 'Menu'], ['order', 'Order'], ['gallery', 'Gallery'], ['reviews', 'Reviews'], ['about', 'About']];
function renderChrome() {
  const name = state.delivery.cafeName || 'The Yaari Cafe', n = cartCount();
  const initial = (state.profile?.name || state.user?.displayName || state.user?.email || '').trim()[0]?.toUpperCase();
  $('#nav').innerHTML = `
    <a class="logo" href="#/home"><i>☕</i>${esc(name)}</a>
    <nav class="nav-links">${LINKS.map(([k, l]) => `<a href="#/${k}" data-nav="${k}" class="${cur === k ? 'active' : ''}">${l}</a>`).join('')}</nav>
    <div class="nav-right">
      <a class="btn btn-sun btn-sm cart-btn" href="#/order">Order${n ? `<b>${n}</b>` : ''}</a>
      <a class="avatar" href="#/profile" title="${state.user ? 'Your profile' : 'Login or register'}">${initial || '👤'}</a>
      <button class="burger" data-act="burger" aria-label="Menu">☰</button>
    </div>`;
  const a = state.about;
  $('#footer').innerHTML = `<div class="logo"><i>☕</i>${esc(name)}</div>
    <p>${esc(a.address || '')} ${a.phone ? '· ' + esc(a.phone) : ''}</p><p>© ${new Date().getFullYear()} ${esc(name)}. Prices exclude 18% GST.</p>`;
  const bar = $('#cartBar');
  if (n && cur !== 'order') { bar.innerHTML = `<span>${n} item${n > 1 ? 's' : ''} in your order</span><b class="btn btn-sun btn-sm">View order</b>`; bar.classList.add('show'); } else bar.classList.remove('show');
}

/* ───────── item card ───────── */
function itemCard(it) {
  const out = it.status === 'out';
  return `<article class="mcard tilt ${out ? 'is-out' : ''}">
    <div class="mimg">${it.image ? `<img src="${it.image}" alt="${esc(it.name)}" loading="lazy">` : `<div class="ph">${esc(it.name[0] || '?')}</div>`}
      <span class="badge ${out ? 'bad' : 'ok'}">${out ? 'Out of stock' : 'Available'}</span>
      <span class="vdot ${it.veg ? 'veg' : 'nonveg'}" title="${it.veg ? 'Vegetarian' : 'Non-vegetarian'}"></span></div>
    <div class="mbody"><h3>${esc(it.name)}</h3><p>${esc(it.desc || '')}</p>
      <div class="mfoot"><strong>${money(it.price)}</strong>
      <button class="btn btn-sm ${out ? 'btn-off' : 'btn-primary'}" data-act="add" data-id="${it.id}" ${out ? 'disabled' : ''}>${out ? 'Unavailable' : 'Add to order'}</button></div></div></article>`;
}
const empty = (t, sub = '') => `<div class="empty"><h3>${t}</h3><p>${sub}</p></div>`;

/* ───────── HOME ───────── */
let hero = null;
function mountHome() {
  $('#app').innerHTML = `<div class="page home"><div id="hBanner"></div>
    <section class="hero"><div class="hero-copy"><h1 id="hTitle"></h1><p class="lead" id="hSub"></p>
      <div class="hero-cta"><a class="btn btn-primary btn-lg" href="#/order">Order now</a><a class="btn btn-ghost btn-lg" href="#/menu">See the menu</a></div>
      <div class="hero-facts" id="hFacts"></div></div>
      <div class="hero-3d" id="heroBox"><canvas id="heroCanvas" aria-label="Interactive 3D coffee cup"></canvas><span class="drag-hint">Drag to spin the cup</span></div></section>
    <section class="section" id="hFeat"></section><section class="section" id="hPop"></section>
    <section class="section" id="hSteps"></section><section class="section" id="hRev"></section>
    <section class="cta-band"><h2>Hungry? Your table is at home.</h2><a class="btn btn-sun btn-lg" href="#/order">Start your order</a></section></div>`;
  fillHome(); loadLib('three').then(() => { if (cur === 'home' && !hero) hero = initHero($('#heroCanvas')); }).catch(() => $('#heroBox')?.classList.add('no-webgl'));
}
function fillHome() {
  const h = state.home, d = state.delivery;
  $('#hBanner').innerHTML = h.banner ? `<div class="banner">${esc(h.banner)}</div>` : '';
  $('#hTitle').textContent = h.heroTitle; $('#hSub').textContent = h.heroSub;
  const avg = state.reviews.length ? (state.reviews.reduce((s, r) => s + r.rating, 0) / state.reviews.length).toFixed(1) : '5.0';
  $('#hFacts').innerHTML = `<div><b>${avg}★</b><span>${state.reviews.length || 'New'} reviews</span></div><div><b>${state.menu.filter(m => m.status !== 'out').length}</b><span>dishes available</span></div><div><b>${d.enabled ? d.radiusKm + ' km' : 'Paused'}</b><span>${d.enabled ? 'delivery radius' : 'delivery right now'}</span></div>`;
  $('#hFeat').innerHTML = `<div class="grid">${(h.features || []).map(f => `<div class="feature tilt"><div class="ic">${esc(f.icon)}</div><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p></div>`).join('')}</div>`;
  const pop = sortedMenu().filter(m => m.featured && m.status !== 'out'), list = (pop.length ? pop : sortedMenu().filter(m => m.status !== 'out')).slice(0, 6);
  $('#hPop').innerHTML = `<div class="section-head"><div><h2>Popular right now</h2><p>What our guests keep coming back for.</p></div><a class="btn btn-ghost" href="#/menu">Full menu</a></div>` + (!state.loaded.menu ? skel(3) : list.length ? `<div class="grid">${list.map(itemCard).join('')}</div>` : empty('Menu is being prepared', 'Check back in a few minutes.'));
  $('#hSteps').innerHTML = `<div class="section-head"><h2>Order in three steps</h2></div><div class="steps">
    <div class="step"><h3>Pick your food</h3><p>Browse the menu and add what you like. Out-of-stock items are marked clearly.</p></div>
    <div class="step"><h3>Pin your location</h3><p>Drop a pin on the map so our rider finds your exact door.</p></div>
    <div class="step"><h3>Pay and wait</h3><p>Pay securely with Razorpay. Your order is confirmed instantly.</p></div></div>`;
  const rv = state.reviews.slice(0, 3);
  $('#hRev').innerHTML = rv.length ? `<div class="section-head"><h2>Kind words</h2><a class="btn btn-ghost" href="#/reviews">All reviews</a></div><div class="grid">${rv.map(reviewCard).join('')}</div>` : '';
}
function leaveHome() { hero?.destroy(); hero = null; }

/* 3D hero: cup, saucer, donut, macaron, beans and steam */
function initHero(canvas) {
  if (!window.THREE || !canvas) return null;
  const T = THREE, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let renderer; try { renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true }); } catch (e) { canvas.parentElement.classList.add('no-webgl'); return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  const scene = new T.Scene(), cam = new T.PerspectiveCamera(32, 1, .1, 100); cam.position.set(0, 5, 15); cam.lookAt(0, 1, 0);
  scene.add(new T.HemisphereLight(0xffffff, 0xbfe3d6, .95));
  const sun = new T.DirectionalLight(0xffffff, .9); sun.position.set(4, 8, 6); scene.add(sun);
  const warm = new T.PointLight(0xffc36b, .8, 30); warm.position.set(-5, 3, 4); scene.add(warm);
  const root = new T.Group(); scene.add(root);
  const std = (c, r = .35, m = 0) => new T.MeshStandardMaterial({ color: c, roughness: r, metalness: m, side: T.DoubleSide });
  const V = a => a.map(p => new T.Vector2(p[0], p[1]));
  const ceramic = std(0xffffff, .22, .05), teal = std(0x0e6b5c, .3);

  const saucer = new T.Mesh(new T.LatheGeometry(V([[0, 0], [1.5, 0], [2.3, .22], [2.36, .32], [2.26, .32], [1.4, .13], [0, .13]]), 64), ceramic); root.add(saucer);
  const cupG = new T.Group(); cupG.position.y = .13; root.add(cupG);
  cupG.add(new T.Mesh(new T.LatheGeometry(V([[0, 0], [.75, 0], [.95, .08], [1.28, 1.45], [1.32, 1.6], [1.22, 1.6], [1.2, 1.5], [.9, .3], [0, .25]]), 64), ceramic));
  const band = new T.Mesh(new T.CylinderGeometry(1.19, 1.12, .3, 64, 1, true), teal); band.position.y = .85; cupG.add(band);
  const coffee = new T.Mesh(new T.CircleGeometry(1.2, 48), std(0x5b3622, .4)); coffee.rotation.x = -Math.PI / 2; coffee.position.y = 1.48; cupG.add(coffee);
  const foam = new T.Mesh(new T.RingGeometry(.35, .75, 48), new T.MeshStandardMaterial({ color: 0xf6e3c8, roughness: .6 })); foam.rotation.x = -Math.PI / 2; foam.position.y = 1.485; cupG.add(foam);
  const handle = new T.Mesh(new T.TorusGeometry(.5, .11, 16, 40, Math.PI * 1.25), ceramic); handle.position.set(1.25, .95, 0); handle.rotation.z = -Math.PI * .625; cupG.add(handle);

  const donut = new T.Group(); donut.position.set(-3.1, 1.3, 1.4); root.add(donut);
  const dBase = new T.Mesh(new T.TorusGeometry(.62, .27, 24, 48), std(0xd99a5b, .6)); dBase.scale.z = .8; donut.add(dBase);
  const dIce = new T.Mesh(new T.TorusGeometry(.62, .29, 24, 48), std(0xff8fa3, .35)); dIce.scale.z = .6; dIce.position.z = .08; donut.add(dIce);
  const sc = [0xffffff, 0xf4b23e, 0x0e6b5c, 0xbfe6f2];
  for (let i = 0; i < 16; i++) { const a = Math.random() * 6.28, o = (Math.random() - .5) * .36, r = .62 + o, z = Math.sqrt(Math.max(.29 * .29 - o * o, 0)) * .6 + .09;
    const s = new T.Mesh(new T.BoxGeometry(.13, .035, .035), std(sc[i % 4], .5)); s.position.set(Math.cos(a) * r, Math.sin(a) * r, z); s.rotation.z = a + Math.random(); donut.add(s); }
  donut.rotation.x = Math.PI / 2.6;

  const mac = new T.Group(); mac.position.set(3.1, 2.1, .6); root.add(mac);
  [.14, -.14].forEach(y => { const m = new T.Mesh(new T.SphereGeometry(.5, 32, 16), std(0xf4b23e, .5)); m.scale.y = .38; m.position.y = y; mac.add(m); });
  mac.add(new T.Mesh(new T.CylinderGeometry(.44, .44, .16, 32), std(0xfff3d9, .8))); mac.rotation.set(.5, 0, .3);

  const beans = []; for (let i = 0; i < 9; i++) { const b = new T.Mesh(new T.SphereGeometry(.2, 16, 12), std(0x4a2c1a, .5)); b.scale.set(1, .7, .62);
    b.userData = { a: i / 9 * 6.28, r: 2.9 + Math.random() * 1.1, y: .6 + Math.random() * 2.6, s: .4 + Math.random() * .5 }; scene.add(b); beans.push(b); }
  const steam = []; for (let i = 0; i < 12; i++) { const m = new T.Mesh(new T.SphereGeometry(.2, 12, 10), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })); m.userData = { t: i / 12, x: (Math.random() - .5) * .8, z: (Math.random() - .5) * .8 }; cupG.add(m); steam.push(m); }
  const sh = document.createElement('canvas'); sh.width = sh.height = 128; const g = sh.getContext('2d'), gr = g.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(9,74,64,.35)'); gr.addColorStop(1, 'rgba(9,74,64,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const shadow = new T.Mesh(new T.PlaneGeometry(8, 8), new T.MeshBasicMaterial({ map: new T.CanvasTexture(sh), transparent: true, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; shadow.position.y = -.02; scene.add(shadow);

  let tx = 0, ty = 0, drag = false, lx = 0, spin = 0, raf, t0 = performance.now();
  const box = canvas.parentElement;
  const down = e => { drag = true; lx = e.clientX; }, up = () => drag = false;
  const move = e => { const r = box.getBoundingClientRect(); if (drag) { spin += (e.clientX - lx) * .012; lx = e.clientX; } tx = ((e.clientY - r.top) / r.height - .5) * .25; ty = ((e.clientX - r.left) / r.width - .5) * .3; };
  box.addEventListener('pointerdown', down); addEventListener('pointerup', up); box.addEventListener('pointermove', move);
  const size = () => { const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); cam.aspect = w / h; cam.fov = w / h < .9 ? 42 : 32; cam.updateProjectionMatrix(); };
  const ro = new ResizeObserver(size); ro.observe(canvas); size();
  const frame = () => {
    const t = (performance.now() - t0) / 1000;
    if (!drag) spin += .004;
    root.rotation.y += (spin + ty - root.rotation.y) * .08; root.rotation.x += (tx - root.rotation.x) * .08;
    root.position.y = Math.sin(t * 1.2) * .08;
    donut.position.y = 1.3 + Math.sin(t * 1.5) * .22; donut.rotation.z = t * .5;
    mac.position.y = 2.1 + Math.sin(t * 1.3 + 2) * .2; mac.rotation.y = t * .6;
    beans.forEach(b => { const u = b.userData, a = u.a + t * .25 * u.s; b.position.set(Math.cos(a) * u.r, u.y + Math.sin(t * u.s * 3) * .15, Math.sin(a) * u.r); b.rotation.set(t * u.s, t * u.s * .7, 0); });
    steam.forEach(s => { const u = s.userData; u.t = (u.t + .004) % 1; s.position.set(u.x + Math.sin(u.t * 9) * .15, 1.6 + u.t * 2.4, u.z); s.scale.setScalar(.6 + u.t * 1.8); s.material.opacity = Math.sin(u.t * Math.PI) * .22; });
    renderer.render(scene, cam); raf = (reduce || !on()) ? 0 : requestAnimationFrame(frame);
  };
  let vis = true; const on = () => vis && !document.hidden;
  const wake = () => { if (on() && !raf && !reduce) raf = requestAnimationFrame(frame); };
  const io = new IntersectionObserver(en => { vis = en[0].isIntersecting; wake(); }); io.observe(box);
  document.addEventListener('visibilitychange', wake);
  frame();
  return { destroy() { cancelAnimationFrame(raf); raf = 0; vis = false; io.disconnect(); document.removeEventListener('visibilitychange', wake); ro.disconnect(); removeEventListener('pointerup', up); renderer.dispose(); } };
}

/* ───────── MENU ───────── */
const mf = { q: '', cat: 'All', veg: false };
function mountMenu() {
  $('#app').innerHTML = `<div class="page"><h1 class="page-title">Our menu</h1><p class="page-sub">Everything we cook, with live availability. Prices are before 18% GST.</p>
    <div class="toolbar"><input class="search" id="mQ" placeholder="Search dishes" value="${esc(mf.q)}"><label class="switch"><input type="checkbox" id="mVeg" ${mf.veg ? 'checked' : ''}>Veg only</label></div>
    <div class="chips" id="mChips" style="margin-bottom:26px"></div><div id="mGrid"></div></div>`;
  $('#mQ').oninput = e => { mf.q = e.target.value; fillMenu(); }; $('#mVeg').onchange = e => { mf.veg = e.target.checked; fillMenu(); };
  fillMenu();
}
function filtered() { return sortedMenu().filter(m => (mf.cat === 'All' || m.category === mf.cat) && (!mf.veg || m.veg) && (m.name + ' ' + (m.desc || '')).toLowerCase().includes(mf.q.toLowerCase())); }
function chips(el, f, after) {
  el.innerHTML = ['All', ...state.cats.map(c => c.name)].map(c => `<button class="chip ${f.cat === c ? 'on' : ''}" data-chip="${esc(c)}">${esc(c)}</button>`).join('');
  $$('.chip', el).forEach(b => b.onclick = () => { f.cat = b.dataset.chip; after(); });
}
function fillMenu() {
  chips($('#mChips'), mf, fillMenu);
  const l = filtered(); $('#mGrid').innerHTML = !state.loaded.menu ? skel(6) : l.length ? `<div class="grid">${l.map(itemCard).join('')}</div>` : empty('Nothing found', state.menu.length ? 'Try a different search or category.' : 'The menu is being prepared.');
}

/* ───────── ORDER ───────── */
let map, marker, circle, rzpLoaded;
const of = { q: '', cat: 'All' };
function mountOrder() {
  if (state.confirm) return mountConfirm();
  $('#app').innerHTML = `<div class="page"><h1 class="page-title">Order for home delivery</h1><div id="oBanner"></div>
    <div id="oGate"></div>
    <div class="olayout" id="oLayout"><div><div class="toolbar"><input class="search" id="oQ" placeholder="Search dishes" value="${esc(of.q)}"></div>
      <div class="chips" id="oChips" style="margin-bottom:18px"></div><div class="olist" id="oList"></div></div>
      <aside class="oside"><div class="panel" id="oCart"></div><form class="panel" id="oForm" autocomplete="on"></form><div class="panel" id="oBill"></div></aside></div></div>`;
  $('#oQ').oninput = e => { of.q = e.target.value; fillOrderList(); };
  renderOrderAll(true);
}
function renderOrderAll(full) {
  fillBanner();
  const gate = $('#oGate'), layout = $('#oLayout'); if (!gate) return;
  if (!state.user) { layout.style.display = 'none'; gate.innerHTML = `<div class="panel authbox" style="text-align:center"><h3>Login to place an order</h3><p style="color:var(--muted);margin-bottom:18px">Only registered customers can order. It takes less than a minute.</p><a class="btn btn-primary" href="#/profile">Login or register</a></div>`; return; }
  gate.innerHTML = ''; layout.style.display = '';
  fillOrderList(); fillCart(); fillBill(); if (full) { fillForm(); setTimeout(initMap, 60); }
}
function fillBanner() {
  const d = state.delivery, el = $('#oBanner'); if (!el) return;
  el.innerHTML = d.enabled
    ? `<div class="obanner"><span>Delivery charge<b>${money(d.charge)}</b></span><span>We deliver within<b>${d.radiusKm} km</b></span><span>Minimum order<b>${money(d.minOrder)}</b></span><span>GST<b>18% added at checkout</b></span></div>`
    : `<div class="obanner off"><span>Home delivery<b>Paused right now</b></span><span>You can browse the menu, but ordering is switched off. Please check back soon.</span></div>`;
}
function fillOrderList() {
  chips($('#oChips'), of, fillOrderList);
  const l = sortedMenu().filter(m => (of.cat === 'All' || m.category === of.cat) && (m.name + (m.desc || '')).toLowerCase().includes(of.q.toLowerCase()));
  $('#oList').innerHTML = !state.loaded.menu ? Array.from({ length: 5 }, () => '<div class="sk row"></div>').join('') : l.length ? l.map(it => { const out = it.status === 'out', q = state.cart[it.id] || 0;
    return `<div class="orow ${out ? 'is-out' : ''}"><div class="th">${it.image ? `<img src="${it.image}" alt="" loading="lazy">` : `<div class="ph">${esc(it.name[0])}</div>`}</div>
      <div><h4>${esc(it.name)} <span class="tag ${out ? 'bad' : 'ok'}">${out ? 'Out of stock' : 'Available'}</span></h4><p>${esc(it.desc || '')}</p><strong>${money(it.price)}</strong></div>
      ${out ? '<button class="btn btn-sm btn-off" disabled>Unavailable</button>' : q ? `<div class="qty"><button data-act="dec" data-id="${it.id}">−</button><span>${q}</span><button data-act="inc" data-id="${it.id}">+</button></div>` : `<button class="btn btn-sm btn-primary" data-act="add" data-id="${it.id}">Add</button>`}</div>`; }).join('') : empty('No dishes found');
}
function fillCart() {
  const b = getBill();
  $('#oCart').innerHTML = `<h3>Your order</h3>` + (b.lines.length ? b.lines.map(l => `<div class="cline"><div><b>${esc(l.name)}</b>${l.status === 'out' ? ' <span class="tag bad">Out of stock</span>' : ''}<br><small>${money(l.price)} each</small></div>
    <div class="qty"><button data-act="dec" data-id="${l.id}">−</button><span>${l.qty}</span><button data-act="inc" data-id="${l.id}">+</button></div><b>${money(l.price * l.qty)}</b></div>`).join('') : `<p style="color:var(--muted)">Your order is empty. Add something from the list.</p>`);
}
function fillForm() {
  const f = state.form;
  $('#oForm').innerHTML = `<h3>Delivery details</h3>
    <div class="row2"><div class="field"><label for="fName">Full name</label><input id="fName" name="name" value="${esc(f.name || state.profile?.name || state.user?.displayName || '')}" required></div>
    <div class="field"><label for="fPhone">Mobile number</label><input id="fPhone" name="tel" inputmode="numeric" maxlength="10" placeholder="10-digit number" value="${esc(f.phone || '')}" required></div></div>
    <div class="mapbar"><input id="mapQ" placeholder="Search your area, street or landmark"><button type="button" class="btn btn-ghost btn-sm" id="mapGo">Search</button><button type="button" class="btn btn-sun btn-sm" id="mapMe">Use my location</button><div class="results" id="mapRes" hidden></div></div>
    <div id="map"></div><div class="distance" id="distBox">Drag the pin or tap the map to set your exact location.</div>
    <div class="field"><label for="fFlat">House, flat or floor</label><input id="fFlat" value="${esc(f.flat || '')}" placeholder="e.g. Flat 302, Green Apartments"></div>
    <div class="field"><label for="fAddr">Full address</label><textarea id="fAddr" rows="2" placeholder="Filled automatically from the pin, edit if needed">${esc(f.address || '')}</textarea></div>
    <div class="field"><label for="fLand">Landmark (optional)</label><input id="fLand" value="${esc(f.landmark || '')}"></div>`;
  const bind = (id, k) => $(id).oninput = e => { state.form[k] = e.target.value; saveForm(); };
  bind('#fName', 'name'); bind('#fPhone', 'phone'); bind('#fFlat', 'flat'); bind('#fAddr', 'address'); bind('#fLand', 'landmark');
  $('#fPhone').oninput = e => { e.target.value = e.target.value.replace(/\D/g, ''); state.form.phone = e.target.value; saveForm(); };
  $('#oForm').onsubmit = e => e.preventDefault();
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
  return e;
}
function fillBill() {
  const b = getBill(), d = state.delivery;
  $('#oBill').innerHTML = `<h3>Bill</h3>
    <div class="billrow"><span>Items total</span><span>${money(b.subtotal)}</span></div>
    <div class="billrow"><span>GST (18%)</span><span>${money(b.gst)}</span></div>
    <div class="billrow"><span>Delivery charge</span><span>${d.enabled ? money(b.dc) : '—'}</span></div>
    <div class="billrow total"><span>To pay</span><span>${money(b.total)}</span></div>
    <ul class="errs" id="oErrs" hidden></ul>
    <button class="btn btn-primary btn-lg btn-block" id="payBtn" style="margin-top:14px" ${d.enabled ? '' : 'disabled'}>Pay ${money(b.total)} securely</button>
    <p class="note">Payments are processed by Razorpay. Your order is confirmed right after payment succeeds.</p>`;
  $('#payBtn').onclick = payNow; updateDistance();
}
function updateDistance() {
  const box = $('#distBox'), f = state.form, d = state.delivery; if (!box) return;
  if (f.lat == null) { box.className = 'distance'; return; }
  const k = km(d.cafeLat, d.cafeLng, f.lat, f.lng), ok = k <= d.radiusKm;
  box.className = 'distance ' + (ok ? 'good' : 'bad');
  box.textContent = ok ? `${k.toFixed(1)} km from the café. We deliver to this location.` : `${k.toFixed(1)} km from the café. This is outside our ${d.radiusKm} km delivery area.`;
}
async function initMap() {
  if (!window.L) { try { await loadLib('leaflet'); } catch { return toast('Map could not load. Check your internet.', 'bad'); } }
  const el = $('#map'); if (!el || cur !== 'order') return; if (map) { map.remove(); map = null; }
  const d = state.delivery, f = state.form, has = f.lat != null, c = [d.cafeLat, d.cafeLng], start = has ? [f.lat, f.lng] : c;
  map = L.map(el).setView(start, has ? 16 : 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  L.circleMarker(c, { radius: 9, color: '#0E6B5C', fillColor: '#F4B23E', fillOpacity: 1, weight: 3 }).addTo(map).bindTooltip(d.cafeName || 'Café');
  circle = L.circle(c, { radius: d.radiusKm * 1000, color: '#0E6B5C', weight: 1.5, fillOpacity: .06 }).addTo(map);
  marker = L.marker(start, { draggable: true, icon: L.divIcon({ className: 'pin', html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 26] }) }).addTo(map);
  marker.on('dragend', () => setLoc(marker.getLatLng(), true)); map.on('click', e => { marker.setLatLng(e.latlng); setLoc(e.latlng, true); });
  setTimeout(() => map?.invalidateSize(), 200); updateDistance();
}
async function setLoc(ll, reverse) {
  state.form.lat = +ll.lat.toFixed(6); state.form.lng = +ll.lng.toFixed(6); saveForm(); updateDistance();
  if (reverse) { try { const r = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${ll.lat}&lon=${ll.lng}`)).json(); if (r.display_name) { state.form.address = r.display_name; saveForm(); const a = $('#fAddr'); if (a) a.value = r.display_name; } } catch { } }
}
function flyTo(lat, lng) { marker.setLatLng([lat, lng]); map.setView([lat, lng], 17); setLoc({ lat, lng }, true); }
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
function loadRazorpay() { return rzpLoaded ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = res; s.onerror = () => { rzpLoaded = null; rej(); }; document.head.append(s); }); }
async function payNow() {
  const b = getBill(), errs = validate(b), box = $('#oErrs');
  if (errs.length) { box.hidden = false; box.innerHTML = errs.map(e => `<li>${esc(e)}</li>`).join(''); return; } box.hidden = true;
  const btn = $('#payBtn'); btn.disabled = true; btn.textContent = 'Opening payment…';
  try { await loadRazorpay(); } catch { btn.disabled = false; fillBill(); return toast('Could not load Razorpay. Check your internet.', 'bad'); }
  const f = state.form, d = state.delivery, snap = { b, f: { ...f }, dist: km(d.cafeLat, d.cafeLng, f.lat, f.lng) };
  const rzp = new Razorpay({
    key: RAZORPAY_KEY_ID, amount: Math.round(b.total * 100), currency: 'INR', name: d.cafeName || 'The Yaari Cafe', description: `${b.lines.length} item order incl. 18% GST`,
    prefill: { name: f.name, email: state.user.email || '', contact: f.phone }, theme: { color: '#0E6B5C' },
    handler: r => saveOrder(r.razorpay_payment_id, snap), modal: { ondismiss: () => { fillBill(); } }
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
    state.cart = {}; saveCart(); state.confirm = { id: ref.id, total: b.total, paymentId }; mountOrder(); scrollTo(0, 0);
  } catch (e) {
    $('#app').innerHTML = `<div class="page"><div class="panel authbox" style="text-align:center"><h3>Payment received, order not saved</h3><p>Your payment (ID <b>${esc(paymentId)}</b>) went through but we could not record the order. Please call the café with this payment ID and we will confirm your order immediately.</p></div></div>`;
  }
}
function mountConfirm() {
  const c = state.confirm;
  $('#app').innerHTML = `<div class="page"><div class="confirm panel">
    <svg class="tick" viewBox="0 0 120 120"><circle cx="60" cy="60" r="56"/><path d="M36 62l16 16 32-34"/></svg>
    <h1 style="font-size:2.6rem">Order confirmed</h1>
    <div class="wait">🛵 Wait for delivery</div>
    <div class="road"><span>🛵</span></div>
    <p>Order <b>#${esc(c.id.slice(-6).toUpperCase())}</b> · Paid ${money(c.total)}<br><small style="color:var(--muted)">Payment ID ${esc(c.paymentId)}</small></p>
    <p style="margin-top:10px;color:var(--muted)">We are preparing your food. You can follow its status in your profile.</p>
    <div class="cactions"><button class="btn btn-primary btn-lg" data-act="orderMore">Back to menu to order more</button><a class="btn btn-ghost btn-lg" href="#/profile">Track my order</a></div></div></div>`;
}
function updOrder(kind) {
  if (cur !== 'order') return; if (state.confirm) return;
  if (!$('#oLayout')) return mountOrder();
  if (kind === 'auth') { return renderOrderAll(true); }
  if (kind === 'delivery') { fillBanner(); fillBill(); if (state.user) initMap(); return; }
  if (kind === 'menu') { fillOrderList(); fillCart(); fillBill(); return; }
  if (kind === 'cart') { fillOrderList(); fillCart(); fillBill(); return; }
}

/* ───────── GALLERY ───────── */
function mountGallery() { $('#app').innerHTML = `<div class="page"><h1 class="page-title">Gallery</h1><p class="page-sub">A look inside the café, the kitchen and the food.</p><div id="gGrid"></div></div>`; fillGallery(); }
function fillGallery() {
  $('#gGrid').innerHTML = state.gallery.length ? `<div class="masonry">${state.gallery.map(g => `<figure class="gitem tilt" data-lb="${g.id}"><img src="${g.image}" alt="${esc(g.caption || 'Café photo')}" loading="lazy">${g.caption ? `<figcaption>${esc(g.caption)}</figcaption>` : ''}</figure>`).join('')}</div>` : empty('Photos are coming soon', 'We are adding pictures of the café and our food.');
}
function openLightbox(id) { const g = state.gallery.find(x => x.id === id); if (!g) return; const lb = $('#lightbox'); lb.innerHTML = `<button class="x" aria-label="Close">✕</button><div><img src="${g.image}" alt=""><p>${esc(g.caption || '')}</p></div>`; lb.classList.add('open'); }

/* ───────── REVIEWS ───────── */
let myRating = 5;
const reviewCard = r => `<div class="rcard"><header><span class="avatar">${esc((r.name || '?')[0].toUpperCase())}</span><div><b>${esc(r.name)}</b><br><small>${fmtDate(r.createdAt)}</small></div></header><div class="stars">${stars(r.rating)}</div><p style="margin-top:6px">${esc(r.text)}</p></div>`;
function mountReviews() {
  $('#app').innerHTML = `<div class="page"><h1 class="page-title">Reviews</h1><p class="page-sub">Real words from people who ate with us.</p>
    <div class="rev-top"><div class="panel" id="rSide"></div><div><div class="grid" id="rList" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))"></div></div></div></div>`;
  fillReviews(); fillReviewForm();
}
function fillReviews() {
  const n = state.reviews.length, avg = n ? state.reviews.reduce((s, r) => s + r.rating, 0) / n : 0;
  const bars = [5, 4, 3, 2, 1].map(s => { const c = state.reviews.filter(r => r.rating === s).length; return `<div class="billrow"><span>${s} ★</span><span>${c}</span></div>`; }).join('');
  if ($('#rStats')) $('#rStats').innerHTML = `<div class="avg">${n ? avg.toFixed(1) : '–'}</div><div class="stars">${stars(Math.round(avg))}</div><p style="color:var(--muted)">${n} review${n === 1 ? '' : 's'}</p>${bars}`;
  $('#rList').innerHTML = n ? state.reviews.map(reviewCard).join('') : empty('No reviews yet', 'Be the first to share your experience.');
}
function fillReviewForm() {
  const mine = state.user && state.reviews.find(r => r.id === state.user.uid); if (mine) myRating = mine.rating;
  $('#rSide').innerHTML = `<div id="rStats"></div><hr style="border:0;border-top:1px solid var(--line);margin:18px 0">` + (state.user ? `<h3>${mine ? 'Update your review' : 'Write a review'}</h3>
    <div class="starpick" id="sp">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-s="${i}" class="${i <= myRating ? 'on' : ''}" aria-label="${i} stars">★</button>`).join('')}</div>
    <div class="field" style="margin-top:12px"><textarea id="rText" rows="4" maxlength="500" placeholder="What did you love?">${esc(mine?.text || '')}</textarea></div>
    <button class="btn btn-primary btn-block" id="rSend">${mine ? 'Save changes' : 'Post review'}</button>` : `<h3>Share your experience</h3><p style="color:var(--muted);margin-bottom:14px">Login to post a review.</p><a class="btn btn-primary btn-block" href="#/profile">Login or register</a>`);
  fillReviews();
  $$('#sp button').forEach(b => b.onclick = () => { myRating = +b.dataset.s; $$('#sp button').forEach(x => x.classList.toggle('on', +x.dataset.s <= myRating)); });
  $('#rSend') && ($('#rSend').onclick = async () => {
    const text = $('#rText').value.trim(); if (text.length < 3) return toast('Write a few words first', 'bad');
    try { await fs.setDoc(fs.doc(db, 'reviews', state.user.uid), { uid: state.user.uid, name: state.profile?.name || state.user.displayName || 'Guest', rating: myRating, text, createdAt: fs.serverTimestamp() }); toast('Thanks for your review!'); } catch { toast('Could not save review', 'bad'); }
  });
}

/* ───────── ABOUT ───────── */
function mountAbout() {
  const a = state.about, d = state.delivery, maps = d.cafeLat ? `https://www.google.com/maps?q=${d.cafeLat},${d.cafeLng}` : '#';
  $('#app').innerHTML = `<div class="page"><h1 class="page-title">${esc(a.title)}</h1><div class="about-grid" style="margin-top:28px">
    <div class="panel"><p class="story">${esc(a.story)}</p></div>
    <div class="panel"><h3>Opening hours</h3><div class="hours">${(a.hours || []).map(h => `<div><span>${esc(h.days)}</span><b>${esc(h.time)}</b></div>`).join('')}</div>
      <h3 style="margin-top:24px">Find us</h3><p>${esc(a.address || '')}</p>${a.phone ? `<p>📞 <a href="tel:${esc(a.phone)}">${esc(a.phone)}</a></p>` : ''}${a.email ? `<p>✉️ ${esc(a.email)}</p>` : ''}
      <a class="btn btn-primary" style="margin-top:14px" target="_blank" rel="noopener" href="${maps}">Open in Google Maps</a></div></div>
    ${(a.team || []).length ? `<section class="section"><h2>The people behind the counter</h2><div class="team">${a.team.map(t => `<div class="member tilt"><div class="avatar">${esc((t.name || '?')[0])}</div><b>${esc(t.name)}</b><br><small style="color:var(--muted)">${esc(t.role)}</small></div>`).join('')}</div></section>` : ''}</div>`;
}

/* ───────── PROFILE ───────── */
let authTab = 'login';
const STEPS = ['confirmed', 'preparing', 'out_for_delivery', 'delivered'], LABEL = { confirmed: 'Confirmed', preparing: 'Preparing', out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled' };
function mountProfile() { $('#app').innerHTML = `<div class="page"><div id="pBox"></div></div>`; fillProfile(); }
function fillProfile() {
  const box = $('#pBox'); if (!box) return;
  if (!state.user) {
    box.innerHTML = `<div class="authbox"><h1 class="page-title" style="font-size:2.6rem">Welcome</h1><p class="page-sub">Login or register to order, review and track your deliveries.</p><div class="panel">
      <div class="tabs"><button data-tab="login" class="${authTab === 'login' ? 'on' : ''}">Login</button><button data-tab="register" class="${authTab === 'register' ? 'on' : ''}">Register</button></div>
      <form id="aForm">${authTab === 'register' ? `<div class="field"><label for="aName">Full name</label><input id="aName" required></div><div class="field"><label for="aPhone">Mobile number</label><input id="aPhone" inputmode="numeric" maxlength="10" required></div>` : ''}
      <div class="field"><label for="aMail">Email</label><input id="aMail" type="email" autocomplete="email" required></div>
      <div class="field"><label for="aPass">Password</label><input id="aPass" type="password" minlength="6" autocomplete="${authTab === 'login' ? 'current-password' : 'new-password'}" required></div>
      <button class="btn btn-primary btn-block" id="aGo">${authTab === 'login' ? 'Login' : 'Create account'}</button>
      ${authTab === 'login' ? '<p class="note" style="text-align:center"><a href="#" data-act="forgot" style="text-decoration:underline">Forgot password?</a></p>' : ''}</form>
      <div class="divider">or</div><button class="btn btn-ghost btn-block" data-act="google">Continue with Google</button></div></div>`;
    $$('.tabs button').forEach(b => b.onclick = () => { authTab = b.dataset.tab; fillProfile(); });
    $('#aForm').onsubmit = submitAuth; return;
  }
  const name = state.profile?.name || state.user.displayName || 'Guest';
  box.innerHTML = `<h1 class="page-title" style="font-size:2.8rem">Hi, ${esc(name.split(' ')[0])}</h1><div class="profile-grid" style="margin-top:24px">
    <div class="panel"><div class="avatar big-av">${esc(name[0].toUpperCase())}</div>
      <div class="field"><label>Name</label><input id="pName" value="${esc(name)}"></div><div class="field"><label>Mobile number</label><input id="pPhone" inputmode="numeric" maxlength="10" value="${esc(state.profile?.phone || '')}"></div>
      <div class="field"><label>Email</label><input value="${esc(state.user.email || '')}" disabled></div>
      <button class="btn btn-primary btn-block" id="pSave">Save profile</button><button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="logout">Logout</button></div>
    <div><h2 style="margin-bottom:16px">Your orders</h2><div id="pOrders"></div></div></div>`;
  $('#pSave').onclick = async () => { try { await fs.setDoc(fs.doc(db, 'users', state.user.uid), { name: $('#pName').value.trim(), phone: $('#pPhone').value.replace(/\D/g, ''), email: state.user.email || '' }, { merge: true }); toast('Profile saved'); } catch { toast('Could not save', 'bad'); } };
  fillOrders();
}
function fillOrders() {
  const el = $('#pOrders'); if (!el) return;
  el.innerHTML = state.orders.length ? state.orders.map(o => { const i = STEPS.indexOf(o.status);
    return `<div class="ocard"><header><b>Order #${esc(o.id.slice(-6).toUpperCase())}</b><span class="pill ${o.status}">${LABEL[o.status] || o.status}</span></header>
      <small style="color:var(--muted)">${fmtDate(o.createdAt)}</small>
      ${o.status === 'cancelled' ? '' : `<div class="timeline">${STEPS.map((s, k) => `<i class="${k <= i ? 'on' : ''}" title="${LABEL[s]}"></i>`).join('')}</div>`}
      <p>${(o.items || []).map(x => `${x.qty}× ${esc(x.name)}`).join(', ')}</p><p><b>Paid ${money(o.total)}</b> <small style="color:var(--muted)">(incl. GST ${money(o.gst)})</small></p></div>`; }).join('')
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
    toast('Welcome!'); if (state.cart && cartCount()) location.hash = '#/order';
  } catch (err) { btn.disabled = false; toast(authMsg(err), 'bad'); }
}
const authMsg = e => ({ 'auth/invalid-credential': 'Wrong email or password', 'auth/email-already-in-use': 'This email is already registered. Try logging in.', 'auth/weak-password': 'Password must be at least 6 characters', 'auth/user-not-found': 'No account with this email', 'auth/wrong-password': 'Wrong password', 'auth/popup-closed-by-user': 'Login cancelled', 'auth/too-many-requests': 'Too many attempts. Try again later.' }[e.code] || 'Something went wrong. Please try again.');

/* ───────── router ───────── */
const pages = {
  home: { mount: mountHome, updateMany: ks => { if (ks.some(k => ['home', 'menu', 'delivery', 'reviews'].includes(k))) fillHome(); }, leave: leaveHome },
  menu: { mount: mountMenu, update: k => { if (k === 'menu') fillMenu(); } },
  order: { mount: mountOrder, update: updOrder, leave: () => { map?.remove(); map = null; },
    updateMany: ks => { if (ks.includes('auth')) return updOrder('auth'); if (ks.includes('delivery')) updOrder('delivery'); else if (ks.includes('menu')) updOrder('menu'); } },
  gallery: { mount: mountGallery, update: k => { if (k === 'gallery') fillGallery(); } },
  reviews: { mount: mountReviews, update: k => { if (k === 'reviews') fillReviews(); if (k === 'auth' || k === 'profile') fillReviewForm(); } },
  about: { mount: mountAbout, updateMany: ks => { if (ks.some(k => ['about', 'delivery'].includes(k))) mountAbout(); } },
  profile: { mount: mountProfile, update: k => { if (k === 'orders') fillOrders(); else if (k === 'auth' || k === 'profile') fillProfile(); } }
};
let cur = null;
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
  if (e.target.id === 'lightbox' || e.target.classList.contains('x')) $('#lightbox').classList.remove('open');
  if (lb) openLightbox(lb.dataset.lb);
  if (!e.target.closest('.mapbar') && $('#mapRes')) $('#mapRes').hidden = true;
  if (!a) return; const id = a.dataset.id;
  switch (a.dataset.act) {
    case 'add': addToCart(id); break;
    case 'inc': setQty(id, (state.cart[id] || 0) + 1); break;
    case 'dec': setQty(id, (state.cart[id] || 0) - 1); break;
    case 'burger': $('#nav').classList.toggle('open'); break;
    case 'orderMore': state.confirm = null; mountOrder(); scrollTo(0, 0); break;
    case 'logout': await au.signOut(auth); toast('Logged out'); break;
    case 'google': try { const c = await au.signInWithPopup(auth, new au.GoogleAuthProvider()); const ref = fs.doc(db, 'users', c.user.uid); if (!(await fs.getDoc(ref)).exists()) await fs.setDoc(ref, { name: c.user.displayName || '', email: c.user.email || '', createdAt: fs.serverTimestamp() }); } catch (err) { toast(authMsg(err), 'bad'); } break;
    case 'forgot': e.preventDefault(); { const m = $('#aMail')?.value.trim(); if (!m) return toast('Type your email first', 'bad'); try { await au.sendPasswordResetEmail(auth, m); toast('Password reset email sent'); } catch (err) { toast(authMsg(err), 'bad'); } } break;
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#lightbox').classList.remove('open'); });
let tiltBusy = false;
document.addEventListener('pointermove', e => {
  if (tiltBusy || e.pointerType === 'touch') return; const t = e.target.closest?.('.tilt'); if (!t) return;
  tiltBusy = true; const x = e.clientX, y = e.clientY;
  requestAnimationFrame(() => { tiltBusy = false; const r = t.getBoundingClientRect(); t.style.setProperty('--ry', ((x - r.left) / r.width - .5) * 10 + 'deg'); t.style.setProperty('--rx', (.5 - (y - r.top) / r.height) * 10 + 'deg'); });
});
document.addEventListener('pointerout', e => { const t = e.target.closest?.('.tilt'); if (t) { t.style.setProperty('--rx', '0deg'); t.style.setProperty('--ry', '0deg'); } });

route();
