/* =====================================================================
 * 精算工坊 · js/engine/filing.js（第二阶段「监管申报」引擎，GDD-stage2 §14.2）
 * 确定性纯逻辑，不碰 DOM。挂载 AW.filingEngine：
 *   buildFiling(archive)                → filing 对象（自动材料即刻置 ready）
 *   requiredAxes(pid, p)                → [{key,label}] 必选敏感性轴清单
 *   axisCoverage(filing)                → {covered,missing,extra,required}
 *   termDecision(pid, p)                → 决策题对象（按参数分流后）
 *   answerRoute(filing, chosen)         → 路径题判定（答错扣费并强制修正）
 *   signActuary(filing)                 → {ok, reasons[]} 缺必选轴/带R13R14未勾相关轴→拒签
 *   submitFiling(filing[, rng])         → {outcome:'reject'|'inquiry'|'receipt',...}
 *   answerInquiry(filing, optIdx)       → {ok, effect} 答错→书面补充流程
 *   applyReceipt(filing)                → 状态翻转＋回执编号＋奖励增量
 *   completeness(filing) / canFile(archive, filings) / cfgOf / warnsOf / routeOf
 * 判定顺序固定：表述硬错误 →（审批 or 命中概率）问询 → 回执。
 * 旧档兼容：archive 无 cfg/warns 字段时用 getDefaultCfg ＋ 按参数重判 R13/R14 兜底。
 * ===================================================================== */
(function () {
  'use strict';
  var AW = (typeof window !== 'undefined') ? (window.AW = window.AW || {})
                                           : (globalThis.AW = globalThis.AW || {});
  var D = AW.filingData;
  var LONG_LIFE = { term: 1, whole: 1, endowment: 1, annuity: 1 };   // 人寿保险险种→审批
  var SAVINGS = { whole: 1, endowment: 1, annuity: 1 };              // 长期储蓄型→减额交清

  function routeOf(pid) { return LONG_LIFE[pid] ? 'approval' : 'filing'; }
  function routeName(r) { return r === 'approval' ? '审批' : '备案'; }
  function statusName(s) { return D.STATUS_TEXT[s] || s; }

  /* ---------- 旧档兜底 ---------- */
  function cfgOf(archiveLike) {
    if (archiveLike && archiveLike.cfg && typeof archiveLike.cfg === 'object') {
      var out = {}, k;
      for (k in archiveLike.cfg) out[k] = archiveLike.cfg[k];
      return out;
    }
    return AW.getDefaultCfg(archiveLike.pid);   // 旧档无 cfg：默认配置兜底
  }
  function warnsOf(archiveLike) {
    if (archiveLike && archiveLike.warns && typeof archiveLike.warns.length === 'number') {
      return archiveLike.warns.slice();
    }
    /* 按参数重判 R13/R14（GDD-stage2 §14.2） */
    var pid = archiveLike.pid, p = cfgOf(archiveLike), w = [];
    if (p.margin != null && p.margin > 25) w.push('R13');
    if (pid === 'medical' && p.renew === 'y20' && p.inflation != null && p.inflation < 8) w.push('R14');
    return w;
  }

  /* ---------- 必选敏感性轴 ---------- */
  function axisLabel(pid, key) {
    var ax = null, i;
    for (i = 0; i < D.SENS_AXES.length; i++) if (D.SENS_AXES[i].key === key) ax = D.SENS_AXES[i];
    if (!ax) return key;
    return (ax.labelByPid && ax.labelByPid[pid]) ? ax.labelByPid[pid] : ax.label;
  }
  function requiredAxes(pid, p) {
    var req = [];
    function add(key) { req.push({ key: key, label: axisLabel(pid, key) }); }
    if (pid === 'term' || pid === 'ci') {
      add('rate'); add('morbidity');
      if (p.lapse != null && p.lapse >= 15) add('lapse');
    } else if (pid === 'whole' || pid === 'endowment') {
      add('rate');
    } else if (pid === 'annuity') {
      add('rate'); add('longevity');
    } else if (pid === 'ltc') {
      add('rate'); add('morbidity');
    } else if (pid === 'medical') {
      add('claimsVol');
      if (p.renew === 'y6' || p.renew === 'y20') add('medInflation');
    } else if (pid === 'accident') {
      add('claimsVol');
    }
    return req;
  }
  function axisCoverage(filing) {
    var req = requiredAxes(filing.pid, filing.cfg || cfgOf(filing));
    var covered = [], missing = [], extra = [];
    req.forEach(function (a) {
      if (filing.axes.indexOf(a.key) >= 0) covered.push(a); else missing.push(a);
    });
    filing.axes.forEach(function (k) {
      var inReq = false;
      req.forEach(function (a) { if (a.key === k) inReq = true; });
      if (!inReq) extra.push(k);
    });
    return { covered: covered, missing: missing, extra: extra, required: req };
  }

  /* ---------- B1 决策题（数据在 js/data/filing.js，medical/accident 按参数分流） ---------- */
  function termDecision(pid, p) {
    var base = D.TERM_DECISIONS[pid];
    if (!base) return null;
    return (typeof base === 'function') ? base(p) : base;
  }

  /* ---------- F1 路径题 ---------- */
  function answerRoute(filing, chosen) {
    var correct = routeOf(filing.pid);
    if (chosen === correct) {
      filing.route = correct;
      filing.routeFixed = false;
      filing.log.push({ t: '路径', text: '报送路径判定：' + routeName(correct) + '（判定正确）', date: '2026-09' });
      return { ok: true, correct: correct };
    }
    /* 答错：监管退回，扣费扣声望，强制修正为正确路径（不卡死） */
    filing.route = correct;
    filing.routeFixed = true;
    filing.fees += D.FEES.routeWrong.fee;
    filing.log.push({ t: '路径', text: '报送方式错误（误选' + routeName(chosen) + '），监管退回，修正为' + routeName(correct), date: '2026-09' });
    return { ok: false, correct: correct, fee: D.FEES.routeWrong.fee, prestige: D.FEES.routeWrong.prestige };
  }

  /* ---------- F3 总精算师签精算声明（内部治理先于监管） ---------- */
  function signActuary(filing) {
    var reasons = [];
    var cov = axisCoverage(filing);
    if (cov.missing.length) {
      var labels = cov.missing.map(function (a) { return a.label; }).join('、');
      reasons.push({ code: 'AXES', text: '精算报告缺必选敏感性分析：' + labels + '。利润测试不完整，我不能签。' });
    }
    var w = filing.warns || [];
    if (w.indexOf('R13') >= 0 && filing.axes.indexOf('expense') < 0) {
      reasons.push({ code: 'R13', text: '本产品评审遗留警告【R13】风险边际超 25%、定价偏高——请勾选费用率敏感性并在报告中补充利润测试说明，否则我不签。' });
    }
    if (w.indexOf('R14') >= 0 && filing.axes.indexOf('medInflation') < 0) {
      reasons.push({ code: 'R14', text: '本产品评审遗留警告【R14】20 年保证＋通胀假设乐观——请勾选医疗通胀敏感性并按审慎口径重测，否则我不签。' });
    }
    filing.lastSignRefused = reasons.length > 0;
    if (reasons.length) {
      filing.log.push({ t: '签批', text: '总精算师拒签：' + reasons[0].text, date: '2026-09' });
    }
    return { ok: reasons.length === 0, reasons: reasons };
  }

  /* ---------- 表述硬错误（B1 选了陷阱项） ---------- */
  function hardErrorsOf(filing) {
    var dec = termDecision(filing.pid, filing.cfg || cfgOf(filing));
    if (!dec || filing.termChoice == null) return [];
    var opt = null;
    dec.options.forEach(function (o) { if (o.id === filing.termChoice) opt = o; });
    if (!opt || !opt.trap) return [];
    return [{
      id: 'E-' + dec.id,
      text: '「' + dec.theme + '」条款表述与监管口径不符：「' + opt.text + '」——' + (opt.why || ''),
      law: dec.law
    }];
  }

  /* ---------- 问询函命中（按优先级取第一个命中的） ---------- */
  function pickInquiry(filing) {
    var p = filing.cfg || cfgOf(filing);
    for (var i = 0; i < D.INQUIRIES.length; i++) {
      var q = D.INQUIRIES[i], hit = false;
      try { hit = q.cond(filing.pid, p, filing); } catch (e) { hit = false; }
      if (hit) return q;
    }
    return D.INQUIRIES[D.INQUIRIES.length - 1];
  }
  function inquiryById(qid) {
    for (var i = 0; i < D.INQUIRIES.length; i++) if (D.INQUIRIES[i].id === qid) return D.INQUIRIES[i];
    return null;
  }

  /* ---------- 报送（判定顺序固定：硬错误 → 问询 → 回执） ---------- */
  function submitFiling(filing, rng) {
    rng = rng || Math.random;
    if (filing.status === 'receipt') return { outcome: 'locked', text: '已备案条款费率不得擅自修改——修改须重新申报。' };
    var resub = filing.status === 'correcting';
    /* 1. 表述硬错误 → 补正通知（回到 F2 改表述，其他材料保留） */
    var hard = hardErrorsOf(filing);
    if (hard.length) {
      filing.errors = hard;
      filing.status = 'correcting';
      filing.signedActuary = false;
      filing.signedLegal = false;
      filing.log.push({ t: '补正', text: '监管补正通知：' + hard[0].text, date: '2026-09' });
      return { outcome: 'reject', errors: hard, prestige: D.FEES.correction.prestige };
    }
    filing.errors = [];
    /* 2. 报送费与天数（补正重报按补正口径计） */
    var isApp = filing.route === 'approval';
    var fee = resub ? D.FEES.correction.fee : (isApp ? D.FEES.submitApproval.fee : D.FEES.submitFiling.fee);
    var days = resub ? D.FEES.correction.days : (isApp ? D.FEES.submitApproval.days : D.FEES.submitFiling.days);
    filing.fees += fee;
    filing.days += days;
    filing.log.push({ t: '报送', text: resub ? '补正后重新报送（补正重报费 ¥3,000）' : '报送' + routeName(filing.route) + '（' + routeName(filing.route) + '费 ¥' + fee.toLocaleString('zh-CN') + '）', date: '2026-09' });
    /* 3. 问询判定：审批必问询；备案=有警告项 100%，否则按概率 */
    var wantInquiry;
    if (isApp) wantInquiry = true;
    else {
      var w = filing.warns || [];
      wantInquiry = w.length > 0 ? true : (rng() < D.INQUIRY_PROB);
    }
    if (wantInquiry) {
      var q = pickInquiry(filing);
      filing.inquiry = { qid: q.id, picked: null, answeredOk: null, supplemental: false };
      filing.status = 'inquiry';
      filing.days += D.FEES.inquiryRound.days;
      filing.log.push({ t: '问询', text: '收到监管问询函：' + q.title, date: '2026-09' });
      return { outcome: 'inquiry', inquiry: q, fee: fee, days: days };
    }
    filing.status = 'submitted';
    return { outcome: 'receipt', fee: fee, days: days };
  }

  /* ---------- 问询答复（答错→书面补充说明，仍取回执） ---------- */
  function answerInquiry(filing, optIdx) {
    if (!filing.inquiry || filing.inquiry.answeredOk != null) return { ok: false, done: true };
    var q = inquiryById(filing.inquiry.qid);
    var opt = (q && q.options[optIdx]) ? q.options[optIdx] : null;
    if (!opt) return { ok: false, invalid: true };
    filing.inquiry.picked = optIdx;
    filing.inquiry.answeredOk = !!opt.ok;
    if (opt.ok) {
      filing.log.push({ t: '问询', text: '问询答复获监管采纳：' + q.title, date: '2026-09' });
      return { ok: true, prestige: D.FEES.inquiryRight.prestige, option: opt, inquiry: q };
    }
    filing.inquiry.supplemental = true;
    filing.fees += D.FEES.inquiryWrong.fee;
    filing.log.push({ t: '问询', text: '问询答复不充分，提交书面补充说明（¥2,000）', date: '2026-09' });
    return { ok: false, fee: D.FEES.inquiryWrong.fee, prestige: D.FEES.inquiryWrong.prestige, option: opt, inquiry: q };
  }

  /* ---------- 回执（每产品一次；此后锁定） ---------- */
  function applyReceipt(filing) {
    filing.status = 'receipt';
    filing.receiptNo = 'NFRA-2026-' + String(1000 + Math.floor(Math.random() * 9000));
    filing.log.push({ t: '回执', text: '取得' + routeName(filing.route) + '回执/批复文件：' + filing.receiptNo, date: '2026-09' });
    return { prestige: D.FEES.receipt.prestige, receiptNo: filing.receiptNo };
  }

  /* ---------- 申报立项 ---------- */
  function buildFiling(archive) {
    var pid = archive.pid;
    var prod = AW.getProduct(pid);
    var cfg = cfgOf(archive);
    var isLong = prod.type === 'long';
    var route = routeOf(pid);
    var mats = [
      { key: 'form', name: route === 'approval' ? '产品审批申请表' : '产品备案表', ready: true, note: '名称/险种/参数摘要取自《产品精算备忘录》，名称合规复用 R9 结论' },
      { key: 'clause', name: '保险条款（草案）', ready: true, note: '产品模板＋法定三条免责＋犹豫期/等待期表述' },
      { key: 'rate', name: '费率表', ready: true, note: isLong ? '20/30/40/50/60 岁五档每千元保额费率（实时取自定价引擎）' : '一年期产品按年龄档展示保费' },
      { key: 'cv', name: '现金价值表＋计算方法', ready: isLong, na: !isLong, note: isLong ? 't=1 / t=5 示例值与计算方法说明' : '一年期产品无现金价值表' },
      { key: 'report', name: '精算报告（定价假设＋利润测试＋敏感性分析）', ready: false, note: '勾齐必选敏感性轴后视为齐备' }
    ];
    if (SAVINGS[pid]) mats.push({ key: 'paidup', name: '减额交清功能说明', ready: true, note: '长期储蓄型产品自动附加' });
    var dec = termDecision(pid, cfg);
    var f = {
      id: 'FL' + String(Date.now()).slice(-8),
      archId: archive.id,
      name: archive.name, pidName: archive.pidName, pid: pid,
      route: route, routeFixed: false,
      termKey: dec ? dec.id : null, termChoice: null,
      axes: [], status: 'draft',
      errors: [], inquiry: null,
      fees: 0, days: 0, receiptNo: null,
      log: [{ t: '立项', text: '申报立项：' + archive.name + '（评审 ' + (archive.grade || '—') + ' 级归档）', date: '2026-09' }],
      materials: mats, warns: warnsOf(archive), cfg: cfg,
      grade: archive.grade || '', gross: archive.gross || 0,
      signedActuary: false, signedLegal: false
    };
    return f;
  }

  /* ---------- 材料完整度 = 自动项(60) + 表述决策(20) + 必选轴覆盖(20) ----------
   * 精算报告的齐备与否即「必选轴覆盖」，由 20% 一项表达，不计入自动项分母。 */
  function completeness(filing) {
    var cov = axisCoverage(filing);
    var auto = filing.materials.filter(function (m) { return m.key !== 'report'; });
    var ready = 0;
    auto.forEach(function (m) { if (m.ready) ready++; });
    var a = auto.length ? ready / auto.length * 60 : 60;
    var b = filing.termChoice != null ? 20 : 0;
    var c = cov.required.length ? Math.min(1, cov.covered.length / cov.required.length) * 20 : 20;
    return Math.round(a + b + c);
  }

  /* ---------- 重复申报闸门 ---------- */
  function canFile(archive, filings) {
    var i, f;
    for (i = 0; i < filings.length; i++) {
      f = filings[i];
      if (f.archId !== archive.id) continue;
      if (f.status === 'receipt') return { ok: false, reason: 'receipt', text: '已备案条款费率不得擅自修改——修改须重新申报。' };
      return { ok: false, reason: 'active', text: '该产品已有申报进行中（' + statusName(f.status) + '），可继续编制。' };
    }
    return { ok: true };
  }

  AW.filingEngine = {
    routeOf: routeOf, routeName: routeName, statusName: statusName,
    cfgOf: cfgOf, warnsOf: warnsOf,
    axisLabel: axisLabel, requiredAxes: requiredAxes, axisCoverage: axisCoverage,
    termDecision: termDecision, answerRoute: answerRoute,
    signActuary: signActuary, hardErrorsOf: hardErrorsOf,
    pickInquiry: pickInquiry, inquiryById: inquiryById,
    submitFiling: submitFiling, answerInquiry: answerInquiry,
    applyReceipt: applyReceipt, buildFiling: buildFiling,
    completeness: completeness, canFile: canFile
  };
})();
