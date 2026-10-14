// v3.25.0 蓄水池 · 互购净额台账——js/reservoir.js 纯计算 / 数据动作 / 页面接线
// 口径：一单一次计入（记账币种=外币原价或人民币）+ 币种桶净额 + 人民币视图 + 参考净额；
// 结算即标记已结算移出活水；手工账同步新建订单；订单管理勾选计入防重；零 schema（d.reservoirs blob 新键）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aoi, doc, win } from './helpers/aoi.js';

const R = () => aoi.reservoir;

function seedData() {
  aoi.state.data = {
    orders: [
      { id: 'o1', ip: '', activity: '8.23涩谷场外', type: '吧唧', model: '初音17周年 吧唧', buyer: '佐藤', currency: 'jpy', priceOrig: 1200, count: 2, price: 115, status: '未到货', remark: '' },
      { id: 'o2', ip: '', activity: '8.23涩谷场外', type: '痛包', model: '痛包 基准款', buyer: '佐藤', currency: 'jpy', priceOrig: 3800, count: 1, price: 182, status: '未到货', remark: '' },
      { id: 'o3', ip: '', activity: '8.23涩谷场外', type: '色纸', model: '初音 色纸', buyer: '田中', currency: 'jpy', priceOrig: 2500, count: 1, price: 120, status: '未到货', remark: '' },
      { id: 'o4', ip: '', activity: '8.23涩谷场外', type: '亚克力', model: '初音 亚克力', buyer: '田中', currency: 'jpy', priceOrig: 900, count: 3, price: null, status: '未到货', remark: '' },
      { id: 'o5', ip: '', activity: '10.1韩国团', type: '小卡', model: 'aespa 小卡', buyer: 'キム', currency: 'krw', priceOrig: 8000, count: 2, price: 85, status: '未到货', remark: '' },
      { id: 'o6', ip: '', activity: '10.1韩国团', type: '海报', model: '新专辑 海报', buyer: 'キム', currency: 'krw', priceOrig: 15000, count: 1, price: null, status: '未到货', remark: '' },
      { id: 'o7', ip: '', activity: '闲鱼代购', type: '棉花娃娃', model: '20cm 初音娃', buyer: '佐藤', currency: 'cny', priceOrig: null, count: 2, price: 158, status: '未到货', remark: '' },
      { id: 'o8', ip: '', activity: '闲鱼代购', type: '吧唧', model: '星穹铁道 吧唧', buyer: 'キム', currency: 'cny', priceOrig: null, count: 2, price: 90, status: '未到货', remark: '' },
      { id: 'o9', ip: '', activity: '闲鱼代购', type: '立牌', model: '初音 立牌', buyer: '佐藤', currency: 'cny', priceOrig: null, count: 1, price: 220, status: '未到货', remark: '' },
      { id: 'o10', ip: '', activity: '谷子杂项', type: '挂件', model: '初音 挂件', buyer: '田中', currency: 'jpy', priceOrig: null, count: 1, price: 45, status: '未到货', remark: '蓄水池手工账：杂项补记' }
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
    ],
    activities: ['8.23涩谷场外', '10.1韩国团', '闲鱼代购'], ips: [],
    activityMeta: {}, batches: [], payments: [], notifications: [], announcements: [],
    typeMeta: {}, ipTypes: {}, addresses: {}, memberMeta: {},
    calc: { jpyRate: 0.048, jpyMarkup: 0, krwRate: 0.0053, krwMarkup: 0 }
  };
  // 持久化打桩：断言调用与入参，不真正写 Supabase/debug 通道
  aoi.saveTeamData = vi.fn(async function (data) { return data; });
}

beforeEach(seedData);

describe('模块与页面接线（静默待命 / 静态标记 / 导航）', () => {
  it('view-reservoir 存在且默认隐藏；订单工具栏有「计入蓄水池」；计入弹层默认收起', () => {
    const view = doc.getElementById('view-reservoir');
    expect(view).not.toBeNull();
    expect(view.classList.contains('hidden')).toBe(true);
    expect(doc.querySelector('button[onclick="Aoi.reservoir.openAssignFromOrders()"]')).not.toBeNull();
    expect(doc.getElementById('reservoirAssignBox').classList.contains('hidden')).toBe(true);
    expect(doc.getElementById('reservoirBody')).not.toBeNull();
  });

  it('Aoi.nav(view-reservoir) 显示视图并渲染池卡：参考净额 + 单侧币种不宣称方向', () => {
    aoi.nav('view-reservoir');
    expect(doc.getElementById('view-reservoir').classList.contains('hidden')).toBe(false);
    const body = doc.getElementById('reservoirBody').textContent;
    expect(body).toContain('日本线 · 佐桑结算');
    expect(body).toContain('参考净额');
    expect(body).toContain('仅侧A有账');   // 日元桶只有 A 侧活水账（缺失侧不按 0 抵扣）
    expect(body).toContain('仅侧B有账');
    expect(body).toContain('对方欠我方');  // 参考净额 −228.8 / −95.2
  });

  it('renderAll 对空 reservoirs 显示空状态并缺省 d.reservoirs', () => {
    aoi.state.data.reservoirs = null;
    R().renderAll();
    expect(Array.isArray(aoi.state.data.reservoirs)).toBe(true);
    expect(doc.getElementById('reservoirBody').textContent).toContain('还没有蓄水池');
  });
});

describe('净额计算（一单一次计入 / 币种桶 / 人民币视图 / 参考净额）', () => {
  it('池1：日元净额 6,400 我欠（结算 5,000 冲抵）；人民币桶仅原生订单 −536 对方欠', () => {
    const s = R().computeSummary(aoi.state.data.reservoirs[0], aoi.state.data.orders);
    expect(s.ccys.jpy.a).toBe(11400);
    expect(s.ccys.jpy.b).toBe(0);
    expect(s.ccys.jpy.us2them).toBe(5000);
    expect(s.ccys.jpy.net).toBe(6400);
    expect(s.ccys.cny.a).toBe(0);
    expect(s.ccys.cny.b).toBe(536);
    expect(s.ccys.cny.net).toBe(-536);
  });

  it('池1：人民币视图 532/581，未转化留空提醒（o4 未转¥ / o10 未转外币）', () => {
    const s = R().computeSummary(aoi.state.data.reservoirs[0], aoi.state.data.orders);
    expect(s.rmbView.a).toBe(532);
    expect(s.rmbView.b).toBe(581);
    expect(s.missingRmb).toContain('o4');
    expect(s.missingOrig).toContain('o10');
  });

  it('池1：参考净额 −228.8（6400 日元×0.048 − 536 人民币）', () => {
    const s = R().computeSummary(aoi.state.data.reservoirs[0], aoi.state.data.orders);
    expect(s.refNet.net).toBe(-228.8);
  });

  it('池2：韩元 16,000 我欠；人民币 −180 对方欠；参考净额 −95.2', () => {
    const s = R().computeSummary(aoi.state.data.reservoirs[1], aoi.state.data.orders);
    expect(s.ccys.krw.net).toBe(16000);
    expect(s.ccys.cny.net).toBe(-180);
    expect(s.refNet.net).toBe(-95.2);
  });

  it('单侧币种不构成抵扣方向（缺失侧不按 0），参考净额照常折算两侧', () => {
    const s = R().computeSummary(aoi.state.data.reservoirs[0], aoi.state.data.orders);
    expect(s.ccys.jpy.oneSided).toBe('A');  // B 侧无日元活水账
    expect(s.ccys.cny.oneSided).toBe('B');
    expect(s.refNet.net).toBe(-228.8);      // 参考净额仍含两侧全部活水
  });

  it('按购买人小计（一池多对手方）', () => {
    const s = R().computeSummary(aoi.state.data.reservoirs[0], aoi.state.data.orders);
    expect(s.buyers['佐藤'].origByCcy.jpy).toBe(6200);
    expect(s.buyers['佐藤'].rmb).toBe(948);
    expect(s.buyers['田中'].origByCcy.jpy).toBe(5200);
  });

  it('纯计算不改订单数据（零干扰）', () => {
    const before = JSON.stringify(aoi.state.data.orders);
    R().computeSummary(aoi.state.data.reservoirs[0], aoi.state.data.orders);
    R().computeSummary(aoi.state.data.reservoirs[1], aoi.state.data.orders);
    expect(JSON.stringify(aoi.state.data.orders)).toBe(before);
  });
});

describe('跨币种场景（用户实测：USD 15 vs 10，两边各转一种货币）', () => {
  it('美元桶净额对方欠 5 刀、人民币视图单侧、参考净额 ≈¥35（一单一次计入不重复）', async () => {
    const p = await R().createPool('美国线 · 约翰结算', 'TA 帮我买（我欠）', '我帮 TA 买（TA 欠）');
    await R().createManual(p.id, 'B', { activity: '美国代购', type: '吧唧', model: 'USD15', buyer: '约翰', currency: 'usd', priceOrig: '15', price: '105', count: '1', note: '' });
    await R().createManual(p.id, 'A', { activity: '美国代购', type: '色纸', model: 'USD10', buyer: '约翰', currency: 'usd', priceOrig: '10', price: '', count: '1', note: '' });
    const s = R().computeSummary(p, aoi.state.data.orders);
    expect(s.ccys.usd.net).toBe(-5);      // 对方欠 5 刀
    expect(s.rmbView.a).toBe(0);          // TA 没换人民币 → 留空
    expect(s.rmbView.b).toBe(105);
    expect(s.missingRmb.length).toBe(1);
    expect(s.refNet.net).toBe(-35);       // (10−15)×7 → 对方欠 ≈¥35
    expect(s.ccys.usd.oneSided).toBeNull(); // 两侧都有美元账 → 正常宣称方向
    await R().createManual(p.id, 'A', { activity: '美国代购', type: '徽章', model: 'USD20', buyer: '约翰', currency: 'usd', priceOrig: '20', price: '', count: '1', note: '' });
    const s2 = R().computeSummary(p, aoi.state.data.orders);
    expect(s2.ccys.usd.net).toBe(15); // (10 + 20) − 15 → 我方欠对方 15 刀
    aoi.nav('view-reservoir');
    expect(doc.getElementById('reservoirBody').textContent).toContain('我方欠对方'); // 双侧有账时方向恢复
  });

  it('TA 侧改记日元 1400：参考净额随汇率折算保持一致（可编辑汇率）', async () => {
    const p = await R().createPool('美国线 · 约翰结算', 'TA 帮我买（我欠）', '我帮 TA 买（TA 欠）');
    await R().createManual(p.id, 'B', { activity: '美国代购', type: '吧唧', model: 'USD15', buyer: '约翰', currency: 'usd', priceOrig: '15', price: '105', count: '1', note: '' });
    await R().createManual(p.id, 'A', { activity: '美国代购', type: '色纸', model: 'JPY1400', buyer: '约翰', currency: 'jpy', priceOrig: '1400', price: '', count: '1', note: '' });
    let s = R().computeSummary(p, aoi.state.data.orders);
    expect(s.ccys.usd.net).toBe(-15);
    expect(s.ccys.jpy.net).toBe(1400);
    expect(s.refNet.net).toBe(-37.8);     // −105 + 1400×0.048
    await R().setPoolRates(p.id, { jpy: 7 / 140 });
    s = R().computeSummary(p, aoi.state.data.orders);
    expect(s.refNet.net).toBe(-35);       // 按 TA 的换算率 → 对方欠 ≈¥35
    expect(p.rates.jpy).toBeCloseTo(0.05);
  });
});

describe('订单管理勾选计入（防重 / 撤销快照 / 持久化）', () => {
  it('勾选计入：新订单入池、已在池中的跳过，弹层收起并保存', async () => {
    aoi.orders.selectedIds = vi.fn(() => ['o6', 'o1']); // o6 未入池；o1 已在 r1
    R().openAssignFromOrders();
    expect(doc.getElementById('reservoirAssignBox').classList.contains('hidden')).toBe(false);
    doc.getElementById('reservoirAssignPool').value = 'r2';
    doc.getElementById('reservoirAssignSide').value = 'B';
    const r = await R().confirmAssign();
    expect(r.added).toBe(1);
    expect(r.skipped).toBe(1);
    expect(aoi.state.data.reservoirs[1].entries.length).toBe(3);
    expect(aoi.saveTeamData).toHaveBeenCalledWith(aoi.state.data);
    expect(doc.getElementById('reservoirAssignBox').classList.contains('hidden')).toBe(true);
  });

  it('未勾选订单时打开弹层直接提示并保持收起', () => {
    aoi.orders.selectedIds = vi.fn(() => []);
    R().openAssignFromOrders();
    expect(doc.getElementById('reservoirAssignBox').classList.contains('hidden')).toBe(true);
  });

  it('全部已在池中时计入被拒绝', async () => {
    aoi.orders.selectedIds = vi.fn(() => ['o1']);
    R().openAssignFromOrders();
    doc.getElementById('reservoirAssignPool').value = 'r2';
    const r = await R().confirmAssign();
    expect(r).toBeUndefined();
    expect(aoi.state.data.reservoirs[1].entries.length).toBe(2);
    expect(aoi.saveTeamData).not.toHaveBeenCalled();
  });
});

describe('手工账同步新建订单', () => {
  it('新建订单（remark 标记）+ 计入池子', async () => {
    const before = aoi.state.data.orders.length;
    const o = await R().createManual('r2', 'A', {
      activity: '谷子杂项', type: '小卡', model: '测试卡', buyer: '佐藤',
      currency: 'jpy', priceOrig: '3000', price: '144', count: '2', note: '测试'
    });
    expect(aoi.state.data.orders.length).toBe(before + 1);
    expect(o.remark).toContain('蓄水池手工账');
    expect(o.status).toBe('未到货');
    const s = R().computeSummary(aoi.state.data.reservoirs[1], aoi.state.data.orders);
    expect(s.ccys.jpy.a).toBe(6000); // o5 是韩元，池2 日元桶仅手工账 3000×2
  });

  it('金额全空被拒绝', async () => {
    const before = aoi.state.data.orders.length;
    const o = await R().createManual('r2', 'A', { buyer: '佐藤', currency: 'jpy', priceOrig: '', price: '', count: '1' });
    expect(o).toBeNull();
    expect(aoi.state.data.orders.length).toBe(before);
  });
});

describe('结算流水与结算即标记', () => {
  it('纯转账结算冲抵净额，可删除还原', async () => {
    await R().addSettlement('r2', { direction: 'us2them', currency: 'krw', amount: 1000, date: '2026-10-14', note: '换货抵账' });
    let s = R().computeSummary(aoi.state.data.reservoirs[1], aoi.state.data.orders);
    expect(s.ccys.krw.net).toBe(15000);
    const sid = aoi.state.data.reservoirs[1].settlements[0].id;
    await R().removeSettlement('r2', sid);
    s = R().computeSummary(aoi.state.data.reservoirs[1], aoi.state.data.orders);
    expect(s.ccys.krw.net).toBe(16000);
  });

  it('方向语义：对方把欠的人民币转清后参考净额归零', async () => {
    await R().addSettlement('r1', { direction: 'them2us', currency: 'cny', amount: 228.8, date: '2026-10-14', note: '对方转账' });
    const s = R().computeSummary(aoi.state.data.reservoirs[0], aoi.state.data.orders);
    expect(s.refNet.net).toBe(0);
  });

  it('勾选订单结算：标记已结算并移出活水（关联结算不重复进公式）', async () => {
    const rec = await R().addSettlement('r2', { direction: 'them2us', currency: 'cny', amount: 180, date: '2026-10-14', note: '结清', entryIds: ['e8'] });
    expect(rec.entryIds).toEqual(['e8']);
    const r2 = aoi.state.data.reservoirs[1];
    const e8 = r2.entries.find((x) => x.id === 'e8');
    expect(e8.settledAt).toBe('2026-10-14');
    expect(e8.settlementId).toBe(rec.id);
    const s = R().computeSummary(r2, aoi.state.data.orders);
    expect(s.ccys.cny.b).toBe(0);
    expect(s.ccys.cny.settledB).toBe(180);
    expect(s.refNet.net).toBe(84.8); // 只剩韩元 16000×0.0053
  });

  it('删除关联结算 → 自动取消标记，金额回到活水', async () => {
    const rec = await R().addSettlement('r2', { direction: 'them2us', currency: 'cny', amount: 180, date: '2026-10-14', note: '结清', entryIds: ['e8'] });
    await R().removeSettlement('r2', rec.id);
    const r2 = aoi.state.data.reservoirs[1];
    expect(r2.entries.find((x) => x.id === 'e8').settledAt).toBeUndefined();
    const s = R().computeSummary(r2, aoi.state.data.orders);
    expect(s.ccys.cny.b).toBe(180);
  });

  it('已结算条目锁定：改侧/移除无效', async () => {
    await R().addSettlement('r2', { direction: 'them2us', currency: 'cny', amount: 180, date: '2026-10-14', note: '结清', entryIds: ['e8'] });
    expect(await R().moveEntry('r2', 'e8')).toBeNull();
    await R().removeEntry('r2', 'e8');
    expect(aoi.state.data.reservoirs[1].entries.length).toBe(2);
  });

  it('金额非法（≤0/缺失）被拒绝', async () => {
    expect(await R().addSettlement('r2', { direction: 'them2us', currency: 'cny', amount: 0 })).toBeNull();
    expect(await R().addSettlement('r2', { direction: 'them2us', currency: 'cny', amount: '' })).toBeNull();
    expect(aoi.state.data.reservoirs[1].settlements.length).toBe(0);
  });
});

describe('池管理', () => {
  it('删除池：确认后移除（订单保留），取消则保留', async () => {
    aoi.confirm = vi.fn(async () => true);
    await R().deletePool('r2');
    expect(aoi.state.data.reservoirs.length).toBe(1);
    expect(aoi.state.data.orders.length).toBe(10);
    aoi.confirm = vi.fn(async () => false);
    await R().deletePool('r1');
    expect(aoi.state.data.reservoirs.length).toBe(1);
  });

  it('改侧与移除即时生效（未结算条目）', async () => {
    await R().moveEntry('r1', 'e9'); // o9 侧B → 侧A
    let s = R().computeSummary(aoi.state.data.reservoirs[0], aoi.state.data.orders);
    expect(s.ccys.cny.a).toBe(220);
    expect(s.ccys.cny.b).toBe(316);
    aoi.confirm = vi.fn(async () => true); // 移除需确认，jsdom 打桩直过
    await R().removeEntry('r1', 'e4');
    s = R().computeSummary(aoi.state.data.reservoirs[0], aoi.state.data.orders);
    expect(s.ccys.jpy.a).toBe(8700);
    expect(s.missingRmb.length).toBe(0);
  });
});

describe('蓄水池弹层交互（回归：box 曾带 stopPropagation 吞掉 document 委托点击，创建/取消全失灵）', () => {
  it('新建蓄水池：点「创建」按钮经事件委托建池、关弹层、保存', async () => {
    R().modalNewPool();
    expect(doc.getElementById('reservoirModal').classList.contains('hidden')).toBe(false);
    doc.getElementById('resNpName').value = '测试池';
    doc.querySelector('[data-ract="pool-save"]').click();
    await new Promise((r) => setTimeout(r, 0)); // 等异步 createPool 落库
    const created = aoi.state.data.reservoirs.find((p) => p.name === '测试池');
    expect(created).toBeTruthy();
    expect(created.sideA).toContain('TA 帮我买');
    expect(aoi.saveTeamData).toHaveBeenCalledWith(aoi.state.data);
    expect(doc.getElementById('reservoirModal').classList.contains('hidden')).toBe(true);
  });

  it('点遮罩关闭弹层；点弹窗内部不关闭', () => {
    R().modalNewPool();
    doc.getElementById('reservoirModalBox').click();
    expect(doc.getElementById('reservoirModal').classList.contains('hidden')).toBe(false);
    doc.getElementById('reservoirModal').click();
    expect(doc.getElementById('reservoirModal').classList.contains('hidden')).toBe(true);
  });

  it('取消按钮（modal-close）关闭弹层', () => {
    R().modalNewPool();
    doc.querySelector('[data-ract="modal-close"]').click();
    expect(doc.getElementById('reservoirModal').classList.contains('hidden')).toBe(true);
  });
});
