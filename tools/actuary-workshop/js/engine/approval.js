/* =====================================================================
 * 精算工坊 · js/engine/approval.js（第三阶段「批复公示」引擎，GDD-stage3 §15.2）
 * 确定性纯逻辑，不碰 DOM。挂载 AW.approvalEngine：
 *   buildPublication(filing)          → publication 对象（15.3 状态结构）
 *   interpretQs(pid)                  → 批复解读三题（转发数据层）
 *   answerInterpret(pub,qid,optIdx)   → {ok,fee,prestige} 答错扣费强制修正
 *   interpretComplete(pub) / interpretAllRight(pub)
 *   disclosureItems(pid)              → [{key,name,attr:'req'|'na'|'trap'|'noise',note}]
 *   requiredDisclosure(pid)           → [keys]
 *   demoDecision(pid) / demoOk(pub)   → 说明书演示口径决策与判定
 *   reviewDisclosure(pub)             → {ok,missing[],traps[],noise[]} 老周审查
 *   launchDisclosure(pub)             → {ok,...} 扣运营费，状态→events，命中事件
 *   pickEvents(pub)                   → [事件]（确定性：audit→media→特征→兜底）
 *   answerEvent(pub,eid,optIdx)       → {ok,fee,prestige} auto 事件自动整改
 *   finalize(pub)                     → 状态翻转＋注册号＋奖励
 *   canPublish(filing,publications)   → 重复闸门
 * 判定全部确定性；短期险赔付率以定价引擎 lr<0.5 判定（与 R12 同口径）。
 * ===================================================================== */
(function () {
  'use strict';
  var AW = (typeof window !== 'undefined') ? (window.AW = window.AW || {})
                                           : (globalThis.AW = globalThis.AW || {});
  var D = AW.approvalData;

  function statusName(s) { return D.STATUS_TEXT[s] || s; }
  function isLong(pid) { return AW.getProduct(pid).type === 'long'; }
  function catOf(pid) { return D.CAT_OF[pid] || pid; }
  function lrOf(pub) {
    try {
      var r = AW.pricing.price(pub.pid, pub.cfg || {});
      return r && r.lr != null ? r.lr : null;
    } catch (e) { return null; }
  }

  /* ---------- P1 批复解读 ---------- */
  function interpretQs(pid) { return D.INTERPRET_QS(pid); }
  function qsById(pid) {
    var out = {}, qs = D.INTERPRET_QS(pid), i;
    for (i = 0; i < qs.length; i++) out[qs[i].id] = qs[i];
    return out;
  }
  function answerInterpret(pub, qid, optIdx) {
    var q = qsById(pub.pid)[qid];
    if (!q || pub.interpret.answers[qid] != null) return { done: true };
    var opt = q.options[optIdx];
    if (!opt) return { invalid: true };
    pub.interpret.answers[qid] = optIdx;
    if (opt.ok) {
      pub.log.push({ t: '解读', text: '「' + q.theme + '」判定正确', date: '2026-09' });
      var res = { ok: true };
      /* 三题全部完成且零错 → 一次性通过奖励 */
      if (interpretComplete(pub) && interpretAllRight(pub)) {
        pub.log.push({ t: '解读', text: '批复解读三题全对，一次性通过', date: '2026-09' });
        res.allOk = true;
        res.prestige = D.FEES.interpretAllOk.prestige;
      }
      return res;
    }
    pub.interpret.wrong.push(qid);
    pub.fees += D.FEES.interpretWrong.fee;
    pub.log.push({ t: '解读', text: '「' + q.theme + '」登记信息有误（' + (opt.why || '') + '），更正后通过', date: '2026-09' });
    return { ok: false, fee: D.FEES.interpretWrong.fee, prestige: D.FEES.interpretWrong.prestige, option: opt, question: q };
  }
  function interpretComplete(pub) {
    var qs = D.INTERPRET_QS(pub.pid), i;
    for (i = 0; i < qs.length; i++) if (pub.interpret.answers[qs[i].id] == null) return false;
    return true;
  }
  function interpretAllRight(pub) { return pub.interpret.wrong.length === 0; }

  /* ---------- P2 披露清单 ---------- */
  function disclosureItems(pid) {
    var long = isLong(pid);
    return D.DISCLOSURE.map(function (d) {
      var attr = 'req';
      if (d.trap) attr = 'trap';
      else if (d.noise) attr = 'noise';
      else if ((d.key === 'cv' || d.key === 'manual') && !long) attr = 'na';
      return { key: d.key, name: d.name, attr: attr, note: d.note };
    });
  }
  function requiredDisclosure(pid) {
    return disclosureItems(pid).filter(function (d) { return d.attr === 'req'; })
      .map(function (d) { return d.key; });
  }
  function demoDecision(pid) { return D.demoDecisionOf(pid); }
  function demoOk(pub) {
    var dec = demoDecision(pub.pid);
    if (pub.demoChoice == null) return { ok: false, reason: 'none', text: '尚未作选择' };
    var opt = null;
    dec.options.forEach(function (o) { if (o.id === pub.demoChoice) opt = o; });
    if (!opt) return { ok: false, reason: 'none', text: '选项无效' };
    if (opt.trap) return { ok: false, reason: 'trap', text: opt.why || '', option: opt, decision: dec };
    return { ok: true, decision: dec };
  }
  /* 老周审查：缺必备→拦截；陷阱→警告放行（后果在公示期）；混淆→点评 */
  function reviewDisclosure(pub) {
    var items = disclosureItems(pub.pid);
    var missing = [], traps = [], noise = [];
    items.forEach(function (d) {
      var on = pub.disclosure.indexOf(d.key) >= 0;
      if (d.attr === 'req' && !on) missing.push(d);
      if (d.attr === 'trap' && on) traps.push(d);
      if (d.attr === 'noise' && on) noise.push(d);
    });
    return { ok: missing.length === 0, missing: missing, traps: traps, noise: noise };
  }

  /* ---------- 披露上线（判定顺序：缺项拦截 → 演示口径拦截 → 上线） ---------- */
  function launchDisclosure(pub) {
    if (pub.status === 'published') return { ok: false, locked: true, text: '本产品已完成公示。' };
    var rev = reviewDisclosure(pub);
    if (!rev.ok) {
      pub.lastReviewRefused = true;
      pub.log.push({ t: '披露', text: '合规审查打回：缺必备披露项 ' + rev.missing.map(function (m) { return m.name; }).join('、'), date: '2026-09' });
      return { ok: false, reason: 'missing', review: rev };
    }
    pub.lastReviewRefused = false;
    var dm = demoOk(pub);
    if (!dm.ok && dm.reason !== 'none') {
      pub.log.push({ t: '披露', text: '合规审查打回：说明书演示口径不合规', date: '2026-09' });
      return { ok: false, reason: 'demo', demo: dm };
    }
    if (dm.reason === 'none') return { ok: false, reason: 'demo-none', demo: dm };
    pub.fees += D.FEES.disclosureLaunch.fee;
    pub.days += D.FEES.disclosureLaunch.days;
    pub.status = 'events';
    pub.events = pickEvents(pub);
    pub.log.push({ t: '披露', text: '官网披露上线（信息披露运营费 ¥2,000），进入公示期' + (rev.traps.length ? '（披露含报送类材料，存在被抽查风险）' : ''), date: '2026-09' });
    return { ok: true, fee: D.FEES.disclosureLaunch.fee, days: D.FEES.disclosureLaunch.days, review: rev, events: pub.events };
  }

  /* ---------- 公示期事件命中（确定性） ---------- */
  function eventById(eid) {
    for (var i = 0; i < D.EVENTS.length; i++) if (D.EVENTS[i].id === eid) return D.EVENTS[i];
    return null;
  }
  function condHit(ev, pub) {
    try {
      return !!ev.cond(pub.pid, pub.cfg || {}, { disclosure: pub.disclosure, lr: lrOf(pub) });
    } catch (e) { return false; }
  }
  function pickEvents(pub) {
    var picked = [];
    var audit = eventById('e_audit');
    if (audit && condHit(audit, pub)) picked.push({ eid: 'e_audit', auto: true, picked: null, ok: null });
    picked.push({ eid: 'e_media', auto: false, picked: null, ok: null });
    var feats = ['e_rate_cap', 'e_loss_ratio'];
    var feat = null;
    for (var i = 0; i < feats.length; i++) {
      var ev = eventById(feats[i]);
      if (ev && condHit(ev, pub)) { feat = ev; break; }
    }
    var last = feat || eventById('e_talk');
    if (last) picked.push({ eid: last.id, auto: false, picked: null, ok: null });
    return picked;
  }

  /* ---------- 事件应对（auto=监管抽查自动整改；答错=合规部补救） ---------- */
  function answerEvent(pub, eid, optIdx) {
    var slot = null, i;
    for (i = 0; i < pub.events.length; i++) if (pub.events[i].eid === eid) slot = pub.events[i];
    if (!slot || slot.ok != null) return { done: true };
    var ev = eventById(eid);
    if (!ev) return { invalid: true };
    pub.days += D.FEES.eventRound.days;
    if (ev.auto) {
      slot.ok = false;
      slot.autoSettled = true;
      pub.fees += D.FEES.auditPenalty.fee;
      pub.days += D.FEES.auditPenalty.days;
      pub.log.push({ t: '事件', text: '监管披露抽查：披露了报送类材料，限期整改（¥3,000、声望 −2）', date: '2026-09' });
      return { ok: false, auto: true, fee: D.FEES.auditPenalty.fee, prestige: D.FEES.auditPenalty.prestige, event: ev };
    }
    var opt = ev.options[optIdx];
    if (!opt) return { invalid: true };
    slot.picked = optIdx;
    slot.ok = !!opt.ok;
    if (opt.ok) {
      pub.log.push({ t: '事件', text: '「' + ev.title + '」应对得当，舆情平息', date: '2026-09' });
      return { ok: true, prestige: D.FEES.eventRight.prestige, option: opt, event: ev };
    }
    pub.fees += D.FEES.eventWrong.fee;
    pub.log.push({ t: '事件', text: '「' + ev.title + '」应对失当，合规部接管补救（¥2,000、声望 −1）', date: '2026-09' });
    return { ok: false, fee: D.FEES.eventWrong.fee, prestige: D.FEES.eventWrong.prestige, option: opt, event: ev };
  }
  function eventsAllDone(pub) {
    for (var i = 0; i < pub.events.length; i++) if (pub.events[i].ok == null) return false;
    return true;
  }

  /* ---------- 公示完成（每产品一次；此后衔接阶段四） ---------- */
  function finalize(pub) {
    pub.status = 'published';
    pub.regNo = 'REG-2026-' + String(1000 + Math.floor(Math.random() * 9000));
    pub.log.push({ t: '公示', text: '公示完成，注册登记号 ' + pub.regNo + '，产品具备上市销售条件', date: '2026-09' });
    return { prestige: D.FEES.finalize.prestige, regNo: pub.regNo };
  }

  /* ---------- 公示立项 ---------- */
  function buildPublication(filing) {
    return {
      id: 'PB' + String(Date.now()).slice(-8),
      filingId: filing.id, archId: filing.archId,
      name: filing.name, pidName: filing.pidName, pid: filing.pid,
      route: filing.route, receiptNo: filing.receiptNo || '',
      interpret: { answers: {}, wrong: [] },
      disclosure: [], demoChoice: null,
      status: 'reading', events: [],
      fees: 0, days: D.FEES.interpretDays, regNo: null,
      log: [{ t: '立项', text: '公示立项：' + filing.name + '（回执 ' + (filing.receiptNo || '—') + '）', date: '2026-09' }],
      cfg: filing.cfg || AW.getDefaultCfg(filing.pid)
    };
  }

  /* ---------- 重复公示闸门 ---------- */
  function canPublish(filing, publications) {
    var i, p;
    for (i = 0; i < publications.length; i++) {
      p = publications[i];
      if (p.filingId !== filing.id) continue;
      if (p.status === 'published') return { ok: false, reason: 'published', text: '本产品已完成公示并注册登记——重复公示无意义。' };
      return { ok: false, reason: 'active', pub: p, text: '该产品公示进行中（' + statusName(p.status) + '），可继续办理。' };
    }
    return { ok: true };
  }

  AW.approvalEngine = {
    statusName: statusName, isLong: isLong, catOf: catOf, lrOf: lrOf,
    interpretQs: interpretQs, answerInterpret: answerInterpret,
    interpretComplete: interpretComplete, interpretAllRight: interpretAllRight,
    disclosureItems: disclosureItems, requiredDisclosure: requiredDisclosure,
    demoDecision: demoDecision, demoOk: demoOk, reviewDisclosure: reviewDisclosure,
    launchDisclosure: launchDisclosure, pickEvents: pickEvents, eventById: eventById,
    answerEvent: answerEvent, eventsAllDone: eventsAllDone,
    finalize: finalize, buildPublication: buildPublication, canPublish: canPublish
  };
})();
