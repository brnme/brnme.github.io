/* =====================================================================
 * 精算工坊 · js/engine/pricing.js
 * 定价引擎（GDD §6）：长期险年度离散模型 + 短期险因子模型。
 * 长期模型：v=1/(1+i)，年末给付，均衡保费；
 *   inforce_prem_k = kpx·(1-lapsePrem)^k（保费端）
 *   inforce_ben_k  = kpx·(1-lapseBen)^k （给付端，各险种简化口径见 README）
 *   G = PVben·(1+margin) / Σ v^k·inforce_prem_k·(1-e_k)
 * 校准因子见 tables.js CALIB（构建期按 §6.5 基准区间标定）。
 * ===================================================================== */
(function () {
  'use strict';
  var AW = (typeof window !== 'undefined') ? (window.AW = window.AW || {})
                                           : (globalThis.AW = globalThis.AW || {});
  var T = AW.tables, C = T.CALIB, MAXAGE = T.MAX_AGE;

  /* ---------- 基础工具 ---------- */
  function v(rate) { return 1 / (1 + rate); }

  /* 生存链：kpx[k] = Π_{j<k}(1-q_j)，q 数组长 n */
  function survival(qs) {
    var kpx = [1], k;
    for (k = 0; k < qs.length - 1; k++) kpx.push(kpx[k] * (1 - qs[k]));
    return kpx;
  }
  function qSeq(x, n, gender, annuityBasis) {
    var qs = [], k;
    for (k = 0; k < n; k++) qs.push(T.qx(x + k, gender, annuityBasis));
    return qs;
  }
  /* 费用调整后的保费现值分母：Σ v^k·inforce·(1-e_k)
   * 护栏：极端滑杆（趸交+首年费用>100%）下分母可为负，按现值的 5% 封底 */
  function expenseDenom(pvPrem, e0, er) {
    return Math.max(pvPrem - e0 - er * (pvPrem - 1), pvPrem * 0.05);
  }
  /* 长期险通用汇总 */
  function summarize(pvBen, pvPrem, e0, er, margin, sa) {
    var denom = expenseDenom(pvPrem, e0, er);
    var gross = pvBen * (1 + margin) / denom;
    var lr = pvBen / (gross * pvPrem);              // 定价赔付率（含费用口径）
    var expenseRatio = (pvPrem - denom) / pvPrem;   // 费用现值占毛保费现值
    return {
      gross: gross, renewal: gross,
      perThousand: sa > 0 ? gross / sa * 1000 : 0,  // 每千元保额费率
      lr: lr, expenseRatio: expenseRatio, margin: margin,
      pvBen: pvBen, pvPrem: pvPrem
    };
  }
  function termYearsN(pid, p, age) {
    var n;
    if (pid === 'term') {
      n = p.term === '20' ? 20 : p.term === '30' ? 30 : p.term === 'to60' ? 60 - age : 70 - age;
    } else if (pid === 'whole') { n = MAXAGE - age; }
    else if (pid === 'endowment') { n = parseInt(p.term, 10); }
    else if (pid === 'ci') { n = p.term === '30' ? 30 : p.term === 'to70' ? 70 - age : MAXAGE - age; }
    else if (pid === 'ltc') { n = p.term === 'to70' ? 70 - age : p.term === 'to80' ? 80 - age : MAXAGE - age; }
    return Math.max(1, Math.min(n, MAXAGE - age));
  }
  function payYearsM(p, n, maxM) {
    var m;
    if (p.pay === '1' || p.pay === 'single') m = 1;
    else if (p.pay === 'term' || p.pay === 'life') m = n;
    else m = parseInt(p.pay, 10);
    return Math.max(1, Math.min(m, maxM || n));
  }
  /* IRR：二分法解 NPV=0。cfs = [{k, amt}]（amt 有正负） */
  function irr(cfs) {
    function npv(r) {
      var s = 0;
      for (var i = 0; i < cfs.length; i++) s += cfs[i].amt / Math.pow(1 + r, cfs[i].k);
      return s;
    }
    var lo = -0.05, hi = 1.0, i, flo = npv(lo), fhi = npv(hi), mid, fm;
    if (flo * fhi > 0) return null;
    for (i = 0; i < 80; i++) {
      mid = (lo + hi) / 2; fm = npv(mid);
      if (flo * fm <= 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  }

  /* ---------- 4.1 定期寿险 ---------- */
  function priceTerm(p) {
    var age = p.age, n = termYearsN('term', p, age), m = payYearsM(p, n);
    var i = p.rate / 100, vv = v(i), sa = p.sa * 10000;
    var c = 1 - p.lapse / 100;                       // lapse 同时作用保费端与给付端
    var qs = qSeq(age, n, p.gender), kpx = survival(qs), k;
    var pvBen = 0, pvPrem = 0;
    for (k = 0; k < n; k++) pvBen += Math.pow(vv, k + 1) * kpx[k] * Math.pow(c, k) * qs[k] * sa;
    for (k = 0; k < m; k++) pvPrem += Math.pow(vv, k) * kpx[k] * Math.pow(c, k);
    var r = summarize(pvBen, pvPrem, p.expFirst / 100, p.expRenew / 100, p.margin / 100, sa);
    r.cv = cashValue('term', p, r);
    return r;
  }

  /* ---------- 4.2 终身寿险 ---------- */
  function priceWhole(p) {
    var age = p.age, n = termYearsN('whole', p, age), m = payYearsM(p, n);
    var i = p.rate / 100, vv = v(i), sa = p.sa * 10000;
    var cPrem = 0.95, cBen = 1 - C.wholeBenLapse;    // 储蓄型：保费端 lapse 5%，给付端不衰减
    var qs = qSeq(age, n, p.gender), kpx = survival(qs), k;
    var pvBen = 0, pvPrem = 0, wSum = 0, wK = 0;
    for (k = 0; k < n; k++) {
      pvBen += Math.pow(vv, k + 1) * kpx[k] * Math.pow(cBen, k) * qs[k] * sa;
      wSum += kpx[k] * qs[k]; wK += k * kpx[k] * qs[k];
    }
    for (k = 0; k < m; k++) pvPrem += Math.pow(vv, k) * kpx[k] * Math.pow(cPrem, k);
    var r = summarize(pvBen, pvPrem, p.expFirst / 100, p.expRenew / 100, p.margin / 100, sa);
    var expDeathK = wSum > 0 ? wK / wSum + 1 : 40;   // 期望身故年
    var cfs = [], kk;
    for (kk = 0; kk < m; kk++) cfs.push({ k: kk, amt: -r.gross });
    cfs.push({ k: Math.round(expDeathK), amt: sa });
    r.irr = irr(cfs);
    r.extras = { irrNote: '持有至身故（期望 ' + Math.round(age + expDeathK) + ' 岁）的内部收益率' };
    r.cv = cashValue('whole', p, r);
    return r;
  }

  /* ---------- 4.3 两全保险 ----------
   * 满期生存金以「已缴保费的保额等价口径」实现（基数=保额×比例），
   * 原因：满期金若按毛保费自洽求解会产生循环定价使保费塌缩（约为市场价 1/6），
   * 与 §6.5 市场基准冲突；基准目标不可改，详见 README 偏差说明。
   * 年度生存金按两段式：先算 G1（无年度生存金），再以 G1·已缴期数为基数折入。 */
  function priceEndowment(p) {
    var age = p.age, n = termYearsN('endowment', p, age), m = payYearsM(p, n);
    var i = p.rate / 100, vv = v(i), sa = p.sa * 10000;
    var cPrem = 1 - C.endowPremLapse, cBen = 1 - C.endowBenLapse;
    var qs = qSeq(age, n, p.gender), kpx = survival(qs), k;
    var pvDeath = 0, pvPrem = 0;
    for (k = 0; k < n; k++) pvDeath += Math.pow(vv, k + 1) * kpx[k] * Math.pow(cBen, k) * qs[k] * sa;
    for (k = 0; k < m; k++) pvPrem += Math.pow(vv, k) * kpx[k] * Math.pow(cPrem, k);
    var npx = kpx[Math.min(n, kpx.length - 1)];      // 生存至满期
    var pvMat = Math.pow(vv, n) * npx * (parseInt(p.matureRatio, 10) / 100) * sa;
    var pvBen1 = pvDeath + pvMat;
    var denom = expenseDenom(pvPrem, p.expFirst / 100, p.expRenew / 100);
    var g1 = pvBen1 * (1 + p.margin / 100) / denom;
    var gross = g1, pvSurvCash = 0;
    if (p.survStart && p.survStart !== 'none') {
      var start = Math.max(1, parseInt(p.survStart, 10)), ratio = parseInt(p.survRatio, 10) / 100;
      for (k = start - 1; k < n; k++) {
        var yearNo = k + 1;
        pvSurvCash += Math.pow(vv, k + 1) * kpx[k] * ratio * Math.min(yearNo, m) * g1;
      }
      gross = (pvBen1 + pvSurvCash) * (1 + p.margin / 100) / denom;
    }
    var pvBen = pvBen1 + pvSurvCash;
    var r = summarize(pvBen, pvPrem, p.expFirst / 100, p.expRenew / 100, p.margin / 100, sa);
    r.gross = gross; r.renewal = gross;
    r.perThousand = sa > 0 ? gross / sa * 1000 : 0;
    r.lr = pvBen / (gross * pvPrem);
    r.extras = { maturityPay: Math.round(parseInt(p.matureRatio, 10) / 100 * m * gross) };
    r.cv = cashValue('endowment', p, r);
    return r;
  }

  /* ---------- 4.4 年金保险 ---------- */
  function priceAnnuity(p) {
    var age = p.age, n = MAXAGE - age;
    var m = payYearsM(p, n);
    var i = p.rate / 100, vv = v(i), B = p.benefit * 10000;
    var k0 = Math.max(0, parseInt(p.startAge, 10) - age);
    var cPrem = 1 - C.annuityPremLapse;
    var qs = qSeq(age, n, p.gender, true), kpx = survival(qs), k;   // 年金生命表 qx×0.75
    var pvLife = 0, pvGuar = 0;
    for (k = k0; k < n; k++) pvLife += Math.pow(vv, k) * kpx[k] * B;
    var ng = p.method === 'g10' ? 10 : p.method === 'g20' ? 20 : 0;
    for (k = k0; k < Math.min(k0 + ng, n); k++) pvGuar += Math.pow(vv, k) * (1 - kpx[k]) * B;
    var pvBen = (pvLife + pvGuar) * C.annuityFactor;                // 校准因子（README）
    var pvPrem = 0;
    for (k = 0; k < m; k++) pvPrem += Math.pow(vv, k) * kpx[k] * Math.pow(cPrem, k);
    var denom = expenseDenom(pvPrem, p.expFirst / 100, p.expRenew / 100);
    var gross = pvBen * (1 + p.margin / 100) / denom;
    /* IRR：至 85 岁口径（GDD §4.4），群体期望现金流 */
    var cfs = [], kk;
    for (kk = 0; kk < m; kk++) cfs.push({ k: kk, amt: -gross });
    var kEnd = Math.min(n - 1, 84 - age + (85 - parseInt(p.startAge, 10) > 0 ? 0 : 0));
    kEnd = Math.min(n - 1, Math.max(k0, 84 - age));
    for (kk = k0; kk <= kEnd; kk++) cfs.push({ k: kk, amt: kpx[kk] * B });
    var r = {
      gross: gross, renewal: gross, perThousand: 0,
      lr: pvBen / (gross * pvPrem),
      expenseRatio: (pvPrem - denom) / pvPrem, margin: p.margin / 100,
      pvBen: pvBen, pvPrem: pvPrem
    };
    r.irr = irr(cfs);
    r.extras = { irrNote: '领取至 85 岁口径的群体期望 IRR', totalPaid: Math.round(m * gross) };
    r.cv = cashValue('annuity', p, r);
    return r;
  }

  /* ---------- 4.6 重大疾病保险 ---------- */
  function priceCI(p) {
    var age = p.age, n = termYearsN('ci', p, age), m = payYearsM(p, n);
    var i = p.rate / 100, vv = v(i), sa = p.sa * 10000;
    var cPrem = 1 - p.lapse / 100, cBen = 1 - C.ciBenLapse;
    /* 责任因子（GDD §4.6）：轻症 +8%~15% 线性、中症 +6%~12%、豁免 +3%、
       多次赔 ×1.12、癌症二次 ×1.10、60岁前额外 +8%~18%、身故责任 +15%/+55% */
    var fLight = 0.08 + Math.max(0, (p.light - 15)) / 15 * 0.07;
    var fMid = 0.06 + Math.max(0, (p.mid - 40)) / 20 * 0.06;
    var fWaiver = p.waiver === 'yes' ? 0.03 : 0;
    var fMulti = p.multi === 'group3' ? 1.12 : 1.0;
    var fCancer = p.cancer2 === 'yes' ? 1.10 : 1.0;
    var fExtra = p.extra60 === '50' ? 1.08 : p.extra60 === '80' ? 1.13 : p.extra60 === '100' ? 1.18 : 1.0;
    var fDeath = p.deathRider === 'refund' ? 1.15 : p.deathRider === 'full' ? 1.55 : 1.0;
    var baseF = (1 + fLight + fMid + fWaiver) * fMulti * fCancer * fExtra * fDeath;
    var qs = qSeq(age, n, p.gender), kpx = survival(qs), k;
    var pvBen = 0, pvPrem = 0;
    for (k = 0; k < n; k++) {
      var ci = T.ciRate(age + k, p.gender);
      pvBen += Math.pow(vv, k + 1) * kpx[k] * Math.pow(cBen, k) * ci * baseF * sa;
    }
    for (k = 0; k < m; k++) pvPrem += Math.pow(vv, k) * kpx[k] * Math.pow(cPrem, k);
    var r = summarize(pvBen, pvPrem, p.expFirst / 100, p.expRenew / 100, p.margin / 100, sa);
    r.extras = { factors: { light: fLight, mid: fMid, waiver: fWaiver } };
    r.cv = cashValue('ci', p, r);
    return r;
  }

  /* ---------- 4.8 长期护理保险 ----------
   * 健康状态 → 触发失能（发生率 i_x×触发系数）→ 月度给付至给付期限封顶；
   * 失能者年死亡率 = 基础 qx×3.5。给付端衰减 ltcBenLapse（服务型给付）。 */
  function priceLTC(p) {
    var age = p.age, n = termYearsN('ltc', p, age), m = payYearsM(p, n);
    var i = p.rate / 100, vv = v(i), B = p.benefit * 12;
    var trig = p.trigger === 'adl2' ? 1.6 : p.trigger === 'adl2c' ? 2.1 : 1.0;
    var cPrem = 1 - C.ltcPremLapse, cBen = 1 - C.ltcBenLapse;
    var qs = qSeq(age, n, p.gender), kpx = survival(qs), k, j;
    var bp = p.benPeriod === 'life' ? n : parseInt(p.benPeriod, 10);
    var pvBen = 0, pvPrem = 0;
    for (k = 0; k < n; k++) {
      var dis = T.ltcRate(age + k) * trig;
      var dpv = 0, dp = 1;
      var lim = Math.min(bp, n - 1 - k);
      for (j = 0; j < lim; j++) {
        dpv += Math.pow(vv, j) * dp;
        dp *= (1 - C.disabledQxMult * T.qx(age + k + 1 + j, p.gender));
      }
      pvBen += Math.pow(vv, k + 1) * kpx[k] * Math.pow(cBen, k) * dis * dpv * B;
    }
    for (k = 0; k < m; k++) pvPrem += Math.pow(vv, k) * kpx[k] * Math.pow(cPrem, k);
    var r = summarize(pvBen, pvPrem, p.expFirst / 100, p.expRenew / 100, p.margin / 100, 0);
    r.perThousand = 0;
    r.extras = { monthlyBenefit: p.benefit, triggerFactor: trig };
    r.cv = cashValue('ltc', p, r);
    return r;
  }

  /* ---------- 责任准备金与现金价值（长期险，GDD §6.2） ----------
   * V_t = PV(未来给付|x+t) − P_net×PV(未来保费|x+t)
   * CV_t = V_t×(1−扣费_t)，扣费：首年100%、每年降 1.5/缴费期、最低0 */
  function cashValue(pid, p, priced) {
    if (p.age == null) return null;
    var rebuild = null;
    if (pid === 'term') rebuild = buildLong('term', p);
    else if (pid === 'whole') rebuild = buildLong('whole', p);
    else if (pid === 'endowment') rebuild = buildLong('endowment', p);
    else if (pid === 'ci') rebuild = buildLong('ci', p);
    else if (pid === 'ltc') rebuild = buildLong('ltc', p);
    else if (pid === 'annuity') rebuild = buildLong('annuity', p);
    if (!rebuild) return null;
    var m = rebuild.m, n = rebuild.n;
    var out = { cv1: 0, cv5: null, cv1Ratio: 0, cv5Ratio: null, note: '首年退保扣费 100%，现金价值为 0（教学口径）' };
    var t;
    for (t = 1; t <= Math.min(5, n - 1); t++) {
      var remainN = n - t, remainM = Math.max(0, m - t);
      var pvB = rebuild.pvBenAt(t), pvP = rebuild.pvPremAt(t);
      var vt = pvB - rebuild.pNet * (remainM > 0 ? pvP : 0);
      var charge = Math.min(1, Math.max(0, 1 - (t - 1) * (1.5 / Math.max(m, 1))));
      var cv = Math.max(0, vt * (1 - charge));
      if (t === 1) { out.cv1 = cv; out.cv1Ratio = cv / Math.max(priced.gross, 1); }
      if (t === 5) { out.cv5 = cv; out.cv5Ratio = cv / Math.max(priced.gross * 5, 1); }
    }
    return out;
  }
  /* 构建可位移的重定价闭包（净保费 P = PVben/PVprem，原问题口径） */
  function buildLong(pid, p) {
    var age = p.age, i = p.rate / 100, vv = v(i);
    var n, m, cPrem, cBen, sa = (p.sa || 0) * 10000;
    var qs, kpx, k;
    if (pid === 'whole') { n = MAXAGE - age; m = payYearsM(p, n); cPrem = 0.95; cBen = 1 - C.wholeBenLapse; }
    else if (pid === 'endowment') { n = termYearsN(pid, p, age); m = payYearsM(p, n); cPrem = 1 - C.endowPremLapse; cBen = 1; }
    else if (pid === 'annuity') { n = MAXAGE - age; m = payYearsM(p, n); cPrem = 1 - C.annuityPremLapse; cBen = 1; }
    else if (pid === 'ltc') { n = termYearsN(pid, p, age); m = payYearsM(p, n); cPrem = 1 - C.ltcPremLapse; cBen = 1 - C.ltcBenLapse; }
    else if (pid === 'ci') { n = termYearsN(pid, p, age); m = payYearsM(p, n); cPrem = 1 - p.lapse / 100; cBen = 1 - C.ciBenLapse; }
    else { n = termYearsN('term', p, age); m = payYearsM(p, n); cPrem = 1 - p.lapse / 100; cBen = cPrem; }
    var thisAge = p.age;
    function pvBenAt(t) {
      var x = thisAge + t, rn = Math.max(1, n - t), pv = 0, kk;
      if (pid === 'annuity') {
        var qs2 = qSeq(x, n - t, p.gender, true), kpx2 = survival(qs2), B = p.benefit * 10000;
        var k0 = Math.max(0, parseInt(p.startAge, 10) - x);
        for (kk = k0; kk < n - t; kk++) pv += Math.pow(vv, kk) * kpx2[kk] * B;
        var ng = p.method === 'g10' ? 10 : p.method === 'g20' ? 20 : 0;
        for (kk = k0; kk < Math.min(k0 + ng, n - t); kk++) pv += Math.pow(vv, kk) * (1 - kpx2[kk]) * B;
        return pv * C.annuityFactor;
      }
      if (pid === 'ltc') {
        var q3 = qSeq(x, rn, p.gender), kx3 = survival(q3), B3 = p.benefit * 12;
        var trig = p.trigger === 'adl2' ? 1.6 : p.trigger === 'adl2c' ? 2.1 : 1.0;
        var bp = p.benPeriod === 'life' ? rn : parseInt(p.benPeriod, 10), jj;
        for (kk = 0; kk < rn; kk++) {
          var dpv = 0, dp = 1, lim = Math.min(bp, rn - 1 - kk);
          for (jj = 0; jj < lim; jj++) { dpv += Math.pow(vv, jj) * dp; dp *= (1 - C.disabledQxMult * T.qx(x + kk + 1 + jj, p.gender)); }
          pv += Math.pow(vv, kk + 1) * kx3[kk] * Math.pow(cBen, kk) * T.ltcRate(x + kk) * trig * dpv * B3;
        }
        return pv;
      }
      var qsa = (pid === 'term' || pid === 'whole' || pid === 'endowment') ? qSeq(x, rn, p.gender) : qSeq(x, rn, p.gender);
      var kxa = survival(qsa);
      if (pid === 'endowment') {
        var pvD = 0;
        for (kk = 0; kk < rn; kk++) pvD += Math.pow(vv, kk + 1) * kxa[kk] * Math.pow(cBen, kk) * qsa[kk] * sa;
        var npx = kxa[Math.min(rn, kxa.length - 1)];
        return pvD + Math.pow(vv, rn) * npx * (parseInt(p.matureRatio, 10) / 100) * sa;
      }
      var rate = 1;
      for (kk = 0; kk < rn; kk++) {
        if (pid === 'ci') {
          var fLight = 0.08 + Math.max(0, (p.light - 15)) / 15 * 0.07;
          var fMid = 0.06 + Math.max(0, (p.mid - 40)) / 20 * 0.06;
          var fW = p.waiver === 'yes' ? 0.03 : 0;
          var fM = p.multi === 'group3' ? 1.12 : 1.0, fC = p.cancer2 === 'yes' ? 1.10 : 1.0;
          var fE = p.extra60 === '50' ? 1.08 : p.extra60 === '80' ? 1.13 : p.extra60 === '100' ? 1.18 : 1.0;
          var fD = p.deathRider === 'refund' ? 1.15 : p.deathRider === 'full' ? 1.55 : 1.0;
          rate = (1 + fLight + fMid + fW) * fM * fC * fE * fD;
          pv += Math.pow(vv, kk + 1) * kxa[kk] * Math.pow(cBen, kk) * T.ciRate(x + kk, p.gender) * rate * sa;
        } else {
          pv += Math.pow(vv, kk + 1) * kxa[kk] * Math.pow(cBen, kk) * qsa[kk] * sa;
        }
      }
      return pv;
    }
    function pvPremAt(t) {
      var x = thisAge + t, rm = Math.max(1, m - t), pv = 0, kk;
      var qsp = qSeq(x, m - t, p.gender, pid === 'annuity'), kxp = survival(qsp);
      if (pid === 'ltc') { /* 长护保费仅健康体缴纳（简化：同 kpx） */ }
      for (kk = 0; kk < rm; kk++) pv += Math.pow(vv, kk) * kxp[kk] * Math.pow(cPrem, kk);
      return pv;
    }
    var pvB0 = pvBenAt(0), pvP0 = pvPremAt(0);
    return { n: n, m: m, pNet: pvB0 / pvP0, pvBenAt: pvBenAt, pvPremAt: pvPremAt };
  }

  /* ---------- 4.5 百万医疗险（短期） ---------- */
  function priceMedical(p) {
    var F = T.MED_FACTORS;
    var base = T.medBase(p.age);
    var fSA = F.sa[p.sa] || 1.0;
    var pure = base * fSA * (F.deduct[p.deduct] || 1) * F.dirOut[p.dirOut] * F.special[p.special] *
               F.payRatio[p.payRatio] * F.renew[p.renew] * C.medicalFactor;
    var svc = p.service === 'lux' ? 25 : p.service === 'std' ? 8 : 0;
    var pureWithSvc = pure * (1 + svc / 100);
    /* 长保证 + 乐观通胀 → 审慎加载 */
    var inflLoad = 1;
    if (p.renew === 'y20' && p.inflation < 8) inflLoad = 1 + (8 - p.inflation) * C.medInflationLoad * C.medInflationCoeff.y20;
    pureWithSvc *= inflLoad;
    var e = Math.min(p.expFirst / 100, 0.95);   /* 短期险费用率 ≥100% 无解，95% 封顶（护栏） */
    var gross = pureWithSvc * (1 + p.margin / 100) / (1 - e);
    var r = {
      gross: gross, renewal: gross,
      perThousand: gross / (({ '100': 100, '200': 200, '300': 300, '400': 400, '600': 600 }[p.sa] || 200) * 10),
      lr: pure / gross, expenseRatio: e, margin: p.margin / 100,
      pvBen: pure, pvPrem: gross
    };
    r.extras = {
      noSocialPrice: gross * F.noSocial,
      svcRatio: svc,
      inflationLoad: inflLoad,
      renewLabel: p.renew === 'y20' ? '保证续保 20 年（费率可调）' : p.renew === 'y6' ? '保证续保 6 年' : '一年期非保证续保'
    };
    r.cv = null;
    return r;
  }

  /* ---------- 4.7 综合意外险（短期） ---------- */
  function occFactorOf(occ) {
    if (occ === 'c13') return T.ACCIDENT.occ['3'];
    if (occ === 'c14') return T.ACCIDENT.occ['4'];
    return (T.ACCIDENT.occ['4'] + T.ACCIDENT.occ['5']) / 2;  // 1-6类按4/5类中值
  }
  function priceAccident(p) {
    var A = T.ACCIDENT;
    var sa = p.sa * 10000;
    var of = occFactorOf(p.occ);
    var deathPure = (A.deathRate + A.disabRate * A.disabAvgPay) / 1000 * sa * of;
    if (p.suddenDeath === 'yes') deathPure *= 1.22;
    var medPure = p.medRider === 'm0100' ? A.medBase : p.medRider === 'm10080' ? A.medBase * 0.72 : 0;
    var allow = p.allowance === 'none' ? 0 : parseInt(p.allowance.slice(1), 10);
    var allowPure = allow === 0 ? 0 : 0.12 * allow * 90 * A.hospRate * of;
    var raw = (deathPure + medPure + allowPure) * (p.sport === 'yes' ? 1.08 : 1);
    var pure = raw * C.accidentFactor;
    var e = Math.min(p.expFirst / 100, 0.95);   /* 短期险费用率护栏（同医疗） */
    var gross = pure * (1 + p.margin / 100) / (1 - e);
    /* 分档价表（按职业类别 1-6 的死亡/伤残/津贴系数） */
    var classTable = [], c;
    for (c = 1; c <= 6; c++) {
      var cf = A.occ[String(c)];
      var rawC = ((A.deathRate + A.disabRate * A.disabAvgPay) / 1000 * sa * cf) * (p.suddenDeath === 'yes' ? 1.22 : 1) +
                 medPure + (allow === 0 ? 0 : 0.12 * allow * 90 * A.hospRate * cf);
      rawC *= (p.sport === 'yes' ? 1.08 : 1);
      classTable.push({ cls: c, price: rawC * C.accidentFactor * (1 + p.margin / 100) / (1 - e) });
    }
    var r = {
      gross: gross, renewal: gross,
      perThousand: gross / (p.sa * 10),
      lr: pure / gross, expenseRatio: e, margin: p.margin / 100,
      pvBen: pure, pvPrem: gross
    };
    r.extras = { occFactor: of, classTable: classTable };
    r.cv = null;
    return r;
  }

  /* ---------- 统一入口 ---------- */
  function price(pid, cfg) {
    var def = AW.getDefaultCfg(pid), p = {}, k;
    for (k in def) p[k] = def[k];
    for (k in cfg) p[k] = cfg[k];
    var r;
    switch (pid) {
      case 'term': r = priceTerm(p); break;
      case 'whole': r = priceWhole(p); break;
      case 'endowment': r = priceEndowment(p); break;
      case 'annuity': r = priceAnnuity(p); break;
      case 'ci': r = priceCI(p); break;
      case 'ltc': r = priceLTC(p); break;
      case 'medical': r = priceMedical(p); break;
      case 'accident': r = priceAccident(p); break;
      default: r = null;
    }
    if (r) {
      r.pid = pid; r.params = p;
      r.irr = (r.irr === undefined ? null : r.irr);
      /* 「实际预期」修正（§6.4）——评分引擎若已加载则联动 */
      if (AW.scoring && AW.scoring.amCoeffs) {
        var am = AW.scoring.amCoeffs(pid, p);
        r.a = am.a; r.m = am.m;
        r.lrReal = r.lr * (1 + am.a + am.m);
        r.piReal = 1 - r.lrReal - r.expenseRatio;
      }
    }
    return r;
  }
  function priceBaseline(pid) {
    var prod = AW.getProduct(pid);
    return price(pid, prod.baseline);
  }

  AW.pricing = {
    price: price, priceBaseline: priceBaseline, irr: irr,
    occFactorOf: occFactorOf, expenseDenom: expenseDenom
  };
})();
