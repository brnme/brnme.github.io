/* =====================================================================
 * 精算工坊 · js/main.js
 * 入口与状态管理：localStorage（aw_ 前缀）/ 向导流程 / 实时联动 /
 * 知识解锁 / 导师规则 / 评审编排 / 备忘录生成。（GDD §0 §9 §10 §11）
 * ===================================================================== */
(function () {
  'use strict';
  var AW = (typeof window !== 'undefined') ? (window.AW = window.AW || {})
                                           : (globalThis.AW = globalThis.AW || {});
  var SAVE_KEY = 'aw_save_v1';
  var SUBMIT_COST = 20000;
  var RANK_BONUS = 50000;   // 升职 research 补给（README 偏差说明：防止预算枯竭软锁）

  var state = null;

  function freshState() {
    return {
      prestige: 0, budget: 500000, submissions: 0,
      unlockedCards: ['k01'], shownMentor: [], mentorLines: [], archives: [], filings: [], publications: [], sales: [], claims: [], renewal: null,
      firstPassDone: false,
      /* 工作台（不持久化） */
      stage: 1,
      pid: null, clusterId: 'free', step: 1, params: {}, productName: '',
      paramTab: 'A', priced: null, suggestions: [], lastFindings: null, flags: {}
    };
  }
  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        prestige: state.prestige, budget: state.budget, submissions: state.submissions,
        unlockedCards: state.unlockedCards, shownMentor: state.shownMentor,
        mentorLines: state.mentorLines, archives: state.archives, filings: state.filings,
        publications: state.publications, sales: state.sales, claims: state.claims,
        renewal: state.renewal,
        firstPassDone: state.firstPassDone
      }));
    } catch (e) { /* file:// 或隐私模式下静默 */ }
    /* 落账即同步右侧阶段进度面板（阶段二~五）；阶段一幂等重渲仪表盘 */
    if (AW.render && AW.render.renderStageDash) AW.render.renderStageDash();
  }
  function load() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return freshState();
      var s = freshState(), d = JSON.parse(raw);
      ['prestige', 'budget', 'submissions', 'unlockedCards', 'shownMentor', 'mentorLines', 'archives', 'filings', 'publications', 'sales', 'claims', 'renewal', 'firstPassDone'].forEach(function (k) {
        if (d[k] != null) s[k] = d[k];
      });
      return s;
    } catch (e) { return freshState(); }
  }
  function hardReset() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
    state = freshState();
    AW.render.closeModal();
    boot(true);
    AW.render.toast('进度已重置，从助理精算师重新开始。', 'info');
  }

  /* ---------- 工具 ---------- */
  var R = function () { return AW.render; };
  function dateStr() { return '2026-09'; }

  /* ---------- 职级 ---------- */
  function checkRankUp(prevRankIdx) {
    var rk = R().rankOf(state.prestige);
    if (rk.idx > prevRankIdx) {
      state.budget += RANK_BONUS;
      R().toast('🎉 晋职！你现在是 <b>' + rk.name + '</b>，公司追加研发拨款 ¥' + RANK_BONUS.toLocaleString('zh-CN'), 'ok');
    }
  }

  /* ---------- 实时联动 ---------- */
  function recalc() {
    if (!state.pid) { state.priced = null; return; }
    var priced = AW.pricing.price(state.pid, state.params);
    var base = AW.pricing.priceBaseline(state.pid);
    priced.vsBase = priced.gross / base.gross;
    state.priced = priced;
    R().renderDashboard();
    R().updateStep3Live();
    checkMentor();
    checkKnowledge();
  }

  /* ---------- 参数与选择 ---------- */
  function selectProduct(pid) {
    state.pid = pid;
    state.params = AW.getDefaultCfg(pid);
    state.step = Math.max(state.step, 1);
    state.productName = '';
    eventUnlock('product', pid);
    recalc();
    R().renderStep1();
    R().renderStep2();
    R().renderHUD();
    gotoStep(2);
  }
  function selectCluster(cid) {
    state.clusterId = cid;
    eventUnlock('cluster');
    recalc();
    R().renderStep1();
  }
  function setParam(key, val, def) {
    if (key === '____name') { recalc(); return; }
    state.params[key] = val;
    state.flags.firstEngine = true;
    if (def && def.key === 'renew' && state.pid === 'medical') { /* 名称后缀联动，刷新 Step3 */ }
    recalc();
  }
  function gotoStep(n) {
    if (n >= 2 && !state.pid) { R().toast('请先在 Step 1 选择险种', 'warn'); return; }
    state.step = n;
    ['1', '2', '3'].forEach(function (s) {
      var el = document.getElementById('step' + s);
      if (!el) return;
      el.classList.toggle('on', parseInt(s, 10) === n);
      if (parseInt(s, 10) === n) { el.classList.remove('slide-in'); void el.offsetWidth; el.classList.add('slide-in'); }
    });
    document.querySelectorAll('.wtab').forEach(function (b) {
      b.classList.toggle('on', parseInt(b.getAttribute('data-step'), 10) === n);
    });
    if (n === 3) { eventUnlock('step3'); R().renderStep3(); recalc(); }
    if (n === 2) { state.flags.firstStep2 = true; eventUnlock('step2'); checkMentor(); }
  }

  /* ---------- 阶段切换（stage 1 产品设计 / 2 监管申报 / 3 批复公示 / 4 上架销售 / 5 理赔季 / 6 续期经营季） ---------- */
  function gotoStage(n) {
    var stage = (n === 2 || n === 3 || n === 4 || n === 5 || n === 6) ? n : 1;
    state.stage = stage;
    var tabs = document.getElementById('wizard-tabs');
    var filingEl = document.getElementById('filing');
    var approvalEl = document.getElementById('approval');
    var salesEl = document.getElementById('sales');
    var claimsEl = document.getElementById('claims');
    var renewalEl = document.getElementById('renewal');
    var sub = document.getElementById('hud-sub');
    var SUBS = { 1: '精算工坊 · 第一阶段「产品设计」', 2: '精算工坊 · 第二阶段「监管申报」', 3: '精算工坊 · 第三阶段「批复公示」', 4: '精算工坊 · 第四阶段「上架销售」', 5: '精算工坊 · 第五阶段「理赔季：勘察与结算」', 6: '精算工坊 · 第六阶段「续期经营季：回溯与调价」' };
    if (tabs) tabs.style.display = stage === 1 ? '' : 'none';
    ['1', '2', '3'].forEach(function (s) {
      var el = document.getElementById('step' + s);
      if (!el) return;
      if (stage === 1) { el.style.display = ''; el.classList.remove('on'); }
      else el.style.display = 'none';
    });
    if (filingEl) {
      filingEl.style.display = stage === 2 ? '' : 'none';
      filingEl.classList.toggle('on', stage === 2);
    }
    if (approvalEl) {
      approvalEl.style.display = stage === 3 ? '' : 'none';
      approvalEl.classList.toggle('on', stage === 3);
    }
    if (salesEl) {
      salesEl.style.display = stage === 4 ? '' : 'none';
      salesEl.classList.toggle('on', stage === 4);
    }
    if (claimsEl) {
      claimsEl.style.display = stage === 5 ? '' : 'none';
      claimsEl.classList.toggle('on', stage === 5);
    }
    if (renewalEl) {
      renewalEl.style.display = stage === 6 ? '' : 'none';
      renewalEl.classList.toggle('on', stage === 6);
    }
    if (sub) sub.textContent = SUBS[stage];
    R().renderStages();
    R().renderStageDash();
    if (stage === 2) { if (AW.uiFiling && AW.uiFiling.render) AW.uiFiling.render(); }
    else if (stage === 3) { if (AW.uiApproval && AW.uiApproval.render) AW.uiApproval.render(); }
    else if (stage === 4) { if (AW.uiSales && AW.uiSales.render) AW.uiSales.render(); }
    else if (stage === 5) { if (AW.uiClaims && AW.uiClaims.render) AW.uiClaims.render(); }
    else if (stage === 6) { if (AW.uiRenewal && AW.uiRenewal.render) AW.uiRenewal.render(); }
    else gotoStep(state.step || 1);
  }

  /* ---------- 名称 ---------- */
  function nameCategorySuffix() {
    if (!state.pid) return '';
    var prod = AW.getProduct(state.pid);
    var sfx = prod.cat;
    if (state.pid === 'medical' && state.params.renew === 'y20') sfx = '医疗保险（费率可调）';
    return sfx;
  }
  function fullProductName() {
    return '南山人寿' + (state.productName || '') + nameCategorySuffix();
  }

  /* ---------- 知识解锁 ---------- */
  function unlockCard(id, silent) {
    if (state.unlockedCards.indexOf(id) >= 0) return false;
    state.unlockedCards.push(id);
    var card = AW.knowledge.getCard(id);
    if (card && !silent) {
      R().toast('📖 解锁知识卡「' + card.title + '」（' + state.unlockedCards.length + '/' + AW.knowledge.cards.length + '）', 'card');
    }
    R().renderHUD();
    save();
    return true;
  }
  function checkKnowledge() {
    var p = state.priced ? state.priced.params : state.params;
    AW.knowledge.cards.forEach(function (c) {
      if (state.unlockedCards.indexOf(c.id) >= 0) return;
      var u = c.unlock;
      if (u.t !== 'param') return;
      if (u.pid && u.pid !== state.pid) return;
      var v = p[u.key];
      if (v == null) return;
      var num = typeof u.v === 'number';
      var val = num ? parseFloat(v) : String(v);
      var target = u.v;
      var hit = (u.op === 'eq' && val === target) || (u.op === 'gte' && val >= target) || (u.op === 'lte' && val <= target);
      if (hit) unlockCard(c.id);
    });
  }
  function eventUnlock(e, pid) {
    AW.knowledge.cards.forEach(function (c) {
      if (state.unlockedCards.indexOf(c.id) >= 0) return;
      var u = c.unlock;
      if (u.t !== 'event' || u.e !== e) return;
      if (u.pid && u.pid !== pid) return;
      unlockCard(c.id);
    });
  }

  /* ---------- 导师 ---------- */
  function checkMentor() {
    if (!state.pid || !state.priced) return;
    var ctx = {
      pid: state.pid, p: state.priced.params, priced: state.priced,
      filing: (state.filings && state.filings[0]) || null,
      flags: {
        firstStep2: !!state.flags.firstStep2 && !state.shownMentorDone_Step2,
        firstEngine: !!state.flags.firstEngine && !state.shownMentorDone_Engine,
        firstPass: state.flags.firstPassPending || false
      }
    };
    AW.mentor.rules.forEach(function (rule) {
      if (state.shownMentor.indexOf(rule.id) >= 0) return;
      var ok = false;
      try { ok = rule.when(ctx); } catch (e) { ok = false; }
      if (ok) {
        state.shownMentor.push(rule.id);
        R().pushMentor(rule.text);
        if (rule.id === 'm_step2') ctx.flags.firstStep2 = false;
      }
    });
    save();
  }
  /* 阶段二导师检查：evt ∈ route/sign_refused/axes_extra/hard_error/inquiry_ok/receipt */
  function checkMentorFiling(evt, filing) {
    if (!filing) return;
    var ctx = {
      pid: filing.pid,
      p: (AW.filingEngine ? AW.filingEngine.cfgOf(filing) : {}),
      filing: filing, event: evt,
      priced: null,
      flags: {}
    };
    AW.mentor.rules.forEach(function (rule) {
      if (state.shownMentor.indexOf(rule.id) >= 0) return;
      var ok = false;
      try { ok = rule.when(ctx); } catch (e) { ok = false; }
      if (ok) {
        state.shownMentor.push(rule.id);
        R().pushMentor(rule.text);
      }
    });
    save();
  }

  /* ---------- 阶段三导师检查：evt ∈ interpret_wrong/interpret_allok/disc_trap/disc_noise/
   * disc_refused/disc_launch/event_ok/event_bad/published ---------- */
  function checkMentorApproval(evt, pub) {
    if (!pub) return;
    var ctx = {
      pid: pub.pid,
      p: pub.cfg || {},
      publication: pub, event: evt,
      filing: null, priced: null,
      flags: {}
    };
    AW.mentor.rules.forEach(function (rule) {
      if (state.shownMentor.indexOf(rule.id) >= 0) return;
      var ok = false;
      try { ok = rule.when(ctx); } catch (e) { ok = false; }
      if (ok) {
        state.shownMentor.push(rule.id);
        R().pushMentor(rule.text);
      }
    });
    save();
  }

  /* ---------- 阶段四导师检查：evt ∈ channel_wrong/commission_b/commission_c/
   * material_trap/material_refused/event_ok/event_bad/trace_ok/trace_bad/listed ---------- */
  function checkMentorSales(evt, sale) {
    if (!sale) return;
    var ctx = {
      pid: sale.pid,
      p: sale.cfg || {},
      sale: sale, event: evt,
      publication: null, filing: null, priced: null,
      flags: {}
    };
    AW.mentor.rules.forEach(function (rule) {
      if (state.shownMentor.indexOf(rule.id) >= 0) return;
      var ok = false;
      try { ok = rule.when(ctx); } catch (e) { ok = false; }
      if (ok) {
        state.shownMentor.push(rule.id);
        R().pushMentor(rule.text);
      }
    });
    save();
  }

  /* ---------- 阶段五导师检查：evt ∈ tier_wrong/doc_trap/case_conceal/case_gratia/
   * case_beneficiary/case_late/deny_bad/finalized ---------- */
  function checkMentorClaims(evt, claim) {
    if (!claim) return;
    var ctx = {
      pid: claim.pid,
      p: {},
      claim: claim, event: evt,
      sale: null, publication: null, filing: null, priced: null,
      flags: {}
    };
    AW.mentor.rules.forEach(function (rule) {
      if (state.shownMentor.indexOf(rule.id) >= 0) return;
      var ok = false;
      try { ok = rule.when(ctx); } catch (e) { ok = false; }
      if (ok) {
        state.shownMentor.push(rule.id);
        R().pushMentor(rule.text);
      }
    });
    save();
  }

  /* ---------- 续期经营季导师（v6.0，m_r_* 规则） ---------- */
  function checkMentorRenewal(evt) {
    var rn = state.renewal;
    var ctx = {
      pid: null,
      p: {},
      renewal: rn, event: evt,
      claim: null, sale: null, publication: null, filing: null, priced: null,
      flags: {}
    };
    AW.mentor.rules.forEach(function (rule) {
      if (state.shownMentor.indexOf(rule.id) >= 0) return;
      var ok = false;
      try { ok = rule.when(ctx); } catch (e) { ok = false; }
      if (ok) {
        state.shownMentor.push(rule.id);
        R().pushMentor(rule.text);
      }
    });
    save();
  }

  /* ---------- 评审 ---------- */
  function submitReview() {
    if (!state.pid || !state.priced) { R().toast('请先完成产品设计', 'warn'); return; }
    if (state.budget < SUBMIT_COST) { R().toast('研发预算不足（每次评审消耗 ¥20,000）', 'bad'); return; }
    var prevRank = R().rankOf(state.prestige).idx;
    state.budget -= SUBMIT_COST;
    state.submissions += 1;
    eventUnlock('review');
    var findings = AW.compliance.check(state.pid, state.params, state.priced, state.productName);
    var result = AW.scoring.score(state.pid, state.params, state.priced, findings, state.clusterId);
    /* 奖惩 */
    if (result.verdict === 'pass') {
      var bonus = result.grade === 'S' ? 5 : result.grade === 'A' ? 3 : 0;
      state.prestige += 8 + bonus;
      if (!state.firstPassDone) { state.firstPassDone = true; state.flags.firstPassPending = true; }
      var locked = AW.knowledge.cards.filter(function (c) { return state.unlockedCards.indexOf(c.id) < 0; });
      for (var i = 0; i < 2 && locked.length; i++) {
        var idx = Math.floor(Math.random() * locked.length);
        unlockCard(locked.splice(idx, 1)[0].id);
      }
    } else {
      state.prestige = Math.max(0, state.prestige - 3);
    }
    checkRankUp(prevRank);
    /* 修改建议（驳回/打回时留在工作台） */
    state.suggestions = result.verdict === 'pass' ? [] :
      findings.findings.filter(function (f) { return f.status === 'reject'; })
        .map(function (f) { return '【' + f.id + '】' + f.text; })
        .concat(result.cheapHint ? ['竞争力提示：r<0.7，存在低价竞争 / 定价不足嫌疑'] : []);
    /* 备忘录归档（仅通过） */
    var archive = null;
    if (result.verdict === 'pass') {
      archive = buildMemo(findings, result);
      state.archives.unshift(archive);
    }
    save();
    R().renderHUD();
    R().renderStep3();
    var ctx = { p: state.priced.params, productName: fullProductName(), archive: archive };
    R().reviewModal(findings, result, ctx, null);
    /* 奖励 toast */
    setTimeout(function () {
      if (result.verdict === 'pass') {
        R().toast('✅ 评审通过！声望 +8' + (result.grade === 'S' ? '（S 级额外 +5）' : result.grade === 'A' ? '（A 级额外 +3）' : '') + '，产品已归档', 'ok');
        if (state.flags.firstPassPending) {
          checkMentor();   // 先让 m_pass 规则读到 pending 标记
          state.flags.firstPassPending = false;
          save();
        }
      } else {
        R().toast(result.verdict === 'reject' ? '❌ 评审驳回：声望 −3，预算不退。修改建议已留在 Step 3。' : '⚠ 打回暂缓：总分不足 60。修改后重新提交。', 'bad');
      }
    }, 500);
  }

  /* ---------- 备忘录 ---------- */
  function buildMemo(findings, result) {
    var prod = AW.getProduct(state.pid);
    var p = state.priced.params;
    var r = state.priced;
    var paramRows = [];
    AW.getParams(state.pid).forEach(function (d) {
      var v = p[d.key];
      var txt = '' + v;
      if (d.type === 'select' && d.options) {
        d.options.forEach(function (o) { if (String(o.v) === String(v)) txt = o.l; });
      } else if (d.type === 'slider') { txt = v + d.unit; }
      paramRows.push([d.label, txt]);
    });
    var thoughts = memoThoughts(state.pid);
    var signoff = memoSignoff(findings, result);
    var memoText = [
      '《产品精算备忘录》',
      '产品名称：' + fullProductName(),
      '险种类别：' + prod.name + '（' + prod.tagline + '）',
      '评审时间：' + dateStr() + ' · 评级：' + result.grade + '（总分 ' + result.total.toFixed(1) + '）· 结论：通过·准予报送备案',
      '',
      '—— 参数摘要 ——'
    ].concat(paramRows.map(function (x) { return x[0] + '：' + x[1]; })).concat([
      '',
      '—— 保费与费率 ——',
      '首年保费（均衡）：' + R().money(r.gross) + '；续期同',
      r.perThousand > 0 ? '每千元保额费率：' + R().money2(r.perThousand) : '费率口径：以年领取额/月给付额为基准',
      '定价赔付率：' + R().pct(r.lr) + '；实现赔付率：' + R().pct(r.lrReal || r.lr),
      '实现利润率：' + R().pct(r.piReal) + '；vs 市场基准 r=' + r.vsBase.toFixed(2),
      '',
      '—— 四维得分 ——',
      '合规 ' + result.compliance.toFixed(0) + ' / 盈利 ' + result.profit + ' / 竞争力 ' + result.competitive.toFixed(0) + ' / 风控 ' + result.risk.toFixed(0),
      '风险五轴：' + result.riskAxes.map(function (a) { return a.key + ' ' + Math.round(a.val); }).join(' · '),
      '',
      '—— 设计思想解读 ——'
    ]).concat(thoughts.map(function (t, i) { return (i + 1) + '. ' + t; })).concat([
      '',
      '—— 总精算师签批意见 ——',
      signoff,
      '',
      '（本备忘录由《精算工坊》生成 · 公司与人物均为虚构 · 监管口径快照 2026-09）'
    ]).join('\n');
    return {
      id: 'AR' + String(Date.now()).slice(-8),
      name: fullProductName(), pidName: prod.name, pid: state.pid,
      grade: result.grade, total: result.total, date: '2026-09',
      gross: r.gross, perThousand: r.perThousand, lr: r.lr, lrReal: r.lrReal || r.lr,
      piReal: r.piReal, r: r.vsBase,
      cfg: JSON.parse(JSON.stringify(state.params)),                       /* 阶段二申报引擎用：参数快照 */
      warns: findings.findings.filter(function (f) { return f.status === 'warn'; }).map(function (f) { return f.id; }),
      scoreAxes: [
        { key: '合规', val: result.compliance }, { key: '盈利', val: result.profit },
        { key: '竞争力', val: result.competitive }, { key: '风控', val: result.risk }
      ],
      paramRows: paramRows, thoughts: thoughts, signoff: signoff, memoText: memoText
    };
  }
  var THOUGHT_MAP = {
    term: ['k01', 'k11', 'k07'], whole: ['k09', 'k12', 'k25'], endowment: ['k10', 'k12', 'k09'],
    annuity: ['k03', 'k12', 'k22'], medical: ['k13', 'k17', 'k28'], ci: ['k27', 'k04', 'k12'],
    accident: ['k29', 'k18', 'k05'], ltc: ['k30', 'k12', 'k07']
  };
  function memoThoughts(pid) {
    return (THOUGHT_MAP[pid] || ['k01', 'k07', 'k19']).map(function (id) {
      var c = AW.knowledge.getCard(id);
      return c ? ('《' + c.title + '》' + c.text) : '';
    }).filter(function (x) { return x; });
  }
  function memoSignoff(findings, result) {
    if (result.grade === 'S') return '假设审慎、结构漂亮，是可以放进教材的产品。准予报送备案——期待它在真实市场里的回溯表现。';
    if (result.grade === 'A') return '整体扎实，个别假设仍有收紧空间。准予报送备案，上市后密切跟踪继续率与赔付率。';
    if (result.grade === 'B') return '可以报送。但请把利润测试的敏感性分析补厚一页——市场不会永远配合你的假设。';
    return '勉强过线。定价与风控之间还有明显张力，下一版产品请把风险边际的论证写充分。';
  }

  /* ---------- 复制 ---------- */
  function copyText(t) {
    var done = function () {};
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).catch(function () { fallbackCopy(t); });
    } else fallbackCopy(t);
  }
  function fallbackCopy(t) {
    var ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }

  /* ---------- 启动 ---------- */
  function wire() {
    document.querySelectorAll('.wtab').forEach(function (b) {
      b.addEventListener('click', function () { gotoStep(parseInt(b.getAttribute('data-step'), 10)); });
    });
    document.querySelector('#btn-gallery').addEventListener('click', function () { R().galleryModal(); });
    document.querySelector('#btn-archives').addEventListener('click', function () { R().archivesModal(); });
    document.querySelector('#btn-reset').addEventListener('click', function () { R().resetModal(); });
  }
  function boot(isReset) {
    R().renderHUD();
    R().renderStages();
    R().renderStep1();
    R().renderStep2();
    R().renderStep3();
    R().renderDashboard();
    gotoStage(1);
    if (state.mentorLines.length) {
      document.querySelector('#mentor-lines').innerHTML = state.mentorLines.map(function (t) {
        return '<div class="mentor-line">' + String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</div>';
      }).join('');
    } else {
      R().pushMentor('欢迎来到产品精算部。我是总精算师陈砚——在这里，你卖出的每一份承诺，都要用几十年的假设兑现。先从 Step 1 选一个险种开始。');
    }
  }
  function init() {
    wire();
    boot(false);
    eventUnlock('start');
    save();
  }
  state = load();
  /* scoring.amCoeffs 需要 clusterId；暴露 getter（hardReset 会替换 state 引用）。
   * 必须先于 init() 定义，避免初始化期间 AW.state 为 undefined。 */
  Object.defineProperty(AW, 'state', {
    get: function () { return state; },
    configurable: true
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  AW.main = {
    selectProduct: selectProduct, selectCluster: selectCluster, setParam: setParam,
    gotoStep: gotoStep, gotoStage: gotoStage, submitReview: submitReview, hardReset: hardReset,
    fullProductName: fullProductName, nameCategorySuffix: nameCategorySuffix,
    copyText: copyText, eventUnlock: eventUnlock,
    save: save, checkMentorFiling: checkMentorFiling, checkMentorApproval: checkMentorApproval,
    checkMentorSales: checkMentorSales, checkMentorClaims: checkMentorClaims,
    checkMentorRenewal: checkMentorRenewal
  };
})();
