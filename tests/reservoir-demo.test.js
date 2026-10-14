// 蓄水池演示 demo（demo/reservoir-demo）——净额计算 + 交互冒烟
// demo 独立于主 harness：直接 jsdom 加载 demo index.html + js/app.js，经 window.RD 断言
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const demoDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo', 'reservoir-demo');
const html = readFileSync(join(demoDir, 'index.html'), 'utf8');
const demoJs = readFileSync(join(demoDir, 'js', 'app.js'), 'utf8');

function boot() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  dom.window.eval(demoJs);
  dom.window.RD.actions.resetData(); // 清 localStorage 残留，回到种子数据
  return dom.window;
}

let w;
beforeEach(() => { w = boot(); });
const RD = () => w.RD;

function showLib() {
  w.document.querySelectorAll('[data-act="tab"]').forEach((t) => {
    if (t.getAttribute('data-tab') === 'lib') t.click();
  });
}

describe('渲染冒烟', () => {
  it('两张池卡 + 净额方向文案', () => {
    expect(w.document.querySelectorAll('.pool-card').length).toBe(2);
    const text = w.document.getElementById('poolList').textContent;
    expect(text).toContain('我方欠对方');
    expect(text).toContain('对方欠我方');
  });

  it('订单库渲染 10 笔 mock 订单，手工账带「手工」标记', () => {
    showLib();
    expect(w.document.querySelectorAll('#libBody tbody tr').length).toBe(10);
    expect(w.document.getElementById('libBody').textContent).toContain('手工');
  });
});

describe('净额计算（按订单自身字段分币种）', () => {
  it('池1：日元净额 6,400 我欠（结算 5,000 冲抵）；人民币净额 −49 对方欠', () => {
    const s = RD().computeSummary(RD().state.reservoirs[0]);
    expect(s.ccys.jpy.a).toBe(11400);
    expect(s.ccys.jpy.b).toBe(0);
    expect(s.ccys.jpy.them2us).toBe(5000);
    expect(s.ccys.jpy.net).toBe(6400);
    expect(s.ccys.cny.a).toBe(532);   // o1 230 + o2 182 + o3 120
    expect(s.ccys.cny.b).toBe(581);   // o7 316 + o9 220 + o10 45
    expect(s.ccys.cny.net).toBe(-49);
  });

  it('池2：韩元 16,000 我欠；人民币 −10 对方欠', () => {
    const s = RD().computeSummary(RD().state.reservoirs[1]);
    expect(s.ccys.krw.a).toBe(16000);
    expect(s.ccys.krw.net).toBe(16000);
    expect(s.ccys.cny.a).toBe(170);   // o5 85×2 折算
    expect(s.ccys.cny.b).toBe(180);   // o8 90×2
    expect(s.ccys.cny.net).toBe(-10);
  });

  it('未转化订单留空并提醒（未转人民币 o4 / 未转外币 o10）', () => {
    const s = RD().computeSummary(RD().state.reservoirs[0]);
    expect(s.missingRmb).toContain('o4');
    expect(s.missingOrig).toContain('o10');
    const text = w.document.getElementById('poolList').textContent;
    expect(text).toContain('未转人民币');
    expect(text).toContain('未转外币');
  });

  it('按购买人小计（一池多对手方）', () => {
    const s = RD().computeSummary(RD().state.reservoirs[0]);
    expect(s.buyers['佐藤'].origByCcy.jpy).toBe(6200);   // o1 2400 + o2 3800
    expect(s.buyers['佐藤'].rmb).toBe(948);              // o1 230 + o2 182 + o7 316 + o9 220（含外币折算）
    expect(s.buyers['田中'].origByCcy.jpy).toBe(5200);   // o3 2500 + o4 2700
    expect(s.buyers['田中'].rmb).toBe(165);              // o3 120 + o10 45
  });
});

describe('计入 / 防重 / 改侧 / 移除', () => {
  it('一单只入一池：已在任一池中的订单自动跳过', () => {
    const r = RD().actions.assignOrders('r2', ['o6', 'o1'], 'B'); // o6 未入池；o1 已在 r1
    expect(r.added).toBe(1);
    expect(r.skipped).toBe(1);
    expect(RD().state.reservoirs[1].entries.length).toBe(3);
  });

  it('改侧与移除即时生效', () => {
    RD().actions.moveEntry('r1', 'e9'); // o9 侧B → 侧A
    let s = RD().computeSummary(RD().state.reservoirs[0]);
    expect(s.ccys.cny.a).toBe(752);   // 532 + 220
    expect(s.ccys.cny.b).toBe(361);   // 581 − 220
    RD().actions.removeEntry('r1', 'e4'); // 移除未转人民币那笔
    s = RD().computeSummary(RD().state.reservoirs[0]);
    expect(s.ccys.jpy.a).toBe(8700);
    expect(s.missingRmb.length).toBe(0);
  });
});

describe('手工账同步新建订单', () => {
  it('新建 source=manual 订单并计入池子，备注可排查', () => {
    const before = RD().state.orders.length;
    const o = RD().actions.createManual('r2', 'A', {
      activity: '谷子杂项', type: '小卡', model: '测试卡', buyer: '佐藤',
      currency: 'jpy', priceOrig: '3000', price: '144', count: '2', note: '测试'
    });
    expect(RD().state.orders.length).toBe(before + 1);
    expect(o.source).toBe('manual');
    expect(o.remark).toContain('蓄水池手工账');
    const s = RD().computeSummary(RD().state.reservoirs[1]);
    expect(s.ccys.jpy.a).toBe(6000); // o5 是韩元，池2 日元桶仅手工账 3000×2
  });
});

describe('结算流水', () => {
  it('记一笔结算即时冲抵净额，可删除', () => {
    RD().actions.addSettlement('r2', { direction: 'us2them', currency: 'krw', amount: 1000, date: '2026-10-14', note: '换货抵账' });
    let s = RD().computeSummary(RD().state.reservoirs[1]);
    expect(s.ccys.krw.us2them).toBe(1000);
    expect(s.ccys.krw.net).toBe(17000);
    const sid = RD().state.reservoirs[1].settlements[0].id;
    RD().actions.removeSettlement('r2', sid);
    s = RD().computeSummary(RD().state.reservoirs[1]);
    expect(s.ccys.krw.net).toBe(16000);
  });
});

describe('金额自动跟随订单改价', () => {
  it('改 o9 人民币价 220→198，池合计与净额随之变化', () => {
    RD().actions.updateOrderPrice('o9', { price: '198' });
    const s = RD().computeSummary(RD().state.reservoirs[0]);
    expect(s.ccys.cny.b).toBe(559);   // o7 316 + o9 198 + o10 45
    expect(s.ccys.cny.net).toBe(-27); // 532 − 559
  });
});

describe('DOM 交互冒烟', () => {
  it('订单库勾选 + 工具栏计入蓄水池', () => {
    showLib();
    w.document.querySelector('#libBody input[data-id="o6"]').checked = true;
    w.document.getElementById('libPoolSel').value = 'r2';
    w.document.getElementById('libSideSel').value = 'B';
    w.document.querySelector('[data-act="assign"]').click();
    expect(RD().state.reservoirs[1].entries.some((e) => e.orderId === 'o6')).toBe(true);
  });

  it('重置演示数据还原种子', () => {
    RD().actions.assignOrders('r2', ['o1'], 'B');
    RD().actions.resetData();
    expect(RD().state.orders.length).toBe(10);
    expect(RD().state.reservoirs[1].entries.length).toBe(2);
  });
});
