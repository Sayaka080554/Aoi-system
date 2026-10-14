// Aoi-system — 蓄水池 · 互购净额台账（v3.25.0）
// 和日本/韩国代购互买谷子的挂账本：订单计入池两侧（A=TA帮我买/我欠，B=我帮TA买/TA欠），
// 按记账币种分桶看净额，攒到合适时机一次结清——缓解「每笔都转账」的不便与手续费。
// 币种模型（2026-10-14 拍板，先行 demo demo/reservoir-demo/ 验证）：一单一次计入（外币原价或人民币）；
// 币种桶净额 + 人民币视图（缺转化留空提醒）+ 参考净额（池内参考汇率统一折算人民币的单一答案，可编辑）。
// 结算即标记：结算可勾选池内订单标记「已结算」移出活水，订单级防重；删除流水自动取消标记。
// 数据：blob 新键 d.reservoirs（零 schema 改动）；仅管理端可见（工具组导航，团员端无入口）。
window.Aoi = window.Aoi || {};
Aoi.reservoir = {};

// —— 纯计算（不碰 DOM / 不落库）——

Aoi.reservoir.DEFAULT_RATES = { cny: 1, jpy: 0.048, krw: 0.0053, usd: 7 };

Aoi.reservoir.isForeign = function (o) { return !!o.currency && o.currency !== 'cny'; };

Aoi.reservoir.ccyLabel = function (c) {
  return c === 'jpy' ? '日元' : c === 'krw' ? '韩元' : c === 'usd' ? '美元' : c === 'cny' ? '人民币' : (c || '—');
};

Aoi.reservoir.fmtN = function (n) { return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 }); };

Aoi.reservoir.fmtMoney = function (c, n) {
  if (n == null) return '—';
  return c === 'cny' ? '¥' + Aoi.reservoir.fmtN(Math.round(n * 100) / 100)
    : Aoi.reservoir.fmtN(Math.round(n * 100) / 100) + ' ' + Aoi.reservoir.ccyLabel(c);
};

Aoi.reservoir.round2 = function (n) { return Math.round(n * 100) / 100; };

// 净额方向：正=我方欠对方，负=对方欠我方，≈0=两清
Aoi.reservoir.netDirection = function (net) {
  if (net > 0.004) return { text: '我方欠对方', cls: 'owe' };
  if (net < -0.004) return { text: '对方欠我方', cls: 'owed' };
  return { text: '两清', cls: 'zero' };
};

function resPoolById(d, id) {
  return (d.reservoirs || []).find(function (p) { return p.id === id; }) || null;
}
function resOrderById(d, id) {
  return (d.orders || []).find(function (o) { return o.id === id; }) || null;
}

function resPoolRates(pool) {
  var rates = {};
  Object.keys(Aoi.reservoir.DEFAULT_RATES).forEach(function (c) {
    rates[c] = (pool.rates && pool.rates[c] != null) ? pool.rates[c] : Aoi.reservoir.DEFAULT_RATES[c];
  });
  return rates;
}

// 池汇总：
//   ccys    记账币种分桶（活水=未结算；a/b 两侧，settledA/B 已结算留档；结算冲抵=对方转我方−我方转对方）
//   rmbView 人民币视图（各侧已转化人民币合计；missing 走 missingRmb，同一批账的折算参考）
//   refNet  参考净额（各币种活水净额+纯转账按参考汇率统一折算人民币；正=我方欠对方）
//   buyers  按购买人小计（一池多对手方）
Aoi.reservoir.computeSummary = function (pool, orders) {
  var ccys = {};
  var rmb = { a: 0, b: 0 };
  var missingRmb = [], missingOrig = [];
  var buyers = {};
  function bucket(c) { return ccys[c] || (ccys[c] = { a: 0, b: 0, sa: 0, sb: 0 }); }
  (pool.entries || []).forEach(function (e) {
    var o = resOrderById({ orders: orders }, e.orderId);
    if (!o) return; // 订单已删：保留快照灰显口径（与 demo 一致）
    var qty = o.count || 1;
    var done = !!e.settledAt;
    var side = e.side === 'B' ? 'b' : 'a';
    var sside = e.side === 'B' ? 'sb' : 'sa';
    var foreign = Aoi.reservoir.isForeign(o);
    var bk = bucket(foreign ? o.currency : 'cny');
    if (foreign) {
      if (o.priceOrig != null) { bk[side] += o.priceOrig * qty; if (done) bk[sside] += o.priceOrig * qty; }
      else if (!done) missingOrig.push(o.id);
      if (o.price != null) { if (!done) rmb[side] += o.price * qty; }
      else if (!done) missingRmb.push(o.id);
    } else {
      if (o.price != null) {
        bk[side] += o.price * qty; if (done) bk[sside] += o.price * qty;
        if (!done) rmb[side] += o.price * qty;
      } else if (!done) missingRmb.push(o.id);
    }
    var b = buyers[o.buyer] || (buyers[o.buyer] = { entries: 0, qty: 0, origByCcy: {}, rmb: 0 });
    b.entries += 1; b.qty += qty;
    if (foreign && o.priceOrig != null) {
      b.origByCcy[o.currency] = (b.origByCcy[o.currency] || 0) + o.priceOrig * qty;
    }
    if (o.price != null) b.rmb += o.price * qty;
  });
  // 纯转账结算（未关联订单）按原币进对应桶冲抵；关联订单的结算不进公式（效果=订单移出活水）
  var freeSt = {};
  (pool.settlements || []).forEach(function (s) {
    if (s.entryIds && s.entryIds.length) return;
    var c = s.currency || 'cny';
    var st = freeSt[c] || (freeSt[c] = { them2us: 0, us2them: 0 });
    if (s.direction === 'us2them') st.us2them += (s.amount || 0); else st.them2us += (s.amount || 0);
    bucket(c);
  });
  var out = { ccys: {}, missingRmb: missingRmb, missingOrig: missingOrig, buyers: buyers };
  Object.keys(ccys).forEach(function (c) {
    var t = ccys[c];
    var st = freeSt[c] || { them2us: 0, us2them: 0 };
    var activeA = Aoi.reservoir.round2(t.a - t.sa), activeB = Aoi.reservoir.round2(t.b - t.sb);
    out.ccys[c] = {
      a: activeA, b: activeB,
      settledA: Aoi.reservoir.round2(t.sa), settledB: Aoi.reservoir.round2(t.sb),
      them2us: Aoi.reservoir.round2(st.them2us), us2them: Aoi.reservoir.round2(st.us2them),
      offset: Aoi.reservoir.round2(st.them2us - st.us2them),
      net: Aoi.reservoir.round2(activeA - activeB + st.them2us - st.us2them)
    };
  });
  var rates = resPoolRates(pool);
  var refNet = 0, hasAmount = false, unknownRate = [];
  Object.keys(out.ccys).forEach(function (c) {
    var v = out.ccys[c];
    if (!rates[c]) { unknownRate.push(c); return; }
    if (v.a || v.b) hasAmount = true;
    refNet += (v.a - v.b + v.them2us - v.us2them) * rates[c];
  });
  out.rmbView = { a: Aoi.reservoir.round2(rmb.a), b: Aoi.reservoir.round2(rmb.b) };
  out.refNet = { net: Aoi.reservoir.round2(refNet), rates: rates, unknownRate: unknownRate, hasAmount: hasAmount };
  return out;
};

// 订单 → 池归属（订单管理计入防重用）
Aoi.reservoir.poolMembership = function (d) {
  var map = {};
  (d.reservoirs || []).forEach(function (p) {
    (p.entries || []).forEach(function (e) {
      if (!map[e.orderId]) map[e.orderId] = { poolId: p.id, label: p.name + ' · 侧' + e.side, settled: !!e.settledAt };
    });
  });
  return map;
};

// —— 数据动作（undo 快照 + saveTeamData + 重渲染）——

function resData() { return Aoi.state.data; }

Aoi.reservoir.createPool = async function (name, sideA, sideB) {
  var d = resData();
  var p = {
    id: Aoi.genId(), name: name || '新蓄水池',
    sideA: sideA || 'TA 帮我买（我欠）', sideB: sideB || '我帮 TA 买（TA 欠）',
    entries: [], settlements: []
  };
  Aoi.undo.arm('新建蓄水池', d);
  d.reservoirs = d.reservoirs || [];
  d.reservoirs.push(p);
  await Aoi.saveTeamData(d);
  Aoi.reservoir.renderAll();
  return p;
};

Aoi.reservoir.deletePool = async function (poolId) {
  var d = resData();
  var pool = resPoolById(d, poolId);
  if (!pool) return;
  if (!(await Aoi.confirm('删除蓄水池「' + pool.name + '」？明细与结算一并删除（订单本身不受影响）。', { danger: true }))) return;
  Aoi.undo.arm('删除蓄水池', d);
  d.reservoirs = d.reservoirs.filter(function (p) { return p.id !== poolId; });
  await Aoi.saveTeamData(d);
  Aoi.reservoir.renderAll();
  Aoi.toast('已删除（30 秒内可撤销）', 'success');
};

// 订单管理勾选 → 「计入蓄水池」弹层
Aoi.reservoir.openAssignFromOrders = function () {
  var d = resData();
  var ids = Aoi.orders.selectedIds();
  if (!ids.length) { Aoi.toast('请先勾选订单', 'warning'); return; }
  if (!(d.reservoirs || []).length) {
    Aoi.toast('还没有蓄水池：请先到 工具 → 蓄水池 点「＋ 新建蓄水池」', 'warning');
    return;
  }
  var sel = document.getElementById('reservoirAssignPool');
  var membership = Aoi.reservoir.poolMembership(d);
  var fresh = ids.filter(function (id) { return !membership[id]; });
  sel.innerHTML = d.reservoirs.map(function (p) {
    return '<option value="' + p.id + '">' + Aoi.escapeHtml(p.name) + '</option>';
  }).join('');
  document.getElementById('reservoirAssignCount').textContent =
    '已勾选 ' + ids.length + ' 笔' + (fresh.length < ids.length ? '（' + (ids.length - fresh.length) + ' 笔已在池中，将跳过）' : '');
  document.getElementById('reservoirAssignBox').classList.remove('hidden');
};

Aoi.reservoir.hideAssign = function () {
  var box = document.getElementById('reservoirAssignBox');
  if (box) box.classList.add('hidden');
};

Aoi.reservoir.confirmAssign = async function () {
  var d = resData();
  var poolId = document.getElementById('reservoirAssignPool').value;
  var side = document.getElementById('reservoirAssignSide').value;
  var pool = resPoolById(d, poolId);
  if (!pool) { Aoi.toast('请选择蓄水池', 'warning'); return; }
  var ids = Aoi.orders.selectedIds();
  if (!ids.length) { Aoi.toast('请先勾选订单', 'warning'); return; }
  var membership = Aoi.reservoir.poolMembership(d);
  var added = [], skipped = 0;
  ids.forEach(function (oid) {
    if (membership[oid]) { skipped++; return; }
    added.push(oid);
  });
  if (!added.length) { Aoi.toast('勾选的订单都已在池中，无需重复计入', 'warning'); Aoi.reservoir.hideAssign(); return; }
  Aoi.undo.arm('计入蓄水池', d);
  var today = new Date().toISOString().slice(0, 10);
  added.forEach(function (oid) {
    pool.entries.push({ id: Aoi.genId(), orderId: oid, side: side === 'B' ? 'B' : 'A', addedAt: today });
  });
  await Aoi.saveTeamData(d);
  Aoi.reservoir.hideAssign();
  Aoi.reservoir.renderAll();
  Aoi.toast('已计入 ' + added.length + ' 笔' + (skipped ? '，跳过 ' + skipped + ' 笔已在池中' : '') + '（30 秒内可撤销）', 'success');
  return { added: added.length, skipped: skipped };
};

Aoi.reservoir.moveEntry = async function (poolId, entryId) {
  var d = resData();
  var pool = resPoolById(d, poolId);
  var e = pool && pool.entries.find(function (x) { return x.id === entryId; });
  if (!e || e.settledAt) return null; // 已结算订单锁定侧向
  Aoi.undo.arm('蓄水池改侧', d);
  e.side = e.side === 'A' ? 'B' : 'A';
  await Aoi.saveTeamData(d);
  Aoi.reservoir.renderAll();
  return e;
};

Aoi.reservoir.removeEntry = async function (poolId, entryId) {
  var d = resData();
  var pool = resPoolById(d, poolId);
  var target = pool && pool.entries.find(function (x) { return x.id === entryId; });
  if (!target || target.settledAt) return; // 已结算不可直接移除（先删关联结算流水）
  if (!(await Aoi.confirm('把这笔从蓄水池移除？（订单本身保留）'))) return;
  Aoi.undo.arm('蓄水池移除订单', d);
  pool.entries = pool.entries.filter(function (x) { return x.id !== entryId; });
  await Aoi.saveTeamData(d);
  Aoi.reservoir.renderAll();
  Aoi.toast('已移除（30 秒内可撤销）', 'success');
};

// 手工账：同步新建一笔真实订单（备注「蓄水池手工账」供排查），再计入池子
Aoi.reservoir.createManual = async function (poolId, side, f) {
  var d = resData();
  var pool = resPoolById(d, poolId);
  if (!pool) return null;
  var num = function (v) { return (v === '' || v == null || isNaN(parseFloat(v))) ? null : parseFloat(v); };
  var o = {
    id: Aoi.genId(),
    ip: '',
    activity: f.activity || '手工账',
    type: f.type || '', model: f.model || '',
    buyer: f.buyer || '未名',
    currency: f.currency || 'cny',
    priceOrig: (f.currency && f.currency !== 'cny') ? num(f.priceOrig) : null,
    price: num(f.price),
    count: Math.max(1, parseInt(f.count, 10) || 1),
    status: '未到货',
    remark: '蓄水池手工账' + (f.note ? '：' + f.note : '')
  };
  if (o.price == null && o.priceOrig == null) { Aoi.toast('外币金额与人民币金额至少填一个', 'warning'); return null; }
  Aoi.undo.arm('蓄水池手工账', d);
  d.orders.push(o);
  pool.entries.push({ id: Aoi.genId(), orderId: o.id, side: side === 'B' ? 'B' : 'A', addedAt: new Date().toISOString().slice(0, 10) });
  await Aoi.saveTeamData(d);
  Aoi.reservoir.renderAll();
  Aoi.toast('已记入，并同步新建订单（备注「蓄水池手工账」，可在订单管理排查）', 'success');
  return o;
};

// 结算流水：them2us=对方转我方（冲抵TA欠），us2them=我方转对方（冲抵我欠）。
// s.entryIds 非空：关联池内条目标记「已结算」，金额移出活水；删除流水时自动取消标记。
Aoi.reservoir.addSettlement = async function (poolId, s) {
  var d = resData();
  var pool = resPoolById(d, poolId);
  var amount = parseFloat(s.amount);
  if (!pool || isNaN(amount) || amount <= 0) { Aoi.toast('请填写大于 0 的金额', 'warning'); return null; }
  var entryIds = Array.isArray(s.entryIds) ? s.entryIds.filter(function (id) {
    return pool.entries.some(function (e) { return e.id === id && !e.settledAt; });
  }) : [];
  var rec = {
    id: Aoi.genId(),
    direction: s.direction === 'us2them' ? 'us2them' : 'them2us',
    currency: s.currency || 'cny',
    amount: amount,
    date: s.date || new Date().toISOString().slice(0, 10),
    note: s.note || ''
  };
  Aoi.undo.arm('蓄水池结算', d);
  if (entryIds.length) {
    rec.entryIds = entryIds;
    entryIds.forEach(function (id) {
      var e = pool.entries.find(function (x) { return x.id === id; });
      e.settledAt = rec.date;
      e.settlementId = rec.id;
    });
  }
  pool.settlements.push(rec);
  await Aoi.saveTeamData(d);
  Aoi.reservoir.renderAll();
  Aoi.toast(rec.entryIds ? ('已结算 ' + rec.entryIds.length + ' 笔订单并标记「已结算」（30 秒内可撤销）') : '已记一笔结算，净额已冲抵（30 秒内可撤销）', 'success');
  return rec;
};

Aoi.reservoir.removeSettlement = async function (poolId, settleId) {
  var d = resData();
  var pool = resPoolById(d, poolId);
  if (!pool) return;
  Aoi.undo.arm('删除结算流水', d);
  pool.settlements = pool.settlements.filter(function (x) { return x.id !== settleId; });
  pool.entries.forEach(function (e) {
    if (e.settlementId === settleId) { delete e.settledAt; delete e.settlementId; }
  });
  await Aoi.saveTeamData(d);
  Aoi.reservoir.renderAll();
  Aoi.toast('已删除结算流水，关联订单取消「已结算」标记（30 秒内可撤销）', 'success');
};

Aoi.reservoir.setPoolRates = async function (poolId, rates) {
  var d = resData();
  var pool = resPoolById(d, poolId);
  if (!pool) return null;
  pool.rates = pool.rates || {};
  Object.keys(rates || {}).forEach(function (c) {
    var v = parseFloat(rates[c]);
    if (!isNaN(v) && v > 0) pool.rates[c] = v;
  });
  await Aoi.saveTeamData(d);
  Aoi.reservoir.renderAll();
  Aoi.toast('参考汇率已保存，参考净额已重算', 'success');
  return pool.rates;
};

// —— 渲染（view-reservoir；由 Aoi.nav 进入时调用）——

var resExpanded = {};

function resNetChip(cls, label, amountHtml) {
  var palette = cls === 'owe' ? 'bg-red-50 border-red-200 text-red-700'
    : cls === 'owed' ? 'bg-green-50 border-green-200 text-green-700'
    : 'bg-gray-50 border-gray-200 text-gray-400';
  return '<span class="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold border ' + palette + '">'
    + Aoi.escapeHtml(label) + (amountHtml || '') + '</span>';
}

function resNetItemsHtml(pool, orders) {
  var s = Aoi.reservoir.computeSummary(pool, orders);
  var html = '';
  if (s.refNet.hasAmount) {
    var rd = Aoi.reservoir.netDirection(s.refNet.net);
    html += '<span class="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold border border-dashed border-red-400 text-red-600 bg-white" '
      + 'title="按参考汇率把各币种活水统一折算成人民币，供「到底谁欠谁多少」决策；账本仍以原币为准，汇率可在明细里改">参考净额 ≈ <b class="mx-1">¥'
      + Aoi.escapeHtml(Aoi.reservoir.fmtN(Math.abs(s.refNet.net))) + '</b>·' + Aoi.escapeHtml(rd.text) + '</span>';
  }
  if (s.refNet.unknownRate.length) {
    html += '<span class="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold border border-amber-200 bg-amber-50 text-amber-700">⚠ '
      + Aoi.escapeHtml(s.refNet.unknownRate.map(Aoi.reservoir.ccyLabel).join('、')) + ' 缺参考汇率</span>';
  }
  Object.keys(s.ccys).forEach(function (c) {
    var v = s.ccys[c];
    var cleared = v.a === 0 && v.b === 0 && (v.settledA || v.settledB);
    var dir = Aoi.reservoir.netDirection(v.net);
    var label = Aoi.reservoir.ccyLabel(c) + ' · ' + (cleared ? '已结清' : dir.text);
    var amount = cleared ? '' : '<b class="mx-1">' + Aoi.escapeHtml(Aoi.reservoir.fmtMoney(c, Math.abs(v.net))) + '</b>';
    html += resNetChip(cleared ? 'zero' : dir.cls, label, amount);
  });
  if (s.missingRmb.length) html += '<span class="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold border border-amber-200 bg-amber-50 text-amber-700 cursor-pointer" data-ract="toggle-detail" data-pool="' + pool.id + '">⚠ ' + s.missingRmb.length + ' 笔未转人民币</span>';
  if (s.missingOrig.length) html += '<span class="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold border border-amber-200 bg-amber-50 text-amber-700 cursor-pointer" data-ract="toggle-detail" data-pool="' + pool.id + '">⚠ ' + s.missingOrig.length + ' 笔未转外币</span>';
  return html;
}

function resSideTableHtml(pool, side, s, orders) {
  var rows = (pool.entries || []).filter(function (e) { return e.side === side; });
  var html = '<h4 class="text-sm font-bold text-gray-600 mt-4 mb-1">侧' + side + ' 明细：' + Aoi.escapeHtml(side === 'A' ? pool.sideA : pool.sideB) + '</h4>';
  if (!rows.length) return html + '<p class="text-xs text-gray-400">侧' + side + '暂无订单。回「订单管理」勾选订单后点「计入蓄水池」。</p>';
  html += '<div class="overflow-x-auto"><table class="w-full text-sm data-table"><thead><tr class="text-left text-gray-500 border-b border-gray-200">'
    + '<th class="px-2 py-1.5 w-8">选</th><th class="px-2 py-1.5">活动</th><th class="px-2 py-1.5">类型 / 型号</th><th class="px-2 py-1.5">购买人</th>'
    + '<th class="px-2 py-1.5 text-right">件数</th><th class="px-2 py-1.5 text-right">外币原价</th><th class="px-2 py-1.5 text-right">人民币</th>'
    + '<th class="px-2 py-1.5">计入日</th><th class="px-2 py-1.5 text-right">状态 / 操作</th></tr></thead><tbody>';
  rows.forEach(function (e) {
    var o = resOrderById({ orders: orders }, e.orderId);
    if (!o) return;
    var qty = o.count || 1;
    var done = !!e.settledAt;
    var foreign = Aoi.reservoir.isForeign(o);
    var warn = !done && (s.missingRmb.indexOf(o.id) >= 0 || s.missingOrig.indexOf(o.id) >= 0);
    var rowCls = done ? 'bg-gray-50 text-gray-400' : (warn ? 'bg-amber-50' : '');
    var origCell = foreign
      ? (o.priceOrig != null ? Aoi.escapeHtml(Aoi.reservoir.fmtMoney(o.currency, o.priceOrig * qty)) : '<span class="text-gray-300">—</span>' + (done ? '' : '<span class="ml-1 px-1.5 rounded-full text-[10px] bg-amber-100 text-amber-700">未转外币</span>'))
      : '<span class="text-gray-300">—</span>';
    var rmbCell = o.price != null ? '¥' + Aoi.escapeHtml(Aoi.reservoir.fmtN(Aoi.reservoir.round2(o.price * qty)))
      : '<span class="text-gray-300">—</span>' + (done ? '' : '<span class="ml-1 px-1.5 rounded-full text-[10px] bg-amber-100 text-amber-700">未转¥</span>');
    var opsCell = done
      ? '<span class="inline-block px-2 py-0.5 rounded-full text-[11px] bg-green-50 text-green-700 border border-green-200">已结算 · ' + Aoi.escapeHtml(e.settledAt) + '</span>'
      : '<button class="px-2 py-0.5 border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-100" data-ract="entry-move" data-pool="' + pool.id + '" data-entry="' + e.id + '">改侧</button> '
      + '<button class="px-2 py-0.5 border border-red-200 rounded text-xs text-red-600 hover:bg-red-50" data-ract="entry-remove" data-pool="' + pool.id + '" data-entry="' + e.id + '">移除</button>';
    html += '<tr class="' + rowCls + '">'
      + '<td class="px-2 py-1.5">' + (done ? '' : '<input type="checkbox" class="res-settle-check" data-entry="' + e.id + '">') + '</td>'
      + '<td class="px-2 py-1.5">' + Aoi.escapeHtml(o.activity) + '</td>'
      + '<td class="px-2 py-1.5">' + Aoi.escapeHtml(o.type) + ' / ' + Aoi.escapeHtml(o.model) + '</td>'
      + '<td class="px-2 py-1.5">' + Aoi.escapeHtml(o.buyer) + '</td>'
      + '<td class="px-2 py-1.5 text-right">' + qty + '</td>'
      + '<td class="px-2 py-1.5 text-right">' + origCell + '</td>'
      + '<td class="px-2 py-1.5 text-right">' + rmbCell + '</td>'
      + '<td class="px-2 py-1.5">' + Aoi.escapeHtml(e.addedAt) + '</td>'
      + '<td class="px-2 py-1.5 text-right whitespace-nowrap">' + opsCell + '</td></tr>';
  });
  return html + '</tbody></table></div>';
}

function resDetailHtml(pool, orders) {
  var s = Aoi.reservoir.computeSummary(pool, orders);
  var html = '<h4 class="text-sm font-bold text-gray-600 mt-4 mb-1">币种汇总（活水 = 未结算部分；净额 = 活水A − 活水B + 结算冲抵）</h4>'
    + '<div class="overflow-x-auto"><table class="w-full text-sm data-table"><thead><tr class="text-left text-gray-500 border-b border-gray-200">'
    + '<th class="px-2 py-1.5">币种</th><th class="px-2 py-1.5 text-right">侧A 活水</th><th class="px-2 py-1.5 text-right">侧B 活水</th>'
    + '<th class="px-2 py-1.5 text-right">结算冲抵</th><th class="px-2 py-1.5 text-right">净额</th><th class="px-2 py-1.5">方向</th>'
    + '<th class="px-2 py-1.5 text-right">已结算</th></tr></thead><tbody>';
  Object.keys(s.ccys).forEach(function (c) {
    var v = s.ccys[c];
    var dir = Aoi.reservoir.netDirection(v.net);
    html += '<tr><td class="px-2 py-1.5">' + Aoi.escapeHtml(Aoi.reservoir.ccyLabel(c)) + '</td>'
      + '<td class="px-2 py-1.5 text-right">' + Aoi.escapeHtml(Aoi.reservoir.fmtMoney(c, v.a)) + '</td>'
      + '<td class="px-2 py-1.5 text-right">' + Aoi.escapeHtml(Aoi.reservoir.fmtMoney(c, v.b)) + '</td>'
      + '<td class="px-2 py-1.5 text-right">' + (v.offset ? Aoi.escapeHtml(Aoi.reservoir.fmtMoney(c, v.offset)) : '—') + '</td>'
      + '<td class="px-2 py-1.5 text-right font-bold">' + Aoi.escapeHtml(Aoi.reservoir.fmtMoney(c, v.net)) + '</td>'
      + '<td class="px-2 py-1.5">' + dir.text + '</td>'
      + '<td class="px-2 py-1.5 text-right">' + ((v.settledA || v.settledB) ? Aoi.escapeHtml(Aoi.reservoir.fmtMoney(c, v.settledA)) + ' / ' + Aoi.escapeHtml(Aoi.reservoir.fmtMoney(c, v.settledB)) : '—') + '</td></tr>';
  });
  html += '</tbody></table></div>';
  html += '<p class="text-xs text-gray-400 mt-2">人民币视图（同一批账的折算参考，缺转化留空提醒）：侧A ¥' + Aoi.escapeHtml(Aoi.reservoir.fmtN(s.rmbView.a))
    + ' / 侧B ¥' + Aoi.escapeHtml(Aoi.reservoir.fmtN(s.rmbView.b))
    + (s.missingRmb.length ? '，⚠ ' + s.missingRmb.length + ' 笔未转人民币' : '')
    + '。跨币种欠款不可直接相减——「到底谁欠谁多少」看卡头参考净额。</p>';
  var rateCcyList = Object.keys(s.refNet.rates).filter(function (c) { return c !== 'cny'; });
  html += '<div class="flex flex-wrap items-center gap-2 mt-2 border border-dashed border-gray-300 bg-gray-50 rounded-lg px-3 py-2">'
    + '<span class="text-xs font-semibold text-gray-500">参考汇率（1 外币 = ? 人民币，仅折算参考净额用，不改订单账本）：</span>'
    + rateCcyList.map(function (c) {
      return '<label class="text-xs text-gray-500">' + Aoi.escapeHtml(Aoi.reservoir.ccyLabel(c))
        + ' <input class="res-rate-input w-20 border border-gray-300 rounded px-2 py-1 text-xs" data-rrate="' + c + '" type="number" step="0.0001" value="' + s.refNet.rates[c] + '"></label>';
    }).join('')
    + '<button class="px-3 py-1 border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-100" data-ract="rates-save" data-pool="' + pool.id + '">保存汇率</button></div>';

  var buyerKeys = Object.keys(s.buyers);
  if (buyerKeys.length) {
    html += '<h4 class="text-sm font-bold text-gray-600 mt-4 mb-1">按购买人小计（一池多对手方：转账一人，订单多人）</h4>'
      + '<div class="overflow-x-auto"><table class="w-full text-sm data-table"><thead><tr class="text-left text-gray-500 border-b border-gray-200">'
      + '<th class="px-2 py-1.5">购买人</th><th class="px-2 py-1.5 text-right">笔数</th><th class="px-2 py-1.5 text-right">件数</th>'
      + '<th class="px-2 py-1.5 text-right">日元</th><th class="px-2 py-1.5 text-right">韩元</th><th class="px-2 py-1.5 text-right">美元</th><th class="px-2 py-1.5 text-right">人民币</th></tr></thead><tbody>';
    buyerKeys.forEach(function (name) {
      var b = s.buyers[name];
      html += '<tr><td class="px-2 py-1.5">' + Aoi.escapeHtml(name) + '</td>'
        + '<td class="px-2 py-1.5 text-right">' + b.entries + '</td><td class="px-2 py-1.5 text-right">' + b.qty + '</td>'
        + ['jpy', 'krw', 'usd'].map(function (c) {
          return '<td class="px-2 py-1.5 text-right">' + (b.origByCcy[c] ? Aoi.escapeHtml(Aoi.reservoir.fmtN(Aoi.reservoir.round2(b.origByCcy[c]))) : '—') + '</td>';
        }).join('')
        + '<td class="px-2 py-1.5 text-right">' + (b.rmb ? '¥' + Aoi.escapeHtml(Aoi.reservoir.fmtN(Aoi.reservoir.round2(b.rmb))) : '—') + '</td></tr>';
    });
    html += '</tbody></table></div>';
  }

  html += '<div class="flex flex-wrap items-center gap-2 mt-4 border border-dashed border-gray-300 bg-gray-50 rounded-lg px-3 py-2">'
    + '<span class="text-xs font-semibold text-gray-500">勾选下方未结算订单后：</span>'
    + '<button class="px-3 py-1 btn-primary rounded text-xs font-bold" data-ract="settle-checked" data-pool="' + pool.id + '">结算勾选订单（标记已结算）</button>'
    + '<span class="text-xs text-gray-400">被结算订单移出活水净额并标记「已结算」，之后无需再勾选；「记一笔结算」为纯转账，不标订单。</span></div>';

  html += resSideTableHtml(pool, 'A', s, orders) + resSideTableHtml(pool, 'B', s, orders);

  html += '<h4 class="text-sm font-bold text-gray-600 mt-4 mb-1">结算流水</h4>';
  if ((pool.settlements || []).length) {
    html += '<div class="overflow-x-auto"><table class="w-full text-sm data-table"><thead><tr class="text-left text-gray-500 border-b border-gray-200">'
      + '<th class="px-2 py-1.5">日期</th><th class="px-2 py-1.5">方向</th><th class="px-2 py-1.5">币种</th><th class="px-2 py-1.5 text-right">金额</th>'
      + '<th class="px-2 py-1.5">备注</th><th class="px-2 py-1.5">关联</th><th class="px-2 py-1.5 text-right">操作</th></tr></thead><tbody>';
    pool.settlements.forEach(function (st) {
      html += '<tr><td class="px-2 py-1.5">' + Aoi.escapeHtml(st.date) + '</td>'
        + '<td class="px-2 py-1.5">' + (st.direction === 'them2us' ? '对方 → 我方' : '我方 → 对方') + '</td>'
        + '<td class="px-2 py-1.5">' + Aoi.escapeHtml(Aoi.reservoir.ccyLabel(st.currency)) + '</td>'
        + '<td class="px-2 py-1.5 text-right">' + Aoi.escapeHtml(Aoi.reservoir.fmtMoney(st.currency, st.amount)) + '</td>'
        + '<td class="px-2 py-1.5">' + Aoi.escapeHtml(st.note || '—') + '</td>'
        + '<td class="px-2 py-1.5">' + (st.entryIds && st.entryIds.length ? '<span class="inline-block px-2 py-0.5 rounded-full text-[11px] bg-green-50 text-green-700 border border-green-200">' + st.entryIds.length + ' 笔订单</span>' : '—') + '</td>'
        + '<td class="px-2 py-1.5 text-right"><button class="px-2 py-0.5 border border-red-200 rounded text-xs text-red-600 hover:bg-red-50" data-ract="settle-remove" data-pool="' + pool.id + '" data-settle="' + st.id + '">删除</button></td></tr>';
    });
    html += '</tbody></table></div>';
  } else {
    html += '<p class="text-xs text-gray-400">暂无结算。点「记一笔结算」登记转账/换货抵账，净额即时冲抵。</p>';
  }
  return html;
}

Aoi.reservoir.renderAll = function () {
  var body = document.getElementById('reservoirBody');
  if (!body) return;
  var d = resData();
  if (!d) { body.innerHTML = ''; return; }
  d.reservoirs = d.reservoirs || [];
  var orders = d.orders || [];
  body.innerHTML = d.reservoirs.map(function (p) {
    var open = !!resExpanded[p.id];
    return '<div class="bg-white rounded-lg border border-gray-200 p-4" data-rpool="' + p.id + '">'
      + '<div class="flex flex-wrap justify-between items-start gap-2">'
      + '<div><div class="font-bold">' + Aoi.escapeHtml(p.name) + '</div>'
      + '<div class="text-xs text-gray-400 mt-0.5">侧A：' + Aoi.escapeHtml(p.sideA) + '　｜　侧B：' + Aoi.escapeHtml(p.sideB) + '</div></div>'
      + '<div class="flex flex-wrap gap-2">'
      + '<button class="px-3 py-1.5 btn-outline rounded text-xs font-bold" data-ract="go-assign">勾选订单计入</button>'
      + '<button class="px-3 py-1.5 border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-100" data-ract="manual" data-pool="' + p.id + '">记一笔手工账</button>'
      + '<button class="px-3 py-1.5 border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-100" data-ract="settle" data-pool="' + p.id + '">记一笔结算</button>'
      + '<button class="px-3 py-1.5 border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-100" data-ract="toggle-detail" data-pool="' + p.id + '">' + (open ? '收起明细' : '展开明细') + '</button>'
      + '<button class="px-3 py-1.5 border border-red-200 rounded text-xs text-red-600 hover:bg-red-50" data-ract="pool-delete" data-pool="' + p.id + '">删除</button>'
      + '</div></div>'
      + '<div class="flex flex-wrap gap-2 mt-3">' + resNetItemsHtml(p, orders) + '</div>'
      + '<div class="' + (open ? '' : 'hidden') + '" id="res-detail-' + p.id + '">' + (open ? resDetailHtml(p, orders) : '') + '</div>'
      + '</div>';
  }).join('')
    || '<div class="bg-white rounded-lg border border-gray-200 p-6 text-sm text-gray-500">还没有蓄水池。点右上角「＋ 新建蓄水池」开始记账——一个池子可含多个对手方联系人（转账通常一人完成，订单可来自多人多活动）。</div>';
};

// —— 弹层（新建池 / 手工账 / 结算）——

function resOpenModal(html) {
  var box = document.getElementById('reservoirModalBox');
  var modal = document.getElementById('reservoirModal');
  if (!box || !modal) return;
  box.innerHTML = html;
  modal.classList.remove('hidden');
}
function resCloseModal() {
  var modal = document.getElementById('reservoirModal');
  if (modal) modal.classList.add('hidden');
  var box = document.getElementById('reservoirModalBox');
  if (box) box.innerHTML = '';
}

Aoi.reservoir.modalNewPool = function () {
  resOpenModal('<h3 class="font-bold mb-3">新建蓄水池</h3>'
    + '<label class="block text-xs text-gray-500 mb-1">池名（如：日本线 · 佐桑结算）</label>'
    + '<input id="resNpName" value="新蓄水池" class="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-3">'
    + '<div class="grid grid-cols-2 gap-3 mb-2">'
    + '<div><label class="block text-xs text-gray-500 mb-1">侧 A 文案</label><input id="resNpA" value="TA 帮我买（我欠）" class="w-full border border-gray-300 rounded px-3 py-2 text-sm"></div>'
    + '<div><label class="block text-xs text-gray-500 mb-1">侧 B 文案</label><input id="resNpB" value="我帮 TA 买（TA 欠）" class="w-full border border-gray-300 rounded px-3 py-2 text-sm"></div></div>'
    + '<p class="text-xs text-gray-400">一个池子可含多个对手方联系人：转账通常由一人完成，订单可来自多人多活动。</p>'
    + '<div class="flex justify-end gap-3 mt-4"><button class="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-bold rounded hover:bg-gray-300" data-ract="modal-close">取消</button>'
    + '<button class="px-4 py-2 btn-primary text-sm font-bold rounded" data-ract="pool-save">创建</button></div>');
};

var resPendingSettleEntries = [];

Aoi.reservoir.modalManual = function (poolId) {
  var d = resData();
  var pool = resPoolById(d, poolId);
  resOpenModal('<h3 class="font-bold mb-3">记一笔手工账（' + Aoi.escapeHtml(pool ? pool.name : '') + '）</h3>'
    + '<div class="grid grid-cols-2 gap-3">'
    + '<div><label class="block text-xs text-gray-500 mb-1">计入侧</label><select id="resMSide" class="w-full border border-gray-300 rounded px-2 py-2 text-sm"><option value="A">侧 A（TA 帮我买）</option><option value="B">侧 B（我帮 TA 买）</option></select></div>'
    + '<div><label class="block text-xs text-gray-500 mb-1">购买人（对手方）</label><input id="resMBuyer" placeholder="如：佐藤" class="w-full border border-gray-300 rounded px-2 py-2 text-sm"></div>'
    + '<div><label class="block text-xs text-gray-500 mb-1">活动</label><input id="resMActivity" value="谷子杂项" class="w-full border border-gray-300 rounded px-2 py-2 text-sm"></div>'
    + '<div><label class="block text-xs text-gray-500 mb-1">类型</label><input id="resMType" placeholder="如：邮费 / 佣金 / 挂件" class="w-full border border-gray-300 rounded px-2 py-2 text-sm"></div>'
    + '<div><label class="block text-xs text-gray-500 mb-1">型号 / 说明</label><input id="resMModel" placeholder="如：国际运费补差" class="w-full border border-gray-300 rounded px-2 py-2 text-sm"></div>'
    + '<div><label class="block text-xs text-gray-500 mb-1">件数</label><input id="resMCount" type="number" min="1" value="1" class="w-full border border-gray-300 rounded px-2 py-2 text-sm"></div>'
    + '<div><label class="block text-xs text-gray-500 mb-1">币种</label><select id="resMCurrency" class="w-full border border-gray-300 rounded px-2 py-2 text-sm"><option value="jpy">日元</option><option value="krw">韩元</option><option value="usd">美元</option><option value="cny">人民币</option></select></div>'
    + '<div id="resMOrigRow"><label class="block text-xs text-gray-500 mb-1">外币金额</label><input id="resMPriceOrig" type="number" step="0.01" placeholder="如 3000" class="w-full border border-gray-300 rounded px-2 py-2 text-sm"></div>'
    + '<div><label class="block text-xs text-gray-500 mb-1">人民币金额</label><input id="resMPrice" type="number" step="0.01" placeholder="可手填" class="w-full border border-gray-300 rounded px-2 py-2 text-sm"></div>'
    + '</div>'
    + '<p class="text-xs text-gray-400 mt-2">确定后会同步新建一笔真实订单（备注「蓄水池手工账」），可在订单管理排查。</p>'
    + '<div class="flex justify-end gap-3 mt-4"><button class="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-bold rounded hover:bg-gray-300" data-ract="modal-close">取消</button>'
    + '<button class="px-4 py-2 btn-primary text-sm font-bold rounded" data-ract="manual-save" data-pool="' + poolId + '">确定</button></div>');
};

Aoi.reservoir.modalSettle = function (poolId, entryIds) {
  var d = resData();
  var pool = resPoolById(d, poolId);
  resPendingSettleEntries = entryIds || [];
  var dir = 'them2us', amount = '', firstCcy = 'cny', linkedNote = '';
  if (resPendingSettleEntries.length && pool) {
    var net = 0;
    resPendingSettleEntries.forEach(function (eid, idx) {
      var e = pool.entries.find(function (x) { return x.id === eid; });
      var o = e && resOrderById(d, e.orderId);
      if (!o) return;
      if (idx === 0) firstCcy = o.currency || 'cny';
      var qty = o.count || 1;
      var v = (firstCcy === 'cny' || firstCcy === o.currency)
        ? ((firstCcy === 'cny' ? o.price : o.priceOrig) || 0) * qty
        : 0; // 币种不符的订单仅作标记，不计入预填
      net += (e.side === 'A' ? 1 : -1) * v;
    });
    net = Aoi.reservoir.round2(net);
    if (net > 0) { dir = 'us2them'; amount = net; }
    else if (net < 0) { dir = 'them2us'; amount = -net; }
    linkedNote = '<p class="text-xs text-gray-400 mt-2">已选 ' + resPendingSettleEntries.length
      + ' 笔订单：方向与金额已按勾选预填（可改，如抹零）；确定后这些订单标记「已结算」并移出活水净额，之后无需再勾选。与所选币种不符的订单仅作标记。</p>';
  }
  var ccyOpt = function (c, label) { return '<option value="' + c + '"' + (firstCcy === c ? ' selected' : '') + '>' + label + '</option>'; };
  resOpenModal('<h3 class="font-bold mb-3">记一笔结算（' + Aoi.escapeHtml(pool ? pool.name : '') + '）</h3>'
    + '<div class="grid grid-cols-2 gap-3">'
    + '<div><label class="block text-xs text-gray-500 mb-1">方向</label><select id="resSDirection" class="w-full border border-gray-300 rounded px-2 py-2 text-sm">'
    + '<option value="them2us"' + (dir === 'them2us' ? ' selected' : '') + '>对方 → 我方（冲抵TA欠）</option>'
    + '<option value="us2them"' + (dir === 'us2them' ? ' selected' : '') + '>我方 → 对方（冲抵我欠）</option></select></div>'
    + '<div><label class="block text-xs text-gray-500 mb-1">币种</label><select id="resSCurrency" class="w-full border border-gray-300 rounded px-2 py-2 text-sm">'
    + ccyOpt('jpy', '日元') + ccyOpt('krw', '韩元') + ccyOpt('usd', '美元') + ccyOpt('cny', '人民币') + '</select></div>'
    + '<div><label class="block text-xs text-gray-500 mb-1">金额</label><input id="resSAmount" type="number" step="0.01" min="0.01" value="' + amount + '" class="w-full border border-gray-300 rounded px-2 py-2 text-sm"></div>'
    + '<div><label class="block text-xs text-gray-500 mb-1">日期</label><input id="resSDate" type="date" value="' + new Date().toISOString().slice(0, 10) + '" class="w-full border border-gray-300 rounded px-2 py-2 text-sm"></div>'
    + '</div>'
    + '<label class="block text-xs text-gray-500 mb-1 mt-3">备注（如：PayPal 转账 / 换货抵账）</label>'
    + '<input id="resSNote" class="w-full border border-gray-300 rounded px-3 py-2 text-sm">'
    + linkedNote
    + '<div class="flex justify-end gap-3 mt-4"><button class="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-bold rounded hover:bg-gray-300" data-ract="modal-close">取消</button>'
    + '<button class="px-4 py-2 btn-primary text-sm font-bold rounded" data-ract="settle-save" data-pool="' + poolId + '">确定</button></div>');
};

// —— 事件（弹层与池卡片统一委托 [data-ract]）——

document.addEventListener('click', function (e) {
  var el = e.target.closest ? e.target.closest('[data-ract]') : null;
  if (!el) return;
  var act = el.getAttribute('data-ract');
  var poolId = el.getAttribute('data-pool');
  if (act === 'modal-close') { resCloseModal(); }
  else if (act === 'pool-save') {
    Aoi.reservoir.createPool(
      document.getElementById('resNpName').value.trim(),
      document.getElementById('resNpA').value.trim(),
      document.getElementById('resNpB').value.trim()
    ).then(function (p) { resCloseModal(); Aoi.toast('已创建「' + p.name + '」', 'success'); });
  }
  else if (act === 'pool-delete') { Aoi.reservoir.deletePool(poolId); }
  else if (act === 'toggle-detail') {
    resExpanded[poolId] = !resExpanded[poolId];
    Aoi.reservoir.renderAll();
  }
  else if (act === 'go-assign') {
    Aoi.nav('view-orders');
    Aoi.toast('在订单管理勾选订单后，点工具栏「计入蓄水池」', 'info');
  }
  else if (act === 'manual') { Aoi.reservoir.modalManual(poolId); }
  else if (act === 'manual-save') {
    var f = {
      side: document.getElementById('resMSide').value,
      buyer: document.getElementById('resMBuyer').value.trim(),
      activity: document.getElementById('resMActivity').value.trim(),
      type: document.getElementById('resMType').value.trim(),
      model: document.getElementById('resMModel').value.trim(),
      count: document.getElementById('resMCount').value,
      currency: document.getElementById('resMCurrency').value,
      priceOrig: document.getElementById('resMPriceOrig').value,
      price: document.getElementById('resMPrice').value,
      note: ''
    };
    if (!f.buyer) { Aoi.toast('请填对手方购买人', 'warning'); return; }
    Aoi.reservoir.createManual(poolId, f.side, f).then(function (o) { if (o) resCloseModal(); });
  }
  else if (act === 'settle') { Aoi.reservoir.modalSettle(poolId); }
  else if (act === 'settle-checked') {
    var sids = Array.prototype.map.call(
      document.querySelectorAll('#res-detail-' + poolId + ' .res-settle-check:checked'),
      function (c) { return c.getAttribute('data-entry'); }
    );
    if (!sids.length) { Aoi.toast('先在明细里勾选要结算的订单', 'warning'); return; }
    Aoi.reservoir.modalSettle(poolId, sids);
  }
  else if (act === 'settle-save') {
    Aoi.reservoir.addSettlement(poolId, {
      direction: document.getElementById('resSDirection').value,
      currency: document.getElementById('resSCurrency').value,
      amount: document.getElementById('resSAmount').value,
      date: document.getElementById('resSDate').value,
      note: document.getElementById('resSNote').value.trim(),
      entryIds: resPendingSettleEntries
    }).then(function (rec) {
      resPendingSettleEntries = [];
      if (rec) resCloseModal();
    });
  }
  else if (act === 'entry-move') { Aoi.reservoir.moveEntry(poolId, el.getAttribute('data-entry')); }
  else if (act === 'entry-remove') { Aoi.reservoir.removeEntry(poolId, el.getAttribute('data-entry')); }
  else if (act === 'settle-remove') { Aoi.reservoir.removeSettlement(poolId, el.getAttribute('data-settle')); }
  else if (act === 'rates-save') {
    var rates = {};
    document.querySelectorAll('#res-detail-' + poolId + ' .res-rate-input').forEach(function (inp) {
      rates[inp.getAttribute('data-rrate')] = inp.value;
    });
    Aoi.reservoir.setPoolRates(poolId, rates);
  }
});

// 手工账币种切换：人民币隐藏外币金额行
document.addEventListener('change', function (e) {
  if (e.target && e.target.id === 'resMCurrency') {
    var row = document.getElementById('resMOrigRow');
    if (row) row.classList.toggle('hidden', e.target.value === 'cny');
  }
});

// Esc 关闭弹层
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') resCloseModal();
});

// 弹层遮罩点击关闭（捕获阶段，避免被内部 stopPropagation 干扰）
document.addEventListener('click', function (e) {
  if (e.target && e.target.id === 'reservoirModal') resCloseModal();
}, true);
