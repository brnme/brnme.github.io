/* =====================================================================
 * 精算工坊 · js/ui/claims.js（第五阶段「出险勘察 + 理赔结算」界面，GDD-stage5 §17.1 §17.5）
 * 挂载 AW.uiClaims：render / renderP1 / renderP2 / renderP3 / ledgerTab /
 * openArchiveModal（理赔季档案）/ doFinalize（结算落账，供测试/自动化）/ currentId。
 * 四页签：① 受理勘察（单证+勘察）② 核定给付（核定+时限链）③ 结算台账
 * （案件台账表+结算卡+事件池+完成结算）④ 案件台账（逐案明细+案卷复盘）。
 * 灰卡案件（未上市险种）点开只渲染教学提示面板，不渲染单证/勘察/核定操作面板。
 * 复用 AW.render 的 showModal / toast / .opt-row / .comp-row / .fcard / .stamp 体系；
 * 结构复刻 ui/sales.js：deps() 延迟绑定（本文件先于 main.js 加载）、tab 局部变量 +
 * render 重绘、applyDelta/saveHud、结果复盘模态 #btn-cl-done、事件模态 #btn-ev2-done、
 * overdraftStreak 透支提醒。案件状态全部落在 state.claims（刷新可恢复重渲染）。
 * 数值展示一律经引擎计算（E.docStep/surveyStep/adjustStep/closeCase/metrics/
 * lrOf/pickEvents/answerEvent/settle/finalize），UI 层不自算给付公式。
 * ===================================================================== */
(function () {
  'use strict';
  var AW = (typeof window !== 'undefined') ? (window.AW = window.AW || {})
                                           : (globalThis.AW = globalThis.AW || {});
  var R = null;                  // 延迟取 AW.render（加载顺序：本文件先于 main.js）
  var D = null, E = null;        // claimsData / claimsEngine

  var tab = 'p1';                // p1 | p2 | p3 | ledger
  var curId = null;              // 当前办理的 claim id（P1/P2 页签间共享）
  var adjPick = null;            // 核定面板临时态：'deny' 时展示拒赔理由二级（不持久化）

  function deps() {
    if (!R) R = AW.render;
    D = AW.claimsData; E = AW.claimsEngine;
    return !!(R && D && E);
  }
  function esc(s) { return R.esc(s); }
  function money(n) { return R.money(n); }
  function pct(n) { return R.pct(n); }
  function st() { return AW.state; }
  function claims() { return st().claims || []; }
  function claimById(id) {
    var cs = claims(), i;
    for (i = 0; i < cs.length; i++) if (cs[i].id === id) return cs[i];
    return null;
  }
  function claimByCaseKey(key) {
    var cs = claims(), i;
    for (i = 0; i < cs.length; i++) if (cs[i].caseKey === key) return cs[i];
    return null;
  }
  function cur() { return curId ? claimById(curId) : null; }
  function caseTplOf(cl) { return E.caseById(cl.caseKey); }
  function pidName(pid) {
    try { var p = AW.getProduct(pid); return p ? p.name : pid; } catch (e) { return pid; }
  }
  function applyDelta(d) {
    if (!d) return;
    if (d.fee) st().budget -= d.fee;
    if (d.prestige) st().prestige = Math.max(0, st().prestige + d.prestige);
  }
  function saveHud() { AW.main.save(); R.renderHUD(); }
  /* 进入理赔季时按上市产品派生案件队列（幂等：已有队列不重建） */
  function ensureClaims() {
    if (!st().claims || !st().claims.length) {
      st().claims = E.buildClaims(st().sales || []);
      AW.main.save();
    }
  }
  /* 归档完成标记：claims.done/fileNo 挂在数组上（JSON 不持久化数组自定义属性），
   * doFinalize 时镜像 fileNo 到首个 claim 对象以跨刷新恢复（GDD §17.5 刷新恢复）。 */
  function isDone() {
    var cs = claims();
    if (cs.done) return true;
    return !!(cs.length && cs[0] && cs[0].fileNo);
  }
  function fileNoOf() {
    var cs = claims();
    return cs.fileNo || (cs.length && cs[0] && cs[0].fileNo) || '';
  }
  function allClosed() {
    var cs = claims(), i;
    if (!cs.length) return false;
    for (i = 0; i < cs.length; i++) if (cs[i].status !== 'closed') return false;
    return true;
  }
  function eventsAllAnswered() {
    var evs = E.eventsOf(claims()), i;
    if (!evs.length) return false;
    for (i = 0; i < evs.length; i++) if (evs[i].ok == null) return false;
    return true;
  }

  var OUTCOME_TEXT = {
    pay: '全额给付', partial: '部分给付', deny: '拒赔',
    deny_bad: '错误拒赔 · 败诉', overpay: '超责给付（滥赔）', gratia: '通融给付'
  };
  /* 结案知识卡解锁事件（data/claims.js 头部约定）与专案导师事件 */
  var KC_EVENTS = {
    c_flash: 'claim_flash', c_incontest: 'claim_incontest', c_exgratia: 'claim_exgratia',
    c_disability: 'claim_disability', c_delay: 'claim_delay', c_beneficiary: 'claim_beneficiary'
  };
  var CASE_MENTOR = { c_conceal: 'case_conceal', c_exgratia: 'case_gratia', c_beneficiary: 'case_beneficiary' };
  /* 从持久化字段反推单证选择（刷新恢复：docsOk/day 增量/evidenceLost 三态判别） */
  function docChoiceOf(cl) {
    if (!cl.docsDone) return null;
    var c = caseTplOf(cl);
    var backlog = c ? (c.backlog || 0) : 0;
    if (cl.docsOk) return (cl.day - backlog) >= 2 ? 'A' : 'C';
    return cl.docsEvidenceLost ? 'C' : 'B';
  }
  function tierName(id) {
    var t = null;
    E.surveyTiers().forEach(function (x) { if (x.id === id) t = x; });
    return t ? t.name : (id || '—');
  }
  function adjIdxOf(id) {
    for (var i = 0; i < D.ADJUSTS.length; i++) if (D.ADJUSTS[i].id === id) return i;
    return -1;
  }

  /* ================= 主视图 ================= */
  function render() {
    if (!deps()) return;
    var root = document.getElementById('claims');
    if (!root) return;
    var gate = E.canEnter(st().sales || [], st().claims);
    root.innerHTML =
      '<div class="ftabs">' +
      '<button class="ftab ' + (tab === 'p1' ? 'on' : '') + '" data-ftab="p1">① 受理勘察</button>' +
      '<button class="ftab ' + (tab === 'p2' ? 'on' : '') + '" data-ftab="p2">② 核定给付</button>' +
      '<button class="ftab ' + (tab === 'p3' ? 'on' : '') + '" data-ftab="p3">③ 结算台账</button>' +
      '<button class="ftab ' + (tab === 'ledger' ? 'on' : '') + '" data-ftab="ledger">🗂️ 案件台账</button>' +
      '</div><div id="claims-body"></div>';
    var body = root.querySelector('#claims-body');
    var html = '', bind = null;
    if (!gate.ok) { html = gateHTML(); bind = bindGate; }
    else {
      ensureClaims();
      if (tab === 'p2') { html = p2HTML(); bind = bindP2; }
      else if (tab === 'p3') { html = p3HTML(); bind = bindP3; }
      else if (tab === 'ledger') { html = ledgerHTML(); bind = bindLedger; }
      else { html = p1HTML(); bind = bindP1; }
    }
    body.innerHTML = html;
    if (bind) bind(body);
    Array.prototype.slice.call(root.querySelectorAll('.ftab')).forEach(function (b) {
      b.addEventListener('click', function () {
        tab = b.getAttribute('data-ftab');
        render();
      });
    });
  }

  /* ================= 入口闸门（三态） ================= */
  function gateHTML() {
    var html = '<h2 class="step-title">理赔季 · 保单池为空</h2>' +
      '<div class="empty-hint">还没有已上市的产品，保单池为空。<br>理赔季随上市保单到来——先去「上架销售」完成渠道开播、首季经营与上市结算。</div>' +
      '<div class="modal-actions"><button id="btn-goto-sales" class="btn-main">← 返回上架销售</button></div>';
    return html;
  }
  function bindGate(body) {
    var b = body.querySelector('#btn-goto-sales');
    if (b) b.addEventListener('click', function () { AW.main.gotoStage(4); });
  }

  /* ================= 案件卡（P1/P2 共享） ================= */
  function caseCardHTML(cl, selected) {
    var c = caseTplOf(cl);
    return '<div class="fcard ' + (selected ? 'sel' : '') + (cl.grayed ? ' dis' : '') + '" data-ckey="' + esc(cl.caseKey) + '" data-cid="' + esc(cl.id) + '">' +
      '<div class="fcard-top">' +
      (cl.grayed ? '<span class="f-badge s-act">教学提示</span>' :
        cl.status === 'closed' ? '<span class="f-badge sp-published">✓ 已结案</span>' :
        cl.status === 'adjusted' ? '<span class="f-badge sp-listed">已核定</span>' :
        cl.status === 'surveyed' ? '<span class="f-badge s-act">已勘察</span>' :
        '<span class="f-badge">已受理</span>') +
      (cl.outcome ? '<span class="f-badge">' + esc(OUTCOME_TEXT[cl.outcome] || cl.outcome) + '</span>' : '') +
      '</div>' +
      '<div class="fcard-name">' + cl.id + ' · ' + esc(c.title) + '</div>' +
      '<div class="fcard-meta">' + esc(pidName(cl.pid)) + ' · ' + esc(E.statusName(cl.status)) +
      (cl.grayed ? '<br>该险种未上市，无在保保单' : '') + '</div></div>';
  }
  function cardGridHTML() {
    var cs = claims();
    var html = '<div class="fcard-grid">';
    cs.forEach(function (cl) { html += caseCardHTML(cl, cl.id === curId); });
    html += '</div>';
    return html;
  }
  function bindCards(body) {
    Array.prototype.slice.call(body.querySelectorAll('.fcard[data-ckey]')).forEach(function (d) {
      d.addEventListener('click', function () {
        var cl = claimByCaseKey(d.getAttribute('data-ckey'));
        if (!cl) return;
        curId = cl.id;
        render();
      });
    });
  }

  /* ================= P1 受理与勘察（单证 22 条 + 勘察三档） ================= */
  function poolCardHTML() {
    var l = E.lrOf(st().sales || [], []);
    var seen = {}, rows = '';
    E.cases(st().sales || []).forEach(function (x) {
      if (seen[x.pid]) return;
      seen[x.pid] = 1;
      rows += '<div class="comp-row ' + (x.listed ? 'ok' : 'bad') + '"><span class="comp-icon">' + (x.listed ? '✓' : '✗') + '</span>' +
        '<span class="comp-text">' + esc(pidName(x.pid)) + '：' +
        (x.listed ? '在保 · 首季保费 ' + money(x.sale ? AW.salesEngine.settle(x.sale).premium : 0) + ' ×10 计入保单池'
                  : '未上市——对应案件按灰卡教学提示办理') + '</span></div>';
    });
    return '<div class="route-box"><h3 class="sub-title">📋 保单池</h3>' +
      '<p>保单池保费（首季保费 ×10 三年累积系数）：<b>' + money(l.pool) + '</b></p>' + rows + '</div>';
  }
  function p1HTML() {
    var html = '<h2 class="step-title">理赔季 · P1 受理与勘察</h2>' +
      '<p class="dim">核赔老师傅陈叔：' + esc(D.CHEN.enter) + ' 单证审核走《保险法》22 条一次性补料；勘察三档决定证据链——该深不深，拒赔就是败诉。</p>' +
      poolCardHTML() + cardGridHTML();
    var cl = cur();
    if (cl) html += surveyPanelHTML(cl);
    return html;
  }
  /* 灰卡教学面板：未上市险种无在保保单，三步不可办理（引擎 canOperate 同口径守卫） */
  function grayedPanelHTML(cl) {
    var c = caseTplOf(cl);
    return '<div class="route-box"><h3 class="sub-title">🧾 案卷 ' + cl.id + ' · ' + esc(c ? c.title : cl.caseKey) +
      ' <span class="f-badge s-act">教学提示：该险种未上市，无在保保单</span></h3>' +
      (c ? '<p class="dim">' + esc(c.profile) + '</p>' : '') +
      '<div class="empty-hint">该险种未上市，无在保保单——单证审核、勘察决策、核定给付三步均不可办理。<br>' +
      '回到第四阶段「上架销售」把该险种产品上市，下一理赔季即可办理本案。</div></div>';
  }
  function surveyPanelHTML(cl) {
    var c = caseTplOf(cl);
    if (!c) return '';
    if (cl.grayed) return grayedPanelHTML(cl);
    var html = '<div class="route-box"><h3 class="sub-title">🧾 案卷 ' + cl.id + ' · ' + esc(c.title) +
      (cl.grayed ? ' <span class="f-badge s-act">教学提示：该险种未上市，无在保保单</span>' : '') + '</h3>' +
      '<p class="dim">' + esc(c.profile) + '</p>';
    /* 单证清单 */
    html += '<div class="axis-grid">';
    c.docs.forEach(function (d) {
      var miss = d === c.missing;
      html += '<div class="axis-item ' + (miss ? '' : 'on') + '"><input type="checkbox" ' + (miss ? '' : 'checked') + ' disabled>' +
        '<span>' + esc(d) + (miss ? ' <i class="req-mark">缺件</i>' : '') + '</span></div>';
    });
    html += '</div>';
    /* Step 1 单证审核 */
    html += '<h3 class="sub-title">Step 1 · 单证审核（第 22 条：一次性补料）</h3>';
    if (!cl.docsDone) {
      html += '<div class="law-box small">' + esc(D.LAW_CLAIM) + '</div><div class="opt-list">';
      E.docOptions(c).forEach(function (o, idx) {
        html += '<label class="opt-item opt-row" data-doc="' + idx + '"><span><b>' + esc(o.name) + '</b>　' + esc(o.text) +
          '（时限 +' + o.day + ' 日' + (o.complaintRisk ? '、投诉风险 +' + o.complaintRisk : '') + '）</span></label>';
      });
      html += '</div>';
    } else {
      var pick = docChoiceOf(cl);
      var opts = E.docOptions(c);
      var opt = null;
      opts.forEach(function (o) { if (o.id === pick) opt = o; });
      html += '<div class="comp-row ' + (cl.docsOk ? 'ok' : 'bad') + '"><span class="comp-icon">' + (cl.docsOk ? '✓' : '✗') + '</span>' +
        '<span class="comp-text">你的单证决策：' + esc(opt ? opt.name : pick) +
        (cl.docsOk ? '——符合第 22 条一次性补料口径' : cl.docsEvidenceLost ? '——大额案件免原件＝漏检欺诈，证据链失效' : '——挤牙膏式索料（时限拉长、投诉风险 +1）') + '</span></div>' +
        '<div class="comp-basis">法规依据：' + esc(opt ? opt.why : '') + '</div>';
    }
    /* Step 2 勘察决策 */
    html += '<h3 class="sub-title">Step 2 · 勘察决策（快速 ¥0 / 标准 ¥800 / 深度 ¥6,000）</h3>';
    if (!cl.docsDone) {
      html += '<div class="dim">先完成单证审核，再定勘察档位。</div>';
    } else if (!cl.surveyDone) {
      html += '<div class="opt-list">';
      E.surveyTiers().forEach(function (t) {
        html += '<label class="opt-item opt-row" data-tier="' + esc(t.id) + '"><span><b>' + esc(t.name) + '</b>　费用 ' + money(t.cost) + ' · 时限 +' + t.day + ' 日<br>' +
          '<span class="dim">' + esc(t.why) + '</span></span></label>';
      });
      html += '</div>';
    } else {
      html += '<div class="comp-row ' + (cl.surveyOk ? 'ok' : 'bad') + '"><span class="comp-icon">' + (cl.surveyOk ? '✓' : '✗') + '</span>' +
        '<span class="comp-text">勘察档位：' + esc(tierName(cl.survey)) + ' · 调查成本 ' + money(cl.cost) +
        ' · 证据链' + (cl.evidence ? '完整' : '不足') + '——正确档位是「' + esc(tierName(c.truth.tier)) + '」</span></div>' +
        '<div class="modal-actions"><button id="btn-cl-gop2" class="btn-main">前往 ② 核定给付 →</button></div>';
    }
    html += '</div>';
    return html;
  }
  function bindP1(body) {
    bindCards(body);
    Array.prototype.slice.call(body.querySelectorAll('.opt-row[data-doc]')).forEach(function (d) {
      d.addEventListener('click', function () {
        var cl = cur();
        if (!cl || cl.docsDone) return;
        var res = E.docStep(cl, parseInt(d.getAttribute('data-doc'), 10));
        if (res.done || res.invalid) return;
        if (!res.ok) AW.main.checkMentorClaims('doc_trap', cl);
        R.toast(res.ok ? '✓ 单证决策合规（时限 +' + res.day + ' 日）' : '⚠ 单证决策踩坑：' + (res.evidenceLost ? '大额案件免原件＝证据链失效' : '分次索要违反 22 条（时限 +' + res.day + ' 日、投诉 +1）'), res.ok ? 'ok' : 'bad');
        saveHud();
        render();
      });
    });
    Array.prototype.slice.call(body.querySelectorAll('.opt-row[data-tier]')).forEach(function (d) {
      d.addEventListener('click', function () {
        var cl = cur();
        if (!cl || cl.surveyDone) return;
        var res = E.surveyStep(cl, d.getAttribute('data-tier'));
        if (res.done || res.invalid) return;
        if (cl.status === 'received') cl.status = 'surveyed';
        if (!res.ok) AW.main.checkMentorClaims('tier_wrong', cl);
        R.toast(res.ok ? '✓ 勘察档位与案情匹配（费用 ' + money(res.cost) + '）' : '⚠ 档位与案情不匹配（罚时 +3 日）——' + res.why, res.ok ? 'ok' : 'warn');
        saveHud();
        render();
      });
    });
    var gop2 = body.querySelector('#btn-cl-gop2');
    if (gop2) gop2.addEventListener('click', function () { tab = 'p2'; render(); });
  }

  /* ================= P2 核定与给付（四选 + 拒赔理由二级 + 时限链） ================= */
  function p2HTML() {
    var html = '<h2 class="step-title">理赔季 · P2 核定与给付</h2>' +
      '<p class="dim">核定四选：全额 / 部分 / 拒赔（须引用条款）/ 通融（仅特殊困难案合规）。法务顾问周律：' + esc(D.ZHOU.enter) + '</p>' +
      cardGridHTML();
    var cl = cur();
    if (cl) html += adjustPanelHTML(cl);
    return html;
  }
  function adjustPanelHTML(cl) {
    var c = caseTplOf(cl);
    if (!c) return '';
    if (cl.grayed) return grayedPanelHTML(cl);
    var html = '<div class="route-box"><h3 class="sub-title">⚖️ 核定 · ' + cl.id + ' ' + esc(c.title) + '</h3>' +
      '<p class="dim">' + esc(c.profile) + '</p>';
    if (!cl.surveyDone) {
      html += '<div class="empty-hint">本案尚未完成勘察。<br>先在「① 受理勘察」走完单证审核与勘察决策。</div></div>';
      return html;
    }
    html += '<div class="comp-row ' + (cl.evidence ? 'ok' : 'bad') + '"><span class="comp-icon">' + (cl.evidence ? '✓' : '✗') + '</span>' +
      '<span class="comp-text">勘察：' + esc(tierName(cl.survey)) + ' · 证据链' + (cl.evidence ? '完整（拒赔站得住）' : '不足（此时拒赔＝败诉风险）') + '</span></div>';
    if (!cl.adjDone) {
      html += '<h3 class="sub-title">核定决策（四选）</h3><div class="opt-list">';
      D.ADJUSTS.forEach(function (a, idx) {
        html += '<label class="opt-item opt-row ' + (adjPick === a.id ? 'sel' : '') + '" data-adj="' + idx + '"><span><b>' + esc(a.name) + '</b>　' + esc(a.text) + '</span></label>';
      });
      html += '</div>';
      if (adjPick === 'deny') {
        html += '<h3 class="sub-title">拒赔理由（第 23/24 条：3 日内书面通知并说明理由）</h3><div class="opt-list">';
        E.adjustOptions(c, cl).reasons.forEach(function (r, idx) {
          html += '<label class="opt-item opt-row" data-rsn="' + idx + '"><span>' + esc(r.text) + '</span></label>';
        });
        html += '</div><div class="modal-actions"><button id="btn-cl-rsn-back" class="btn-ghost">← 重选核定结论</button></div>';
      }
    } else {
      html += '<div class="comp-row ' + (cl.adjOk ? 'ok' : 'bad') + '"><span class="comp-icon">' + (cl.adjOk ? '✓' : '✗') + '</span>' +
        '<span class="comp-text">核定结论：' + esc(OUTCOME_TEXT[cl.outcome] || cl.outcome || '—') + ' · 给付 ' + money(cl.paid) + ' · 案卷 ' + cl.day + ' 日' +
        (cl.status === 'closed' ? ' · 已结案' : '') + '</span></div>' +
        '<div class="comp-basis">正确路径：' + esc(c.truth.path) + '</div>';
    }
    html += '</div>';
    return html;
  }
  function bindP2(body) {
    bindCards(body);
    Array.prototype.slice.call(body.querySelectorAll('.opt-row[data-adj]')).forEach(function (d) {
      d.addEventListener('click', function () {
        var cl = cur();
        if (!cl || cl.adjDone) return;
        var idx = parseInt(d.getAttribute('data-adj'), 10);
        if (D.ADJUSTS[idx] && D.ADJUSTS[idx].id === 'deny') { adjPick = 'deny'; render(); return; }
        doAdjust(cl, idx, null);
      });
    });
    Array.prototype.slice.call(body.querySelectorAll('.opt-row[data-rsn]')).forEach(function (d) {
      d.addEventListener('click', function () {
        var cl = cur();
        if (!cl || cl.adjDone) return;
        doAdjust(cl, adjIdxOf('deny'), parseInt(d.getAttribute('data-rsn'), 10));
      });
    });
    var back = body.querySelector('#btn-cl-rsn-back');
    if (back) back.addEventListener('click', function () { adjPick = null; render(); });
  }
  function doAdjust(cl, adjIdx, reasonIdx) {
    var res = E.adjustStep(cl, adjIdx, reasonIdx);
    if (res.done || res.invalid) return;
    adjPick = null;
    applyDelta({ prestige: res.prestige });          /* 空泛拒赔/通融拒赔的声望变动（引擎只返回不落账） */
    if (res.outcome === 'deny_bad') AW.main.checkMentorClaims('deny_bad', cl);
    saveHud();
    var cres = E.closeCase(cl);                       /* 时限链结算（逾期利息/投诉在引擎内落 claim） */
    if (!cres.done) finishCase(cl, cres);
    render();
    openCaseResultModal(cl);
  }
  /* 结案派发：专案导师事件 / 逾期导师事件 / 知识卡解锁（事件名照 data/claims.js 头部约定） */
  function finishCase(cl, cres) {
    if (CASE_MENTOR[cl.caseKey]) AW.main.checkMentorClaims(CASE_MENTOR[cl.caseKey], cl);
    if (cres.late && !cl.lateExpected) AW.main.checkMentorClaims('case_late', cl);
    if (KC_EVENTS[cl.caseKey]) AW.main.eventUnlock(KC_EVENTS[cl.caseKey]);
  }
  /* 结果复盘模态（法规依据＋正确路径＋经济账），#btn-cl-done 关闭并重渲染 */
  function openCaseResultModal(cl) {
    var c = caseTplOf(cl);
    if (!c) return;
    var html = '<h3>🧾 结果复盘 · ' + esc(c.title) + '</h3>' +
      '<div class="comp-row ' + (cl.adjOk ? 'ok' : 'bad') + '"><span class="comp-icon">' + (cl.adjOk ? '✓' : '✗') + '</span>' +
      '<span class="comp-text">你司核定：' + esc(OUTCOME_TEXT[cl.outcome] || cl.outcome || '—') + ' · 给付 ' + money(cl.paid) + '</span></div>' +
      '<table class="sl-report"><tr><th>给付保险金</th><td>' + money(cl.paid) + '</td></tr>' +
      '<tr><th>调查成本</th><td>' + money(cl.cost) + '</td></tr>' +
      '<tr><th>利息 / 罚息</th><td>' + money(cl.interest) + '</td></tr>' +
      '<tr><th>案卷天数</th><td>' + cl.day + ' 日' + (cl.day > 30 ? '（逾期）' : '') + '</td></tr>' +
      '<tr><th>投诉风险</th><td>' + (cl.complaintRisk || 0) + ' 件</td></tr></table>' +
      (cl.late ? '<div class="warn-legacy"><b>⏰ 逾期结案（第 23 条）</b>利息 = 给付 × 1.5% × 逾期月数' +
        (cl.lateExpected ? '（前案积压所致，教学演示时限链计息）' : '——时限链是计息器，投诉另计。') + '</div>' : '') +
      '<div class="speech"><span class="speech-who">🧑‍🦳 陈叔：</span>' + esc(D.CHEN[c.key] || '') + '</div>' +
      '<div class="suggest-box ok-box"><b>正确路径</b>' + esc(c.truth.path) + '</div>' +
      '<div class="comp-basis">法规依据：' + esc(c.truth.why) + '</div>' +
      '<div class="modal-actions"><button id="btn-cl-done" class="btn-main">继续核赔 →</button></div>';
    R.showModal(html).querySelector('#btn-cl-done').addEventListener('click', function () {
      R.closeModal();
      render();
    });
  }

  /* ================= P3 结算台账（台账表 + 结算卡 + 事件池 + 完成结算） ================= */
  function ledgerRowsHTML() {
    var cs = claims();
    var html = '<table class="filing-table ledger"><tr><th>案卷</th><th>险种</th><th>勘察</th><th>给付</th><th>调查成本</th><th>利息</th><th>天数</th><th>结论</th><th>状态</th></tr>';
    cs.forEach(function (cl) {
      html += '<tr><td>' + cl.id + ' ' + esc(caseTplOf(cl) ? caseTplOf(cl).title : cl.caseKey) + '</td>' +
        '<td>' + esc(pidName(cl.pid)) + '</td>' +
        '<td>' + esc(cl.surveyDone ? tierName(cl.survey) : '—') + '</td>' +
        '<td>' + money(cl.paid) + '</td><td>' + money(cl.cost) + '</td><td>' + money(cl.interest) + '</td>' +
        '<td>' + cl.day + ' 日</td>' +
        '<td>' + (cl.outcome ? esc(OUTCOME_TEXT[cl.outcome] || cl.outcome) : '—') + '</td>' +
        '<td>' + esc(E.statusName(cl.status)) + '</td></tr>';
    });
    html += '</table>';
    return html;
  }
  function settleCardHTML() {
    var s = E.settle(claims());
    var l = E.lrOf(st().sales || [], claims());
    var m = s.metrics;
    var html = '<div class="route-box"><h3 class="sub-title">💰 结算卡</h3>' +
      '<table class="sl-report"><tr><th>保单池保费（×10 三年系数）</th><td>' + money(l.pool) + '</td></tr>' +
      '<tr><th>总给付</th><td>' + money(s.paid) + '</td></tr>' +
      '<tr><th>调查成本</th><td>' + money(s.cost) + '</td></tr>' +
      '<tr><th>逾期利息</th><td>' + money(s.interest) + '</td></tr>' +
      '<tr><th>罚款合计（空泛/约谈/审计）</th><td>' + money(s.penalty) + '</td></tr>' +
      '<tr><th><b>理赔净流出</b></th><td class="bad-t"><b>' + money(s.netPaid) + '</b></td></tr></table>' +
      '<div class="comp-row ' + (l.actual != null && l.actual >= 0.40 && l.actual <= 0.70 ? 'ok' : 'bad') + '"><span class="comp-icon">' +
      (l.actual != null && l.actual >= 0.40 && l.actual <= 0.70 ? '✓' : '⚠') + '</span>' +
      '<span class="comp-text">实际赔付率 <b>' + (l.actual != null ? pct(l.actual) : '—') + '</b> vs 定价假设赔付率 ' +
      (l.assumed != null ? pct(l.assumed) : '—') + '（健康带 40%–70%，偏离 &gt;10pp 触发回溯）</span></div>' +
      '<p class="dim">服务评价：获赔率 ' + (m.closed ? pct(1 - m.denyRate) : '—') + ' · 平均核定天数 ' + m.avgDay +
      ' 日 · 投诉 ' + m.complaints + ' 件 · 拒赔 ' + m.denied + ' 件 · 通融 ' + m.gratiaCount + ' 件</p></div>';
    return html;
  }
  function eventsHTML() {
    var cs = claims();
    if (!allClosed()) {
      return '<div class="route-box"><h3 class="sub-title">📰 理赔季事件池</h3>' +
        '<div class="dim">完成全部 10 案结案后，按结案结果确定性生成理赔季事件（败诉 / 12378 / 约谈 / 回溯 / 审计，兜底为监管服务评级问卷）。</div></div>';
    }
    /* 事件槽一次生成、会话内保留（pickEvents 每次会重置答题槽；
     * 刷新后按引擎确定性规则重新生成——引擎头部注释约定） */
    if (!E.eventsOf(cs).length) E.pickEvents(cs, st().sales || []);
    var picked = E.eventsOf(cs);
    var html = '<div class="route-box"><h3 class="sub-title">📰 理赔季事件池</h3>';
    picked.forEach(function (slot, idx) {
      var ev = E.eventById(slot.eid);
      if (!ev) return;
      var state2 = slot.ok == null ? 'pending' : (slot.ok ? 'ok' : 'bad');
      html += '<div class="event-card ' + state2 + '"><div class="event-head"><span class="event-idx">' + (idx + 1) + '</span><b>' + esc(ev.title) + '</b>' +
        (slot.ok == null ? '<button class="btn-main event-go" data-eid="' + esc(ev.id) + '">应对 →</button>' :
         slot.ok ? '<span class="f-badge sp-published">✓ 已妥善应对</span>' : '<span class="f-badge s-correcting">✗ 已补救</span>') + '</div>' +
        '<div class="event-q">' + esc(ev.question) + '</div>' +
        (slot.picked != null && ev.options[slot.picked] ? '<div class="comp-text">你司回应：' + esc(ev.options[slot.picked].text) + '</div>' : '') +
        '</div>';
    });
    html += '</div>';
    return html;
  }
  function finalizeBoxHTML() {
    if (isDone()) {
      return '<div class="route-box"><h3 class="sub-title">✅ 理赔季已完成</h3>' +
        '<p>理赔档案 <b>' + esc(fileNoOf() || '（已归档）') + '</b> 已生成，理赔净流出已计入研发预算。</p>' +
        '<div class="modal-actions"><button id="btn-cl-archive" class="btn-main">🗂️ 查看理赔季档案</button></div></div>';
    }
    if (!allClosed()) {
      return '<div class="dim">完成全部 10 案结案后可进行理赔结算。</div>';
    }
    if (!eventsAllAnswered()) {
      return '<div class="dim">先应对完全部理赔季事件，再完成结算。</div>';
    }
    return '<div class="sign-step"><button id="btn-cl-finalize" class="btn-submit">🏦 完成结算 · 生成理赔档案<br><span class="dim">净流出计入研发预算 · 声望结算 · 六阶段总复盘</span></button></div>';
  }
  function p3HTML() {
    var html = '<h2 class="step-title">理赔季 · P3 结算台账</h2>' +
      '<p class="dim">' + esc(D.CHEN.settle) + '</p>' +
      '<h3 class="sub-title">🗂️ 案件台账</h3>' + ledgerRowsHTML() +
      settleCardHTML() + eventsHTML() + finalizeBoxHTML();
    return html;
  }
  function bindP3(body) {
    Array.prototype.slice.call(body.querySelectorAll('.event-go')).forEach(function (b) {
      b.addEventListener('click', function () { openEventModal(b.getAttribute('data-eid')); });
    });
    var fin = body.querySelector('#btn-cl-finalize');
    if (fin) fin.addEventListener('click', function () { doFinalize(); });
    var arch = body.querySelector('#btn-cl-archive');
    if (arch) arch.addEventListener('click', function () { openArchiveModal(); });
  }
  /* 事件模态（复刻 ui/sales.js openEventModal，结果模态关闭键 #btn-ev2-done） */
  function openEventModal(eid) {
    var cs = claims();
    var slot = null, evs = E.eventsOf(cs), i;
    for (i = 0; i < evs.length; i++) if (evs[i].eid === eid) slot = evs[i];
    var ev = E.eventById(eid);
    if (!slot || !ev || slot.ok != null) return;
    var html = '<h3>📰 理赔季事件 · ' + esc(ev.title) + '</h3><p>' + esc(ev.question) + '</p><div class="opt-list">';
    ev.options.forEach(function (o, idx) {
      html += '<label class="opt-item opt-row" data-eidx="' + idx + '"><span>' + esc(o.text) + '</span></label>';
    });
    html += '</div>';
    var m = R.showModal(html);
    Array.prototype.slice.call(m.querySelectorAll('.opt-row')).forEach(function (d) {
      d.addEventListener('click', function () {
        var res = E.answerEvent(cs, eid, parseInt(d.getAttribute('data-eidx'), 10));
        if (res.done || res.invalid) return;
        applyDelta(res);
        saveHud();
        R.closeModal();
        openEventResultModal(res);
      });
    });
  }
  function openEventResultModal(res) {
    var ev = res.event;
    var html = '<h3>' + (res.ok ? '✅ 应对得当 · 监管认可' : '⚠ 应对失当 · 合规部接管补救') + '</h3>' +
      '<div class="comp-row ' + (res.ok ? 'ok' : 'bad') + '"><span class="comp-icon">' + (res.ok ? '✓' : '✗') + '</span>' +
      '<span class="comp-text">你司回应：' + esc(res.option ? res.option.text : '') + '</span></div>' +
      '<div class="speech"><span class="speech-who">🧑‍⚖️ 复盘：</span>' + esc(ev ? ev.why : '') + '</div>' +
      (res.ok ? '<div class="suggest-box ok-box"><b>结果</b>声望 +2。</div>' :
        '<div class="suggest-box"><b>结果</b>合规部补救：¥2,000、声望 −1。</div>') +
      '<div class="modal-actions"><button id="btn-ev2-done" class="btn-main">继续理赔季 →</button></div>';
    R.showModal(html).querySelector('#btn-ev2-done').addEventListener('click', function () {
      R.closeModal();
      render();
    });
  }
  /* 完成结算：引擎 finalize 只算不落账，预算扣减在 UI 执行（照 ui/sales.js doFinalize 约定：
   * 引擎不碰 HUD，st().budget 的账由 UI 记） */
  function doFinalize() {
    if (!deps()) return;
    var cs = claims();
    if (isDone()) { openArchiveModal(); return; }
    var d = E.finalize(cs);
    /* 透支防软锁（ui/sales.js doLaunch 模式；理赔净流出是法定义务不可拦，连续透支触发提醒） */
    if (st().budget < d.settle.netPaid) {
      st().overdraftStreak = (st().overdraftStreak || 0) + 1;
      if (st().overdraftStreak >= 2) {
        R.toast('⚠ 预算连续透支——该给付的照给，但回看一眼定价假设：理赔是假设的对账单。', 'warn');
      } else {
        R.toast('💰 预算不足支付理赔净流出，公司垫付（透支）', 'warn');
      }
    } else {
      st().overdraftStreak = 0;
    }
    st().budget -= d.settle.netPaid;                  /* 净流出落账（UI 层，同 v4 约定） */
    applyDelta({ prestige: d.prestige });
    cs.done = true; cs.fileNo = d.fileNo;
    if (cs[0]) cs[0].fileNo = d.fileNo;               /* 数组属性不进 JSON，镜像到 claim 以跨刷新恢复 */
    AW.main.checkMentorClaims('finalized', { id: d.fileNo, caseKey: 'finalized', pid: 'claims', status: 'closed' });
    saveHud();
    openArchiveModal({ recap: true });
  }
  /* 理赔季档案文本（明细 + 尾行免责） */
  function archiveText(d) {
    var cs = claims();
    var s = d && d.settle ? d.settle : E.settle(cs);
    var l = E.lrOf(st().sales || [], cs);
    var lines = ['《理赔季档案》'];
    lines.push('档案号：' + (fileNoOf() || (d && d.fileNo) || '（未归档）'));
    lines.push('归档时间：2026-09 · 状态：理赔季收官');
    lines.push('');
    lines.push('—— 案件明细 ——');
    cs.forEach(function (cl) {
      var c = caseTplOf(cl);
      lines.push(cl.id + ' ' + (c ? c.title : cl.caseKey) + '（' + pidName(cl.pid) + '）：' +
        (OUTCOME_TEXT[cl.outcome] || E.statusName(cl.status)) + ' · 给付 ¥' + (cl.paid || 0).toLocaleString('zh-CN') +
        ' · 调查成本 ¥' + (cl.cost || 0).toLocaleString('zh-CN') + ' · ' + cl.day + ' 日' +
        (cl.late ? ' · 逾期利息 ¥' + (cl.interest || 0).toLocaleString('zh-CN') : ''));
    });
    lines = lines.concat([
      '',
      '—— 结算汇总 ——',
      '总给付：¥' + s.paid.toLocaleString('zh-CN'),
      '调查成本：¥' + s.cost.toLocaleString('zh-CN'),
      '逾期利息：¥' + s.interest.toLocaleString('zh-CN'),
      '罚款合计：¥' + s.penalty.toLocaleString('zh-CN'),
      '理赔净流出：¥' + s.netPaid.toLocaleString('zh-CN'),
      '实际赔付率：' + (l.actual != null ? pct(l.actual) : '—') + '（定价假设 ' + (l.assumed != null ? pct(l.assumed) : '—') + '，保单池保费 ¥' + l.pool.toLocaleString('zh-CN') + '）',
      '',
      '—— 服务评价 ——',
      '获赔率：' + (s.metrics.closed ? pct(1 - s.metrics.denyRate) : '—') + ' · 平均核定天数：' + s.metrics.avgDay + ' 日 · 投诉：' + s.metrics.complaints + ' 件 · 通融：' + s.metrics.gratiaCount + ' 件',
      '',
      '（本档案为教学演出数值，非精算报告；案件给付额、利息与罚款均为虚构设定，不对应任何真实保单。《精算工坊》生成）'
    ]);
    return lines.join('\n');
  }
  function openArchiveModal(opts) {
    if (!deps()) return;
    var cs = claims();
    var d = (opts && opts.data) || null;
    var html = '<h3>🗂️ 理赔季档案 · ' + esc(fileNoOf() || '（未归档）') + '</h3>' +
      '<div style="text-align:center"><div class="stamp stamp-sale">理赔季收官</div>' +
      '<div class="stamp-caption">理赔档案号 <b>' + esc(fileNoOf() || '（未归档）') + '</b> · 全流程六阶段闭环</div></div>' +
      '<pre class="memo-pre">' + esc(archiveText(d)) + '</pre>' +
      '<div class="modal-actions"><button id="btn-copy-claims" class="btn-ghost">📋 复制为文本</button>' +
      (opts && opts.recap ? '<button id="btn-cl-recap" class="btn-main">🏁 六阶段总复盘 →</button>' : '') + '</div>';
    var m = R.showModal(html, { wide: true });
    m.querySelector('#btn-copy-claims').addEventListener('click', function () {
      AW.main.copyText(archiveText(d));
      R.toast('理赔季档案已复制到剪贴板', 'ok');
    });
    var rc = m.querySelector('#btn-cl-recap');
    if (rc) rc.addEventListener('click', function () { openRecapModal(d); });
  }
  /* 六阶段总复盘模态（预算 / 声望 / 知识卡 / 导师评语，结构同销售完成模态） */
  function openRecapModal(d) {
    var l = E.lrOf(st().sales || [], claims());
    var total = AW.knowledge.cards.length;
    var html = '<h3>🏁 六阶段总复盘 · 全流程闭环</h3>' +
      '<div class="comp-row ok"><span class="comp-icon">✓</span><span class="comp-text">产品设计 → 监管申报 → 批复公示 → 上架销售 → 出险勘察 → 理赔结算，全流程走通。</span></div>' +
      '<table class="sl-report"><tr><th>研发预算</th><td class="' + (st().budget < 0 ? 'bad-t' : '') + '">' + money(st().budget) + (st().budget < 0 ? '（透支）' : '') + '</td></tr>' +
      '<tr><th>声望</th><td>' + st().prestige + '</td></tr>' +
      '<tr><th>知识卡</th><td>' + st().unlockedCards.length + ' / ' + total + '</td></tr>' +
      '<tr><th>实际赔付率</th><td>' + (l.actual != null ? pct(l.actual) : '—') + '</td></tr></table>' +
      '<div class="speech"><span class="speech-who">🧑‍🦳 陈叔：</span>' + esc(D.CHEN.final) + '</div>' +
      '<div class="speech"><span class="speech-who">⚖️ 周律：</span>' + esc(D.ZHOU.final) + '</div>' +
      '<div class="modal-actions"><button id="btn-cl-finish" class="btn-main">完成理赔季 · 前往续期经营季 →</button></div>';
    R.showModal(html).querySelector('#btn-cl-finish').addEventListener('click', function () {
      R.closeModal();
      AW.main.gotoStage(6);
      render();
    });
  }

  /* ================= ④ 案件台账（逐案明细 + 案卷复盘） ================= */
  function ledgerHTML() {
    var cs = claims();
    var html = '<h2 class="step-title">案件台账</h2>';
    if (!cs.length) {
      html += '<div class="empty-hint">暂无案件。保单池为空——先去「上架销售」完成产品上市。</div>';
      return html;
    }
    html += '<table class="filing-table ledger"><tr><th>案卷</th><th>险种</th><th>勘察档位</th><th>证据</th><th>结论</th><th>给付</th><th>调查成本</th><th>利息</th><th>天数</th><th>状态</th><th>操作</th></tr>';
    cs.forEach(function (cl) {
      html += '<tr><td>' + cl.id + '</td><td>' + esc(pidName(cl.pid)) + '</td>' +
        '<td>' + esc(cl.surveyDone ? tierName(cl.survey) : '—') + '</td>' +
        '<td>' + (cl.surveyDone ? (cl.evidence ? '完整' : '不足') : '—') + '</td>' +
        '<td>' + (cl.outcome ? esc(OUTCOME_TEXT[cl.outcome] || cl.outcome) : '—') + '</td>' +
        '<td>' + money(cl.paid) + '</td><td>' + money(cl.cost) + '</td><td>' + money(cl.interest) + '</td>' +
        '<td>' + cl.day + ' 日</td><td>' + esc(E.statusName(cl.status)) + '</td>' +
        '<td><button class="btn-ghost f-op" data-op="review" data-cid="' + esc(cl.id) + '">案卷复盘</button></td></tr>';
    });
    html += '</table><div class="dim" style="margin-top:8px">案件给付额均为演出数值（锚 research/03 案均&lt;15 万）；时限链与利息口径见《保险法》21→27 条。</div>';
    if (isDone()) {
      html += '<div class="modal-actions"><button id="btn-cl-archive2" class="btn-main">🗂️ 查看理赔季档案</button></div>';
    }
    return html;
  }
  function bindLedger(body) {
    Array.prototype.slice.call(body.querySelectorAll('.f-op')).forEach(function (b) {
      b.addEventListener('click', function () {
        var cl = claimById(b.getAttribute('data-cid'));
        if (cl && cl.status === 'closed') openCaseResultModal(cl);
        else R.toast('案卷尚未结案，先在「① 受理勘察」「② 核定给付」办理。', 'info');
      });
    });
    var a2 = body.querySelector('#btn-cl-archive2');
    if (a2) a2.addEventListener('click', function () { openArchiveModal(); });
  }

  /* ================= 导出 ================= */
  AW.uiClaims = {
    render: render,
    renderP1: function () { tab = 'p1'; render(); },
    renderP2: function () { tab = 'p2'; render(); },
    renderP3: function () { tab = 'p3'; render(); },
    ledgerTab: function () { tab = 'ledger'; render(); },
    openArchiveModal: function () { if (deps()) openArchiveModal(); },
    doFinalize: function () { if (deps()) doFinalize(); },   /* 结算落账（供测试/自动化，同 UI 按钮路径） */
    currentId: function (id) { if (id != null) { curId = id; } return curId; }
  };
})();
