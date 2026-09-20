/* =====================================================================
 * 精算工坊 · js/engine/claims.js（第五阶段「出险勘察 + 理赔结算」引擎，GDD-stage5 §17.2）
 * 确定性纯逻辑，不碰 DOM。挂载 AW.claimsEngine：
 *   buildClaims(sales)          → 10 案队列（按 listed 产品派生 saleId；无上市险种 → grayed 灰卡注记，
 *                                 灰卡=教学提示不可办理（canOperate 守卫三步，GDD §17.7-5 非真实业务逻辑），
 *                                 claim.id='cl-01'…）
 *   caseById(key) / cases(sales) → 案件模板 / 模板×上市状态注记
 *   canOperate(claim)           → 灰卡守卫：未上市险种无在保保单，三步均 {ok:false, why:'…未上市…'}
 *   docOptions(caseTpl)         → 单证三选（C 按 case.small 判定 ok/trap）
 *   docStep(claim, idx)         → {ok,day,complaintRisk,evidenceLost?,why}   B 陷阱 +7日&投诉+1；C 大额=证据失效
 *   surveyTiers()               → 勘察三档
 *   surveyStep(claim, tierId)   → {ok,day,cost,evidence,why}  该深不深→证据不足；不该深→成本浪费
 *   adjustOptions(caseTpl, claim) → {options:四选, reasons:该案拒赔理由二级}
 *   adjustStep(claim, adjIdx, reasonIdx) → {ok,paid,outcome,prestige?,why}
 *                                 outcome∈pay/partial/deny/gratia/overpay/deny_bad
 *                                 （c_conceal 拒赔但 evidence=false → deny_bad 败诉：
 *                                   补付+利息 4,500+诉讼费 12,000+投诉 2）
 *   closeCase(claim)            → 时限结算：day>30 → {late:true,interest,complaintRisk+1}，
 *                                 interest=paid×1.5%×⌈(day−30)/30⌉
 *   metrics(claims)             → {paid,denied,closed,avgDay,complaints,overpay,lawsuits,
 *                                 gratiaCount,gratiaWrong,vague,denyRate}
 *   lrOf(sales, claims)         → {pool,paid,actual,assumed,gap}；保单池保费=Σsettle.premium×10，
 *                                 assumed=各 listed 产品 AW.pricing lr 均值（同 v4 lrOf 口径）
 *   pickEvents(claims, sales)   → 事件槽 [slot]（确定性：lawsuit→12378→complaint→revisit→audit→兜底e_none），
 *                                 存于 claims.events（数组属性）；回溯触发口径＝健康带 40%–70%（GDD §17.4：
 *                                 基准档 56.9% 不触发），gap 仅作展示
 *   eventById(eid) / answerEvent(claims, eid, optIdx) → {ok,fee?,prestige,option,event}（同 v4 事件口径）
 *   settle(claims)              → {netPaid, paid, cost, interest, penalty, gratia, metrics} 只算不落账
 *                                 penalty=空泛×3,000＋(投诉≥3?5,000)＋(通融滥用>2?2,000)
 *   finalize(claims)            → {fileNo:'CL-2026-XXXX', prestige, perfect, settle}（全对 +8、档案 +5）
 *   canEnter(sales[, claims])   → 三态闸门 {ok, reason:'no-listed'|'done'|'active'}
 * claim 结构（state.claims[] 单项，GDD §17.2）：{ id, caseKey, pid, saleId, docsDone, docsOk,
 *   surveyDone, survey, surveyOk*, evidence, docsEvidenceLost*, adjDone, adjIdx, reasonIdx, adjOk*,
 *   day, wrongSteps*, complaintRisk, status, paid, cost, interest, outcome, grayed?, lawsuit?, vague?,
 *   audit?, overpay?, late?, lateExpected? }（* 为实现用扩展字段）
 * 引擎就地改 claim（status/day/cost/paid/…），永不持久化、永不碰 HUD
 * （结算落账由 UI 的 applyDelta 执行，同阶段三/四约定）。事件应答槽挂 claims.events
 * 数组属性，JSON 持久化不含该属性（刷新后按确定性规则重新生成）。
 * ===================================================================== */
(function () {
  'use strict';
  var AW = (typeof window !== 'undefined') ? (window.AW = window.AW || {})
                                           : (globalThis.AW = globalThis.AW || {});
  var D = AW.claimsData;

  function statusName(s) { return D.STATUS_TEXT[s] || s; }
  function caseById(key) {
    for (var i = 0; i < D.CASES.length; i++) if (D.CASES[i].key === key) return D.CASES[i];
    return null;
  }
  function listedSaleOf(pid, sales) {
    var ss = sales || [];
    for (var i = 0; i < ss.length; i++) {
      if (ss[i].pid === pid && ss[i].status === 'listed') return ss[i];
    }
    return null;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- 案件队列派生 ---------- */
  function buildClaims(sales) {
    var arr = [];
    for (var i = 0; i < D.CASES.length; i++) {
      var c = D.CASES[i];
      var s = listedSaleOf(c.pid, sales);
      arr.push({
        id: 'cl-' + pad2(i + 1), caseKey: c.key, pid: c.pid, saleId: s ? s.id : null,
        docsDone: false, docsOk: false,
        surveyDone: false, survey: null, surveyOk: false, evidence: false, docsEvidenceLost: false,
        adjDone: false, adjIdx: null, reasonIdx: null, adjOk: false,
        day: c.backlog || 0, wrongSteps: 0, complaintRisk: 0,
        status: 'received', paid: 0, cost: 0, interest: 0, outcome: null,
        grayed: !s
      });
    }
    return arr;
  }
  function cases(sales) {
    return D.CASES.map(function (c) {
      var s = listedSaleOf(c.pid, sales);
      return { key: c.key, pid: c.pid, title: c.title, listed: !!s, sale: s || null };
    });
  }

  /* ---------- P1 · 单证审核（22 条一次性补料） ---------- */
  function docOptions(caseTpl) {
    return D.DOC_CHOICES.map(function (o) {
      var ok = o.id === 'A' || (o.id === 'C' && !!caseTpl.small);
      return { id: o.id, name: o.name, text: o.text, day: o.day, ok: ok, trap: !ok,
        complaintRisk: o.complaintRisk || 0, why: o.why };
    });
  }
  /* ---------- 灰卡守卫（未上市险种无在保保单，三步不可办理，GDD §17.7-5） ---------- */
  function canOperate(claim) { return !claim.grayed; }
  function docStep(claim, idx) {
    if (!canOperate(claim)) return { ok: false, why: '该险种未上市，无在保保单' };
    if (claim.docsDone) return { done: true };
    var c = caseById(claim.caseKey);
    if (!c) return { invalid: true };
    var o = docOptions(c)[idx];
    if (!o) return { invalid: true };
    claim.docsDone = true;
    claim.docsOk = !!o.ok;
    claim.day += o.day;
    claim.complaintRisk += (o.complaintRisk || 0);
    var res = { ok: claim.docsOk, day: o.day, complaintRisk: o.complaintRisk || 0, why: o.why };
    if (!claim.docsOk) {
      claim.wrongSteps += 1;
      claim.day += D.FEES.wrongDay;
      if (o.id === 'C') {
        claim.docsEvidenceLost = true;
        claim.evidence = false;
        res.evidenceLost = true;
      }
    }
    return res;
  }

  /* ---------- P1 · 勘察决策（三档；该深不深→证据不足） ---------- */
  function surveyTiers() { return D.TIERS; }
  function tierRank(id) { return id === 'fast' ? 0 : (id === 'standard' ? 1 : 2); }
  function surveyStep(claim, tierId) {
    if (!canOperate(claim)) return { ok: false, why: '该险种未上市，无在保保单' };
    if (claim.surveyDone) return { done: true };
    var t = null;
    for (var i = 0; i < D.TIERS.length; i++) if (D.TIERS[i].id === tierId) t = D.TIERS[i];
    if (!t) return { invalid: true };
    var c = caseById(claim.caseKey);
    if (!c) return { invalid: true };
    claim.surveyDone = true;
    claim.survey = t.id;
    claim.day += t.day;
    claim.cost += t.cost;
    var enough = tierRank(t.id) >= tierRank(c.truth.tier);
    claim.evidence = enough && !claim.docsEvidenceLost;
    claim.surveyOk = t.id === c.truth.tier;
    var ok = claim.surveyOk;
    if (!ok) {
      claim.wrongSteps += 1;
      claim.day += D.FEES.wrongDay;
    }
    var why;
    if (ok) why = '勘察档位与案情匹配，证据链完整。';
    else if (tierRank(t.id) < tierRank(c.truth.tier)) why = '该深不深：证据不足，拒赔选项转为高风险（败诉）。';
    else why = '不该深而深：调查成本与核定时限双重浪费。';
    if (claim.docsEvidenceLost) why += '（单证阶段免原件受理，证据链已失效）';
    return { ok: ok, day: t.day, cost: t.cost, evidence: claim.evidence, why: why };
  }

  /* ---------- P2 · 核定与给付（四选 + 拒赔理由二级） ---------- */
  function reasonsFor(key) { return D.DENY_REASONS[key] || D.DENY_REASONS.generic; }
  function adjustOptions(caseTpl, claim) {
    return { options: D.ADJUSTS, reasons: reasonsFor(caseTpl.key) };
  }
  function adjustStep(claim, adjIdx, reasonIdx) {
    if (!canOperate(claim)) return { ok: false, why: '该险种未上市，无在保保单' };
    if (claim.adjDone) return { done: true };
    var c = caseById(claim.caseKey);
    if (!c || !claim.surveyDone) return { invalid: true };
    var adj = D.ADJUSTS[adjIdx];
    if (!adj) return { invalid: true };
    var truth = c.truth, A = c.amounts;
    claim.adjDone = true;
    claim.adjIdx = adjIdx;
    claim.reasonIdx = adj.id === 'deny' ? reasonIdx : null;
    var outcome = null, paid = 0, ok = false, why = '', rkind = null;
    if (adj.id === 'deny') {
      var rs = reasonsFor(c.key);
      var r = (reasonIdx != null) ? rs[reasonIdx] : null;
      rkind = r ? r.kind : 'vague';
    }
    if (adj.id === 'pay') {
      paid = A.full;
      outcome = (truth.outcome === 'pay') ? 'pay' : 'overpay';
      ok = truth.outcome === 'pay';
    } else if (adj.id === 'partial') {
      paid = A.partial;
      if (truth.outcome === 'partial') { outcome = 'partial'; ok = true; }
      else if (truth.outcome === 'pay') { outcome = 'partial'; ok = false; }   /* 少赔 */
      else { outcome = 'overpay'; ok = false; }                                 /* 半额滥赔 */
    } else if (adj.id === 'deny') {
      paid = 0;
      if (truth.outcome === 'deny') {
        if (rkind === 'wrong') outcome = 'deny_bad';                            /* 条款错配→败诉 */
        else if (!claim.evidence) outcome = 'deny_bad';                         /* 证据不足→败诉 */
        else if (rkind === 'vague') outcome = 'deny';                           /* 空泛→通报 */
        else { outcome = 'deny'; ok = true; }
      } else {
        if (rkind === 'wrong') outcome = 'deny_bad';
        else { outcome = 'deny'; ok = false; }                                  /* 错误拒赔（非败诉） */
      }
    } else if (adj.id === 'gratia') {
      outcome = 'gratia';
      ok = truth.outcome === 'gratia';
      paid = ok ? c.benefit.value : A.full;                                     /* 滥用＝给付照付 */
    }
    claim.paid = paid;
    claim.outcome = outcome;
    claim.adjOk = ok;
    claim.status = 'adjusted';
    /* 后果落账（费用/投诉/罚时进 claim；声望由 UI 按 res.prestige 落账） */
    if (outcome === 'deny_bad') {
      paid = A.full;                                         /* 败诉补付全额 */
      claim.paid = paid;
      claim.cost += D.FEES.lawsuit.cost;                     /* 诉讼费 12,000 */
      claim.interest += Math.round(paid * D.FEES.late.rate); /* 败诉利息 1 个月演出值 */
      claim.complaintRisk += 2;
      claim.lawsuit = true;
      why = '错误拒赔败诉：补付 ' + paid.toLocaleString('zh-CN') + '、利息、诉讼费 ¥12,000、投诉 +2。';
    } else {
      if (!ok) {
        claim.wrongSteps += 1;
        claim.day += D.FEES.wrongDay;
      }
      if (outcome === 'deny' && rkind === 'vague') {
        claim.vague = true;
        claim.complaintRisk += 2;
        why = '空泛理由拒赔：通报批评 ¥3,000、声望 −2、投诉 +2（settle 罚款另计）。';
      } else if (outcome === 'gratia' && !ok) {
        claim.audit = true;
        why = '通融滥用：给付照付 + 审计风险（通融件数>2 触发审计事件）。';
      } else if (outcome === 'overpay') {
        claim.overpay = true;
        why = '超责给付（滥赔）：赔付率失真，回溯定价会找到你。';
      } else if (outcome === 'partial' && !ok) {
        claim.complaintRisk += 1;
        why = '应赔未足额给付：少赔滋生投诉，获赔率下降。';
      } else if (ok && truth.gratia) {
        why = '通融给付合规三要件齐备：分账列支、负责人审批、金额设锚。';
      } else {
        why = truth.path;
      }
    }
    var res = { ok: ok, paid: paid, outcome: outcome, why: why };
    if (outcome === 'deny' && rkind === 'vague') res.prestige = D.FEES.notice.rep;      /* 空泛：声望 −2（UI 落账） */
    if (c.gratia && outcome === 'deny') {                                               /* c_exgratia 选拒赔 */
      claim.complaintRisk += 1;
      res.prestige = (res.prestige || 0) - 2;
      res.gratiaDenied = true;
    }
    return res;
  }

  /* ---------- P2 · 时限链结算（23 条逾期利息） ---------- */
  function closeCase(claim) {
    if (claim.status === 'closed') return { done: true };
    var c = caseById(claim.caseKey);
    if (!c) return { invalid: true };
    claim.status = 'closed';
    var res = { day: claim.day };
    if (claim.day > 30) {
      var months = Math.ceil((claim.day - 30) / 30);
      var interest = Math.round((claim.paid || 0) * D.FEES.late.rate * months);
      claim.interest += interest;
      claim.late = true;
      claim.lateExpected = !!c.truth.late;
      claim.complaintRisk += 1;
      res.late = true;
      res.interest = interest;
    }
    return res;
  }

  /* ---------- P3 · 服务评价与结算 ---------- */
  function metrics(claims) {
    var paid = 0, denied = 0, closed = 0, daySum = 0, complaints = 0,
        overpay = 0, lawsuits = 0, gratiaCount = 0, gratiaWrong = 0, vague = 0;
    (claims || []).forEach(function (cl) {
      complaints += cl.complaintRisk || 0;
      if (cl.status === 'closed') {
        closed += 1;
        daySum += cl.day;
        paid += cl.paid || 0;
      }
      if (cl.outcome === 'deny' || cl.outcome === 'deny_bad') denied += 1;
      if (cl.outcome === 'overpay') overpay += 1;
      if (cl.outcome === 'deny_bad') lawsuits += 1;
      if (cl.outcome === 'gratia') { gratiaCount += 1; if (cl.audit) gratiaWrong += 1; }
      if (cl.vague) vague += 1;
    });
    return {
      paid: paid, denied: denied, closed: closed,
      avgDay: closed ? Math.round(daySum / closed) : 0,
      complaints: complaints, overpay: overpay, lawsuits: lawsuits,
      gratiaCount: gratiaCount, gratiaWrong: gratiaWrong, vague: vague,
      denyRate: closed ? denied / closed : 0
    };
  }
  function lrOf(sales, claims) {
    var pool = 0, lrSum = 0, lrN = 0;
    (sales || []).forEach(function (s) {
      if (s.status !== 'listed') return;
      var p = 0;
      try { p = AW.salesEngine.settle(s).premium; } catch (e) { p = s.income || 0; }
      pool += p * 10;                                   /* 保单池保费 = 首季保费 × 10（三年累积演出系数，GDD §17.4） */
      var r = null;
      try { r = AW.pricing.price(s.pid, s.cfg || {}); } catch (e2) { r = null; }
      if (r && r.lr != null) { lrSum += r.lr; lrN += 1; }
    });
    var m = metrics(claims);
    var actual = pool > 0 ? m.paid / pool : null;
    var assumed = lrN ? lrSum / lrN : null;
    return {
      pool: pool, paid: m.paid, actual: actual, assumed: assumed,
      gap: (actual != null && assumed != null) ? (actual - assumed) : null
    };
  }

  /* ---------- P3 · 事件池（确定性命中，同 v4 pickEvents 模式） ---------- */
  function eventById(eid) {
    for (var i = 0; i < D.EVENTS.length; i++) if (D.EVENTS[i].id === eid) return D.EVENTS[i];
    return null;
  }
  function pickEvents(claims, sales) {
    var m = metrics(claims);
    var l = lrOf(sales, claims);
    m.lra = l.actual; m.gap = l.gap; m.pool = l.pool;
    var picked = [];
    var order = ['e_lawsuit', 'e_12378', 'e_complaint', 'e_revisit', 'e_audit'];
    for (var i = 0; i < order.length; i++) {
      var ev = eventById(order[i]);
      var hit = false;
      try { hit = ev ? !!ev.cond(m) : false; } catch (e) { hit = false; }
      if (hit) picked.push({ eid: order[i], picked: null, ok: null });
    }
    if (!picked.length) picked.push({ eid: 'e_none', picked: null, ok: null });
    claims.events = picked;
    return picked;
  }
  function answerEvent(claims, eid, optIdx) {
    var slot = null, i, evs = claims.events || [];
    for (i = 0; i < evs.length; i++) if (evs[i].eid === eid) slot = evs[i];
    if (!slot || slot.ok != null) return { done: true };
    var ev = eventById(eid);
    if (!ev) return { invalid: true };
    var opt = ev.options[optIdx];
    if (!opt) return { invalid: true };
    slot.picked = optIdx;
    slot.ok = !!opt.ok;
    if (opt.ok) return { ok: true, prestige: D.FEES.eventRight.prestige, option: opt, event: ev };
    return { ok: false, fee: D.FEES.eventWrong.fee, prestige: D.FEES.eventWrong.prestige, option: opt, event: ev };
  }
  function eventsOf(claims) { return claims.events || []; }

  /* ---------- 结算与终局（只算不落账；落账由 UI 执行） ---------- */
  function settle(claims) {
    var m = metrics(claims);
    var cost = 0, interest = 0;
    (claims || []).forEach(function (cl) {
      cost += cl.cost || 0;
      interest += cl.interest || 0;
    });
    var penalty = m.vague * D.FEES.notice.fee +
      (m.complaints >= 3 ? D.FEES.talk.fee : 0) +
      (m.gratiaWrong > 2 ? D.FEES.audit.fee : 0);
    var netPaid = m.paid + cost + interest + penalty;
    return { netPaid: netPaid, paid: m.paid, cost: cost, interest: interest, penalty: penalty,
      gratia: m.gratiaCount, metrics: m };
  }
  function finalize(claims) {
    var s = settle(claims);
    var perfect = true;
    (claims || []).forEach(function (cl) {
      if (!(cl.docsOk && cl.surveyOk && cl.adjOk)) perfect = false;
      if (cl.late && !cl.lateExpected) perfect = false;
    });
    var prestige = D.FEES.finalize.rep + (perfect ? D.FEES.perfect.rep : 0);
    claims.fileNo = 'CL-2026-' + String(1000 + Math.floor(Math.random() * 9000));
    claims.done = true;
    return { fileNo: claims.fileNo, prestige: prestige, perfect: perfect, settle: s };
  }

  /* ---------- 入口闸门（三态，同 canList 模式） ---------- */
  function canEnter(sales, claims) {
    var ss = sales || [], i;
    for (i = 0; i < ss.length; i++) if (ss[i].status === 'listed') break;
    if (i >= ss.length) return { ok: false, reason: 'no-listed' };
    if (claims && claims.done) return { ok: true, reason: 'done' };
    return { ok: true, reason: 'active' };
  }

  AW.claimsEngine = {
    statusName: statusName, caseById: caseById, buildClaims: buildClaims, cases: cases,
    docOptions: docOptions, docStep: docStep,
    surveyTiers: surveyTiers, surveyStep: surveyStep,
    adjustOptions: adjustOptions, adjustStep: adjustStep,
    canOperate: canOperate,
    closeCase: closeCase, metrics: metrics, lrOf: lrOf,
    pickEvents: pickEvents, eventById: eventById, answerEvent: answerEvent, eventsOf: eventsOf,
    settle: settle, finalize: finalize, canEnter: canEnter
  };
})();
