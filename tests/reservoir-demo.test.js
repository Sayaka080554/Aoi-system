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
  it('两张池卡 + 参考净额 + 单侧币种不宣称方向（缺失侧不按 0）', () => {
    expect(w.document.querySelectorAll('.pool-card').length).toBe(2);
    const text = w.document.getElementById('poolList').textContent;
    expect(text).toContain('参考净额');
    expect(text).toContain('仅侧A有账');   // 日元桶只有 A 侧有活水账
    expect(text).toContain('仅侧B有账');   // 人民币桶只有 B 侧有活水账
    expect(text).toContain('对方欠我方');  // 参考净额 −228.8 / −95.2
  });

  it('订单库渲染 10 笔 mock 订单，手工账带「手工」标记', () => {
    showLib();
    expect(w.document.querySelectorAll('#libBody tbody tr').length).toBe(10);
    expect(w.document.getElementById('libBody').textContent).toContain('手工');
  });
});

describe('净额计算（一单一次计入，按记账币种分桶）', () => {
  it('池1：日元净额 6,400 我欠（结算 5,000 冲抵）；人民币桶仅原生人民币订单（−536 对方欠）', () => {
    const s = RD().computeSummary(RD().state.reservoirs[0]);
    expect(s.ccys.jpy.a).toBe(11400);
    expect(s.ccys.jpy.b).toBe(0);
    expect(s.ccys.jpy.us2them).toBe(5000);
    expect(s.ccys.jpy.net).toBe(6400);
    expect(s.ccys.cny.a).toBe(0);      // 外币订单的人民币折算不再混入人民币桶
    expect(s.ccys.cny.b).toBe(536);    // o7 316 + o9 220（原生人民币）
    expect(s.ccys.cny.net).toBe(-536);
  });

  it('池2：韩元 16,000 我欠；人民币 −180 对方欠', () => {
    const s = RD().computeSummary(RD().state.reservoirs[1]);
    expect(s.ccys.krw.a).toBe(16000);
    expect(s.ccys.krw.net).toBe(16000);
    expect(s.ccys.cny.a).toBe(0);
    expect(s.ccys.cny.b).toBe(180);
    expect(s.ccys.cny.net).toBe(-180);
  });

  it('人民币视图（外币订单取已转化价格，缺失留空提醒）', () => {
    const s = RD().computeSummary(RD().state.reservoirs[0]);
    expect(s.rmbView.a).toBe(532);  // o1 230 + o2 182 + o3 120
    expect(s.rmbView.b).toBe(581);  // o7 316 + o9 220 + o10 45
    expect(s.missingRmb).toContain('o4');
    expect(s.missingOrig).toContain('o10');
  });

  it('参考净额：各币种净额按参考汇率统一折算人民币（池1 −228.8 对方欠）', () => {
    const s = RD().computeSummary(RD().state.reservoirs[0]);
    // 6400 日元 × 0.048 = 307.2（我欠）；−536 人民币（对方欠）→ 对方欠 ≈ ¥228.8
    expect(s.refNet.net).toBe(-228.8);
  });

  it('单侧币种不构成抵扣方向（缺失侧不按 0），参考净额照常折算两侧', () => {
    const s = RD().computeSummary(RD().state.reservoirs[0]);
    expect(s.ccys.jpy.oneSided).toBe('A');  // B 侧无日元活水账（o10 缺外币原价不算在账）
    expect(s.ccys.cny.oneSided).toBe('B');
    expect(s.refNet.net).toBe(-228.8);      // 参考净额仍含两侧全部活水
  });

  it('按购买人小计（一池多对手方）', () => {
    const s = RD().computeSummary(RD().state.reservoirs[0]);
    expect(s.buyers['佐藤'].origByCcy.jpy).toBe(6200);   // o1 2400 + o2 3800
    expect(s.buyers['佐藤'].rmb).toBe(948);              // o1 230 + o2 182 + o7 316 + o9 220（含外币折算）
    expect(s.buyers['田中'].origByCcy.jpy).toBe(5200);   // o3 2500 + o4 2700
    expect(s.buyers['田中'].rmb).toBe(165);              // o3 120 + o10 45
  });
});

describe('跨币种场景（用户截图：USD 15 vs 10，两边各转一种货币）', () => {
  it('美元桶净额 5 刀对方欠 + 人民币视图单侧 + 参考净额 ≈¥35（一单一次计入不重复）', () => {
    const p = RD().actions.createPool('美国线 · 约翰结算', 'TA 帮我买（我欠）', '我帮 TA 买（TA 欠）');
    RD().actions.createManual(p.id, 'B', { activity: '美国代购', type: '吧唧', model: 'USD15', buyer: '约翰', currency: 'usd', priceOrig: '15', price: '105', count: '1', note: '' });
    RD().actions.createManual(p.id, 'A', { activity: '美国代购', type: '色纸', model: 'USD10', buyer: '约翰', currency: 'usd', priceOrig: '10', price: '', count: '1', note: '' });
    const s = RD().computeSummary(p);
    expect(s.ccys.usd.a).toBe(10);
    expect(s.ccys.usd.b).toBe(15);
    expect(s.ccys.usd.net).toBe(-5);       // 对方欠 5 刀（原币净额）
    expect(s.rmbView.a).toBe(0);           // TA 没换人民币 → 留空
    expect(s.rmbView.b).toBe(105);         // 我换成了人民币
    expect(s.missingRmb.length).toBe(1);
    expect(s.refNet.net).toBe(-35);        // (10−15)×7 → 对方欠 ≈¥35（参考汇率 usd=7）
    const text = w.document.getElementById('poolList').textContent;
    expect(text).toContain('参考净额');
    expect(s.ccys.usd.oneSided).toBeNull(); // 两侧都有美元账 → 正常宣称方向
    RD().actions.createManual(p.id, 'A', { activity: '美国代购', type: '徽章', model: 'USD20', buyer: '约翰', currency: 'usd', priceOrig: '20', price: '', count: '1', note: '' });
    const s2 = RD().computeSummary(p);
    expect(s2.ccys.usd.net).toBe(15); // (10 + 20) − 15 → 我方欠对方 15 刀
    expect(w.document.getElementById('poolList').textContent).toContain('我方欠对方'); // 双侧有账时方向恢复
  });

  it('TA 侧改记日元 1400（7/140=0.05）参考净额不变', () => {
    const p = RD().actions.createPool('美国线 · 约翰结算', 'TA 帮我买（我欠）', '我帮 TA 买（TA 欠）');
    RD().actions.createManual(p.id, 'B', { activity: '美国代购', type: '吧唧', model: 'USD15', buyer: '约翰', currency: 'usd', priceOrig: '15', price: '105', count: '1', note: '' });
    RD().actions.createManual(p.id, 'A', { activity: '美国代购', type: '色纸', model: 'JPY1400', buyer: '约翰', currency: 'jpy', priceOrig: '1400', price: '', count: '1', note: '' });
    const s = RD().computeSummary(p);
    expect(s.ccys.usd.net).toBe(-15);      // 美元桶只剩我方 15
    expect(s.ccys.jpy.net).toBe(1400);     // 日元桶只剩 TA 1400（我欠）
    expect(s.refNet.net).toBe(-37.8); // 我帮TA买15刀（对方欠105）vs TA帮我买1400円（我欠67.2）→ 对方欠 ≈¥37.8
    RD().actions.setPoolRates(p.id, { jpy: 7 / 140 });
    expect(RD().computeSummary(p).refNet.net).toBe(-35); // 按 TA 的换算率折算 → 对方欠 ≈¥35
  });

  it('参考汇率可编辑，改后参考净额重算', () => {
    const p = RD().actions.createPool('美国线', 'TA 帮我买（我欠）', '我帮 TA 买（TA 欠）');
    RD().actions.createManual(p.id, 'B', { activity: '美国代购', type: '吧唧', model: 'USD10', buyer: '约翰', currency: 'usd', priceOrig: '10', price: '', count: '1', note: '' });
    expect(RD().computeSummary(p).refNet.net).toBe(-70);   // 10×7
    RD().actions.setPoolRates(p.id, { usd: 7.3 });
    expect(RD().computeSummary(p).refNet.net).toBe(-73);   // 10×7.3
    expect(RD().state.reservoirs.find((x) => x.id === p.id).rates.usd).toBe(7.3);
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
    expect(s.ccys.cny.a).toBe(220);   // 人民币桶（原生）：0 + 220
    expect(s.ccys.cny.b).toBe(316);   // 536 − 220
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
  it('记一笔纯转账结算即时冲抵净额，可删除', () => {
    RD().actions.addSettlement('r2', { direction: 'us2them', currency: 'krw', amount: 1000, date: '2026-10-14', note: '换货抵账' });
    let s = RD().computeSummary(RD().state.reservoirs[1]);
    expect(s.ccys.krw.us2them).toBe(1000);
    expect(s.ccys.krw.net).toBe(15000); // 我欠 16,000 − 我方转对方 1,000
    const sid = RD().state.reservoirs[1].settlements[0].id;
    RD().actions.removeSettlement('r2', sid);
    s = RD().computeSummary(RD().state.reservoirs[1]);
    expect(s.ccys.krw.net).toBe(16000);
  });

  it('方向语义：对方把欠的人民币转清后参考净额归零', () => {
    // 池1 参考净额 −228.8（对方欠）；对方转我 228.8 人民币后应两清
    RD().actions.addSettlement('r1', { direction: 'them2us', currency: 'cny', amount: 228.8, date: '2026-10-14', note: '对方转账' });
    const s = RD().computeSummary(RD().state.reservoirs[0]);
    expect(s.refNet.net).toBe(0);
  });
});

describe('结算标记订单', () => {
  const settleE8 = () => RD().actions.addSettlement('r2', {
    direction: 'them2us', currency: 'cny', amount: 180, date: '2026-10-14', note: '结清', entryIds: ['e8']
  });

  it('勾选订单结算：标记已结算并移出活水（关联结算不重复进公式）', () => {
    const rec = settleE8();
    expect(rec.entryIds).toEqual(['e8']);
    const r2 = RD().state.reservoirs[1];
    const e8 = r2.entries.find((x) => x.id === 'e8');
    expect(e8.settledAt).toBe('2026-10-14');
    expect(e8.settlementId).toBe(rec.id);
    const s = RD().computeSummary(r2);
    expect(s.ccys.cny.b).toBe(0);            // 活水移出
    expect(s.ccys.cny.settledB).toBe(180);   // 已结算留档
    expect(s.ccys.cny.net).toBe(0);
    expect(s.refNet.net).toBe(84.8);         // 只剩韩元 16000×0.0053
  });

  it('删除关联结算 → 自动取消标记，金额回到活水', () => {
    const rec = settleE8();
    RD().actions.removeSettlement('r2', rec.id);
    const r2 = RD().state.reservoirs[1];
    const e8 = r2.entries.find((x) => x.id === 'e8');
    expect(e8.settledAt).toBeUndefined();
    const s = RD().computeSummary(r2);
    expect(s.ccys.cny.b).toBe(180);
    expect(s.ccys.cny.net).toBe(-180);
  });

  it('已结算条目锁定：改侧/移除无效', () => {
    settleE8();
    expect(RD().actions.moveEntry('r2', 'e8')).toBeNull();
    RD().actions.removeEntry('r2', 'e8');
    expect(RD().state.reservoirs[1].entries.length).toBe(2);
  });

  it('订单库：已结算订单带标记且勾选框禁用（无需再勾选）', () => {
    settleE8();
    showLib();
    const cb = w.document.querySelector('#libBody input[data-id="o8"]');
    expect(cb.disabled).toBe(true);
    expect(w.document.getElementById('libBody').textContent).toContain('已结算');
  });

  it('明细勾选 → 结算勾选订单 → 确定（DOM 全链路，预填方向/金额）', () => {
    w.document.querySelector('[data-act="toggle-detail"][data-pool="r2"]').click();
    w.document.querySelector('#detail-r2 input[data-entry="e8"]').checked = true;
    w.document.querySelector('[data-act="settle-checked"][data-pool="r2"]').click();
    expect(w.document.getElementById('sDirection').value).toBe('them2us'); // e8 在 B 侧（TA欠）→ 对方转我方
    expect(w.document.getElementById('sAmount').value).toBe('180');
    expect(w.document.getElementById('sCurrency').value).toBe('cny');
    w.document.getElementById('sNote').value = '微信收款码';
    w.document.querySelector('[data-act="settle-save"]').click();
    const r2 = RD().state.reservoirs[1];
    expect(r2.settlements[0].entryIds).toEqual(['e8']);
    expect(r2.entries.find((x) => x.id === 'e8').settledAt).toBeTruthy();
    const s = RD().computeSummary(r2);
    expect(s.ccys.cny.net).toBe(0);
  });
});

describe('金额自动跟随订单改价', () => {
  it('改 o9 人民币价 220→198，池合计与净额随之变化', () => {
    RD().actions.updateOrderPrice('o9', { price: '198' });
    const s = RD().computeSummary(RD().state.reservoirs[0]);
    expect(s.ccys.cny.b).toBe(514);   // o7 316 + o9 198
    expect(s.ccys.cny.net).toBe(-514);
    expect(s.rmbView.b).toBe(559);    // o7 316 + o9 198 + o10 45
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

describe('就地转化（v3.26.0：未转¥/未转外币 点一下就地补，预填参考汇率）', () => {
  it('卡头警告标签点击 → 打开第一笔转化弹窗，人民币按参考汇率预填', () => {
    w.document.querySelector('[data-act="convert"][data-pool="r1"][data-kind="rmb"]').click();
    expect(w.document.getElementById('modalRoot').classList.contains('hidden')).toBe(false);
    expect(w.document.getElementById('resCvPrice').value).toBe('43.2'); // o4：900 日元 × 0.048
    expect(w.document.getElementById('resCvPrice').getAttribute('data-count')).toBe('3');
  });

  it('小计随输入联动；保存写入 orders.price，提醒消失、弹层关闭', () => {
    w.document.querySelector('[data-act="convert"][data-pool="r1"][data-kind="rmb"]').click();
    const input = w.document.getElementById('resCvPrice');
    input.value = '50';
    input.dispatchEvent(new w.Event('input', { bubbles: true }));
    expect(w.document.getElementById('resCvSubtotal').textContent).toBe('150'); // 50 × 3
    w.document.querySelector('[data-act="convert-save"]').click();
    expect(RD().state.orders.find((o) => o.id === 'o4').price).toBe(50);
    expect(RD().computeSummary(RD().state.reservoirs[0]).missingRmb.length).toBe(0);
    expect(w.document.getElementById('modalRoot').classList.contains('hidden')).toBe(true);
  });

  it('保存并下一笔串联两笔，走完自动关闭', () => {
    RD().actions.assignOrders('r2', ['o6'], 'B'); // o6 缺人民币（15,000 韩元）
    RD().actions.createManual('r2', 'A', { activity: '谷子杂项', type: '挂件', model: 'JPY800', buyer: '金桑', currency: 'jpy', priceOrig: '800', price: '', count: '1', note: '' });
    w.document.querySelector('[data-act="convert"][data-pool="r2"][data-kind="rmb"]').click();
    expect(w.document.getElementById('resCvPrice').value).toBe('79.5'); // o6：15,000 × 0.0053
    w.document.querySelector('[data-act="convert-save-next"]').click();
    expect(w.document.getElementById('resCvPrice').value).toBe('38.4'); // 手工账 800 × 0.048
    w.document.querySelector('[data-act="convert-save-next"]').click();
    expect(w.document.getElementById('modalRoot').classList.contains('hidden')).toBe(true);
    expect(RD().computeSummary(RD().state.reservoirs[1]).missingRmb.length).toBe(0);
  });

  it('行内「未转¥」→ 单笔弹窗（无下一笔按钮）；反向补外币写 priceOrig', () => {
    w.document.querySelector('[data-act="toggle-detail"][data-pool="r1"]').click();
    w.document.querySelector('#detail-r1 [data-act="convert-one"][data-order="o4"]').click();
    expect(w.document.getElementById('resCvPrice')).not.toBeNull();
    expect(w.document.querySelector('[data-act="convert-save-next"]')).toBeNull();
    w.document.querySelector('[data-act="modal-close"]').click();
    w.document.querySelector('[data-act="convert"][data-pool="r1"][data-kind="orig"]').click();
    expect(w.document.getElementById('resCvOrig').value).toBe('937.5'); // o10：¥45 ÷ 0.048
    w.document.querySelector('[data-act="convert-save"]').click();
    expect(RD().state.orders.find((o) => o.id === 'o10').priceOrig).toBe(937.5);
    expect(RD().computeSummary(RD().state.reservoirs[0]).missingOrig.length).toBe(0);
  });
});
