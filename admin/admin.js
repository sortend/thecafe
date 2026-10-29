import { db, auth, fs, au } from './firebase-init.js';
import { ADMIN_EMAIL } from './firebase-config.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = n => Math.round(n * 100) / 100;
const money = n => '₹' + r2(n || 0).toLocaleString('en-IN');
const col = n => fs.collection(db, n);
const ts = x => x?.seconds || 0;
const fmt = x => x?.seconds ? new Date(x.seconds * 1000).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Just now';
const toast = (m, t = 'ok') => { const e = document.createElement('div'); e.className = 'toast ' + t; e.textContent = m; $('#toast').append(e); setTimeout(() => e.remove(), 3000); };
const lines = s => s.split('\n').map(x => x.trim()).filter(Boolean);

const S = { orders: [], menu: [], cats: [], gallery: [], reviews: [], users: [], delivery: {}, home: {}, about: {}, tab: 'dash', ofilter: 'all', ready: false };
let unsubs = [];

/* ───────── login ───────── */
function showLogin(msg = '') {
  $('#root').innerHTML = `<div class="login"><form id="lf"><h1>Admin login</h1><p>The Yaari Cafe control panel</p>
    ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
    <div class="field"><label for="e">Email</label><input id="e" type="email" autocomplete="username" required></div>
    <div class="field"><label for="p">Password</label><input id="p" type="password" autocomplete="current-password" required></div>
    <button class="btn btn-primary" style="width:100%" id="go">Login</button></form></div>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault(); $('#go').disabled = true;
    try { await au.signInWithEmailAndPassword(auth, $('#e').value.trim(), $('#p').value); }
    catch { showLogin('Wrong email or password.'); }
  };
}
au.onAuthStateChanged(auth, u => {
  unsubs.forEach(f => f()); unsubs = [];
  if (!u) return showLogin();
  if ((u.email || '').toLowerCase() !== ADMIN_EMAIL.toLowerCase()) { au.signOut(auth); return showLogin('This account is not an admin.'); }
  startApp();
});

/* ───────── data ───────── */
function startApp() {
  S.ready = false; shell();
  const L = (q, fn) => unsubs.push(fs.onSnapshot(q, fn, e => toast(e.message, 'bad')));
  const arr = s => s.docs.map(d => ({ id: d.id, ...d.data() }));
  let first = true;
  L(fs.query(col('orders')), s => { const added = !first && s.docChanges().some(c => c.type === 'added' && !c.doc.metadata.hasPendingWrites); first = false; S.orders = arr(s).sort((a, b) => ts(b.createdAt) - ts(a.createdAt)); if (added) { beep(); toast('New order received!'); } refresh('orders'); });
  L(col('menu'), s => { S.menu = arr(s).sort((a, b) => a.name.localeCompare(b.name)); refresh('menu'); });
  L(col('categories'), s => { S.cats = arr(s).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); refresh('menu'); });
  L(col('gallery'), s => { S.gallery = arr(s).sort((a, b) => ts(b.createdAt) - ts(a.createdAt)); refresh('gallery'); });
  L(col('reviews'), s => { S.reviews = arr(s).sort((a, b) => ts(b.createdAt) - ts(a.createdAt)); refresh('reviews'); });
  L(col('users'), s => { S.users = arr(s); refresh('users'); });
  L(fs.doc(db, 'settings', 'delivery'), s => { S.delivery = s.data() || {}; if (!S.ready || S.tab !== 'delivery') refresh('delivery'); });
  L(fs.doc(db, 'content', 'home'), s => { S.home = s.data() || {}; if (S.tab !== 'pages') refresh('pages'); });
  L(fs.doc(db, 'content', 'about'), s => { S.about = s.data() || {}; if (S.tab !== 'pages') refresh('pages'); });
  S.ready = true; render();
}
function beep() { try { const c = new AudioContext(), o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.value = 880; g.gain.setValueAtTime(.2, c.currentTime); g.gain.exponentialRampToValueAtTime(.001, c.currentTime + .6); o.start(); o.stop(c.currentTime + .6); } catch { } }
const MAP = { orders: ['dash', 'orders'], menu: ['dash', 'menu'], gallery: ['gallery'], reviews: ['reviews'], users: ['users', 'dash'], delivery: ['delivery'], pages: ['pages'] };
function refresh(kind) { renderSide(); if (kind === 'menu') window.__catDraw?.(); if (S.ready && (MAP[kind] || []).includes(S.tab)) render(); }

/* ───────── shell ───────── */
const TABS = [['dash', 'Dashboard'], ['orders', 'Orders'], ['menu', 'Menu items'], ['gallery', 'Gallery'], ['reviews', 'Reviews'], ['pages', 'Page content'], ['delivery', 'Delivery settings'], ['users', 'Customers']];
function shell() {
  $('#root').innerHTML = `<div class="shell"><aside id="side"></aside><main id="main"></main></div>`;
  $('#side').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) { S.tab = b.dataset.tab; renderSide(); render(); } if (e.target.id === 'out') au.signOut(auth); };
}
function renderSide() {
  const side = $('#side'); if (!side) return; const pend = S.orders.filter(o => o.status === 'confirmed').length;
  side.innerHTML = `<div class="brand"><i>☕</i>Yaari admin</div>` + TABS.map(([k, l]) => `<button class="tab ${S.tab === k ? 'on' : ''}" data-tab="${k}">${l}${k === 'orders' && pend ? `<span class="dot">${pend}</span>` : ''}</button>`).join('') +
    `<div class="foot">${esc(ADMIN_EMAIL)}<br><button class="btn btn-ghost btn-sm" id="out" style="margin-top:8px">Logout</button></div>`;
}
function render() { renderSide(); const m = $('#main'); if (!m) return; ({ dash, orders, menu, gallery, reviews, pages, delivery, users }[S.tab])(m); }

/* ───────── dashboard ───────── */
function dash(m) {
  const today = new Date().setHours(0, 0, 0, 0) / 1000, live = S.orders.filter(o => o.status !== 'cancelled'), td = live.filter(o => ts(o.createdAt) >= today);
  m.innerHTML = `<h1>Dashboard</h1><p class="sub">Live numbers from your café.</p><div class="cards">
    <div class="stat"><b>${td.length}</b><span>Orders today</span></div><div class="stat"><b>${money(td.reduce((s, o) => s + o.total, 0))}</b><span>Revenue today</span></div>
    <div class="stat"><b>${S.orders.filter(o => o.status === 'confirmed').length}</b><span>Waiting to be prepared</span></div><div class="stat"><b>${money(live.reduce((s, o) => s + o.total, 0))}</b><span>Total revenue</span></div>
    <div class="stat"><b>${S.menu.length}</b><span>Menu items</span></div><div class="stat"><b>${S.menu.filter(i => i.status === 'out').length}</b><span>Out of stock</span></div></div>
    <div class="panel"><h3>Latest orders</h3>${S.orders.slice(0, 5).map(orderCard).join('') || '<div class="empty">No orders yet.</div>'}</div>`;
  bindOrders(m);
}

/* ───────── orders ───────── */
const ST = [['confirmed', 'Confirmed'], ['preparing', 'Preparing'], ['out_for_delivery', 'Out for delivery'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']];
function orderCard(o) {
  const c = o.customer || {}, maps = c.lat != null ? `https://www.google.com/maps?q=${c.lat},${c.lng}` : '#';
  return `<div class="order ${o.status === 'confirmed' ? 'new' : ''}"><header><b>#${esc(o.id.slice(-6).toUpperCase())} <small>${fmt(o.createdAt)}</small></b>
    <select data-oid="${o.id}">${ST.map(([k, l]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></header>
    <div class="grid"><div><b>${esc(c.name)}</b><br><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a><br><small>${esc(c.flat ? c.flat + ', ' : '')}${esc(c.address)}${c.landmark ? ' (Near ' + esc(c.landmark) + ')' : ''}</small><br>
      <a href="${maps}" target="_blank" rel="noopener">Open exact location in Google Maps</a> <small>(${c.distanceKm ?? '?'} km)</small></div>
    <div>${(o.items || []).map(i => `${i.qty}× ${esc(i.name)} <small>${money(i.price * i.qty)}</small>`).join('<br>')}<hr style="border:0;border-top:1px dashed var(--line);margin:8px 0">
      <small>Items ${money(o.subtotal)} + GST ${money(o.gst)} + Delivery ${money(o.deliveryCharge)}</small><br><b>Paid ${money(o.total)}</b> <small>Razorpay ${esc(o.paymentId)}</small></div></div></div>`;
}
function bindOrders(m) { $$('select[data-oid]', m).forEach(s => s.onchange = async () => { try { await fs.updateDoc(fs.doc(db, 'orders', s.dataset.oid), { status: s.value }); toast('Order status updated'); } catch (e) { toast(e.message, 'bad'); } }); }
function orders(m) {
  const list = S.ofilter === 'all' ? S.orders : S.orders.filter(o => o.status === S.ofilter);
  m.innerHTML = `<h1>Orders</h1><p class="sub">Change the status and the customer sees it in their profile.</p>
    <div class="bar">${[['all', 'All'], ...ST].map(([k, l]) => `<button class="chip ${S.ofilter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>${list.map(orderCard).join('') || '<div class="empty">No orders here.</div>'}`;
  $$('[data-f]', m).forEach(b => b.onclick = () => { S.ofilter = b.dataset.f; orders(m); }); bindOrders(m);
}

/* ───────── menu ───────── */
function menu(m) {
  m.innerHTML = `<h1>Menu items</h1><p class="sub">Add, edit, delete items and mark them available or out of stock. Changes appear instantly on the website.</p>
    <div class="bar"><button class="btn btn-primary" id="add">Add item</button><button class="btn btn-ghost" id="cats">Manage categories</button>${S.menu.length ? '' : '<button class="btn btn-sun" id="seed">Load sample menu</button>'}</div>
    <div class="list">${S.menu.map(i => `<div class="item"><div class="th">${i.image ? `<img src="${i.image}" alt="">` : esc(i.name[0])}</div>
      <div><b>${esc(i.name)}</b> <span class="tag ${i.status === 'out' ? 'bad' : 'ok'}">${i.status === 'out' ? 'Out of stock' : 'Available'}</span>${i.featured ? ' <span class="tag mid">Popular</span>' : ''}<p>${esc(i.category)} · ${i.veg ? 'Veg' : 'Non-veg'} · ${money(i.price)}</p></div>
      <div class="acts"><button class="btn btn-ghost btn-sm" data-t="${i.id}">${i.status === 'out' ? 'Mark available' : 'Mark out of stock'}</button><button class="btn btn-ghost btn-sm" data-e="${i.id}">Edit</button><button class="btn btn-bad btn-sm" data-d="${i.id}">Delete</button></div></div>`).join('') || '<div class="empty">No items yet. Add your first item or load the sample menu.</div>'}</div>`;
  $('#add').onclick = () => itemModal(); $('#cats').onclick = catModal; $('#seed') && ($('#seed').onclick = seed);
  $$('[data-t]', m).forEach(b => b.onclick = () => { const i = S.menu.find(x => x.id === b.dataset.t); fs.updateDoc(fs.doc(db, 'menu', i.id), { status: i.status === 'out' ? 'available' : 'out' }); });
  $$('[data-e]', m).forEach(b => b.onclick = () => itemModal(S.menu.find(x => x.id === b.dataset.e)));
  $$('[data-d]', m).forEach(b => b.onclick = () => { if (confirm('Delete this item permanently?')) fs.deleteDoc(fs.doc(db, 'menu', b.dataset.d)).then(() => toast('Item deleted')); });
}
function modal(html) { const el = document.createElement('div'); el.className = 'modal'; el.innerHTML = `<div class="box">${html}</div>`; el.onclick = e => { if (e.target === el) el.remove(); }; document.body.append(el); return el; }
function itemModal(it = null) {
  let img = it?.image || '';
  const el = modal(`<h2 style="margin-bottom:18px">${it ? 'Edit item' : 'Add item'}</h2>
    <div class="field"><label>Item name</label><input id="n" value="${esc(it?.name || '')}"></div>
    <div class="field"><label>Description</label><textarea id="d" rows="2">${esc(it?.desc || '')}</textarea></div>
    <div class="row2"><div class="field"><label>Price in ₹ (before GST)</label><input id="p" type="number" min="0" step="1" value="${it?.price ?? ''}"></div>
      <div class="field"><label>Category</label><input id="c" list="cl" value="${esc(it?.category || '')}" placeholder="Pick or type new"><datalist id="cl">${S.cats.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist></div></div>
    <div class="row3"><div class="field"><label>Type</label><select id="v"><option value="1" ${it?.veg !== false ? 'selected' : ''}>Veg</option><option value="0" ${it?.veg === false ? 'selected' : ''}>Non-veg</option></select></div>
      <div class="field"><label>Stock</label><select id="s"><option value="available" ${it?.status !== 'out' ? 'selected' : ''}>Available</option><option value="out" ${it?.status === 'out' ? 'selected' : ''}>Out of stock</option></select></div>
      <div class="field"><label>Show as popular</label><select id="f"><option value="0">No</option><option value="1" ${it?.featured ? 'selected' : ''}>Yes</option></select></div></div>
    <div class="field"><label>Photo</label><div class="imgpick"><div class="th" id="pv">${img ? `<img src="${img}">` : 'No photo'}</div><input id="im" type="file" accept="image/*"></div></div>
    <div class="bar" style="margin:10px 0 0"><button class="btn btn-primary" id="sv">Save item</button><button class="btn btn-ghost" id="cn">Cancel</button></div>`);
  $('#cn', el).onclick = () => el.remove();
  $('#im', el).onchange = async e => { const f = e.target.files[0]; if (!f) return; img = await toData(f, 800, .78); $('#pv', el).innerHTML = `<img src="${img}">`; };
  $('#sv', el).onclick = async () => {
    const name = $('#n', el).value.trim(), price = parseFloat($('#p', el).value), category = $('#c', el).value.trim();
    if (!name || isNaN(price) || price < 0 || !category) return toast('Name, price and category are required', 'bad');
    const data = { name, desc: $('#d', el).value.trim(), price, category, veg: $('#v', el).value === '1', status: $('#s', el).value, featured: $('#f', el).value === '1', image: img };
    try {
      if (!S.cats.some(c => c.name === category)) await fs.addDoc(col('categories'), { name: category, order: S.cats.length });
      it ? await fs.updateDoc(fs.doc(db, 'menu', it.id), data) : await fs.addDoc(col('menu'), { ...data, createdAt: fs.serverTimestamp() });
      el.remove(); toast('Item saved');
    } catch (e) { toast(e.message, 'bad'); }
  };
}
function catModal() {
  const el = modal(`<h2 style="margin-bottom:14px">Categories</h2><div class="list" id="cl2"></div><div class="bar" style="margin-top:16px"><input id="cn2" class="field" style="padding:10px 14px;border-radius:99px;border:1.5px solid var(--line)" placeholder="New category name"><button class="btn btn-primary" id="ca">Add</button><button class="btn btn-ghost" id="cx">Close</button></div>`);
  const draw = () => { $('#cl2', el).innerHTML = S.cats.map(c => `<div class="item" style="grid-template-columns:1fr auto"><b>${esc(c.name)} <small style="color:var(--muted)">${S.menu.filter(i => i.category === c.name).length} items</small></b><button class="btn btn-bad btn-sm" data-x="${c.id}">Delete</button></div>`).join('') || '<div class="empty">No categories yet.</div>';
    $$('[data-x]', el).forEach(b => b.onclick = () => { const c = S.cats.find(x => x.id === b.dataset.x); if (S.menu.some(i => i.category === c.name)) return toast('Move or delete the items in this category first', 'bad'); fs.deleteDoc(fs.doc(db, 'categories', c.id)); }); };
  draw(); window.__catDraw = () => { if (document.body.contains(el)) draw(); else window.__catDraw = null; };
  $('#cx', el).onclick = () => el.remove();
  $('#ca', el).onclick = async () => { const v = $('#cn2', el).value.trim(); if (!v) return; if (S.cats.some(c => c.name.toLowerCase() === v.toLowerCase())) return toast('Category already exists', 'bad'); await fs.addDoc(col('categories'), { name: v, order: S.cats.length }); $('#cn2', el).value = ''; };
}
async function seed() {
  const cats = ['Coffee and chai', 'Breakfast', 'Burgers and sandwiches', 'Pizza and pasta', 'Desserts and shakes'];
  const items = [['Masala chai', 'Slow-brewed with ginger and cardamom', 60, 0, 1], ['Cappuccino', 'Double shot with silky milk foam', 140, 0, 1], ['Cold coffee', 'Blended with ice cream, thick and chilled', 160, 0, 1],
    ['Poha with sev', 'Soft flattened rice, lemon and peanuts', 90, 1, 0], ['Aloo paratha', 'Two parathas with curd and pickle', 120, 1, 0], ['Veg grilled sandwich', 'Garden vegetables and cheese, grilled', 130, 1, 0],
    ['Crispy veg burger', 'Crunchy patty with house sauce', 150, 1, 1], ['Chicken burger', 'Juicy grilled chicken, lettuce and mayo', 190, 2, 0], ['Margherita pizza', 'Tomato, mozzarella and basil', 280, 3, 1], ['Alfredo pasta', 'Creamy white sauce, herbs and garlic bread', 260, 3, 0],
    ['Chocolate brownie', 'Warm brownie with fudge', 140, 4, 1], ['Oreo shake', 'Thick shake with cookie crumble', 170, 4, 0]];
  try { for (let i = 0; i < cats.length; i++) await fs.addDoc(col('categories'), { name: cats[i], order: i });
    for (const [name, desc, price, c, f] of items) await fs.addDoc(col('menu'), { name, desc, price, category: cats[c], veg: name !== 'Chicken burger', status: 'available', featured: !!f, image: '', createdAt: fs.serverTimestamp() });
    toast('Sample menu added. Now edit it and add photos.'); } catch (e) { toast(e.message, 'bad'); }
}
function toData(file, max, q) { return new Promise((res, rej) => { const im = new Image(), r = new FileReader(); r.onload = () => { im.onload = () => { const s = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = im.width * s; c.height = im.height * s; c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', q)); }; im.onerror = rej; im.src = r.result; }; r.onerror = rej; r.readAsDataURL(file); }); }

/* ───────── gallery ───────── */
function gallery(m) {
  m.innerHTML = `<h1>Gallery</h1><p class="sub">Upload photos, add a caption, and delete any time. Photos are compressed automatically.</p>
    <div class="panel"><div class="row2"><div class="field"><label>Photos (you can select many)</label><input id="gf" type="file" accept="image/*" multiple></div><div class="field"><label>Caption (optional)</label><input id="gc"></div></div>
    <button class="btn btn-primary" id="gu">Upload</button></div>
    <div class="grid-g">${S.gallery.map(g => `<div class="gcard"><img src="${g.image}" alt="">${g.caption ? `<p>${esc(g.caption)}</p>` : ''}<button class="btn btn-bad btn-sm x" data-g="${g.id}">Delete</button></div>`).join('') || '<div class="empty" style="grid-column:1/-1">No photos yet.</div>'}</div>`;
  $('#gu').onclick = async () => { const files = [...$('#gf').files]; if (!files.length) return toast('Choose at least one photo', 'bad'); $('#gu').disabled = true;
    try { for (const f of files) await fs.addDoc(col('gallery'), { image: await toData(f, 1200, .8), caption: $('#gc').value.trim(), createdAt: fs.serverTimestamp() }); toast(`${files.length} photo(s) uploaded`); } catch (e) { toast(e.message, 'bad'); } $('#gu') && ($('#gu').disabled = false); };
  $$('[data-g]', m).forEach(b => b.onclick = () => confirm('Delete this photo?') && fs.deleteDoc(fs.doc(db, 'gallery', b.dataset.g)));
}

/* ───────── reviews & customers ───────── */
function reviews(m) {
  m.innerHTML = `<h1>Reviews</h1><p class="sub">Remove anything inappropriate.</p><div class="list">${S.reviews.map(r => `<div class="item" style="grid-template-columns:1fr auto"><div><b>${esc(r.name)}</b> <span style="color:var(--sun)">${'★'.repeat(r.rating)}</span> <small>${fmt(r.createdAt)}</small><p>${esc(r.text)}</p></div><button class="btn btn-bad btn-sm" data-r="${r.id}">Delete</button></div>`).join('') || '<div class="empty">No reviews yet.</div>'}</div>`;
  $$('[data-r]', m).forEach(b => b.onclick = () => confirm('Delete this review?') && fs.deleteDoc(fs.doc(db, 'reviews', b.dataset.r)));
}
function users(m) {
  m.innerHTML = `<h1>Customers</h1><p class="sub">${S.users.length} registered customers.</p><div class="list">${S.users.map(u => `<div class="item" style="grid-template-columns:1fr auto"><div><b>${esc(u.name)}</b><p>${esc(u.email)} ${u.phone ? '· ' + esc(u.phone) : ''}</p></div><small>${S.orders.filter(o => o.uid === u.id).length} orders</small></div>`).join('') || '<div class="empty">No customers yet.</div>'}</div>`;
}

/* ───────── page content ───────── */
function pages(m) {
  const h = S.home, a = S.about;
  const feats = (h.features || [{ icon: '☕', title: 'Brewed to order', text: 'Small-batch coffee and chai, made when you order it.' }, { icon: '🛵', title: 'Home delivery', text: 'Hot food from our kitchen to your doorstep.' }, { icon: '🥗', title: 'Honest ingredients', text: 'Seasonal produce and no shortcuts.' }, { icon: '💳', title: 'Easy payments', text: 'UPI, cards and netbanking through Razorpay.' }]).map(f => `${f.icon} | ${f.title} | ${f.text}`).join('\n');
  const hours = (a.hours || [{ days: 'Monday to Friday', time: '9:00 AM – 11:00 PM' }, { days: 'Saturday and Sunday', time: '8:00 AM – 12:00 AM' }]).map(x => `${x.days} | ${x.time}`).join('\n');
  const team = (a.team || [{ name: 'Head chef', role: 'Kitchen' }, { name: 'Barista lead', role: 'Coffee bar' }, { name: 'Delivery captain', role: 'Home delivery' }]).map(x => `${x.name} | ${x.role}`).join('\n');
  m.innerHTML = `<h1>Page content</h1><p class="sub">Edit the text on your pages. The pages themselves (Home, Menu, Order, Gallery, Reviews, About, Profile) are fixed and cannot be deleted. Menu items, gallery photos and reviews are managed in their own tabs.</p>
    <div class="panel"><h3>Home page</h3>
      <div class="field"><label>Announcement banner</label><input id="hb" value="${esc(h.banner || '')}" placeholder="e.g. Free dessert on orders above ₹500 this weekend. Leave empty to hide."></div>
      <div class="field"><label>Main headline</label><input id="ht" value="${esc(h.heroTitle || 'Chai, coffee and the people you love')}"></div>
      <div class="field"><label>Intro text</label><textarea id="hs" rows="2">${esc(h.heroSub || "Fresh food, slow brews and warm corners. Order from The Yaari Cafe and we'll bring it to your door.")}</textarea></div>
      <div class="field"><label>Highlight cards (one per line)</label><textarea id="hf" rows="5">${esc(feats)}</textarea><small>Format: emoji | title | short text. Add a line to add a card, remove a line to delete one.</small></div>
      <button class="btn btn-primary" id="sh">Save home page</button></div>
    <div class="panel"><h3>About page</h3>
      <div class="field"><label>Heading</label><input id="at" value="${esc(a.title || 'A corner café built for long conversations')}"></div>
      <div class="field"><label>Our story</label><textarea id="as" rows="6">${esc(a.story || '')}</textarea></div>
      <div class="field"><label>Opening hours (one per line)</label><textarea id="ah" rows="3">${esc(hours)}</textarea><small>Format: days | time</small></div>
      <div class="row3"><div class="field"><label>Phone</label><input id="ap" value="${esc(a.phone || '')}"></div><div class="field"><label>Email</label><input id="ae" value="${esc(a.email || 'theyaari@cafe.com')}"></div><div class="field"><label>Address</label><input id="aa" value="${esc(a.address || '')}"></div></div>
      <div class="field"><label>Team (one per line)</label><textarea id="at2" rows="4">${esc(team)}</textarea><small>Format: name | role</small></div>
      <button class="btn btn-primary" id="sa">Save about page</button></div>`;
  $('#sh').onclick = async () => { const features = lines($('#hf').value).map(l => { const [icon, title, ...t] = l.split('|').map(x => x.trim()); return { icon: icon || '⭐', title: title || '', text: t.join(' | ') }; });
    await save('content', 'home', { banner: $('#hb').value.trim(), heroTitle: $('#ht').value.trim(), heroSub: $('#hs').value.trim(), features }); };
  $('#sa').onclick = async () => { const pair = (s, a, b) => lines(s).map(l => { const [x, ...y] = l.split('|').map(z => z.trim()); return { [a]: x, [b]: y.join(' | ') }; });
    await save('content', 'about', { title: $('#at').value.trim(), story: $('#as').value, hours: pair($('#ah').value, 'days', 'time'), phone: $('#ap').value.trim(), email: $('#ae').value.trim(), address: $('#aa').value.trim(), team: pair($('#at2').value, 'name', 'role') }); };
}
async function save(c, d, data) { try { await fs.setDoc(fs.doc(db, c, d), data, { merge: true }); toast('Saved. Live on the website now.'); } catch (e) { toast(e.message, 'bad'); } }

/* ───────── delivery settings ───────── */
let amap, amarker, acircle;
function delivery(m) {
  const d = { enabled: true, charge: 40, radiusKm: 5, minOrder: 150, cafeLat: 28.6139, cafeLng: 77.2090, cafeName: 'The Yaari Cafe', ...S.delivery };
  m.innerHTML = `<h1>Delivery settings</h1><p class="sub">These values show at the top of the Order page and are used to check every order.</p>
    <div class="panel"><div class="switchrow"><div><b>Home delivery</b><br><small style="color:var(--muted)">Turn off to pause all new orders instantly.</small></div><input type="checkbox" class="switch" id="de" ${d.enabled ? 'checked' : ''}></div>
      <div class="field"><label>Café name</label><input id="dn" value="${esc(d.cafeName)}"></div>
      <div class="row3"><div class="field"><label>Delivery charge (₹)</label><input id="dc" type="number" min="0" value="${d.charge}"></div>
        <div class="field"><label>Delivery distance limit (km)</label><input id="dr" type="number" min="0.5" step="0.5" value="${d.radiusKm}"></div>
        <div class="field"><label>Minimum order (₹)</label><input id="dm" type="number" min="0" value="${d.minOrder}"></div></div>
      <h3 style="margin-top:8px">Café location</h3><p class="sub" style="margin-bottom:8px">Distance is measured from this point. Drag the pin or tap the map.</p>
      <div class="bar"><input id="aq" placeholder="Search your café address" style="flex:1;padding:10px 16px;border-radius:99px;border:1.5px solid var(--line)"><button class="btn btn-ghost" id="as1">Search</button><button class="btn btn-ghost" id="am1">Use my location</button></div>
      <div id="amap"></div><small id="ac" style="color:var(--muted)"></small>
      <div style="margin-top:18px"><button class="btn btn-primary" id="ds">Save delivery settings</button></div></div>`;
  let lat = d.cafeLat, lng = d.cafeLng;
  setTimeout(() => {
    amap = L.map('amap').setView([lat, lng], 14); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(amap);
    acircle = L.circle([lat, lng], { radius: d.radiusKm * 1000, color: '#0E6B5C', weight: 1.5, fillOpacity: .07 }).addTo(amap);
    amarker = L.marker([lat, lng], { draggable: true, icon: L.divIcon({ className: 'pin', html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 26] }) }).addTo(amap);
    const set = (a, b) => { lat = +a.toFixed(6); lng = +b.toFixed(6); amarker.setLatLng([lat, lng]); acircle.setLatLng([lat, lng]); $('#ac').textContent = `Selected: ${lat}, ${lng}`; };
    set(lat, lng); amarker.on('dragend', () => { const p = amarker.getLatLng(); set(p.lat, p.lng); }); amap.on('click', e => set(e.latlng.lat, e.latlng.lng));
    $('#dr').oninput = e => acircle.setRadius((parseFloat(e.target.value) || 0) * 1000);
    $('#as1').onclick = async () => { const q = $('#aq').value.trim(); if (!q) return; const r = await (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`)).json(); if (!r[0]) return toast('Place not found', 'bad'); set(+r[0].lat, +r[0].lon); amap.setView([lat, lng], 16); };
    $('#am1').onclick = () => navigator.geolocation.getCurrentPosition(p => { set(p.coords.latitude, p.coords.longitude); amap.setView([lat, lng], 17); }, () => toast('Location access denied', 'bad'), { enableHighAccuracy: true });
    $('#ds').onclick = () => save('settings', 'delivery', { enabled: $('#de').checked, cafeName: $('#dn').value.trim() || 'The Yaari Cafe', charge: Math.max(0, parseFloat($('#dc').value) || 0), radiusKm: Math.max(.5, parseFloat($('#dr').value) || 5), minOrder: Math.max(0, parseFloat($('#dm').value) || 0), cafeLat: lat, cafeLng: lng });
  }, 50);
}
