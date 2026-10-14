/* 蓄水池 · 互购净额台账 —— 演示 demo（零依赖，数据为写死 mock；改动存 localStorage）
 * 正式版将实现为管理端「工具 → 蓄水池」（js/reservoir.js，v3.25.0 立项待拍板）。
 * 可测逻辑全部挂在 window.RD（state / actions / computeSummary），见 tests/reservoir-demo.test.js。
 * 演示口径（2026-10-14 拍板）：一池多对手方 / 手工账同步新建订单 / 按订单自身汇率分币种统计
 * 外币+人民币、未转化留空提醒 / 结算流水冲抵 / 金额自动跟随订单改价 / 仅管理员可见。
 */
(function () {
  'use strict';

  var STORE_KEY = 'rsd_demo_v1';

  /* ---------- mock 种子数据（合成数据，非真实业务数据） ---------- */
  function seed() {
    return {
      // 演示汇率：仅手工账折算人民币建议值用；正式版金额一律读订单自身已转化字段
      rates: { jpy: 0.048, krw: 0.0053 },
      orders: [
        // 字段与主系统 orders 一致：activity/type/model/buyer/currency/priceOrig/count/price
        { id: 'o1', activity: '8.23涩谷场外', type: '吧唧', model: '初音17周年 吧唧', buyer: '佐藤', currency: 'jpy', priceOrig: 1200, count: 2, price: 115, source: 'order', remark: '' },
        { id: 'o2', activity: '8.23涩谷场外', type: '痛包', model: '痛包 基准款', buyer: '佐藤', currency: 'jpy', priceOrig: 3800, count: 1, price: 182, source: 'order', remark: '' },
        { id: 'o3', activity: '8.23涩谷场外', type: '色纸', model: '初音 色纸', buyer: '田中', currency: 'jpy', priceOrig: 2500, count: 1, price: 120, source: 'order', remark: '' },
        { id: 'o4', activity: '8.23涩谷场外', type: '亚克力', model: '初音 亚克力', buyer: '田中', currency: 'jpy', priceOrig: 900, count: 3, price: null, source: 'order', remark: '' },
        { id: 'o5', activity: '10.1韩国团', type: '小卡', model: 'aespa 小卡', buyer: 'キム', currency: 'krw', priceOrig: 8000, count: 2, price: 85, source: 'order', remark: '' },
        { id: 'o6', activity: '10.1韩国团', type: '海报', model: '新专辑 海报', buyer: 'キム', currency: 'krw', priceOrig: 15000, count: 1, price: null, source: 'order', remark: '' },
        { id: 'o7', activity: '闲鱼代购', type: '棉花娃娃', model: '20cm 初音娃', buyer: '佐藤', currency: 'cny', priceOrig: null, count: 2, price: 158, source: 'order', remark: '' },
        { id: 'o8', activity: '闲鱼代购', type: '吧唧', model: '星穹铁道 吧唧', buyer: 'キム', currency: 'cny', priceOrig: null, count: 2, price: 90, source: 'order', remark: '' },
        { id: 'o9', activity: '闲鱼代购', type: '立牌', model: '初音 立牌', buyer: '佐藤', currency: 'cny', priceOrig: null, count: 1, price: 220, source: 'order', remark: '' },
        { id: 'o10', activity: '谷子杂项', type: '挂件', model: '初音 挂件', buyer: '田中', currency: 'jpy', priceOrig: null, count: 1, price: 45, source: 'manual', remark: '蓄水池手工账：杂项补记' }
      ],
      reservoirs: [
        {
          id: 'r1', name: '日本线 · 佐桑结算',
          sideA: 'TA 帮我买（我欠）', sideB: '我帮 TA 买（TA 欠）',
          entries: [
            { id: 'e1', orderId: 'o1', side: 'A', addedAt: '2026-09-20' },
            { id: 'e2', orderId: 'o2', side: 'A', addedAt: '2026-09-20' },
            { id: 'e3', orderId: 'o3', side: 'A', addedAt: '2026-09-22' },
            { id: 'e4', orderId: 'o4', side: 'A', addedAt: '2026-09-22' },
            { id: 'e7', orderId: 'o7', side: 'B', addedAt: '2026-09-25' },
            { id: 'e9', orderId: 'o9', side: 'B', addedAt: '2026-09-28' },
            { id: 'e10', orderId: 'o10', side: 'B', addedAt: '2026-10-01' }
          ],
          settlements: [
            { id: 's1', direction: 'us2them', currency: 'jpy', amount: 5000, date: '2026-09-30', note: 'PayPal 转账' }
          ]
        },
        {
          id: 'r2', name: '韩国线 · 金桑',
          sideA: 'TA 帮我买（我欠）', sideB: '我帮 TA 买（TA 欠）',
          entries: [
            { id: 'e5', orderId: 'o5', side: 'A', addedAt: '2026-10-02' },
            { id: 'e8', orderId: 'o8', side: 'B', addedAt: '2026-10-05' }
          ],
          settlements: []
        }
      ]
    };
  }

  /* ---------- 状态 ---------- */
  var state = null;
  var expanded = {};          // 池明细展开状态
  var libSearch = '';
  var toastTimer = null;

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) { state = JSON.parse(raw); return; }
    } catch (e) { /* 忽略：回种子 */ }
    state = seed();
    save();
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* 演示环境允许失败 */ }
  }

  /* ---------- 小工具 ---------- */
  function genId() { return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function round2(n) { return Math.round(n * 100) / 100; }
  function numOrNull(v) {
    if (v === '' || v == null) return null;
    var n = parseFloat(v);
    return isFinite(n) ? n : null;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtN(n) { return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 }); }
  function ccyLabel(c) { return c === 'jpy' ? '日元' : c === 'krw' ? '韩元' : c === 'cny' ? '人民币' : (c || '—'); }
  function fmtMoney(c, n) {
    if (n == null) return '—';
    return c === 'cny' ? '¥' + fmtN(round2(n)) : fmtN(round2(n)) + ' ' + ccyLabel(c);
  }
  function isForeign(o) { return !!o.currency && o.currency !== 'cny'; }
  function orderById(id) {
    for (var i = 0; i < state.orders.length; i++) if (state.orders[i].id === id) return state.orders[i];
    return null;
  }
  function poolById(id) {
    for (var i = 0; i < state.reservoirs.length; i++) if (state.reservoirs[i].id === id) return state.reservoirs[i];
    return null;
  }
  function poolMembership() {
    var map = {};
    state.reservoirs.forEach(function (p) {
      p.entries.forEach(function (e) {
        if (!map[e.orderId]) map[e.orderId] = { label: p.name + ' · 侧' + e.side, settled: !!e.settledAt };
      });
    });
    return map;
  }

  /* ---------- 核心计算：按币种分组的两侧合计 + 结算冲抵 + 净额 ----------
   * 活水 = 未结算订单；已结算订单（entry.settledAt）移出活水，仅在「已结算」列留档
   * 外币合计 = Σ 该币 priceOrig×件数（缺失留空）；人民币合计 = Σ price×件数（缺失留空）
   * 净额 = 活水A − 活水B + 对方转我方 − 我方转对方；正=我方欠对方，负=对方欠我方
   * 关联订单的结算（entryIds 非空）不进公式——其效果已由「订单移出活水」体现，避免二次冲抵
   */
  function computeSummary(pool) {
    var ccys = {};   // c -> { a,b 全量, sa,sb 已结算 }
    var missingRmb = [], missingOrig = [];
    var buyers = {};
    function bucket(c) { return ccys[c] || (ccys[c] = { a: 0, b: 0, sa: 0, sb: 0 }); }
    pool.entries.forEach(function (e) {
      var o = orderById(e.orderId);
      if (!o) return; // 正式版：订单已删时保留快照灰显；demo mock 不删单
      var qty = o.count || 1;
      var done = !!e.settledAt;
      var side = e.side === 'B' ? 'b' : 'a';
      var sside = e.side === 'B' ? 'sb' : 'sa';
      var bk = bucket(o.currency || 'cny');
      var rc = isForeign(o) ? bucket('cny') : bk;
      if (isForeign(o)) {
        if (o.priceOrig != null) { bk[side] += o.priceOrig * qty; if (done) bk[sside] += o.priceOrig * qty; }
        else if (!done) missingOrig.push(o.id);
        if (o.price != null) { rc[side] += o.price * qty; if (done) rc[sside] += o.price * qty; }
        else if (!done) missingRmb.push(o.id);
      } else {
        if (o.price != null) { bk[side] += o.price * qty; if (done) bk[sside] += o.price * qty; }
        else if (!done) missingRmb.push(o.id);
      }
      var b = buyers[o.buyer] || (buyers[o.buyer] = { entries: 0, qty: 0, origByCcy: {}, rmb: 0 });
      b.entries += 1; b.qty += qty;
      if (isForeign(o) && o.priceOrig != null) {
        b.origByCcy[o.currency] = (b.origByCcy[o.currency] || 0) + o.priceOrig * qty;
      }
      if (o.price != null) b.rmb += o.price * qty;
    });
    // 纯转账结算（未关联订单）照旧冲抵；关联订单的结算不进公式（效果=订单移出活水）
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
      var activeA = round2(t.a - t.sa), activeB = round2(t.b - t.sb);
      out.ccys[c] = {
        a: activeA, b: activeB,
        settledA: round2(t.sa), settledB: round2(t.sb),
        them2us: round2(st.them2us), us2them: round2(st.us2them),
        offset: round2(st.them2us - st.us2them),
        net: round2(activeA - activeB + st.them2us - st.us2them)
      };
    });
    return out;
  }
  function netDirection(net) {
    if (net > 0.004) return { text: '我方欠对方', cls: 'net-owe' };
    if (net < -0.004) return { text: '对方欠我方', cls: 'net-owed' };
    return { text: '两清', cls: 'net-zero' };
  }

  /* ---------- 动作（可测） ---------- */
  var actions = {
    resetData: function () { state = seed(); save(); renderAll(); toast('已重置演示数据'); },

    createPool: function (name, sideA, sideB) {
      var p = {
        id: genId(), name: name || '新蓄水池',
        sideA: sideA || 'TA 帮我买（我欠）', sideB: sideB || '我帮 TA 买（TA 欠）',
        entries: [], settlements: []
      };
      state.reservoirs.push(p);
      save(); renderAll();
      return p;
    },
    deletePool: function (poolId) {
      state.reservoirs = state.reservoirs.filter(function (p) { return p.id !== poolId; });
      save(); renderAll();
    },

    /* 勾选订单计入：一单只入一池，已在池中的自动跳过 */
    assignOrders: function (poolId, orderIds, side) {
      var pool = poolById(poolId);
      if (!pool) return { added: 0, skipped: 0 };
      var added = 0, skipped = 0;
      orderIds.forEach(function (oid) {
        var dup = state.reservoirs.some(function (p) {
          return p.entries.some(function (e) { return e.orderId === oid; });
        });
        if (dup) { skipped++; return; }
        pool.entries.push({ id: genId(), orderId: oid, side: side === 'B' ? 'B' : 'A', addedAt: today() });
        added++;
      });
      save(); renderAll();
      return { added: added, skipped: skipped };
    },
    moveEntry: function (poolId, entryId) {
      var pool = poolById(poolId);
      var e = pool && pool.entries.find(function (x) { return x.id === entryId; });
      if (!e || e.settledAt) return null; // 已结算订单锁定侧向
      e.side = e.side === 'A' ? 'B' : 'A';
      save(); renderAll();
      return e;
    },
    removeEntry: function (poolId, entryId) {
      var pool = poolById(poolId);
      if (!pool) return;
      var target = pool.entries.find(function (x) { return x.id === entryId; });
      if (!target || target.settledAt) return; // 已结算订单不可直接移除（先删关联结算流水）
      pool.entries = pool.entries.filter(function (x) { return x.id !== entryId; });
      save(); renderAll();
    },

    /* 手工账：同步新建一笔真实订单（source=manual，备注「蓄水池手工账」）供排查，再计入池子 */
    createManual: function (poolId, side, f) {
      var o = {
        id: genId(),
        activity: f.activity || '手工账',
        type: f.type || '', model: f.model || '',
        buyer: f.buyer || '未名',
        currency: f.currency || 'cny',
        priceOrig: (f.currency && f.currency !== 'cny') ? numOrNull(f.priceOrig) : null,
        price: numOrNull(f.price),
        count: Math.max(1, parseInt(f.count, 10) || 1),
        source: 'manual',
        remark: '蓄水池手工账' + (f.note ? '：' + f.note : '')
      };
      state.orders.push(o);
      var pool = poolById(poolId);
      if (pool) pool.entries.push({ id: genId(), orderId: o.id, side: side === 'B' ? 'B' : 'A', addedAt: today() });
      save(); renderAll();
      return o;
    },

    /* 结算流水：them2us=对方转我方（冲抵TA欠），us2them=我方转对方（冲抵我欠）。
     * s.entryIds 非空时：关联的池内条目标记「已结算」（settledAt/settlementId），金额移出活水净额；
     * 删除该流水时自动取消标记（见 removeSettlement）。 */
    addSettlement: function (poolId, s) {
      var pool = poolById(poolId);
      var amount = numOrNull(s.amount);
      if (!pool || amount == null || amount <= 0) return null;
      var entryIds = Array.isArray(s.entryIds) ? s.entryIds.filter(function (id) {
        return pool.entries.some(function (e) { return e.id === id && !e.settledAt; });
      }) : [];
      var rec = {
        id: genId(),
        direction: s.direction === 'us2them' ? 'us2them' : 'them2us',
        currency: s.currency || 'cny',
        amount: amount,
        date: s.date || today(),
        note: s.note || ''
      };
      if (entryIds.length) {
        rec.entryIds = entryIds;
        entryIds.forEach(function (id) {
          var e = pool.entries.find(function (x) { return x.id === id; });
          e.settledAt = rec.date;
          e.settlementId = rec.id;
        });
      }
      pool.settlements.push(rec);
      save(); renderAll();
      return rec;
    },
    removeSettlement: function (poolId, settleId) {
      var pool = poolById(poolId);
      if (!pool) return;
      pool.settlements = pool.settlements.filter(function (x) { return x.id !== settleId; });
      // 取消该流水关联订单的「已结算」标记（金额回到活水）
      pool.entries.forEach(function (e) {
        if (e.settlementId === settleId) { delete e.settledAt; delete e.settlementId; }
      });
      save(); renderAll();
    },

    /* 金额自动跟随订单现价：只改订单本身，池内条目引用 orderId，合计即时反映 */
    updateOrderPrice: function (orderId, patch) {
      var o = orderById(orderId);
      if (!o) return null;
      if ('price' in patch) o.price = numOrNull(patch.price);
      if ('priceOrig' in patch) o.priceOrig = numOrNull(patch.priceOrig);
      save(); renderAll();
      return o;
    }
  };

  /* ---------- 渲染 ---------- */
  function renderAll() { renderPools(); renderLib(); }

  function netItemsHtml(pool) {
    var s = computeSummary(pool);
    var html = '';
    var keys = Object.keys(s.ccys).sort(function (a, b) {
      if (a === 'cny') return 1; if (b === 'cny') return -1; return a < b ? -1 : 1;
    });
    keys.forEach(function (c) {
      var v = s.ccys[c];
      var cleared = v.a === 0 && v.b === 0 && (v.settledA || v.settledB);
      var dir = netDirection(v.net);
      var cls = cleared ? 'net-zero' : dir.cls;
      var label = cleared ? '已结清' : dir.text;
      var amount = cleared ? '' : '<b>' + esc(fmtMoney(c, Math.abs(v.net))) + '</b>';
      html += '<span class="net-item ' + cls + '">' + esc(ccyLabel(c)) + ' · ' + label + amount + '</span>';
    });
    if (s.missingRmb.length) html += '<span class="warn-chip" data-act="toggle-detail" data-pool="' + pool.id + '">⚠ ' + s.missingRmb.length + ' 笔未转人民币</span>';
    if (s.missingOrig.length) html += '<span class="warn-chip" data-act="toggle-detail" data-pool="' + pool.id + '">⚠ ' + s.missingOrig.length + ' 笔未转外币</span>';
    return html;
  }

  function renderPools() {
    var root = document.getElementById('poolList');
    root.innerHTML = state.reservoirs.map(function (p) {
      var open = !!expanded[p.id];
      return '<div class="card pool-card" data-pool="' + p.id + '">' +
        '<div class="pool-head"><div>' +
        '<div class="pool-name">' + esc(p.name) + '</div>' +
        '<div class="pool-side-labels">侧A：' + esc(p.sideA) + '　｜　侧B：' + esc(p.sideB) + '</div>' +
        '</div><div class="pool-actions">' +
        '<button class="btn btn-sm" data-act="go-assign" data-pool="' + p.id + '">勾选订单计入</button>' +
        '<button class="btn btn-sm" data-act="manual" data-pool="' + p.id + '">记一笔手工账</button>' +
        '<button class="btn btn-sm" data-act="settle" data-pool="' + p.id + '">记一笔结算</button>' +
        '<button class="btn btn-sm" data-act="toggle-detail" data-pool="' + p.id + '">' + (open ? '收起明细' : '展开明细') + '</button>' +
        '<button class="btn btn-sm btn-danger" data-act="del-pool" data-pool="' + p.id + '">删除</button>' +
        '</div></div>' +
        '<div class="net-row">' + netItemsHtml(p) + '</div>' +
        '<div class="pool-detail' + (open ? '' : ' hidden') + '" id="detail-' + p.id + '">' + (open ? poolDetailHtml(p) : '') + '</div>' +
        '</div>';
    }).join('');
  }

  function poolDetailHtml(p) {
    var s = computeSummary(p);
    var html = '';

    // 币种汇总
    html += '<div class="sec-title">币种汇总（活水 = 未结算部分；净额 = 活水A − 活水B + 结算冲抵）</div><table class="tbl"><thead><tr>' +
      '<th>币种</th><th class="num">侧A 活水</th><th class="num">侧B 活水</th><th class="num">结算冲抵</th><th class="num">净额</th><th>方向</th><th class="num">已结算</th></tr></thead><tbody>';
    Object.keys(s.ccys).forEach(function (c) {
      var v = s.ccys[c], d = netDirection(v.net);
      html += '<tr><td>' + esc(ccyLabel(c)) + '</td>' +
        '<td class="num">' + esc(fmtMoney(c, v.a)) + '</td>' +
        '<td class="num">' + esc(fmtMoney(c, v.b)) + '</td>' +
        '<td class="num">' + (v.offset ? esc(fmtMoney(c, v.offset)) : '—') + '</td>' +
        '<td class="num"><b>' + esc(fmtMoney(c, v.net)) + '</b></td>' +
        '<td>' + d.text + '</td>' +
        '<td class="num">' + ((v.settledA || v.settledB) ? esc(fmtMoney(c, v.settledA)) + ' / ' + esc(fmtMoney(c, v.settledB)) : '—') + '</td></tr>';
    });
    html += '</tbody></table>';

    // 按购买人小计（一池多对手方）
    var buyerKeys = Object.keys(s.buyers);
    if (buyerKeys.length) {
      html += '<div class="sec-title">按购买人小计（一池多对手方：转账一人，订单多人）</div><table class="tbl"><thead><tr>' +
        '<th>购买人</th><th class="num">笔数</th><th class="num">件数</th><th class="num">日元</th><th class="num">韩元</th><th class="num">人民币</th></tr></thead><tbody>';
      buyerKeys.forEach(function (name) {
        var b = s.buyers[name];
        html += '<tr><td>' + esc(name) + '</td><td class="num">' + b.entries + '</td><td class="num">' + b.qty + '</td>' +
          '<td class="num">' + (b.origByCcy.jpy ? esc(fmtN(round2(b.origByCcy.jpy))) : '—') + '</td>' +
          '<td class="num">' + (b.origByCcy.krw ? esc(fmtN(round2(b.origByCcy.krw))) : '—') + '</td>' +
          '<td class="num">' + (b.rmb ? '¥' + esc(fmtN(round2(b.rmb))) : '—') + '</td></tr>';
      });
      html += '</tbody></table>';
    }

    html += '<div class="settle-bar"><span>勾选下方未结算订单：</span>' +
      '<button class="btn btn-sm btn-primary" data-act="settle-checked" data-pool="' + p.id + '">结算勾选订单（标记已结算）</button>' +
      '<span class="lib-note">被结算订单移出活水净额并标记「已结算」，之后无需再勾选；上方「记一笔结算」为纯转账，不标订单。</span></div>';
    html += sideTableHtml(p, 'A', s) + sideTableHtml(p, 'B', s);

    // 结算流水
    html += '<div class="sec-title">结算流水</div>';
    if (p.settlements.length) {
      html += '<table class="tbl"><thead><tr><th>日期</th><th>方向</th><th>币种</th><th class="num">金额</th><th>备注</th><th>关联</th><th class="ops">操作</th></tr></thead><tbody>';
      p.settlements.forEach(function (st) {
        html += '<tr><td>' + esc(st.date) + '</td><td>' + (st.direction === 'them2us' ? '对方 → 我方' : '我方 → 对方') + '</td>' +
          '<td>' + esc(ccyLabel(st.currency)) + '</td><td class="num">' + esc(fmtMoney(st.currency, st.amount)) + '</td>' +
          '<td>' + esc(st.note || '—') + '</td>' +
          '<td>' + (st.entryIds && st.entryIds.length ? '<span class="badge badge-settled">' + st.entryIds.length + ' 笔订单</span>' : '—') + '</td>' +
          '<td class="ops"><button class="btn btn-sm btn-danger" data-act="settle-remove" data-pool="' + p.id + '" data-settle="' + st.id + '">删除</button></td></tr>';
      });
      html += '</tbody></table>';
    } else {
      html += '<p class="lib-note">暂无结算。点「记一笔结算」登记转账/换货抵账，净额即时冲抵。</p>';
    }
    return html;
  }

  function sideTableHtml(p, side, s) {
    var rows = p.entries.filter(function (e) { return e.side === side; });
    var html = '<div class="sec-title">侧' + side + ' 明细：' + esc(side === 'A' ? p.sideA : p.sideB) + '</div>';
    if (!rows.length) return html + '<p class="lib-note">侧' + side + '暂无订单。</p>';
    html += '<table class="tbl"><thead><tr>' +
      '<th>选</th><th>活动</th><th>类型 / 型号</th><th>购买人</th><th class="num">件数</th><th class="num">外币原价</th><th class="num">人民币</th><th>计入日</th><th class="ops">状态 / 操作</th></tr></thead><tbody>';
    rows.forEach(function (e) {
      var o = orderById(e.orderId);
      if (!o) return;
      var qty = o.count || 1;
      var done = !!e.settledAt;
      var warn = !done && (s.missingRmb.indexOf(o.id) >= 0 || s.missingOrig.indexOf(o.id) >= 0);
      var origCell, rmbCell;
      if (isForeign(o)) {
        origCell = o.priceOrig != null ? esc(fmtMoney(o.currency, o.priceOrig * qty))
          : '<span class="miss">—</span>' + (done ? '' : '<span class="mini-warn">未转外币</span>');
        rmbCell = o.price != null ? '¥' + esc(fmtN(round2(o.price * qty)))
          : '<span class="miss">—</span>' + (done ? '' : '<span class="mini-warn">未转¥</span>');
      } else {
        origCell = '<span class="miss">—</span>';
        rmbCell = o.price != null ? '¥' + esc(fmtN(round2(o.price * qty)))
          : '<span class="miss">—</span>' + (done ? '' : '<span class="mini-warn">未转¥</span>');
      }
      var opsCell = done
        ? '<span class="badge badge-settled">已结算 · ' + esc(e.settledAt) + '</span>'
        : '<button class="btn btn-sm" data-act="entry-move" data-pool="' + p.id + '" data-entry="' + e.id + '">改侧</button> ' +
          '<button class="btn btn-sm btn-danger" data-act="entry-remove" data-pool="' + p.id + '" data-entry="' + e.id + '">移除</button>';
      html += '<tr class="' + (done ? 'row-settled' : (warn ? 'row-warn' : '')) + '">' +
        '<td>' + (done ? '' : '<input type="checkbox" class="row-settle-check" data-entry="' + e.id + '">') + '</td>' +
        '<td>' + esc(o.activity) + '</td>' +
        '<td>' + esc(o.type) + ' / ' + esc(o.model) + '</td>' +
        '<td>' + esc(o.buyer) + '</td><td class="num">' + qty + '</td>' +
        '<td class="num">' + origCell + '</td><td class="num">' + rmbCell + '</td>' +
        '<td>' + esc(e.addedAt) + '</td>' +
        '<td class="ops">' + opsCell + '</td></tr>';
    });
    return html + '</tbody></table>';
  }

  function renderLib() {
    var membership = poolMembership();
    var kw = libSearch.trim().toLowerCase();
    var rows = state.orders.filter(function (o) {
      if (!kw) return true;
      return (o.activity + ' ' + o.type + ' ' + o.model + ' ' + o.buyer).toLowerCase().indexOf(kw) >= 0;
    });
    var html = '<table class="tbl"><thead><tr>' +
      '<th></th><th>活动</th><th>类型 / 型号</th><th>购买人</th><th class="num">件数</th><th>币种</th><th class="num">外币原价</th><th class="num">人民币</th><th>来源</th><th>池归属</th><th class="ops">操作</th></tr></thead><tbody>';
    rows.forEach(function (o) {
      var qty = o.count || 1;
      var mem = membership[o.id];
      var settled = mem && mem.settled;
      var origCell = isForeign(o)
        ? (o.priceOrig != null ? esc(fmtMoney(o.currency, o.priceOrig)) : '<span class="miss">—</span><span class="mini-warn">未转外币</span>')
        : '<span class="miss">—</span>';
      var rmbCell = o.price != null ? '¥' + esc(fmtN(round2(o.price)))
        : '<span class="miss">—</span><span class="mini-warn">未转¥</span>';
      html += '<tr><td><input type="checkbox" data-id="' + o.id + '"' + (settled ? ' disabled title="已结算，无需再勾选"' : '') + '></td>' +
        '<td>' + esc(o.activity) + '</td><td>' + esc(o.type) + ' / ' + esc(o.model) + '</td>' +
        '<td>' + esc(o.buyer) + '</td><td class="num">' + qty + '</td><td>' + esc(ccyLabel(o.currency)) + '</td>' +
        '<td class="num">' + origCell + '</td><td class="num">' + rmbCell + '</td>' +
        '<td>' + (o.source === 'manual' ? '<span class="badge badge-manual">手工</span>' : '<span class="badge">订单</span>') + '</td>' +
        '<td>' + (mem ? '<span class="badge badge-pool">' + esc(mem.label) + '</span>' : '—') +
        (settled ? ' <span class="badge badge-settled">已结算</span>' : '') + '</td>' +
        '<td class="ops"><button class="btn btn-sm" data-act="edit-price" data-order="' + o.id + '">改价</button></td></tr>';
    });
    document.getElementById('libBody').innerHTML = html + '</tbody></table>';

    // 池子下拉（保留已选）
    var sel = document.getElementById('libPoolSel');
    var prev = sel.value;
    sel.innerHTML = state.reservoirs.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('');
    if (prev && state.reservoirs.some(function (p) { return p.id === prev; })) sel.value = prev;
  }

  /* ---------- 弹层 / Toast ---------- */
  function openModal(html) {
    document.getElementById('modalBox').innerHTML = html;
    document.getElementById('modalRoot').classList.remove('hidden');
  }
  function closeModal() {
    document.getElementById('modalRoot').classList.add('hidden');
    document.getElementById('modalBox').innerHTML = '';
  }
  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2600);
  }
  function confirmBox(msg, onOk) {
    pendingConfirm = onOk;
    openModal('<h3>请确认</h3><p>' + esc(msg) + '</p>' +
      '<div class="modal-foot"><button class="btn" data-act="modal-close">取消</button>' +
      '<button class="btn btn-primary" data-act="confirm-ok">确定</button></div>');
  }
  var pendingConfirm = null;
  var pendingSettleEntries = [];

  function modalNewPool() {
    openModal('<h3>新建蓄水池</h3>' +
      '<div class="form-row"><label>池名（如：日本线 · 佐桑结算）</label><input id="npName" value="新蓄水池"></div>' +
      '<div class="form-grid"><div class="form-row"><label>侧 A 文案</label><input id="npA" value="TA 帮我买（我欠）"></div>' +
      '<div class="form-row"><label>侧 B 文案</label><input id="npB" value="我帮 TA 买（TA 欠）"></div></div>' +
      '<p class="form-hint">一个池子可含多个对手方联系人：转账通常由一人完成，订单可以来自多人多活动。</p>' +
      '<div class="modal-foot"><button class="btn" data-act="modal-close">取消</button>' +
      '<button class="btn btn-primary" data-act="pool-save">创建</button></div>');
  }

  function modalManual(poolId) {
    var pool = poolById(poolId);
    openModal('<h3>记一笔手工账（' + esc(pool ? pool.name : '') + '）</h3>' +
      '<div class="form-grid">' +
      '<div class="form-row"><label>计入侧</label><select id="mSide"><option value="A">侧 A（TA 帮我买）</option><option value="B">侧 B（我帮 TA 买）</option></select></div>' +
      '<div class="form-row"><label>购买人（对手方）</label><input id="mBuyer" placeholder="如：佐藤"></div>' +
      '<div class="form-row"><label>活动</label><input id="mActivity" value="谷子杂项"></div>' +
      '<div class="form-row"><label>类型</label><input id="mType" placeholder="如：邮费 / 佣金 / 挂件"></div>' +
      '<div class="form-row"><label>型号 / 说明</label><input id="mModel" placeholder="如：国际运费补差"></div>' +
      '<div class="form-row"><label>件数</label><input id="mCount" type="number" min="1" value="1"></div>' +
      '<div class="form-row"><label>币种</label><select id="mCurrency"><option value="jpy">日元</option><option value="krw">韩元</option><option value="cny">人民币</option></select></div>' +
      '<div class="form-row" id="rowOrig"><label>外币金额</label><input id="mPriceOrig" type="number" step="0.01" placeholder="如 3000"></div>' +
      '<div class="form-row"><label>人民币金额</label><input id="mPrice" type="number" step="0.01" placeholder="可手填，外币输入后按演示汇率折算"></div>' +
      '</div>' +
      '<p class="form-hint">确定后会同步新建一笔「手工」标记的真实订单（备注「蓄水池手工账」），在订单库可排查。</p>' +
      '<div class="modal-foot"><button class="btn" data-act="modal-close">取消</button>' +
      '<button class="btn btn-primary" data-act="manual-save" data-pool="' + poolId + '">确定</button></div>');
  }

  function modalSettle(poolId, entryIds) {
    var pool = poolById(poolId);
    pendingSettleEntries = entryIds || [];
    var dir = 'them2us', amount = '', firstCcy = 'cny', linkedNote = '';
    if (pendingSettleEntries.length && pool) {
      var net = 0;
      pendingSettleEntries.forEach(function (eid, idx) {
        var e = pool.entries.find(function (x) { return x.id === eid; });
        var o = e && orderById(e.orderId);
        if (!o) return;
        if (idx === 0) firstCcy = o.currency || 'cny';
        var qty = o.count || 1;
        var v = (firstCcy === 'cny' || firstCcy === o.currency)
          ? ((firstCcy === 'cny' ? o.price : o.priceOrig) || 0) * qty
          : 0; // 币种不符的订单仅作标记，不计入预填
        net += (e.side === 'A' ? 1 : -1) * v;
      });
      net = round2(net);
      if (net > 0) { dir = 'us2them'; amount = net; }
      else if (net < 0) { dir = 'them2us'; amount = -net; }
      linkedNote = '<p class="form-hint">已选 ' + pendingSettleEntries.length +
        ' 笔订单：方向与金额已按勾选预填（可改，如抹零）；确定后这些订单标记「已结算」并移出活水净额，之后无需再勾选。与所选币种不符的订单仅作标记。</p>';
    }
    openModal('<h3>记一笔结算（' + esc(pool ? pool.name : '') + '）</h3>' +
      '<div class="form-grid">' +
      '<div class="form-row"><label>方向</label><select id="sDirection">' +
      '<option value="them2us"' + (dir === 'them2us' ? ' selected' : '') + '>对方 → 我方（冲抵TA欠）</option>' +
      '<option value="us2them"' + (dir === 'us2them' ? ' selected' : '') + '>我方 → 对方（冲抵我欠）</option></select></div>' +
      '<div class="form-row"><label>币种</label><select id="sCurrency">' +
      '<option value="jpy"' + (firstCcy === 'jpy' ? ' selected' : '') + '>日元</option>' +
      '<option value="krw"' + (firstCcy === 'krw' ? ' selected' : '') + '>韩元</option>' +
      '<option value="cny"' + (firstCcy === 'cny' ? ' selected' : '') + '>人民币</option></select></div>' +
      '<div class="form-row"><label>金额</label><input id="sAmount" type="number" step="0.01" min="0.01" value="' + amount + '"></div>' +
      '<div class="form-row"><label>日期</label><input id="sDate" type="date" value="' + today() + '"></div>' +
      '</div>' +
      '<div class="form-row"><label>备注（如：PayPal 转账 / 换货抵账）</label><input id="sNote"></div>' +
      linkedNote +
      '<div class="modal-foot"><button class="btn" data-act="modal-close">取消</button>' +
      '<button class="btn btn-primary" data-act="settle-save" data-pool="' + poolId + '">确定</button></div>');
  }

  function modalPrice(orderId) {
    var o = orderById(orderId);
    if (!o) return;
    openModal('<h3>改价（演示「自动跟随」）</h3>' +
      '<p class="form-hint">' + esc(o.activity) + ' · ' + esc(o.type) + ' / ' + esc(o.model) + ' · ' + esc(o.buyer) + '</p>' +
      '<div class="form-grid">' +
      '<div class="form-row"><label>外币原价（' + esc(ccyLabel(o.currency)) + '，单价）</label><input id="pOrig" type="number" step="0.01" value="' + (o.priceOrig != null ? o.priceOrig : '') + '"></div>' +
      '<div class="form-row"><label>人民币（单价）</label><input id="pPrice" type="number" step="0.01" value="' + (o.price != null ? o.price : '') + '"></div>' +
      '</div>' +
      '<p class="form-hint">正式版改价在订单管理完成；蓄水池条目引用订单，保存后合计与净额自动跟随（此处直接模拟）。</p>' +
      '<div class="modal-foot"><button class="btn" data-act="modal-close">取消</button>' +
      '<button class="btn btn-primary" data-act="price-save" data-order="' + orderId + '">保存</button></div>');
  }

  /* ---------- 事件 ---------- */
  function switchTab(name) {
    document.getElementById('tab-pools').classList.toggle('hidden', name !== 'pools');
    document.getElementById('tab-lib').classList.toggle('hidden', name !== 'lib');
    document.querySelectorAll('.tabs .tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === name);
    });
  }

  function checkedLibIds() {
    return Array.prototype.map.call(
      document.querySelectorAll('#libBody input[type="checkbox"]:checked'),
      function (c) { return c.getAttribute('data-id'); }
    );
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el) return;
    var act = el.getAttribute('data-act');
    var poolId = el.getAttribute('data-pool');
    if (act === 'tab') { switchTab(el.getAttribute('data-tab')); }
    else if (act === 'modal-close') { closeModal(); }
    else if (act === 'confirm-ok') { var cb = pendingConfirm; pendingConfirm = null; closeModal(); if (cb) cb(); }
    else if (act === 'new-pool') { modalNewPool(); }
    else if (act === 'reset') { actions.resetData(); }
    else if (act === 'pool-save') {
      var p = actions.createPool(
        document.getElementById('npName').value.trim(),
        document.getElementById('npA').value.trim(),
        document.getElementById('npB').value.trim()
      );
      closeModal();
      toast('已创建「' + p.name + '」');
    }
    else if (act === 'del-pool') {
      var pool = poolById(poolId);
      confirmBox('删除蓄水池「' + (pool ? pool.name : '') + '」？明细与结算一并删除（订单本身不受影响）。', function () {
        actions.deletePool(poolId);
        toast('已删除');
      });
    }
    else if (act === 'toggle-detail') {
      expanded[poolId] = !expanded[poolId];
      renderPools();
    }
    else if (act === 'go-assign') {
      switchTab('lib');
      var sel = document.getElementById('libPoolSel');
      if (sel) sel.value = poolId;
    }
    else if (act === 'manual') { modalManual(poolId); }
    else if (act === 'manual-save') {
      var f = {
        side: document.getElementById('mSide').value,
        buyer: document.getElementById('mBuyer').value.trim(),
        activity: document.getElementById('mActivity').value.trim(),
        type: document.getElementById('mType').value.trim(),
        model: document.getElementById('mModel').value.trim(),
        count: document.getElementById('mCount').value,
        currency: document.getElementById('mCurrency').value,
        priceOrig: document.getElementById('mPriceOrig').value,
        price: document.getElementById('mPrice').value,
        note: ''
      };
      if (!f.buyer) { toast('请填对手方购买人'); return; }
      if (numOrNull(f.price) == null && numOrNull(f.priceOrig) == null) { toast('外币金额与人民币金额至少填一个'); return; }
      actions.createManual(poolId, f.side, f);
      closeModal();
      toast('已记入，并同步新建「手工」订单（订单库可排查）');
    }
    else if (act === 'settle') { modalSettle(poolId); }
    else if (act === 'settle-checked') {
      var sids = Array.prototype.map.call(
        document.querySelectorAll('#detail-' + poolId + ' input.row-settle-check:checked'),
        function (c) { return c.getAttribute('data-entry'); }
      );
      if (!sids.length) { toast('先在明细里勾选要结算的订单'); return; }
      modalSettle(poolId, sids);
    }
    else if (act === 'settle-save') {
      var rec = actions.addSettlement(poolId, {
        direction: document.getElementById('sDirection').value,
        currency: document.getElementById('sCurrency').value,
        amount: document.getElementById('sAmount').value,
        date: document.getElementById('sDate').value,
        note: document.getElementById('sNote').value.trim(),
        entryIds: pendingSettleEntries
      });
      pendingSettleEntries = [];
      if (!rec) { toast('请填写大于 0 的金额'); return; }
      closeModal();
      toast(rec.entryIds ? '已结算 ' + rec.entryIds.length + ' 笔订单，已标记「已结算」' : '已记一笔结算，净额已冲抵');
    }
    else if (act === 'entry-move') { actions.moveEntry(poolId, el.getAttribute('data-entry')); }
    else if (act === 'entry-remove') {
      var entryId = el.getAttribute('data-entry');
      confirmBox('把这笔从蓄水池移除？（订单本身保留）', function () {
        actions.removeEntry(poolId, entryId);
        toast('已移除');
      });
    }
    else if (act === 'settle-remove') { actions.removeSettlement(poolId, el.getAttribute('data-settle')); }
    else if (act === 'edit-price') { modalPrice(el.getAttribute('data-order')); }
    else if (act === 'price-save') {
      actions.updateOrderPrice(el.getAttribute('data-order'), {
        priceOrig: document.getElementById('pOrig').value,
        price: document.getElementById('pPrice').value
      });
      closeModal();
      toast('已保存，蓄水池金额已自动跟随');
    }
    else if (act === 'assign') {
      var ids = checkedLibIds();
      if (!ids.length) { toast('先在列表里勾选订单'); return; }
      var target = document.getElementById('libPoolSel').value;
      var side = document.getElementById('libSideSel').value;
      var r = actions.assignOrders(target, ids, side);
      toast('已计入 ' + r.added + ' 笔' + (r.skipped ? '，跳过 ' + r.skipped + ' 笔已在池中' : ''));
    }
    else if (act === 'lib-price') {
      var selIds = checkedLibIds();
      if (selIds.length !== 1) { toast('请只勾选一笔再改价'); return; }
      modalPrice(selIds[0]);
    }
  });

  document.addEventListener('input', function (e) {
    if (!e.target || !e.target.id) return;
    if (e.target.id === 'libSearch') {
      libSearch = e.target.value;
      renderLib();
      var inp = document.getElementById('libSearch');
      if (inp) { inp.focus(); inp.value = libSearch; }
    } else if (e.target.id === 'mPriceOrig') {
      var cur = document.getElementById('mCurrency') ? document.getElementById('mCurrency').value : 'cny';
      var rate = state.rates[cur];
      var v = numOrNull(e.target.value);
      if (rate && v != null) document.getElementById('mPrice').value = round2(v * rate);
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'mCurrency') {
      var row = document.getElementById('rowOrig');
      if (row) row.classList.toggle('hidden', e.target.value === 'cny');
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
  });

  /* ---------- 启动 ---------- */
  function init() {
    load();
    // hash 预置视图（演示深链）：#tab-lib 直开订单库；#detail-<池id> 展开该池明细
    var h = (window.location.hash || '').replace('#', '');
    if (h === 'tab-lib') switchTab('lib');
    else if (h.indexOf('detail-') === 0) expanded[h.slice(7)] = true;
    renderAll();
  }
  init();

  /* ---------- 供测试 ---------- */
  window.RD = {
    get state() { return state; },
    computeSummary: computeSummary,
    actions: actions,
    helpers: { fmtMoney: fmtMoney, ccyLabel: ccyLabel, netDirection: netDirection, round2: round2 }
  };
})();
