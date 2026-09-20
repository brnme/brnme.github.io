/* =====================================================================
 * 精算工坊 · js/engine/renewal.js（第六阶段「续期经营季」引擎，GDD-stage6 §18.2）
 * 挂载 AW.renewalEngine：buildRenewal / canEnter / reportStep / rateStep /
 * settle2（第二季续期模型）/ pickEvents / answerEvent / finalize。
 * 口径：只算不落账（预算/声望由 UI 执行，同 claims 惯例）；events 挂运行时
 * 属性不进 JSON——刷新后按确定性规则重生成（§18.7，同 §17.7-6②）。
 * 第二季模型（演出值【低】）：medical r2 = base×(1+涨幅)×续保率，lr2 = 实际lr×
 * 逆选择因子；其他险种 r2 = base×(1−lapse 12%)，lr2 = 实际lr；净 = r2−赔款−
 * 续期费用12%。实际lr 用 claimsEngine.lrOf 全局口径（§18.7 声明）。
 * ===================================================================== */
(function () {
  'use strict';
  var AW = (typeof window !== 'undefined') ? (window.AW = window.AW || {})
                                           : (globalThis.AW = globalThis.AW || {});
  var D = null;
  function d() { if (!D) D = AW.renewalData; return D; }

  function statusName(s) { return (d().STATUS_TEXT[s] || s); }
  function tierById(id) {
    var ts = d().RATE_TIERS, i;
    for (i = 0; i < ts.length; i++) if (ts[i].id === id) return ts[i];
    return null;
  }
  function subjectById(id) {
    var ss = d().SUBJECTS, i;
    for (i = 0; i < ss.length; i++) if (ss[i].id === id) return ss[i];
    return null;
  }
  function rnd4() { return 1000 + Math.floor(Math.random() * 9000); }

  /* ---------- 已上市产品工具 ---------- */
  function listedOf(sales) { return (sales || []).filter(function (s) { return s.status === 'listed'; }); }
  function medicalOf(sales) {
    var ls = listedOf(sales), i;
    for (i = 0; i < ls.length; i++) if (ls[i].pid === 'medical') return ls[i];
    return null;
  }
  function isAdjustable(sale) {
    return !!(sale && sale.pid === 'medical' && sale.cfg && sale.cfg.renew === 'y20');
  }
  /* 意外险 50% 红线（演出简化 §18.7：意外险办法"平均赔付率<50%"以实际经营口径近似——
   * 意外险案件已结案且零给付（如职业误报正确拒赔）→ 视为该险种赔付率低于红线。
   * 教学点：拒赔正确 ≠ 定价合理——定价充足+零给付仍触发"须及时调价"让利义务。） */
  function accidentLowOf(sales, claims) {
    var has = false, ls = listedOf(sales), i;
    for (i = 0; i < ls.length; i++) if (ls[i].pid === 'accident') has = true;
    if (!has) return false;
    var deny = false;
    (claims || []).forEach(function (c) {
      if (c.pid === 'accident' && c.status === 'closed' && !(c.paid > 0)) deny = true;
    });
    return deny;
  }

  /* ---------- 入口三态（+理赔季未收官拦截） ---------- */
  function canEnter(sales, claims) {
    if (!listedOf(sales).length) return { ok: false, reason: 'no-listed' };
    var done = !!(claims && claims.length && (claims.done || claims[0].fileNo));
    if (!done) return { ok: false, reason: 'claims-open' };
    if (AW.state && AW.state.renewal && AW.state.renewal.status === 'done')
      return { ok: true, reason: 'done' };
    return { ok: true, reason: 'active' };
  }

  /* ---------- 立项 ---------- */
  function buildRenewal(sales, claims) {
    return {
      status: 'report',            /* report → rate → season → done */
      reportPicked: [], reportOk: null,
      ratePicked: null, rateOk: null, disc: false,
      backflowPicked: [],
      fileNo: '',
      log: [{ t: '立项', text: '理赔季结案（档案号 ' + ((claims && claims[0] && claims[0].fileNo) || '—') + '），进入续期经营季', date: '2026-09' }]
    };
  }

  /* ---------- P1 回溯报告（四必选科目 + 两陷阱） ---------- */
  function reportStep(r, picked) {
    var mustMiss = [], trapHit = [], ss = d().SUBJECTS;
    ss.forEach(function (s) {
      var on = picked.indexOf(s.id) >= 0;
      if (s.must && !on) mustMiss.push(s.name);
      if (s.trap && on) trapHit.push(s.name);
    });
    if (mustMiss.length || trapHit.length) {
      var why = [];
      if (mustMiss.length) why.push('缺少必选科目：' + mustMiss.join('、'));
      if (trapHit.length) why.push('陷阱项：' + trapHit.join('、'));
      return { ok: false, why: why.join('；') + '（1275号：>1年产品四科目齐回溯，停售不豁免）' };
    }
    return { ok: true };
  }

  /* ---------- P2 调价（正解区间 §18.1；合法档全放行，aggr 合法但非正解） ---------- */
  function correctTierOf(lra) {
    if (lra == null) return 'hold';
    if (lra <= 0.70) return 'hold';
    if (lra <= 0.85) return 'mild';
    return 'full';
  }
  function rateStep(r, tierId, disc, lra) {
    var tier = tierById(tierId);
    if (!tier) return { ok: false, why: '未选择调价档位' };
    r.ratePicked = tierId;
    r.disc = !!disc;
    r.rateOk = (tierId === correctTierOf(lra));
    var warn = null;
    if (!tier.cap) warn = '突破单次调整上限（演出值 +' + Math.round(d().CAP_RATE * 100) + '%）——监管风险与退保潮';
    if (disc) warn = (warn ? warn + '；' : '') + '差别化执行违反费率调整通知红线';
    return { ok: true, tier: tier, correct: r.rateOk, warn: warn };
  }

  /* ---------- P3 第二季续期模型 ---------- */
  function loyaltyBonusOf(r) {
    var evs = r.events || [], i;
    for (i = 0; i < evs.length; i++) {
      if (evs[i].eid === 'e_r_loyalty' && evs[i].ok) return d().FEES.loyaltyBonus.keepBonus;
    }
    return 0;
  }
  function settle2(sales, claims, r) {
    var l = AW.claimsEngine.lrOf(sales, claims);
    var tier = r.ratePicked ? tierById(r.ratePicked) : null;
    var keepBonus = loyaltyBonusOf(r);
    var per = [];
    listedOf(sales).forEach(function (s) {
      var base = 0;
      try { base = AW.salesEngine.settle(s).premium; } catch (e) { base = 0; }
      var isMed = s.pid === 'medical' && tier;
      var mult = isMed ? (1 + tier.rate) * (tier.keep + keepBonus) : (1 - d().LAPSE);
      var lr2 = (l.actual != null && isMed) ? Math.min(1, l.actual * tier.adverse) : (l.actual || 0);
      var r2 = Math.round(base * mult);
      var claims2 = Math.round(r2 * lr2);
      var fee2 = Math.round(r2 * d().RENEW_EXP);
      per.push({ pid: s.pid, name: s.name, base: base, mult: mult, r2: r2, lr2: lr2,
        claims2: claims2, fee2: fee2, net2: r2 - claims2 - fee2, medical: !!isMed });
    });
    var t = { r2: 0, claims2: 0, fee2: 0, net2: 0 };
    per.forEach(function (p) { t.r2 += p.r2; t.claims2 += p.claims2; t.fee2 += p.fee2; t.net2 += p.net2; });
    t.lr2 = t.r2 > 0 ? t.claims2 / t.r2 : null;
    return { per: per, total: t, base: l };
  }

  /* ---------- 事件池（确定性命中） ---------- */
  function eventById(eid) {
    var evs = d().EVENTS, i;
    for (i = 0; i < evs.length; i++) if (evs[i].id === eid) return evs[i];
    return null;
  }
  function pickEvents(sales, claims, r) {
    var l = AW.claimsEngine.lrOf(sales, claims);
    var m = {
      lra: l.actual, tier: r.ratePicked, disc: !!r.disc,
      accidentLow: accidentLowOf(sales, claims), medicalListed: !!medicalOf(sales)
    };
    var picked = [];
    var order = ['e_r_disc', 'e_r_spiral', 'e_r_accident', 'e_r_loyalty'];
    for (var i = 0; i < order.length; i++) {
      var ev = eventById(order[i]);
      var hit = false;
      try { hit = ev ? !!ev.cond(m) : false; } catch (e) { hit = false; }
      if (hit) picked.push({ eid: order[i], picked: null, ok: null });
    }
    if (!picked.length) picked.push({ eid: 'e_r_none', picked: null, ok: null });
    r.events = picked;
    return picked;
  }
  function answerEvent(r, eid, optIdx) {
    var slot = null, i, evs = r.events || [];
    for (i = 0; i < evs.length; i++) if (evs[i].eid === eid) slot = evs[i];
    if (!slot || slot.ok != null) return { done: true };
    var ev = eventById(eid);
    if (!ev) return { invalid: true };
    var opt = ev.options[optIdx];
    if (!opt) return { invalid: true };
    slot.picked = optIdx;
    slot.ok = !!opt.ok;
    /* 差别化调价：无论答对与否，违规事实已成立，罚（教学：答题不能洗白违规） */
    if (eid === 'e_r_disc') {
      var dp = d().FEES.discPenalty;
      return { ok: !!opt.ok, fee: dp.fee, prestige: dp.prestige + (opt.ok ? d().FEES.eventRight.prestige : d().FEES.eventWrong.prestige), option: opt, event: ev };
    }
    if (opt.ok) return { ok: true, prestige: d().FEES.eventRight.prestige, option: opt, event: ev };
    return { ok: false, fee: d().FEES.eventWrong.fee, prestige: d().FEES.eventWrong.prestige, option: opt, event: ev };
  }
  function eventsOf(r) { return r.events || []; }

  /* ---------- 收官（只算不落账；落账由 UI doFinalize 执行） ---------- */
  function backflowDone(r) {
    return d().BACKFLOW.every(function (b) { return r.backflowPicked.indexOf(b.id) >= 0; });
  }
  function finalize(r, sales, claims) {
    var s2 = settle2(sales, claims, r);
    r.fileNo = 'RN-2026-' + rnd4();
    r.status = 'done';
    var backflowAll = backflowDone(r);
    r.log.push({ t: '收官', text: '第二季结算：续期保费 ¥' + s2.total.r2.toLocaleString('zh-CN') +
      '、赔款 ¥' + s2.total.claims2.toLocaleString('zh-CN') + '、续期费用 ¥' + s2.total.fee2.toLocaleString('zh-CN') +
      '、净现金流 ¥' + s2.total.net2.toLocaleString('zh-CN') + '，续期档案号 ' + r.fileNo +
      (backflowAll ? '；假设回流三项全勾' : ''), date: '2026-09' });
    return {
      fileNo: r.fileNo, settle: s2, backflowAll: backflowAll,
      prestige: d().FEES.finalize.prestige + (backflowAll ? d().FEES.backflowAll.prestige : 0)
    };
  }

  AW.renewalEngine = {
    statusName: statusName, tierById: tierById, subjectById: subjectById,
    listedOf: listedOf, medicalOf: medicalOf, isAdjustable: isAdjustable,
    accidentLowOf: accidentLowOf, canEnter: canEnter, buildRenewal: buildRenewal,
    reportStep: reportStep, correctTierOf: correctTierOf, rateStep: rateStep,
    settle2: settle2, pickEvents: pickEvents, answerEvent: answerEvent,
    eventsOf: eventsOf, backflowDone: backflowDone, finalize: finalize
  };
})();
