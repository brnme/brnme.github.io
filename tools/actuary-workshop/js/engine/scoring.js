/* =====================================================================
 * 精算工坊 · js/engine/scoring.js
 * 四维评分 + 逆选择/道德风险实现系数（GDD §6.4 §8）。
 * ===================================================================== */
(function () {
  'use strict';
  var AW = (typeof window !== 'undefined') ? (window.AW = window.AW || {})
                                           : (globalThis.AW = globalThis.AW || {});

  /* ---------- §6.4 「实际预期」修正系数 ---------- */
  function amCoeffs(pid, p) {
    var a = 0, m = 0;
    /* 逆选择 a */
    if (p.underwriting === 'loose') a += 0.18;
    else if (p.underwriting === 'std') a += 0.08;
    else if (p.underwriting === 'strict') a += 0;
    if (p.wait === 0) a += 0.15;
    else if (p.wait < 30) a += 0.08;
    if (pid === 'medical' && p.renew === 'y20') a += 0.06;
    var cluster = (typeof AW.state !== 'undefined' && AW.state.clusterId) || 'free';
    if (cluster === 'silver' && (pid === 'medical' || pid === 'ltc' || pid === 'ci')) a += 0.12;
    if (p.exclusion === 'wide') a += 0.04;
    /* 道德风险 m */
    if (pid === 'medical') {
      if (parseInt(p.deduct, 10) === 0) m += 0.18;
      else if (parseInt(p.deduct, 10) <= 5000) m += 0.08;
      if (p.payRatio === '100') m += 0.06;
    }
    if (pid === 'accident') {
      if (p.medRider === 'm0100') m += 0.06;
      var allow = p.allowance === 'none' ? 0 : parseInt(p.allowance.slice(1), 10);
      if (allow >= 100) m += 0.04;
    }
    if (pid === 'ci' && (p.extra60 === '80' || p.extra60 === '100')) m += 0.03;
    return { a: a, m: m };
  }

  /* ---------- 富责任度 R（0-100） ---------- */
  function richness(pid, p) {
    var prod = AW.getProduct(pid);
    var R = 60, items = [];
    for (var i = 0; i < prod.richness.length; i++) {
      var it = prod.richness[i];
      if (it.when(p)) { R += it.pts; items.push(it.label); }
    }
    return { R: Math.min(100, R), items: items };
  }

  /* ---------- 风控五轴 ---------- */
  function termN(pid, p) {
    var def = AW.getDefaultCfg(pid), q = {}, k;
    for (k in def) q[k] = def[k];
    for (k in p) q[k] = p[k];
    var age = q.age || 30;
    if (pid === 'term') return q.term === 'to60' ? Math.max(1, 60 - age) : q.term === 'to70' ? Math.max(1, 70 - age) : parseInt(q.term, 10);
    if (pid === 'whole') return 75;
    if (pid === 'endowment') return parseInt(q.term, 10);
    if (pid === 'ci') return q.term === 'to70' ? Math.max(1, 70 - age) : q.term === '30' ? 30 : 75;
    if (pid === 'ltc') return q.term === 'to70' ? Math.max(1, 70 - age) : q.term === 'to80' ? Math.max(1, 80 - age) : 75;
    if (pid === 'annuity') return Math.max(1, parseInt(q.startAge, 10) - age + 20);
    return 10;
  }

  function riskAxes(pid, p, priced) {
    var axes = [];
    var a = priced.a || 0, m = priced.m || 0;
    axes.push({ key: '逆选择', val: Math.max(0, 100 - 100 * a) });
    axes.push({ key: '道德风险', val: Math.max(0, 100 - 100 * m) });
    var isLong = AW.getProduct(pid).type === 'long';
    var rateRisk = 100;
    if (isLong) {
      var durW = (pid === 'whole' || pid === 'annuity' || pid === 'ltc') ? 15 : Math.min(15, termN(pid, p) * 0.25);
      rateRisk = Math.max(0, 100 - (p.rate / 2) * 60 - durW);
    }
    axes.push({ key: '利率风险', val: rateRisk });
    var inflRisk = 100;
    if (pid === 'medical') {
      var coeff = p.renew === 'y20' ? 2.2 : p.renew === 'y6' ? 1.2 : 0.5;
      inflRisk = Math.max(0, 100 - Math.max(0, 10 - p.inflation) * 12 * coeff);
    }
    axes.push({ key: '通胀风险', val: inflRisk });
    var rep = 100;
    if ((priced.lr || 1) < 0.5) rep = 40;
    if (pid === 'term' && p.lapse >= 20) rep -= 20;
    if (p.exclusion === 'wide') rep -= 10;
    axes.push({ key: '声誉风险', val: Math.max(0, rep) });
    var sum = 0;
    for (var i = 0; i < axes.length; i++) sum += axes[i].val;
    return { axes: axes, avg: sum / axes.length };
  }

  /* ---------- 主评分 ---------- */
  function score(pid, cfg, priced, findings, clusterId) {
    var cnt = findings.cnt;
    /* 合规分 */
    var comp = Math.max(0, 100 - 40 * cnt.reject - 15 * cnt.warn - 5 * cnt.info);
    var hasReject = cnt.reject > 0;
    /* 盈利分 */
    var pi = priced.piReal != null ? priced.piReal : (1 - priced.lr * (1 + (priced.a || 0) + (priced.m || 0)) - priced.expenseRatio);
    var profit;
    if (pi < 0) profit = 20; else if (pi < 0.05) profit = 55; else if (pi < 0.15) profit = 100;
    else if (pi <= 0.25) profit = 70; else profit = 45;
    /* 竞争力分 */
    var base = AW.pricing.priceBaseline(pid);
    var r = priced.gross / base.gross;
    var rich = richness(pid, priced.params);
    var vRatio = rich.R / Math.max(r, 0.5);
    var vScore = vRatio >= 110 ? 95 : vRatio >= 90 ? 85 : vRatio >= 70 ? 65 : vRatio >= 50 ? 40 : 25;
    var cluster = null, cl;
    for (var i = 0; i < AW.clusters.length; i++) if (AW.clusters[i].id === clusterId) cluster = AW.clusters[i];
    if (!cluster) cluster = AW.clusters[4];
    var wPrice = cluster.priceSens === 'high' ? 0.5 : cluster.priceSens === 'low' ? 0.15 : 0.3;
    var priceScore = r <= 0.8 ? 95 : r <= 0.9 ? 85 : r <= 1.0 ? 70 : r <= 1.15 ? 55 : 35;
    var competitive = vScore * (1 - wPrice) + priceScore * wPrice;
    var mismatch = false;
    if (cluster.fit && cluster.fit.indexOf(pid) < 0) { competitive -= 15; mismatch = true; }
    competitive = Math.max(0, competitive);
    var cheapHint = r < 0.7;
    /* 风控分 */
    var risk = riskAxes(pid, priced.params, priced);
    var total = comp * 0.35 + profit * 0.25 + competitive * 0.25 + risk.avg * 0.15;
    var grade = total >= 90 ? 'S' : total >= 80 ? 'A' : total >= 70 ? 'B' : total >= 60 ? 'C' : 'D';
    var verdict = hasReject ? 'reject' : (total < 60 ? 'redo' : 'pass');
    return {
      compliance: comp, profit: profit, competitive: competitive, risk: risk.avg,
      total: total, grade: grade, verdict: verdict,
      piReal: pi, r: r, richness: rich, vRatio: vRatio, vScore: vScore, priceScore: priceScore,
      mismatch: mismatch, cheapHint: cheapHint, cluster: cluster,
      riskAxes: risk.axes, wPrice: wPrice
    };
  }

  AW.scoring = { score: score, amCoeffs: amCoeffs, richness: richness, riskAxes: riskAxes };
})();
