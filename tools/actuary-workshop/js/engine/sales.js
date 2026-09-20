/* =====================================================================
 * 精算工坊 · js/engine/sales.js（第四阶段「上架销售」引擎，GDD-stage4 §16.2）
 * 确定性纯逻辑，不碰 DOM。挂载 AW.salesEngine：
 *   buildSale(publication)        → sale 对象（16.3 状态结构）
 *   canList(publication, sales)   → 重复闸门（listed/in-progress）
 *   channelQs()                   → 渠道三选项（含资格卡数据引用）
 *   answerChannel(sale, idx)      → {ok,fee,prestige,forced}  ltc×net 强制改个险
 *   commissionQs(pid)             → 三方案（C 按 pid 分流文案）
 *   answerCommission(sale, idx)   → {ok,fee,prestige,forced}  C 陷阱强制改 A
 *   materialItems(pid, channel)   → [{key,name,attr:'req'|'na'|'trap'|'noise',note}]
 *   requiredMaterials(pid,channel)/reviewMaterial(sale) → {ok,missing[],traps[],noise[]}
 *   hesDecision(channel,cfg) / talkDecision(pid) / decisionOk(dec,choiceId)
 *   launchSale(sale)              → {ok,fee,days} 扣启动费，状态→season，命中事件
 *   pickEvents(sale)              → [事件]（确定性：expose→inspect→complaint→特征→兜底）
 *   answerEvent(sale,eid,optIdx)  → {ok,fee,prestige} auto 事件自动结算
 *   traceQ(pid) / answerTrace(sale, idx) → {ok,fee,prestige}
 *   settle(sale)                  → {premium,commissionPaid,net,surrenders,confiscated}
 *   finalize(sale)                → 状态翻转＋档案号＋奖励（调 settle 先入账）
 *   canList / eventsAllDone / eventById / statusName / commissionRate
 * 判定全部确定性；短期险赔付率以定价引擎 lr<0.5 判定（与阶段三 R12 同口径）；
 * 没收账外金额＝首季保费（B 系数后）×8pp，随 e_inspect 扣减并计入罚没合计。
 * 引擎就地改 sale（status/fees/days/income/log.push），返回小结果对象；
 * 永不持久化、永不碰 HUD（扣费/声望由 UI 的 applyDelta 落账，同阶段三约定）。
 * ===================================================================== */
(function () {
  'use strict';
  var AW = (typeof window !== 'undefined') ? (window.AW = window.AW || {})
                                           : (globalThis.AW = globalThis.AW || {});
  var D = AW.salesData;

  function statusName(s) { return D.STATUS_TEXT[s] || s; }
  function isLong(pid) { return AW.getProduct(pid).type === 'long'; }
  function lrOf(sale) {
    try {
      var r = AW.pricing.price(sale.pid, sale.cfg || {});
      return r && r.lr != null ? r.lr : null;
    } catch (e) { return null; }
  }

  /* ---------- 销售立项 ---------- */
  function buildSale(publication) {
    return {
      id: 'SL' + String(Date.now()).slice(-8),
      pubId: publication.id, name: publication.name, pidName: publication.pidName,
      pid: publication.pid, route: publication.route,
      receiptNo: publication.receiptNo || '', regNo: publication.regNo || '',
      channel: null, channelWrong: false,
      commission: null, commissionWrong: false,
      materials: [], hesChoice: null, talkChoice: null,
      status: 'planning', events: [], trace: { picked: null, ok: null },
      fees: 0, days: 0, income: 0, commissionPaid: 0, penalties: 0,
      fileNo: null, lastReviewRefused: false,
      log: [{ t: '立项', text: '销售立项：' + publication.name + '（注册号 ' + (publication.regNo || '—') + '）', date: '2026-09' }],
      cfg: publication.cfg || AW.getDefaultCfg(publication.pid)
    };
  }

  /* ---------- 重复上架闸门 ---------- */
  function canList(publication, sales) {
    if (publication.status !== 'published') {
      return { ok: false, reason: 'not-published', text: '该产品尚未完成公示，不具备上市销售条件。' };
    }
    var i, s;
    for (i = 0; i < (sales || []).length; i++) {
      s = sales[i];
      if (s.pubId !== publication.id) continue;
      if (s.status === 'listed') return { ok: false, reason: 'listed', text: '本产品已上市销售——重复上架无意义。' };
      return { ok: false, reason: 'active', sale: s, text: '该产品销售办理中（' + statusName(s.status) + '），可继续办理。' };
    }
    return { ok: true };
  }

  /* ---------- P1·Q1 渠道布局 ---------- */
  function channelQs() { return D.CH_OPTIONS; }
  function answerChannel(sale, idx) {
    if (sale.channel) return { done: true };
    var keys = ['agent', 'bank', 'net'];
    var ch = keys[idx];
    if (!ch) return { invalid: true };
    if (sale.pid === 'ltc' && ch === 'net') {
      sale.channelWrong = true;
      sale.channel = 'agent';
      sale.fees += D.FEES.channelWrong.fee;
      sale.log.push({ t: '渠道', text: '互联网渠道违规：护理保险不在 108 号文网销白名单（健康险除护理），监管通报（−¥1,000、声望 −1），强制改选个险渠道', date: '2026-09' });
      return { ok: false, fee: D.FEES.channelWrong.fee, prestige: D.FEES.channelWrong.prestige, forced: true, channel: 'agent' };
    }
    sale.channel = ch;
    sale.days += D.FEES.layoutDays;
    sale.log.push({ t: '渠道', text: '主销渠道确定：' + D.CH_NAMES[ch] + '（渠道布局沟通 ' + D.FEES.layoutDays + ' 天）', date: '2026-09' });
    return { ok: true, channel: ch };
  }

  /* ---------- P1·Q2 佣金方案·报行合一 ---------- */
  function commissionQs(pid) { return D.commissionQs(pid); }
  function answerCommission(sale, idx) {
    if (sale.commission) return { done: true };
    var keys = ['A', 'B', 'C'];
    var plan = keys[idx];
    if (!plan) return { invalid: true };
    if (plan === 'B') {
      /* 账外加佣：当场放行（诱惑），首季 100% 触发飞行检查 */
      sale.commission = 'B';
      sale.log.push({ t: '渠道', text: '选定 B 账外加佣：账外返佣 8 个百分点——报行合一风险埋下（首季飞行检查必至）', date: '2026-09' });
      return { ok: true, plan: 'B', warned: true };
    }
    if (plan === 'C') {
      if (sale.pid === 'accident') {
        sale.commission = 'C';
        sale.log.push({ t: '渠道', text: '选定 C 说明制通道：佣金率上调至 40%（超短期个人费用率上限 5 个百分点），随附总经理书面说明报备', date: '2026-09' });
        return { ok: true, plan: 'C' };
      }
      sale.commissionWrong = true;
      sale.commission = 'A';
      sale.fees += D.FEES.commissionWrong.fee;
      sale.log.push({ t: '渠道', text: '「免报备特殊通道」不存在：佣金率上浮超备案上限即违规（−¥1,000、声望 −1），强制改回 A 严格报行', date: '2026-09' });
      return { ok: false, fee: D.FEES.commissionWrong.fee, prestige: D.FEES.commissionWrong.prestige, forced: true, plan: 'A' };
    }
    sale.commission = 'A';
    sale.log.push({ t: '渠道', text: '选定 A 严格报行：按备案佣金表执行（银保渠道同步报送费用结构）', date: '2026-09' });
    return { ok: true, plan: 'A' };
  }

  /* ---------- P2·B1 物料清单（attr 按险种×渠道判定） ---------- */
  function materialItems(pid, channel) {
    var long = isLong(pid);
    return D.MATERIALS.map(function (d) {
      var attr = 'req';
      if (d.key === 'quepei' && pid !== 'medical' && pid !== 'ci') attr = 'na';
      else if (d.trap) attr = 'trap';
      else if (d.noise) attr = 'noise';
      else if (d.key === 'brochure' && !long) attr = 'na';
      else if (d.key === 'double' && (!long || channel === 'net')) attr = 'na';
      return { key: d.key, name: d.name, attr: attr, note: d.note };
    });
  }
  function requiredMaterials(pid, channel) {
    return materialItems(pid, channel).filter(function (d) { return d.attr === 'req'; })
      .map(function (d) { return d.key; });
  }
  /* 老周审查：缺必备→拦截开播；陷阱→警告放行（后果在首季）；混淆→点评 */
  function reviewMaterial(sale) {
    var items = materialItems(sale.pid, sale.channel);
    var missing = [], traps = [], noise = [];
    items.forEach(function (d) {
      var on = sale.materials.indexOf(d.key) >= 0;
      if (d.attr === 'req' && !on) missing.push(d);
      if (d.attr === 'trap' && on) traps.push(d);
      if (d.attr === 'noise' && on) noise.push(d);
    });
    return { ok: missing.length === 0, missing: missing, traps: traps, noise: noise };
  }

  /* ---------- P2·B2 文案终审（D1 犹豫期 / D2 话术） ---------- */
  function hesDecision(channel, cfg) {
    var base = D.HESITATION[channel] || D.HESITATION.agent;
    var h = (cfg && cfg.hesitation != null && !isNaN(parseInt(cfg.hesitation, 10))) ? parseInt(cfg.hesitation, 10) : 15;
    var eff = Math.max(15, h);
    var okText;
    if (channel === 'agent') {
      okText = '按备案条款约定的犹豫期（' + h + ' 日）执行：期内解约全额退还保费、仅扣不超过 ¥10 成本费';
    } else if (channel === 'bank') {
      okText = '犹豫期按不短于 15 个自然日执行（本产品备案 ' + h + ' 日，执行口径 ' + eff + ' 日）：期内解约仅扣 ≤¥10 成本费';
    } else {
      okText = '犹豫期 15 日（不低于备案口径 ' + h + ' 日），并在销售页面显著展示犹豫期与退保规则；期内解约仅扣 ≤¥10 成本费';
    }
    var dec = { id: base.id, theme: base.theme, question: base.question, law: base.law, options: [] };
    base.options.forEach(function (o) {
      dec.options.push({ id: o.id, text: o.ok ? okText : o.text, ok: o.ok, trap: o.trap, why: o.why });
    });
    return dec;
  }
  function talkDecision(pid) {
    if (pid === 'medical' || pid === 'ci' || pid === 'accident' || pid === 'ltc') return D.TALKS[pid];
    return D.TALKS.savings;
  }
  function decisionOk(dec, choiceId) {
    if (choiceId == null || !dec) return { ok: false, reason: 'none', decision: dec };
    var opt = null;
    dec.options.forEach(function (o) { if (o.id === choiceId) opt = o; });
    if (!opt) return { ok: false, reason: 'none', decision: dec };
    if (opt.trap) return { ok: false, reason: 'trap', text: opt.why || '', option: opt, decision: dec };
    return { ok: true, option: opt, decision: dec };
  }

  /* ---------- 渠道开播（判定顺序：缺项拦截 → D1 拦截 → D2 拦截 → 开播） ---------- */
  function launchSale(sale) {
    if (sale.status === 'season' || sale.status === 'listed') {
      return { ok: false, locked: true, text: '本产品已开播。' };
    }
    var rev = reviewMaterial(sale);
    if (!rev.ok) {
      sale.lastReviewRefused = true;
      sale.log.push({ t: '物料', text: '合规审查打回：缺必备销售物料 ' + rev.missing.map(function (m) { return m.name; }).join('、'), date: '2026-09' });
      return { ok: false, reason: 'missing', review: rev };
    }
    sale.lastReviewRefused = false;
    var hm = decisionOk(hesDecision(sale.channel, sale.cfg), sale.hesChoice);
    if (!hm.ok && hm.reason === 'none') return { ok: false, reason: 'hes-none', hes: hm };
    if (!hm.ok) {
      sale.log.push({ t: '物料', text: '合规审查打回：犹豫期告知文案口径不合规', date: '2026-09' });
      return { ok: false, reason: 'hes', hes: hm };
    }
    var tm = decisionOk(talkDecision(sale.pid), sale.talkChoice);
    if (!tm.ok && tm.reason === 'none') return { ok: false, reason: 'talk-none', talk: tm };
    if (!tm.ok) {
      sale.log.push({ t: '物料', text: '合规审查打回：销售话术口径不合规', date: '2026-09' });
      return { ok: false, reason: 'talk', talk: tm };
    }
    sale.fees += D.FEES.launch.fee;
    sale.days += D.FEES.launch.days;
    sale.status = 'season';
    sale.events = pickEvents(sale);
    sale.log.push({ t: '物料', text: '渠道开播（销售启动费 ¥2,000）' + (rev.traps.length ? '——物料含陷阱项，首季风险已埋下' : '') + '，进入首季经营', date: '2026-09' });
    return { ok: true, fee: D.FEES.launch.fee, days: D.FEES.launch.days, review: rev, events: sale.events };
  }

  /* ---------- 首季事件命中（确定性：expose→inspect→complaint→特征→兜底） ---------- */
  function eventById(eid) {
    for (var i = 0; i < D.EVENTS.length; i++) if (D.EVENTS[i].id === eid) return D.EVENTS[i];
    return null;
  }
  function saleCtx(sale) {
    var trapCount = 0;
    materialItems(sale.pid, sale.channel).forEach(function (d) {
      if (d.attr === 'trap' && sale.materials.indexOf(d.key) >= 0) trapCount++;
    });
    return { isLong: isLong(sale.pid), lr: lrOf(sale), channel: sale.channel, commission: sale.commission, trapCount: trapCount };
  }
  function condHit(ev, sale, ctx) {
    try { return !!ev.cond(sale, ctx || saleCtx(sale)); } catch (e) { return false; }
  }
  function pickEvents(sale) {
    var ctx = saleCtx(sale);
    var picked = [];
    var expose = eventById('e_expose');
    if (expose && condHit(expose, sale, ctx)) picked.push({ eid: 'e_expose', auto: true, picked: null, ok: null });
    var inspect = eventById('e_inspect');
    if (inspect && condHit(inspect, sale, ctx)) picked.push({ eid: 'e_inspect', auto: true, picked: null, ok: null });
    picked.push({ eid: 'e_complaint', auto: false, picked: null, ok: null });
    var feats = ['e_surrender', 'e_rate', 'e_bank'];
    var feat = null, i, ev;
    for (i = 0; i < feats.length; i++) {
      ev = eventById(feats[i]);
      if (ev && condHit(ev, sale, ctx)) { feat = ev; break; }
    }
    var last = feat || eventById('e_fallback');
    if (last) picked.push({ eid: last.id, auto: false, picked: null, ok: null });
    return picked;
  }

  /* ---------- 事件应对（auto=自动整改/检查；答错=合规部补救） ---------- */
  function answerEvent(sale, eid, optIdx) {
    var slot = null, i;
    for (i = 0; i < sale.events.length; i++) if (sale.events[i].eid === eid) slot = sale.events[i];
    if (!slot || slot.ok != null) return { done: true };
    var ev = eventById(eid);
    if (!ev) return { invalid: true };
    sale.days += D.FEES.eventRound.days;
    if (ev.auto) {
      slot.ok = false;
      slot.autoSettled = true;
      if (eid === 'e_inspect') {
        var prem = settle(sale).premium;
        var conf = Math.round(prem * D.FEES.extraCommissionPP);
        var fine = D.FEES.inspect.fine;
        sale.fees += fine;
        sale.penalties += conf + fine;
        sale.days += D.FEES.inspect.days;
        sale.log.push({ t: '事件', text: '报行合一飞行检查：账外支付 8 个百分点被查实——没收账外金额 ¥' + conf.toLocaleString('zh-CN') + '、罚款 ¥' + fine.toLocaleString('zh-CN') + '（声望 −2、整改 +5 天）', date: '2026-09' });
        return { ok: false, auto: true, fee: conf + fine, confiscated: conf, fine: fine, prestige: D.FEES.inspect.prestige, event: ev };
      }
      sale.fees += D.FEES.expose.fee;
      sale.penalties += D.FEES.expose.fee;
      sale.log.push({ t: '事件', text: '消保通报与媒体曝光：违规物料限期整改并下架（¥3,000、声望 −2）', date: '2026-09' });
      return { ok: false, auto: true, fee: D.FEES.expose.fee, prestige: D.FEES.expose.prestige, event: ev };
    }
    var opt = ev.options[optIdx];
    if (!opt) return { invalid: true };
    slot.picked = optIdx;
    slot.ok = !!opt.ok;
    if (opt.ok) {
      sale.log.push({ t: '事件', text: '「' + ev.title + '」应对得当，客户与监管认可', date: '2026-09' });
      return { ok: true, prestige: D.FEES.eventRight.prestige, option: opt, event: ev };
    }
    sale.fees += D.FEES.eventWrong.fee;
    sale.log.push({ t: '事件', text: '「' + ev.title + '」应对失当，合规部接管补救（¥2,000、声望 −1）', date: '2026-09' });
    return { ok: false, fee: D.FEES.eventWrong.fee, prestige: D.FEES.eventWrong.prestige, option: opt, event: ev };
  }
  function eventsAllDone(sale) {
    for (var i = 0; i < sale.events.length; i++) if (sale.events[i].ok == null) return false;
    return true;
  }

  /* ---------- 回溯报告决策（长期四项 / 短期两项） ---------- */
  function traceQ(pid) { return isLong(pid) ? D.TRACE_QS.long : D.TRACE_QS.short; }
  function answerTrace(sale, idx) {
    if (sale.trace.ok != null) return { done: true };
    var q = traceQ(sale.pid);
    var opt = q.options[idx];
    if (!opt) return { invalid: true };
    sale.trace.picked = idx;
    sale.trace.ok = !!opt.ok;
    if (opt.ok) {
      sale.log.push({ t: '结算', text: '「' + q.theme + '」口径正确：' + opt.text, date: '2026-09' });
      return { ok: true, prestige: D.FEES.traceRight.prestige, option: opt, question: q };
    }
    sale.fees += D.FEES.traceWrong.fee;
    sale.log.push({ t: '结算', text: '「' + q.theme + '」口径错误（' + (opt.why || '') + '），已按 1275 号便函口径更正', date: '2026-09' });
    return { ok: false, fee: D.FEES.traceWrong.fee, prestige: D.FEES.traceWrong.prestige, option: opt, question: q };
  }

  /* ---------- 首季结算（演出数值表，GDD-stage4 §16.1） ---------- */
  function commissionRate(sale) {
    if (sale.commission === 'C') return 0.40;
    var base = D.CHANNEL_RATE[sale.channel] != null ? D.CHANNEL_RATE[sale.channel] : 0;
    if (sale.commission === 'B') base += D.FEES.extraCommissionPP;
    return base;
  }
  function settle(sale) {
    var base = D.BASE_PREMIUM[sale.pid] || 0;
    var premium = Math.round(base * (D.CHANNEL_COEFF[sale.channel] || 1) * (D.PLAN_COEFF[sale.commission] || 1));
    var commissionPaid = Math.round(premium * commissionRate(sale));
    var conf = sale.commission === 'B' ? Math.round(premium * D.FEES.extraCommissionPP) : 0;
    var net = premium - commissionPaid - (sale.penalties || 0);
    var surrenders = (isLong(sale.pid) && sale.channel !== 'net') ? 8 : (D.SURRENDER_MINI[sale.pid] != null ? D.SURRENDER_MINI[sale.pid] : 1);
    return { premium: premium, commissionPaid: commissionPaid, net: net, surrenders: surrenders, confiscated: conf };
  }

  /* ---------- 上市完成（每产品一次） ---------- */
  function finalize(sale) {
    var s = settle(sale);
    sale.income = s.premium;
    sale.commissionPaid = s.commissionPaid;
    sale.status = 'listed';
    sale.fileNo = 'SL-2026-' + String(1000 + Math.floor(Math.random() * 9000));
    sale.days += D.FEES.settleDays;
    sale.log.push({ t: '结算', text: '上市结算：首季保费 ¥' + s.premium.toLocaleString('zh-CN') + '、佣金支出 ¥' + s.commissionPaid.toLocaleString('zh-CN') + '、净现金流 ¥' + s.net.toLocaleString('zh-CN') + '，分配销售档案号 ' + sale.fileNo, date: '2026-09' });
    return { fileNo: sale.fileNo, prestige: D.FEES.finalize.prestige, settle: s };
  }

  AW.salesEngine = {
    statusName: statusName, isLong: isLong, lrOf: lrOf,
    buildSale: buildSale, canList: canList,
    channelQs: channelQs, answerChannel: answerChannel,
    commissionQs: commissionQs, answerCommission: answerCommission,
    materialItems: materialItems, requiredMaterials: requiredMaterials,
    reviewMaterial: reviewMaterial,
    hesDecision: hesDecision, talkDecision: talkDecision, decisionOk: decisionOk,
    launchSale: launchSale, pickEvents: pickEvents, eventById: eventById,
    answerEvent: answerEvent, eventsAllDone: eventsAllDone,
    traceQ: traceQ, answerTrace: answerTrace,
    commissionRate: commissionRate, settle: settle, finalize: finalize
  };
})();
