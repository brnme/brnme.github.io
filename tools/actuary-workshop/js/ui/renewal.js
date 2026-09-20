/* =====================================================================
 * 精算工坊 · js/ui/renewal.js（第六阶段「续期经营季」界面，GDD-stage6 §18.1 §18.5）
 * 挂载 AW.uiRenewal：render / renderP1 / renderP2 / renderP3 / ledgerTab /
 * openArchiveModal / doFinalize（落账，供测试/自动化）。
 * 四页签：① 经验回溯（分桶卡+偏差表+回溯报告）② 费率调价（通知红线+四档+差别化陷阱）
 * ③ 第二季结算（续期模型+事件池+假设回流+收官）④ 续期台账。
 * 结构复刻 ui/claims.js：deps() 延迟绑定、tab 局部变量 + render 重绘、
 * applyDelta/saveHud、事件答题模态（.event-go[data-eid] + #btn-rn-ev-done）、
 * 结果复盘模态（#btn-rn-done）。数值展示一律经引擎计算（reportStep/rateStep/
 * settle2/pickEvents/answerEvent/finalize），UI 层不自算续期公式。
 * 灰卡守卫（同 v5）：无已上市医疗险时 P2 渲染教学注记，不给调价操作。
 * ===================================================================== */
(function () {
  'use strict';
  var AW = (typeof window !== 'undefined') ? (window.AW = window.AW || {})
                                           : (globalThis.AW = globalThis.AW || {});
  var R = null, D = null, E = null, EC = null;   // render / renewalData / renewalEngine / claimsEngine

  var tab = 'p1';               // p1 | p2 | p3 | ledger

  function deps() {
    if (!R) R = AW.render;
    D = AW.renewalData; E = AW.renewalEngine; EC = AW.claimsEngine;
    return !!(R && D && E && EC);
  }
  function esc(s) { return R.esc(s); }
  function money(n) { return R.money(n); }
  function pct(n) { return R.pct(n); }
  function st() { return AW.state; }
  function rn() { return st().renewal; }
  function sales() { return st().sales || []; }
  function claims() { return st().claims || []; }
  function pidName(pid) {
    try { var p = AW.getProduct(pid); return p ? p.name : pid; } catch (e) { return pid; }
  }
  function applyDelta(d) {
    if (!d) return;
    if (d.fee) st().budget -= d.fee;
    if (d.prestige) st().prestige = Math.max(0, st().prestige + d.prestige);
  }
  function saveHud() { AW.main.save(); R.renderHUD(); }
  function badgeHTML(r) {
    return '<span class="f-badge sr-' + (r ? r.status : 'none') + '">' + esc(E.statusName(r ? r.status : '未立项')) + '</span>';
  }
  function eventsAllAnswered(r) {
    var evs = E.eventsOf(r), i;
    if (!evs.length) return false;
    for (i = 0; i < evs.length; i++) if (evs[i].ok == null) return false;
    return true;
  }

  /* ================= 主视图 ================= */
  function render() {
    if (!deps()) return;
    var root = document.getElementById('renewal');
    if (!root) return;
    var gate = E.canEnter(sales(), claims());
    if (!gate.ok) {
      root.innerHTML = '<h2 class="step-title">续期经营季</h2>' +
        '<div class="empty-hint">' + (gate.reason === 'no-listed'
          ? '还没有已上市产品。<br><br>先走完 设计→申报→公示→销售 四步，产品上市并完成理赔季后，这里将开启第二个保单年度。'
          : '理赔季尚未收官。<br><br>续期经营季以结案数据为输入——先在第五阶段完成全部案件的结算（档案号 CL-2026-XXXX）。') + '</div>';
      return;
    }
    if (!rn()) st().renewal = E.buildRenewal(sales(), claims());
    if (AW.main.checkMentorRenewal) AW.main.checkMentorRenewal('enter');
    if (AW.main.eventUnlock) AW.main.eventUnlock('renew_enter');
    var r = rn();
    if (r.status === 'report') tab = (tab === 'p2' || tab === 'p3') ? 'p1' : tab;
    if (r.status === 'rate' && tab === 'p3') tab = 'p2';
    var locked = function (k) {
      if (k === 'p2') return r.status === 'report';
      if (k === 'p3') return r.status === 'report' || r.status === 'rate';
      return false;
    };
    root.innerHTML =
      '<div class="ftabs">' +
      '<button class="ftab ' + (tab === 'p1' ? 'on' : '') + '" data-ftab="p1">① 经验回溯</button>' +
      '<button class="ftab ' + (tab === 'p2' ? 'on' : '') + (locked('p2') ? ' dis' : '') + '" data-ftab="p2"' + (locked('p2') ? ' disabled' : '') + '>② 费率调价</button>' +
      '<button class="ftab ' + (tab === 'p3' ? 'on' : '') + (locked('p3') ? ' dis' : '') + '" data-ftab="p3"' + (locked('p3') ? ' disabled' : '') + '>③ 第二季结算</button>' +
      '<button class="ftab ' + (tab === 'ledger' ? 'on' : '') + '" data-ftab="ledger">④ 续期台账</button>' +
      '</div>' + (r.fileNo ? '<div class="side-tip">续期档案号 <b>' + esc(r.fileNo) + '</b> ' + badgeHTML(r) + '</div>' : '');
    var host = document.createElement('div');
    host.className = 'rn-body';
    root.appendChild(host);
    if (tab === 'p1') renderP1(host);
    else if (tab === 'p2') renderP2(host);
    else if (tab === 'p3') renderP3(host);
    else renderLedger(host);
    wireTabs(root);
  }
  function wireTabs(root) {
    root.querySelectorAll('.ftab').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) { R.toast('先完成前一步——续期经营按 回溯→调价→结算 推进', 'warn'); return; }
        tab = b.getAttribute('data-ftab');
        render();
      });
    });
  }

  /* ================= P1 经验回溯 ================= */
  function bucketCardHTML() {
    var s = EC.settle(claims());
    var m = s.metrics;
    return '<div class="route-box"><h3 class="sub-title">🪣 经验分桶（回溯的输入）</h3>' +
      '<table class="sl-report">' +
      '<tr><th>责任赔款（合同给付）</th><td>' + money(s.paid) + '</td></tr>' +
      '<tr><th>通融赔款（分账列支）</th><td>' + money(gratiaPaidOf(claims())) + '</td></tr>' +
      '<tr><th>调查成本 + 逾期利息</th><td>' + money(s.cost + s.interest) + '</td></tr>' +
      '<tr><th>拒赔件数 / 通融件数</th><td>' + m.denied + ' 件 / ' + m.gratiaCount + ' 件</td></tr>' +
      '</table>' +
      '<div class="comp-row ok"><span class="comp-icon">✓</span><span class="comp-text">通融赔款按费用注记分账列支——不污染下一轮回溯的发生率经验（research 口径）。</span></div></div>';
  }
  function gratiaPaidOf(cs) {
    var t = 0;
    (cs || []).forEach(function (c) { if (c.outcome === 'gratia') t += (c.paid || 0); });
    return t;
  }
  function devTableHTML() {
    var l = EC.lrOf(sales(), claims());
    var rows = E.listedOf(sales()).map(function (s) {
      var lrAssumed;
      try { lrAssumed = AW.pricing.price(s.pid, s.cfg || AW.getDefaultCfg(s.pid)).lr; }
      catch (e) { lrAssumed = null; }
      return '<tr><td>' + esc(pidName(s.pid)) + '</td><td>' + (lrAssumed != null ? pct(lrAssumed) : '—') + '</td>' +
        '<td>' + (l.actual != null ? pct(l.actual) : '—') + '</td>' +
        '<td class="' + (l.gap != null && Math.abs(l.gap) > 0.10 ? 'bad-t' : '') + '">' + (l.gap != null ? (l.gap > 0 ? '+' : '') + pct(l.gap) : '—') + '</td></tr>';
    }).join('');
    return '<div class="route-box"><h3 class="sub-title">📉 偏差表（假设 vs 实现全局口径）</h3>' +
      '<table class="sl-report"><tr><th>险种</th><th>定价假设 lr</th><th>理赔季实际</th><th>偏差</th></tr>' + rows + '</table>' +
      '<p class="dim">健康带 40%–70%（同第五阶段 e_revisit 口径）；偏差表为回溯报告的证据附录。</p></div>';
  }
  function renderP1(host) {
    var r = rn();
    var html = '<h2 class="step-title">续期经营季 · P1 经验回溯</h2>' +
      '<p class="dim">总精算师陈砚：' + esc(D.CHEN.enter) + '</p>' +
      bucketCardHTML() + devTableHTML();
    html += '<div class="route-box"><h3 class="sub-title">📋《产品回溯报告》决策（1275号便函：>1年产品）</h3>' +
      '<p class="dim">银保监办便函〔2021〕1275 号：上市超过一年的产品，回溯哪些科目？（多选，四项必选）</p>';
    D.SUBJECTS.forEach(function (s) {
      var on = r.reportPicked.indexOf(s.id) >= 0;
      html += '<div class="opt-row ' + (on ? 'on' : '') + '" data-subj="' + s.id + '"><b>' + esc(s.name) + '</b>' +
        (s.must ? ' <span class="f-badge s-draft">必选</span>' : '') +
        '<span class="opt-note">' + esc(s.why) + '</span></div>';
    });
    html += '<div class="modal-actions"><button id="btn-rn-report" class="btn-submit">📤 报送回溯报告</button></div></div>';
    host.innerHTML = html;
    host.querySelectorAll('.opt-row[data-subj]').forEach(function (row) {
      row.addEventListener('click', function () {
        var id = row.getAttribute('data-subj');
        var i = r.reportPicked.indexOf(id);
        if (i >= 0) r.reportPicked.splice(i, 1); else r.reportPicked.push(id);
        render();
      });
    });
    var btn = host.querySelector('#btn-rn-report');
    if (btn) btn.addEventListener('click', doReport);
  }
  function doReport() {
    var r = rn();
    var res = E.reportStep(r, r.reportPicked);
    if (!res.ok) {
      applyDelta(D.FEES.reportWrong);
      saveHud();
      R.toast('回溯报告被打回：' + esc(res.why) + '（补正费 ¥' + D.FEES.reportWrong.fee.toLocaleString('zh-CN') + '）', 'bad');
      AW.main.checkMentorRenewal('report_bad');
      render();
      return;
    }
    r.reportOk = true;
    r.status = 'rate';
    r.log.push({ t: '回溯', text: '回溯报告四科目报送通过（责任赔款/费用率/退保率/投资收益率）', date: '2026-09' });
    saveHud();
    R.toast('回溯报告通过——进入费率调价决策', 'ok');
    if (AW.main.eventUnlock) { AW.main.eventUnlock('renew_report_ok'); AW.main.eventUnlock('renew_rate_enter'); }
    AW.main.checkMentorRenewal('rate_enter');
    tab = 'p2';
    render();
  }

  /* ================= P2 费率调价 ================= */
  function renderP2(host) {
    var r = rn();
    var med = E.medicalOf(sales());
    var adjustable = E.isAdjustable(med);
    var l = EC.lrOf(sales(), claims());
    var correct = E.correctTierOf(l.actual);
    var html = '<h2 class="step-title">续期经营季 · P2 费率调价</h2>' +
      '<p class="dim">总精算师陈砚：' + esc(D.CHEN.rateHold) + '</p>';
    html += '<div class="route-box"><h3 class="sub-title">⚖️ 费率调整通知四红线（〔2020-04〕）</h3>' +
      '<div class="law-box small"><b>长期医疗保险产品费率调整</b>' +
      '<div>· 首次调整不早于上市满 3 年（演出注记：理赔季=满三个保单年度，条件已满足）</div>' +
      '<div>· 调整间隔 ≥ 1 年 · 单次调整设上限（演出值 +' + Math.round(D.CAP_RATE * 100) + '%）</div>' +
      '<div>· 不得对单个被保险人差别化调整（按出险史/新老客户拆分执行均属违规）</div></div></div>';
    if (!med) {
      html += '<div class="route-box"><h3 class="sub-title">🔒 无已上市医疗险</h3>' +
        '<div class="empty-hint">费率可调通道仅适用于长期医疗险（名称含「（费率可调）」）。当前无已上市医疗险——本季无调价标的，直接进入第二季结算。</div></div>' +
        '<div class="modal-actions"><button id="btn-rn-rate" class="btn-submit">进入第二季结算 →</button></div>';
    } else if (!adjustable) {
      html += '<div class="route-box"><h3 class="sub-title">🔒 医疗险不适用费率可调通道</h3>' +
        '<div class="empty-hint">已上市医疗险为一年期非保证续保/保证续保6年——费率调整通知仅适用自然费率的长期医疗险（保证续保20年·费率可调）。一年期产品重定价走新产品报备流程。</div></div>' +
        '<div class="modal-actions"><button id="btn-rn-rate" class="btn-submit">进入第二季结算 →</button></div>';
    } else {
      html += '<div class="route-box"><h3 class="sub-title">🎚️ 调价档位（标的：' + esc(med.name) + ' · 实际赔付率 ' + (l.actual != null ? pct(l.actual) : '—') + '）</h3>';
      D.RATE_TIERS.forEach(function (t) {
        var on = r.ratePicked === t.id;
        html += '<div class="opt-row ' + (on ? 'on' : '') + '" data-tier="' + t.id + '"><b>' + esc(t.name) + '</b>' +
          (t.id === correct ? '' : '') +
          '<span class="opt-note">续保率 ' + Math.round(t.keep * 100) + '% · 逆选择因子 ×' + t.adverse.toFixed(2) +
          (t.cap ? '' : ' · ⚠ 突破单次上限') + ' — ' + esc(t.note) + '</span></div>';
      });
      var discOn = !!r.disc;
      html += '<div class="opt-row ' + (discOn ? 'on bad' : '') + '" data-disc="1"><b>只对新客户执行新费率，老客户维持原价</b>' +
        '<span class="opt-note">⚠ 差别化执行变体——费率调整通知红线（勾选将触发监管事件）</span></div>';
      html += '<div class="modal-actions"><button id="btn-rn-rate" class="btn-submit">⚖️ 提交调价决议</button></div></div>';
    }
    /* 其他险种教学行 */
    var others = E.listedOf(sales()).filter(function (s) { return s.pid !== 'medical'; });
    if (others.length) {
      html += '<div class="route-box"><h3 class="sub-title">🧊 其他已上市险种（不适用调价）</h3>' +
        others.map(function (s) {
          return '<div class="comp-row"><span class="comp-icon">·</span><span class="comp-text">' + esc(pidName(s.pid)) +
            '：' + (AW.salesEngine.isLong(s.pid) ? '均衡保费锁定——调价不可行，续期现金流按继续率滚动（教学：费差来源）' : '一年期产品——重定价走新产品流程') + '</span></div>';
        }).join('') + '</div>';
    }
    host.innerHTML = html;
    host.querySelectorAll('.opt-row[data-tier]').forEach(function (row) {
      row.addEventListener('click', function () {
        r.ratePicked = row.getAttribute('data-tier');
        render();
      });
    });
    var discRow = host.querySelector('.opt-row[data-disc]');
    if (discRow) discRow.addEventListener('click', function () {
      r.disc = !r.disc;
      render();
    });
    var btn = host.querySelector('#btn-rn-rate');
    if (btn) btn.addEventListener('click', doRate);
  }
  function doRate() {
    var r = rn();
    var l = EC.lrOf(sales(), claims());
    if (E.medicalOf(sales()) && E.isAdjustable(E.medicalOf(sales())) && !r.ratePicked) {
      R.toast('先选择调价档位', 'warn');
      return;
    }
    var res = E.rateStep(r, r.ratePicked || 'hold', r.disc, l.actual);
    r.status = 'season';
    E.pickEvents(sales(), claims(), r);
    r.log.push({ t: '调价', text: '调价决议：' + (r.ratePicked ? E.tierById(r.ratePicked).name : '无标的跳过') +
      (r.disc ? '（含差别化执行——违规）' : '') + (res.warn ? '；' + res.warn : ''), date: '2026-09' });
    saveHud();
    if (r.ratePicked === 'aggr') {
      if (AW.main.eventUnlock) AW.main.eventUnlock('renew_spiral');
      AW.main.checkMentorRenewal('spiral');
    }
    R.toast('调价决议落档——进入第二季结算' + (res.warn ? '（' + esc(res.warn) + '）' : ''),
      r.disc ? 'bad' : (res.warn ? 'warn' : 'ok'));
    tab = 'p3';
    render();
  }

  /* ================= P3 第二季结算 ================= */
  function settleCard2HTML() {
    var r = rn();
    var s2 = E.settle2(sales(), claims(), r);
    var t = s2.total;
    var rows = s2.per.map(function (p) {
      return '<tr><td>' + esc(pidName(p.pid)) + '</td><td>' + money(p.base) + '</td><td>×' + p.mult.toFixed(2) + '</td>' +
        '<td>' + money(p.r2) + '</td><td>' + pct(p.lr2) + '</td><td>' + money(p.fee2) + '</td>' +
        '<td class="' + (p.net2 >= 0 ? 'ok-t' : 'bad-t') + '"><b>' + money(p.net2) + '</b></td></tr>';
    }).join('');
    return '<div class="route-box"><h3 class="sub-title">🧮 第二季续期模型（演出值【低】）</h3>' +
      '<table class="sl-report"><tr><th>险种</th><th>首季保费</th><th>续期系数</th><th>续期保费</th><th>第二季 lr</th><th>续期费用(12%)</th><th>净现金流</th></tr>' + rows +
      '<tr><th colspan="3"><b>合计</b></th><th>' + money(t.r2) + '</th><th>' + (t.lr2 != null ? pct(t.lr2) : '—') + '</th><th>' + money(t.fee2) + '</th>' +
      '<th class="' + (t.net2 >= 0 ? 'ok-t' : 'bad-t') + '"><b>' + money(t.net2) + '</b></th></tr></table>' +
      '<p class="dim">口径：医疗险 r2 = 首季×(1+涨幅)×续保率、lr2 = 实际lr×逆选择因子；其他险种 r2 = 首季×(1−lapse 12%)。第二季为完整承保口径（保费−赔款−费用），与首季渠道口径（赔付在理赔季结算）不可直接相加。</p>' +
      '<div class="comp-row ' + (t.net2 >= 0 ? 'ok' : 'bad') + '"><span class="comp-icon">' + (t.net2 >= 0 ? '✓' : '⚠') + '</span>' +
      '<span class="comp-text">首年费用率 55% vs 续期 12%——<b>费差益：长期险的利润在后端</b>。激进调价的季节，这句话会反过来念。</span></div></div>';
  }
  function events2HTML() {
    var r = rn();
    var evs = E.eventsOf(r);
    if (!evs.length) return '';
    var html = '<div class="route-box"><h3 class="sub-title">📮 本季事件（按调价决策确定性命中）</h3>';
    evs.forEach(function (slot) {
      var ev = null;
      D.EVENTS.forEach(function (x) { if (x.id === slot.eid) ev = x; });
      if (!ev) return;
      var state = slot.ok == null ? '待处理' : (slot.ok ? '✓ 已答对' : '✗ 已答错');
      html += '<div class="event-row"><b>' + esc(ev.title) + '</b> <span class="f-badge ' + (slot.ok == null ? 's-inquiry' : (slot.ok ? 's-receipt' : 's-correcting')) + '">' + state + '</span>' +
        (slot.ok == null ? '<button class="btn-main event-go" data-eid="' + slot.eid + '">去处理 →</button>' : '') + '</div>';
    });
    html += '</div>';
    return html;
  }
  function backflowHTML() {
    var r = rn();
    var html = '<div class="route-box"><h3 class="sub-title">🔁 假设回流（经验数据 → 下一版定价）</h3>' +
      '<p class="dim">总精算师陈砚：' + esc(D.CHEN.backflow) + '</p>';
    D.BACKFLOW.forEach(function (b) {
      var on = r.backflowPicked.indexOf(b.id) >= 0;
      html += '<div class="opt-row ' + (on ? 'on' : '') + '" data-bf="' + b.id + '"><b>' + esc(b.name) + '</b>' +
        '<span class="opt-note">' + esc(b.why) + '</span></div>';
    });
    html += '<p class="dim">三项全勾：声望 +' + D.FEES.backflowAll.prestige + '（收官时结算）。</p></div>';
    return html;
  }
  function renderP3(host) {
    var r = rn();
    if (AW.main.eventUnlock) AW.main.eventUnlock('renew_settle');
    if (AW.main.checkMentorRenewal) AW.main.checkMentorRenewal('settle');
    var evs = E.eventsOf(r);
    var allAnswered = evs.length > 0 && eventsAllAnswered(r);
    var html = '<h2 class="step-title">续期经营季 · P3 第二季结算</h2>';
    html += settleCard2HTML() + events2HTML() + backflowHTML();
    html += '<div class="modal-actions"><button id="btn-rn-finalize" class="btn-submit"' +
      (!allAnswered || r.status === 'done' ? ' disabled' : '') + '>🏁 完成续期季结算<br><span class="dim">第二季净现金流计入研发预算 · 档案号 RN-2026-XXXX</span></button></div>';
    host.innerHTML = html;
    host.querySelectorAll('.opt-row[data-bf]').forEach(function (row) {
      row.addEventListener('click', function () {
        var id = row.getAttribute('data-bf');
        var i = r.backflowPicked.indexOf(id);
        if (i >= 0) r.backflowPicked.splice(i, 1); else r.backflowPicked.push(id);
        if (AW.main.eventUnlock) AW.main.eventUnlock('renew_backflow');
        AW.main.save();
        render();
      });
    });
    host.querySelectorAll('.event-go[data-eid]').forEach(function (b) {
      b.addEventListener('click', function () { openEventModal(b.getAttribute('data-eid')); });
    });
    var fin = host.querySelector('#btn-rn-finalize');
    if (fin) fin.addEventListener('click', function () {
      if (fin.disabled) return;
      doFinalize();
    });
  }
  function openEventModal(eid) {
    var r = rn();
    var ev = null;
    D.EVENTS.forEach(function (x) { if (x.id === eid) ev = x; });
    if (!ev) return;
    if (AW.main.eventUnlock) AW.main.eventUnlock('renew_' + eid.replace('e_r_', ''));
    var html = '<h3>📮 ' + esc(ev.title) + '</h3><p class="dim">' + esc(ev.question) + '</p>';
    ev.options.forEach(function (o, i) {
      html += '<div class="opt-row" data-opt="' + i + '"><b>' + o.id.toUpperCase() + ' · ' + esc(o.text) + '</b></div>';
    });
    html += '<div id="ev2-feedback"></div><div class="modal-actions"><button id="btn-rn-ev-done" class="btn-ghost" style="display:none">我明白了</button></div>';
    R.showModal(html);
    document.querySelectorAll('#modal-root .opt-row[data-opt]').forEach(function (row) {
      row.addEventListener('click', function () {
        var pick = parseInt(row.getAttribute('data-opt'), 10);
        var res = E.answerEvent(r, eid, pick);
        if (res.done || res.invalid) return;
        applyDelta(res);
        saveHud();
        var fb = document.getElementById('ev2-feedback');
        if (fb) fb.innerHTML = '<div class="comp-row ' + (res.ok ? 'ok' : 'bad') + '"><span class="comp-icon">' + (res.ok ? '✓' : '✗') + '</span>' +
          '<span class="comp-text">' + (res.ok ? '处理得当（声望 +' + D.FEES.eventRight.prestige + '）' : '处理不当（罚 ¥' + D.FEES.eventWrong.fee.toLocaleString('zh-CN') + ' · 声望 ' + D.FEES.eventWrong.prestige + '）') +
          ' — ' + esc(ev.why) + '</span></div>';
        var done = document.getElementById('btn-rn-ev-done');
        if (done) done.style.display = '';
        document.querySelectorAll('#modal-root .opt-row[data-opt]').forEach(function (x) { x.classList.add('dis'); });
      });
    });
    var doneBtn = document.getElementById('btn-rn-ev-done');
    if (doneBtn) doneBtn.addEventListener('click', function () {
      R.closeModal();
      render();
    });
  }

  /* ================= 收官落账 ================= */
  function doFinalize() {
    var r = rn();
    if (r.status === 'done') return;
    var res = E.finalize(r, sales(), claims());
    var s2 = res.settle;
    st().budget += s2.total.net2;                 /* 第二季净现金流（可为负——死亡螺旋允许恶化） */
    applyDelta({ prestige: res.prestige });
    saveHud();
    AW.main.checkMentorRenewal('finalize');
    openRecapModal(s2, res);
    render();
  }
  function openRecapModal(s2, res) {
    var r = rn();
    var q1 = 0;
    E.listedOf(sales()).forEach(function (s) {
      try { q1 += AW.salesEngine.settle(s).premium; } catch (e) {}
    });
    var t = s2.total;
    var verdict = t.net2 < 0
      ? '死亡螺旋是最好的精算教材——这一季的亏损，下个版本的产品定价会记得。'
      : (r.disc ? '闭环走通了，但差别化调价的处罚记录留在档案里——合规没有中间态。'
                : '回溯 → 调价 → 回流，闭环走通了。经验数据是你下一版产品的第一假设。');
    var html = '<h3>🏁 续期经营季收官</h3>' +
      '<div class="memo-box"><h4>两季对比（口径注记：首季为渠道口径，第二季为完整承保口径）</h4>' +
      '<table class="sl-report">' +
      '<tr><th></th><th>首季（销售）</th><th>第二季（续期）</th></tr>' +
      '<tr><th>保费收入</th><td>' + money(q1) + '</td><td>' + money(t.r2) + '</td></tr>' +
      '<tr><th>赔付口径</th><td>理赔季净流出（另结）</td><td>赔款 ' + money(t.claims2) + '（lr ' + (t.lr2 != null ? pct(t.lr2) : '—') + '）</td></tr>' +
      '<tr><th>费用/佣金</th><td>渠道佣金（首年 55% 口径）</td><td>' + money(t.fee2) + '（续期 12%）</td></tr>' +
      '<tr><th><b>净现金流</b></th><td>首季结算见销售档案</td><td class="' + (t.net2 >= 0 ? 'ok-t' : 'bad-t') + '"><b>' + money(t.net2) + '</b>（已计入研发预算）</td></tr>' +
      '</table>' +
      '<div class="memo-sign">续期档案号：<b>' + esc(r.fileNo) + '</b>' + (res.backflowAll ? ' · 假设回流三项全勾（声望 +' + D.FEES.backflowAll.prestige + '）' : '') + '</div>' +
      '<div class="memo-sign">总精算师点评（陈砚）：' + esc(verdict) + '</div></div>' +
      '<div class="modal-actions"><button id="btn-rn-done" class="btn-submit">继续经营 →</button></div>';
    R.showModal(html);
    var b = document.getElementById('btn-rn-done');
    if (b) b.addEventListener('click', function () { R.closeModal(); });
  }

  /* ================= 台账 ================= */
  function renderLedger(host) {
    var r = rn();
    var s2 = r.status === 'done' ? E.settle2(sales(), claims(), r) : null;
    var rows = '';
    E.listedOf(sales()).forEach(function (s) {
      var p = null;
      if (s2) s2.per.forEach(function (x) { if (x.pid === s.pid) p = x; });
      rows += '<tr><td>' + esc(pidName(s.pid)) + '</td><td>' + (s.pid === 'medical' && r.ratePicked ? esc(E.tierById(r.ratePicked).name) : '—') + '</td>' +
        '<td>' + (p ? money(p.r2) : '—') + '</td><td>' + (p ? (p.net2 >= 0 ? '+' : '') + money(p.net2) : '—') + '</td></tr>';
    });
    var evs = E.eventsOf(r);
    var evCells = evs.map(function (x) {
      return '<span class="f-badge ' + (x.ok == null ? 's-inquiry' : (x.ok ? 's-receipt' : 's-correcting')) + '">' +
        (x.ok == null ? '待' : (x.ok ? '✓' : '✗')) + '</span>';
    }).join(' ');
    host.innerHTML = '<h2 class="step-title">续期经营季 · 台账</h2>' +
      '<div class="route-box"><h3 class="sub-title">📚 续期档案</h3>' +
      '<table class="sl-report"><tr><th>险种</th><th>调价决议</th><th>续期保费</th><th>第二季净现金流</th></tr>' + rows + '</table>' +
      '<p class="dim">状态 ' + badgeHTML(r) + ' · 档案号 ' + esc(r.fileNo || '未生成') + ' · 事件 ' + (evCells || '—') + '</p></div>' +
      '<div class="modal-actions"><button id="btn-rn-recap" class="btn-ghost" ' + (r.status === 'done' ? '' : 'disabled') + '>📖 续期经营复盘</button></div>';
    var b = host.querySelector('#btn-rn-recap');
    if (b) b.addEventListener('click', function () {
      if (b.disabled) return;
      openRecapModal(E.settle2(sales(), claims(), r), { backflowAll: E.backflowDone(r) });
    });
  }

  /* ================= 导出 ================= */
  AW.uiRenewal = {
    render: render,
    renderP1: function () { tab = 'p1'; render(); },
    renderP2: function () { tab = 'p2'; render(); },
    renderP3: function () { tab = 'p3'; render(); },
    ledgerTab: function () { tab = 'ledger'; render(); },
    doFinalize: function () { if (deps()) doFinalize(); }   /* 收官落账（供测试/自动化，同 UI 按钮路径） */
  };
})();
