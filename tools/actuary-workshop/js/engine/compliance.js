/* =====================================================================
 * 精算工坊 · js/engine/compliance.js
 * 合规检查器（GDD §7）：16 条规则，评审前在 Step3 实时显示 ✓/⚠/✗。
 * finding = {id, name, status: 'pass'|'warn'|'reject'|'info'|'na', text, basis}
 * ===================================================================== */
(function () {
  'use strict';
  var AW = (typeof window !== 'undefined') ? (window.AW = window.AW || {})
                                           : (globalThis.AW = globalThis.AW || {});
  var HEALTH = { medical: 1, ci: 1, ltc: 1 };
  var SHORT = { medical: 1, accident: 1 };
  var WITH_DEATH = { term: 1, whole: 1, endowment: 1, accident: 1 };

  function svcRatio(p) { return p.service === 'lux' ? 25 : p.service === 'std' ? 8 : 0; }
  function deductNum(p) { return parseInt(p.deduct, 10); }

  var RULES = [
    { id: 'R1', name: '预定利率 ≤ 2.00%',
      applies: function (pid) { return AW.getProduct(pid).type === 'long'; },
      run: function (pid, p) {
        if (p.rate > 2.0) return { status: 'reject', text: '预定利率 ' + p.rate + '% 超过普通型上限 2.0%（超出 ' + (p.rate - 2.0).toFixed(2) + ' 个百分点）' };
        return { status: 'pass', text: '预定利率 ' + p.rate + '%，未超过普通型上限 2.0%' };
      },
      basis: '金融监管总局金发〔2024〕18号及2025年动态调整：普通型上限 2.0%' },

    { id: 'R2', name: '犹豫期 ≥ 15 日',
      applies: function (pid) { return AW.getProduct(pid).type === 'long'; },
      run: function (pid, p) {
        var h = parseInt(p.hesitation, 10);
        if (h < 10) return { status: 'reject', text: '犹豫期 ' + h + ' 日：一年期以上人身险必须约定犹豫期且不得低于 10 日' };
        if (h < 15) return { status: 'warn', text: '犹豫期 ' + h + ' 日：个险渠道可售，但银保/互联网渠道须 15 个自然日' };
        return { status: 'pass', text: '犹豫期 ' + h + ' 日，符合银保/互联网渠道 15 日口径' };
      },
      basis: '《保险销售行为管理办法》（2023年令第2号，2024年3月施行）' },

    { id: 'R3', name: '健康险等待期 ≤ 180 天',
      applies: function (pid) { return !!HEALTH[pid]; },
      run: function (pid, p) {
        if (p.wait > 180) return { status: 'reject', text: '等待期 ' + p.wait + ' 天超过 180 天上限' };
        return { status: 'pass', text: '等待期 ' + p.wait + ' 天，未超过 180 天上限' };
      },
      basis: '《健康保险管理办法》第27条' },

    { id: 'R4', name: '核保方式不得使用基因筛查',
      applies: function () { return true; },
      run: function (pid, p) {
        if (p.underwriting === 'gene') return { status: 'reject', text: '以基因检测资料作为核保条件——健康险公司不得将基因检测资料用于核保' };
        return { status: 'pass', text: '核保方式：' + ({ loose: '宽松健康告知', std: '标准告知＋智能核保', strict: '严格（体检＋财务核保）' }[p.underwriting] || '标准') };
      },
      basis: '《健康保险管理办法》第38条：不得以家族遗传病史之外的遗传信息、基因检测资料作为核保条件' },

    { id: 'R5', name: '生存金首次给付满 5 年且年给付 ≤ 已缴保费 20%',
      applies: function (pid) { return pid === 'endowment' || pid === 'annuity'; },
      run: function (pid, p) {
        if (pid === 'endowment') {
          if (p.survStart !== 'none') {
            var st = parseInt(p.survStart, 10), ra = parseInt(p.survRatio, 10);
            if (st < 5) return { status: 'reject', text: '年度生存金第 ' + st + ' 年即开始返还：两全/年金首次生存金给付须在保单生效满 5 年后' };
            if (ra > 20) return { status: 'reject', text: '年度生存金返还比例 ' + ra + '% 超过已缴保费 20% 上限' };
            return { status: 'pass', text: '年度生存金第 ' + st + ' 年起返还、比例 ' + ra + '%，符合 134 号文' };
          }
          return { status: 'pass', text: '未设年度生存金，仅满期给付' };
        }
        var gap = parseInt(p.startAge, 10) - p.age;
        if (gap < 5) return { status: 'reject', text: '投保 ' + p.age + ' 岁、第 ' + p.startAge + ' 年起领取：年金首次给付须在生效满 5 年后' };
        return { status: 'pass', text: '年金于第 ' + p.startAge + ' 岁起领取（生效满 ' + gap + ' 年）' };
      },
      basis: '保监人身险〔2017〕134号：首次生存金给付须在生效满5年后，年给付/领取≤已交保费20%' },

    { id: 'R6', name: '轻症给付 ≤ 30%（中症 ≤ 60% 惯例）',
      applies: function (pid) { return pid === 'ci'; },
      run: function (pid, p) {
        if (p.light > 30) return { status: 'reject', text: '轻症给付比例 ' + p.light + '% 超过 30% 红线（3 种规范轻症给付比例上限 30%）' };
        if (p.mid > 60) return { status: 'warn', text: '中症给付比例 ' + p.mid + '%：无监管强制上限，但超出市场惯例（50%-60%）' };
        return { status: 'pass', text: '轻症 ' + p.light + '% / 中症 ' + p.mid + '%，符合 2020 定义规范与市场惯例' };
      },
      basis: '《重大疾病保险的疾病定义使用规范（2020年修订版）》' },

    { id: 'R7', name: '意外险附加费用率 ≤ 35%',
      applies: function (pid) { return pid === 'accident'; },
      run: function (pid, p) {
        if (p.expFirst > 35) return { status: 'reject', text: '附加费用率 ' + p.expFirst + '% 超过短期个人意外险 35% 上限' };
        return { status: 'pass', text: '附加费用率 ' + p.expFirst + '%，未超过 35% 上限' };
      },
      basis: '《意外伤害保险业务监管办法》（银保监办发〔2021〕，2022-01-01 施行）：保险期≤1年个人 35%、团体 25%' },

    { id: 'R8', name: '健康管理服务分摊成本 ≤ 净保费 20%',
      applies: function (pid) { return pid === 'medical'; },
      run: function (pid, p) {
        var s = svcRatio(p);
        if (s > 20) return { status: 'reject', text: '健康管理服务分摊 ' + s + '% 净保费，超过 20% 上限（须在精算报告中说明）' };
        return { status: 'pass', text: '健康管理服务分摊 ' + s + '% 净保费，符合上限' };
      },
      basis: '《健康保险管理办法》及 2020 年通知：健康管理服务分摊成本不得超过净保险费的 20%' },

    { id: 'R9', name: '产品命名规范（说明文字 ≤10 字且无禁词）',
      applies: function () { return true; },
      run: function (pid, p, priced, name) {
        var n = name || '';
        var banned = ['理财', '投资', '自动续保', '承诺续保', '终身限额'];
        for (var i = 0; i < banned.length; i++) {
          if (n.indexOf(banned[i]) >= 0) return { status: 'reject', text: '产品名含禁用词「' + banned[i] + '」——不得使用误导性词语' };
        }
        if (n.length > 10) return { status: 'reject', text: '产品说明文字 ' + n.length + ' 字，超过 10 字上限（名称＝公司名＋说明文字≤10字＋险种类别）' };
        return { status: 'pass', text: '说明文字「' + (n || '（未自定义）') + '」共 ' + n.length + ' 字，无禁用词' };
      },
      basis: '《人身保险公司保险条款和保险费率管理办法》（2011/2015修订）＋银保监办发〔2021〕7号' },

    { id: 'R10', name: '未成年人身故保额限额',
      applies: function (pid) { return !!WITH_DEATH[pid] || pid === 'ci'; },
      run: function (pid, p) {
        var sa = (p.sa || 0) * 10000;
        if (p.age < 10 && sa > 200000) return { status: 'reject', text: '被保险人不满 10 岁，身故保额 ' + (sa / 10000) + ' 万超过 20 万限额' };
        if (p.age >= 10 && p.age < 18 && sa > 500000) return { status: 'reject', text: '被保险人 10-17 岁，身故保额 ' + (sa / 10000) + ' 万超过 50 万限额' };
        return { status: 'pass', text: '被保险人 ' + p.age + ' 岁，未触及未成年人身故限额（<10岁20万 / 10-17岁50万）' };
      },
      basis: '保监发〔2015〕90号（航空意外、重大自然灾害意外除外）' },

    { id: 'R11', name: '短期健康险已明示「非保证续保」',
      applies: function (pid) { return pid === 'medical'; },
      run: function (pid, p) {
        if (p.renew === 'none') return { status: 'info', text: '已按 7 号文在条款显著位置明示「非保证续保」及停售/调价风险（展示项，固定合规）' };
        return { status: 'pass', text: '保证续保期内费率可调，名称含「（费率可调）」标识' };
      },
      basis: '银保监办发〔2021〕7号：短期健康险不得保证续保，须明示"非保证续保"，禁用"自动续保""承诺续保""终身限额"' },

    { id: 'R12', name: '短期险平均定价赔付率披露义务',
      applies: function (pid) { return !!SHORT[pid]; },
      run: function (pid, p, priced) {
        var lr = (priced && priced.lr ? priced.lr : 0) * 100;
        if (lr < 50) return { status: 'warn', text: '平均定价赔付率 ' + lr.toFixed(1) + '% 低于 50%：须按监管持续披露赔付率；连续 3 年保费超 500 万且低于 50% 须及时调价' };
        return { status: 'pass', text: '平均定价赔付率 ' + lr.toFixed(1) + '%，高于 50% 参考线' };
      },
      basis: '《意外伤害保险业务监管办法》：连续三年保费收入超500万元且平均赔付率低于50%的短期意外险须调整费率' },

    { id: 'R13', name: '风险边际合理性（≤ 25%）',
      applies: function () { return true; },
      run: function (pid, p) {
        if (p.margin > 25) return { status: 'warn', text: '风险边际 ' + p.margin + '%：定价偏高，涉嫌侵害消费者利益，请补充利润测试与消保审查说明' };
        return { status: 'pass', text: '风险边际 ' + p.margin + '%，处于合理区间' };
      },
      basis: '定价合理性 / 消费者权益保护审查（《消费者权益保护管理办法》2022年令第9号）' },

    { id: 'R14', name: '长期保证 + 医疗通胀假设审慎性',
      applies: function (pid) { return pid === 'medical'; },
      run: function (pid, p) {
        if (p.renew === 'y20' && p.inflation < 8) return { status: 'warn', text: '20 年保证续保叠加 ' + p.inflation + '% 通胀假设：长期保证＋乐观通胀＝定价假设不审慎（全球医疗通胀约 10%）' };
        return { status: 'pass', text: '通胀假设 ' + p.inflation + '% 与续保安排匹配' };
      },
      basis: '《关于长期医疗保险产品费率调整有关问题的通知》（2020-04）精神：费率可调长期医疗须审慎定价' },

    { id: 'R15', name: '高保额营销杠杆提示',
      applies: function (pid) { return pid === 'medical'; },
      run: function (pid, p) {
        if (parseInt(p.sa, 10) >= 600 && deductNum(p) >= 10000) return { status: 'info', text: '保额 600 万档 + 免赔 1 万：高保额多为营销杠杆，注意 7 号文"不得设定严重背离经验数据的虚高保额"' };
        return { status: 'pass', text: '保额与免赔组合未见虚高倾向' };
      },
      basis: '银保监办发〔2021〕7号' },

    { id: 'R16', name: '法定免责三条齐备',
      applies: function (pid) { return !!WITH_DEATH[pid]; },
      run: function () {
        return { status: 'pass', text: '法定三条已列入条款：①投保人故意杀害不赔（43条）②故意犯罪致死不赔（45条）③2年内自杀不赔、满2年应赔（44条）' };
      },
      basis: '《保险法》第43/44/45条（展示性核验）' }
  ];

  /* 汇总检查：返回 findings 数组（含 na 项），并给出计数 */
  function check(pid, cfg, priced, productName) {
    var defs = AW.getDefaultCfg(pid), p = {}, k;
    for (k in defs) p[k] = defs[k];
    for (k in cfg) p[k] = cfg[k];
    var out = [], i, r;
    for (i = 0; i < RULES.length; i++) {
      var rule = RULES[i];
      if (!rule.applies(pid)) { out.push({ id: rule.id, name: rule.name, status: 'na', text: '本险种不适用', basis: rule.basis }); continue; }
      r = rule.run(pid, p, priced, productName);
      out.push({ id: rule.id, name: rule.name, status: r.status, text: r.text, basis: rule.basis });
    }
    var cnt = { reject: 0, warn: 0, info: 0, pass: 0, na: 0 };
    for (i = 0; i < out.length; i++) cnt[out[i].status]++;
    return { findings: out, cnt: cnt, hasReject: cnt.reject > 0 };
  }

  AW.compliance = { check: check, rules: RULES };
})();
