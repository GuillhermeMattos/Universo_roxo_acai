(function () {
'use strict';
var C = window.CONFIG || {};
var NAME = C.nome || 'Cardápio';
var app = document.getElementById('app');
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var money = function (n) { return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); };
var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
var ls = {
  get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sem armazenamento */ } }
};

/* ---------- leitura da planilha ---------- */
function norm(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
function parseCSV(text) {
  text = String(text).replace(/^﻿/, '');
  var first = text.split('\n')[0] || '';
  var sep = first.indexOf(';') >= 0 && first.indexOf(',') < 0 ? ';' : ',';
  var rows = [], row = [], f = '', q = false;
  for (var i = 0; i < text.length; i++) {
    var c = text.charAt(i);
    if (q) {
      if (c === '"') { if (text.charAt(i + 1) === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}
function num(s) {
  s = String(s == null ? '' : s).replace(/[^\d.,-]/g, '');
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  var n = parseFloat(s);
  return isFinite(n) && n > 0 ? n : 0;
}
function yes(s) {
  var v = norm(s);
  return !(v === 'nao' || v === 'n' || v === '0' || v === 'false' || v === 'esgotado' || v === 'fechado');
}
var menu = null, idx = null;
function buildMenu(text) {
  var rows = parseCSV(text);
  if (rows.length < 2) throw new Error('A planilha está vazia.');
  var col = {};
  rows[0].forEach(function (h, i) { col[norm(h)] = i; });
  if (col.tipo === undefined || col.nome === undefined) throw new Error('A primeira linha da planilha precisa ter as colunas tipo e nome.');
  var get = function (r, k) { return col[k] === undefined ? '' : String(r[col[k]] == null ? '' : r[col[k]]).trim(); };
  var m = { open: true, aviso: '', sizes: [], groups: [], extras: [] }, gmap = {}, emap = {};
  function group(name) {
    if (!gmap[name]) { gmap[name] = { name: name, limit: 0, desc: '', off: false, items: [] }; m.groups.push(gmap[name]); }
    return gmap[name];
  }
  rows.slice(1).forEach(function (r) {
    var t = norm(get(r, 'tipo')), nome = get(r, 'nome'), grupo = get(r, 'grupo'), on = yes(get(r, 'disponivel'));
    if (t === 'aviso') { if (nome) m.aviso = nome; }
    else if (t === 'aberto') { m.open = on; }
    else if (t === 'tamanho') { if (nome && on) m.sizes.push({ key: 't|' + nome, name: nome, price: num(get(r, 'preco')), desc: get(r, 'descricao') }); }
    else if (t === 'grupo') {
      if (!nome) return;
      var g = group(nome), n = parseInt(get(r, 'limite'), 10);
      g.limit = isFinite(n) && n > 0 ? n : 0; g.desc = get(r, 'descricao'); g.off = !on;
    }
    else if (t === 'item') {
      if (nome && grupo) group(grupo).items.push({ key: 'i|' + grupo + '|' + nome, name: nome, price: num(get(r, 'preco')), desc: get(r, 'descricao'), off: !on });
    }
    else if (t === 'extra') {
      if (!nome) return;
      var cat = grupo || 'Extras';
      if (!emap[cat]) { emap[cat] = { cat: cat, items: [] }; m.extras.push(emap[cat]); }
      emap[cat].items.push({ key: 'e|' + cat + '|' + nome, name: nome, price: num(get(r, 'preco')), desc: get(r, 'descricao'), off: !on });
    }
  });
  m.groups = m.groups.filter(function (g) { return !g.off && g.items.length; });
  m.extras = m.extras.filter(function (e) { return e.items.length; });
  if (!m.sizes.length) throw new Error('A planilha não tem nenhum tamanho disponível (linhas com tipo "tamanho").');
  return m;
}
function index(m) {
  var x = { size: {}, item: {}, extra: {} };
  m.sizes.forEach(function (s) { x.size[s.key] = s; });
  m.groups.forEach(function (g) { g.items.forEach(function (i) { x.item[i.key] = i; }); });
  m.extras.forEach(function (e) { e.items.forEach(function (i) { x.extra[i.key] = i; }); });
  return x;
}

/* ---------- estado ---------- */
var loadErr = '', notice = '', cart = { acais: [], extras: {} };
var form = { name: '', type: 'retirada', addr: '', pay: (C.pagamentos && C.pagamentos[0]) || 'Pix', obs: '' };
var builder = null, checkout = false, sent = false, copyBox = '', toastTimer = null;
try { var c0 = JSON.parse(ls.get('cart') || 'null'); if (c0 && Array.isArray(c0.acais)) cart = c0; } catch (e) { /* ignora */ }
try { var f0 = JSON.parse(ls.get('form') || 'null'); if (f0) form = Object.assign(form, f0); } catch (e) { /* ignora */ }
function saveCart() { ls.set('cart', JSON.stringify(cart)); }
function saveForm() { ls.set('form', JSON.stringify(form)); }
var canDeliver = function () { return C.entrega !== false; };
var fee = function () { return form.type === 'entrega' && canDeliver() ? Number(C.taxaEntrega || 0) : 0; };

function reconcile() {
  cart.acais = cart.acais.filter(function (a) { return idx.size[a.size]; }).map(function (a) {
    var picks = {};
    menu.groups.forEach(function (g) {
      var ok = ((a.picks && a.picks[g.name]) || []).filter(function (k) { var it = idx.item[k]; return it && !it.off && g.items.indexOf(it) >= 0; });
      if (g.limit) ok = ok.slice(0, g.limit);
      if (ok.length) picks[g.name] = ok;
    });
    return { size: a.size, picks: picks };
  });
  var ex = {};
  Object.keys(cart.extras).forEach(function (k) { var it = idx.extra[k]; if (it && !it.off && cart.extras[k] > 0) ex[k] = cart.extras[k]; });
  cart.extras = ex; saveCart();
}
function acaiTotal(a) {
  var s = idx.size[a.size], t = s ? s.price : 0;
  menu.groups.forEach(function (g) { (a.picks[g.name] || []).forEach(function (k) { var it = idx.item[k]; if (it) t += it.price; }); });
  return t;
}
function subtotal() {
  var t = 0;
  cart.acais.forEach(function (a) { t += acaiTotal(a); });
  Object.keys(cart.extras).forEach(function (k) { var it = idx.extra[k]; if (it) t += it.price * cart.extras[k]; });
  return t;
}
function count() { return cart.acais.length + Object.keys(cart.extras).reduce(function (s, k) { return s + cart.extras[k]; }, 0); }
function waDigits() {
  var d = String(C.whatsapp || '').replace(/\D/g, '');
  if (d && d.length <= 11) d = '55' + d;
  return d;
}
function acaiLines(a) {
  var out = [];
  menu.groups.forEach(function (g) {
    var names = (a.picks[g.name] || []).map(function (k) { var it = idx.item[k]; return it ? it.name + (it.price > 0 ? ' (+' + money(it.price) + ')' : '') : ''; }).filter(Boolean);
    if (names.length) out.push({ g: g.name, text: names.join(', ') });
  });
  return out;
}
function orderText() {
  var t = '*Pedido - ' + NAME + '*\nCliente: ' + form.name.trim() + '\n';
  t += form.type === 'entrega' ? 'Entrega em: ' + form.addr.trim() + '\n' : 'Retirada no local\n';
  t += '\n';
  cart.acais.forEach(function (a) {
    var s = idx.size[a.size];
    t += '1x Açaí ' + s.name + ' (' + money(s.price) + ')\n';
    acaiLines(a).forEach(function (l) { t += '   ' + l.g + ': ' + l.text + '\n'; });
    t += '   Subtotal: ' + money(acaiTotal(a)) + '\n';
  });
  Object.keys(cart.extras).forEach(function (k) { var it = idx.extra[k]; if (it) t += cart.extras[k] + 'x ' + it.name + ' (' + money(it.price * cart.extras[k]) + ')\n'; });
  t += '\n';
  if (fee()) t += 'Taxa de entrega: ' + money(fee()) + '\n';
  t += 'Total: ' + money(subtotal() + fee()) + '\nPagamento: ' + form.pay + '\n';
  if (form.obs.trim()) t += 'Obs.: ' + form.obs.trim() + '\n';
  return t;
}
function orderError() {
  if (!count()) return 'Seu pedido está vazio.';
  if (!form.name.trim()) return 'Informe seu nome.';
  if (form.type === 'entrega' && !form.addr.trim()) return 'Informe o endereço de entrega.';
  return '';
}

/* ---------- telas ---------- */
function logoImg() { return C.logo ? '<img class="logo" src="' + esc(C.logo) + '" alt="Logotipo de ' + esc(NAME) + '">' : ''; }
function header() {
  var d = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  var open = menu ? menu.open : true;
  return '<header class="head"><div class="brand">' + logoImg() + '<div class="grow"><div class="eyebrow">Cardápio de ' + esc(d) + '</div><h1>' + esc(NAME) + '</h1></div></div>' +
    (menu ? '<div class="meta"><span class="status ' + (open ? 'on' : 'off') + '"><i></i>' + (open ? 'Recebendo pedidos' : 'Fechado no momento') + '</span>' +
    (menu.aviso ? '<span class="notice">' + esc(menu.aviso) + '</span>' : '') + '</div>' : '') + '</header>';
}
function rangeText(g) { return g.limit ? 'até ' + g.limit : 'quantos quiser'; }
function viewMain() {
  var out = '';
  if (notice) out += '<div class="banner">' + esc(notice) + '</div>';
  if (!menu.open) out += '<div class="banner">Estamos fechados agora. Você pode ver o cardápio e voltar mais tarde.</div>';
  out += '<h2 class="cat">Seu açaí</h2>';
  cart.acais.forEach(function (a, i) {
    var s = idx.size[a.size];
    out += '<div class="card"><div class="spread"><span class="title">Açaí ' + esc(s.name) + '</span><span class="price">' + money(acaiTotal(a)) + '</span></div><ul class="lines">' +
      acaiLines(a).map(function (l) { return '<li><b>' + esc(l.g) + ':</b> ' + esc(l.text) + '</li>'; }).join('') + '</ul>' +
      '<div class="row-btns mt"><button class="btn sm" id="edit-' + i + '" data-act="editA" data-i="' + i + '">Editar</button>' +
      '<button class="btn sm" id="dup-' + i + '" data-act="dupA" data-i="' + i + '">Duplicar</button>' +
      '<button class="btn sm danger" id="rm-' + i + '" data-act="rmA" data-i="' + i + '">Remover</button></div></div>';
  });
  if (menu.open) out += '<div class="mt"><button class="btn primary" id="new-a" data-act="newA">' + (cart.acais.length ? 'Montar outro açaí' : 'Montar meu açaí') + '</button></div>';
  out += '<h2 class="cat">Tamanhos</h2>';
  menu.sizes.forEach(function (s) {
    out += '<div class="dish"><div><div class="dish-top"><h3>' + esc(s.name) + '</h3><span class="leader"></span><span class="price">' + money(s.price) + '</span></div>' +
      (s.desc ? '<p>' + esc(s.desc) + '</p>' : '') + '</div><div></div></div>';
  });
  out += '<h2 class="cat">Opções</h2>';
  menu.groups.forEach(function (g) {
    out += '<div class="opts"><b>' + esc(g.name) + ' · ' + esc(rangeText(g)) + (g.desc ? ' · ' + esc(g.desc) : '') + '</b>' +
      g.items.map(function (i) { var n = esc(i.name) + (i.price > 0 ? ' (+' + money(i.price) + ')' : ''); return i.off ? '<s>' + n + '</s>' : n; }).join(' · ') + '</div>';
  });
  var xi = 0;
  menu.extras.forEach(function (e) {
    out += '<h2 class="cat">' + esc(e.cat) + '</h2>';
    e.items.forEach(function (d) {
      var q = cart.extras[d.key] || 0, ctl = '', id = 'x' + (xi++), kk = esc(d.key);
      if (d.off) ctl = '<span class="pill">Esgotado</span>';
      else if (!menu.open) ctl = '';
      else if (q > 0) ctl = '<span class="step"><button id="xdec-' + id + '" data-act="xdec" data-k="' + kk + '" aria-label="Tirar um ' + esc(d.name) + '">−</button><b>' + q + '</b><button id="xinc-' + id + '" data-act="xinc" data-k="' + kk + '" aria-label="Adicionar mais um ' + esc(d.name) + '">+</button></span>';
      else ctl = '<button class="btn sm" id="xadd-' + id + '" data-act="xinc" data-k="' + kk + '">Adicionar</button>';
      out += '<article class="dish' + (d.off ? ' sold' : '') + '"><div><div class="dish-top"><h3>' + esc(d.name) + '</h3><span class="leader"></span><span class="price">' + money(d.price) + '</span></div>' +
        (d.desc ? '<p>' + esc(d.desc) + '</p>' : '') + '</div><div>' + ctl + '</div></article>';
    });
  });
  return out;
}
function barHtml() {
  if (!menu || !menu.open || checkout || builder || !count()) return '';
  var n = count();
  return '<div class="bar"><div class="bar-in"><span class="bar-txt"><b>' + n + (n === 1 ? ' item' : ' itens') + '</b><small>' + money(subtotal()) + '</small></span>' +
    '<button class="btn primary" id="open-checkout" data-act="openCheckout">Ver pedido</button></div></div>';
}
function builderHtml() {
  var a = builder.a, s = idx.size[a.size];
  var h = '<div class="back" id="back"><div class="sheet" role="dialog" aria-modal="true" aria-label="Monte seu açaí"><h2>Monte seu açaí</h2>' +
    '<div class="field"><span class="lbl">Tamanho</span><div class="chips">' +
    menu.sizes.map(function (z, i) {
      return '<label class="chip"><input type="radio" name="size" id="size-' + i + '" value="' + i + '"' + (a.size === z.key ? ' checked' : '') + '>' + esc(z.name) + ' · ' + money(z.price) + '</label>';
    }).join('') + '</div></div>';
  menu.groups.forEach(function (g, gi) {
    var picks = a.picks[g.name] || [];
    h += '<fieldset class="group"><legend>' + esc(g.name) + ' <small>' + esc(rangeText(g)) + (g.limit ? ' (' + picks.length + '/' + g.limit + ')' : '') + '</small></legend>';
    g.items.forEach(function (it, ii) {
      var on = picks.indexOf(it.key) >= 0, off = it.off || (!on && g.limit > 1 && picks.length >= g.limit);
      h += '<label class="choice' + (off ? ' off' : '') + '"><input type="checkbox" id="pick-' + gi + '-' + ii + '" data-act="pick" data-g="' + gi + '" data-i="' + ii + '"' + (on ? ' checked' : '') + (off ? ' disabled' : '') + '>' +
        '<span class="nm">' + esc(it.name) + (it.off ? ' (esgotado)' : '') + '</span><span class="pr">' + (it.price > 0 ? '+' + money(it.price) : 'incluso') + '</span></label>';
    });
    h += '</fieldset>';
  });
  h += '<div class="sum total"><span>Este açaí</span><span id="b-total">' + money(acaiTotal(a)) + '</span></div>' +
    '<div class="row-btns mt"><button class="btn primary" id="save-a" data-act="saveA">' + (builder.idx == null ? 'Adicionar ao pedido' : 'Salvar açaí') + '</button>' +
    '<button class="btn" id="cancel-a" data-act="cancelA">Cancelar</button></div></div></div>';
  return h;
}
function checkoutHtml() {
  var sub = subtotal(), f = fee(), wa = waDigits();
  var h = '<div class="back" id="back"><div class="sheet" role="dialog" aria-modal="true" aria-label="Seu pedido"><h2>' + (sent ? 'Falta só enviar' : 'Seu pedido') + '</h2>';
  if (sent) {
    h += '<p>Se o WhatsApp abriu, toque em <b>enviar</b> na conversa. Seu pedido só chega ao restaurante depois disso.</p>' +
      '<p class="muted mt">Não abriu? Copie o pedido e envie pelo WhatsApp do restaurante' + (C.whatsapp ? ': ' + esc(C.whatsapp) : '') + '.</p>' +
      (copyBox ? '<div class="field mt"><label for="copy-box">Texto do pedido</label><textarea id="copy-box" readonly style="min-height:150px">' + esc(copyBox) + '</textarea></div>' : '') +
      '<div class="row-btns mt">' + (wa ? '<a class="btn primary" id="wa-send" data-act="wa" href="#" target="_blank" rel="noopener">Abrir o WhatsApp de novo</a>' : '') +
      '<button class="btn" id="copy-btn" data-act="copy">Copiar pedido</button>' +
      '<button class="btn" id="new-order" data-act="newOrder">Fazer outro pedido</button><button class="btn" id="back-order" data-act="backOrder">Voltar ao pedido</button></div></div></div>';
    return h;
  }
  cart.acais.forEach(function (a) {
    var s = idx.size[a.size];
    h += '<div class="list-row"><div class="nm"><b>Açaí ' + esc(s.name) + '</b><ul class="lines">' +
      acaiLines(a).map(function (l) { return '<li><b>' + esc(l.g) + ':</b> ' + esc(l.text) + '</li>'; }).join('') + '</ul></div><span class="price">' + money(acaiTotal(a)) + '</span></div>';
  });
  Object.keys(cart.extras).forEach(function (k) {
    var it = idx.extra[k]; if (!it) return;
    h += '<div class="list-row"><div class="nm"><b>' + esc(it.name) + '</b><span class="muted">' + cart.extras[k] + ' × ' + money(it.price) + '</span></div><span class="price">' + money(it.price * cart.extras[k]) + '</span></div>';
  });
  h += '<div class="mt"></div>' +
    '<div class="field"><label for="f-name">Seu nome</label><input type="text" id="f-name" data-f="name" value="' + esc(form.name) + '" autocomplete="name" maxlength="80"></div>' +
    (canDeliver() ? '<div class="field"><span class="lbl">Como você quer receber?</span><div class="chips">' +
      '<label class="chip"><input type="radio" name="type" id="f-type-retirada" value="retirada"' + (form.type === 'retirada' ? ' checked' : '') + '>Retirar no local</label>' +
      '<label class="chip"><input type="radio" name="type" id="f-type-entrega" value="entrega"' + (form.type === 'entrega' ? ' checked' : '') + '>Entrega</label></div></div>' : '') +
    (form.type === 'entrega' && canDeliver() ? '<div class="field"><label for="f-addr">Endereço de entrega</label><input type="text" id="f-addr" data-f="addr" value="' + esc(form.addr) + '" autocomplete="street-address" maxlength="200"></div>' : '') +
    '<div class="field"><label for="f-pay">Pagamento</label><select id="f-pay" data-f="pay">' + (C.pagamentos || ['Pix']).map(function (p) { return '<option' + (form.pay === p ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label for="f-obs">Observações</label><textarea id="f-obs" data-f="obs" maxlength="300" placeholder="Sem granola, troco para R$ 50…">' + esc(form.obs) + '</textarea></div>' +
    '<div class="sum"><span>Subtotal</span><span>' + money(sub) + '</span></div>' +
    (f ? '<div class="sum"><span>Taxa de entrega</span><span>' + money(f) + '</span></div>' : '') +
    '<div class="sum total"><span>Total</span><span>' + money(sub + f) + '</span></div>' +
    '<div class="err" id="sheet-err" role="alert"></div><div class="row-btns">' +
    (wa ? '<a class="btn primary" id="wa-send" data-act="wa" href="#" target="_blank" rel="noopener">Enviar pelo WhatsApp</a>' : '') +
    '<button class="btn' + (wa ? '' : ' primary') + '" id="copy-btn" data-act="copy">Copiar pedido</button>' +
    '<button class="btn" id="close-sheet" data-act="closeCheckout">Voltar ao cardápio</button></div>' +
    (wa ? '' : '<p class="hint mt">Este cardápio ainda não tem WhatsApp configurado. Copie o pedido e envie ao restaurante.</p>') + '</div></div>';
  return h;
}
function render() {
  var ae = document.activeElement, fid = ae && ae.id, sy = window.scrollY;
  document.title = NAME + ' · Cardápio';
  if (!menu) {
    app.innerHTML = '<div class="wrap">' + header() + '<div class="empty"><h2>' + (loadErr ? 'Não foi possível abrir o cardápio' : 'Carregando o cardápio…') + '</h2>' +
      (loadErr ? '<p class="muted">' + esc(loadErr) + '</p><button class="btn primary" id="retry" data-act="retry">Tentar de novo</button>' : '') + '</div></div>';
    return;
  }
  app.innerHTML = '<div class="wrap">' + header() + '<main>' + viewMain() + '</main></div><div id="bar">' + barHtml() + '</div>' +
    (builder ? builderHtml() : '') + (checkout ? checkoutHtml() : '') + '<div id="toast" class="toast" role="status" hidden></div>';
  if (fid) { var n = document.getElementById(fid); if (n) { try { n.focus({ preventScroll: true }); } catch (e) { /* sem foco */ } } }
  window.scrollTo(0, sy);
}
function flash(t) {
  var el = document.getElementById('toast'); if (!el) return;
  el.textContent = t; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
}
function setErr(id, t) { var el = document.getElementById(id); if (el) el.textContent = t; }

/* ---------- carregar o cardápio ---------- */
function setMenu(text) {
  var m = buildMenu(text), old = menu;
  menu = m; idx = index(m);
  return old;
}
function loadMenu() {
  var demo = !C.planilha;
  var url = demo ? 'cardapio-modelo.csv' : C.planilha + (C.planilha.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
  return fetch(url, { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error('A planilha não respondeu (código ' + r.status + '). Confira se ela está publicada na web.');
    return r.text();
  }).then(function (text) {
    if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('O link da planilha não devolveu os dados. Use o link de publicação em formato CSV.');
    setMenu(text); loadErr = '';
    notice = demo ? 'Modo demonstração: este é um cardápio de exemplo. Conecte a sua planilha no arquivo config.js.' : '';
    if (!demo) ls.set('menuCache', JSON.stringify({ t: Date.now(), csv: text }));
    reconcile(); render();
  }).catch(function (e) {
    var cached = null;
    try { cached = JSON.parse(ls.get('menuCache') || 'null'); } catch (x) { /* ignora */ }
    if (cached && cached.csv && !demo) {
      try { setMenu(cached.csv); notice = 'Sem conexão com o cardápio agora. Mostrando a última versão salva neste aparelho, os preços podem estar desatualizados.'; reconcile(); render(); return; } catch (x) { /* cai no erro */ }
    }
    if (!menu) { loadErr = e && e.message ? e.message : 'Verifique sua internet e tente de novo.'; render(); }
  });
}

/* ---------- ações ---------- */
function newBuilder(idxEdit) {
  builder = idxEdit == null ? { idx: null, a: { size: menu.sizes[0].key, picks: {} } } : { idx: idxEdit, a: clone(cart.acais[idxEdit]) };
  render();
}
document.addEventListener('click', function (e) {
  if (e.target.id === 'back') { builder = null; checkout = false; sent = false; render(); return; }
  var t = e.target.closest('[data-act]');
  if (!t) return;
  var a = t.getAttribute('data-act'), i = Number(t.getAttribute('data-i')), k = t.getAttribute('data-k');
  if (a === 'retry') { loadErr = ''; render(); loadMenu(); }
  else if (a === 'newA') newBuilder(null);
  else if (a === 'editA') newBuilder(i);
  else if (a === 'dupA') { cart.acais.splice(i + 1, 0, clone(cart.acais[i])); saveCart(); render(); }
  else if (a === 'rmA') { cart.acais.splice(i, 1); saveCart(); if (checkout && !count()) checkout = false; render(); }
  else if (a === 'cancelA') { builder = null; render(); }
  else if (a === 'saveA') {
    if (!idx.size[builder.a.size]) return;
    if (builder.idx == null) cart.acais.push(builder.a); else cart.acais[builder.idx] = builder.a;
    builder = null; saveCart(); render(); flash('Açaí adicionado');
  }
  else if (a === 'xinc') { cart.extras[k] = (cart.extras[k] || 0) + 1; saveCart(); render(); }
  else if (a === 'xdec') { cart.extras[k] = (cart.extras[k] || 0) - 1; if (cart.extras[k] <= 0) delete cart.extras[k]; saveCart(); if (checkout && !count()) checkout = false; render(); }
  else if (a === 'openCheckout') { checkout = true; sent = false; render(); }
  else if (a === 'closeCheckout') { checkout = false; render(); }
  else if (a === 'backOrder') { sent = false; render(); }
  else if (a === 'newOrder') { cart = { acais: [], extras: {} }; saveCart(); checkout = false; sent = false; copyBox = ''; render(); window.scrollTo(0, 0); }
  else if (a === 'wa') {
    var er = sent ? '' : orderError();
    if (er) { e.preventDefault(); setErr('sheet-err', er); return; }
    t.href = 'https://wa.me/' + waDigits() + '?text=' + encodeURIComponent(orderText());
    if (!sent) setTimeout(function () { sent = true; render(); }, 400);
  }
  else if (a === 'copy') {
    var er2 = sent ? '' : orderError();
    if (er2) { setErr('sheet-err', er2); return; }
    var txt = orderText();
    var fail = function () { copyBox = txt; sent = true; render(); var b = document.getElementById('copy-box'); if (b) { b.focus(); b.select(); } };
    try { navigator.clipboard.writeText(txt).then(function () { flash('Pedido copiado'); }, fail); } catch (x) { fail(); }
  }
});
document.addEventListener('change', function (e) {
  var t = e.target;
  if (t.name === 'size' && builder) { builder.a.size = menu.sizes[Number(t.value)].key; render(); return; }
  if (t.name === 'type') { form.type = t.value; saveForm(); render(); return; }
  if (t.getAttribute('data-act') === 'pick' && builder) {
    var g = menu.groups[Number(t.getAttribute('data-g'))], it = g.items[Number(t.getAttribute('data-i'))];
    var arr = (builder.a.picks[g.name] || []).slice();
    if (t.checked) { if (g.limit === 1) arr = [it.key]; else if (!g.limit || arr.length < g.limit) arr.push(it.key); }
    else arr = arr.filter(function (x) { return x !== it.key; });
    builder.a.picks[g.name] = arr; render(); return;
  }
  var f = t.getAttribute('data-f');
  if (f) { form[f] = t.value; saveForm(); }
});
document.addEventListener('input', function (e) {
  var f = e.target.getAttribute && e.target.getAttribute('data-f');
  if (f) { form[f] = e.target.value; saveForm(); var er = document.getElementById('sheet-err'); if (er) er.textContent = ''; }
});
document.addEventListener('visibilitychange', function () { if (!document.hidden && !builder && !checkout) loadMenu(); });

render();
loadMenu();
})();
