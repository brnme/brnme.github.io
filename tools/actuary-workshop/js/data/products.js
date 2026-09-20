/* =====================================================================
 * 精算工坊 · js/data/products.js
 * 8 个险种模板：参数定义（含范围/默认/💡三段tooltip）/ 基准配置 /
 * 富责任度规则 / 权衡要点；客群定义与适配矩阵。（GDD §4 §5）
 * ===================================================================== */
(function () {
  'use strict';
  var AW = (typeof window !== 'undefined') ? (window.AW = window.AW || {})
                                           : (globalThis.AW = globalThis.AW || {});
  var C = AW.tables.CALIB;

  /* ---------- 参数 tooltip 写法：tip = [定义, 设计思想, 后果] 三段 ---------- */

  /* —— 通用参数（所有险种共享）—— */
  var SHARED = [
    { key: 'age', label: '被保险人年龄', group: 'A', type: 'slider', min: 18, max: 65, step: 1, unit: '岁', def: 30,
      tip: ['年龄是发生率的第一驱动因子：同样的保额，65 岁的价格可以是 30 岁的十倍以上。',
            '自然费率随年龄逐年上调（老年天价且不可保）；长期险改收均衡保费，把一生的风险成本平摊成每年一样的保费。',
            '拉高年龄观察定价：年轻是最大的费率优惠。'] },
    { key: 'gender', label: '承保性别', group: 'A', type: 'select', def: 'M',
      options: [{ v: 'M', l: '仅男' }, { v: 'F', l: '仅女' }, { v: 'X', l: '不限（混合费率）' }],
      tip: ['按性别区分费率是最基础的风险分类：女性死亡率显著低于男性（本表约一半）。',
            '风险分类越细，定价越"个体公平"，但也越接近把高风险者逐出市场——基因信息被立法禁止用于核保，正是这条边界的极端情形。',
            '选"不限"用混合费率：低风险女性在补贴高风险男性，逆选择会慢慢淘走低风险客户。'] },
    { key: 'rate', label: '预定利率 i', group: 'B', type: 'slider', min: 0.5, max: 2.0, step: 0.25, unit: '%', def: 1.75, redline: 2.0,
      tip: ['定价时承诺给客户的资金增值速率，长期险的每一分保费与给付都按它折现。红线 2.00%（普通型上限）。',
            '这是横跨几十年的刚性承诺：90 年代 8% 保单遇上连续降息，酿成全行业数百亿利差损，直接催生了今天的动态调整机制。',
            '顶格定价产品更便宜更好卖，但把利率下行风险全部留给了公司——你在高点卖出了几十年的期权。'] },
    { key: 'expFirst', label: '预定费用率（首年）', group: 'B', type: 'slider', min: 5, max: 110, step: 1, unit: '%', def: 55, shortDef: 12,
      tip: ['首年保费中用于渠道佣金、获客与运营的比例。长期险首年费用普遍很高（银保/经代渠道尤甚）。',
            '首年高费用是退保扣费高、前期现金价值远低于已缴保费的原因之一：渠道的钱要先从保费里扣。',
            '费用率拉太高，保费变贵、定价赔付率变低；短期险还受附加费用率红线约束（意外 35%）。'] },
    { key: 'expRenew', label: '预定费用率（续期）', group: 'B', type: 'slider', min: 2, max: 30, step: 1, unit: '%', def: 12,
      tip: ['续期保费中维持运营与服务的费用比例，长期险逐年收取。',
            '首年高、续期低的费用结构意味着：保险公司要靠客户长期持有才能摊回收获客成本——费差是三差利润的重要来源。',
            '续期费用低 → 长期持有越久，定价越"回本"；这也是长期险鼓励续保的经济学。'] },
    { key: 'margin', label: '风险边际（利润加载）', group: 'B', type: 'slider', min: 0, max: 30, step: 1, unit: '%', def: 10,
      tip: ['在净保费之上叠加的安全垫，用于覆盖模型误差、波动与股东利润。',
            '不确定性本身有成本：零边际定价意味着一次经验波动就可能击穿偿付能力。',
            '边际过高 = 定价偏高，涉嫌侵害消费者利益（>25% 触发合规警告）；过低则利润测试难看。'] },
    { key: 'underwriting', label: '核保方式', group: 'C', type: 'select', def: 'std',
      options: [{ v: 'loose', l: '宽松健康告知' }, { v: 'std', l: '标准告知＋智能核保' }, { v: 'strict', l: '严格（体检＋财务核保）' }, { v: 'gene', l: '基因筛查 ❌' }],
      tip: ['投保前筛选风险的手段：告知、智能核保、体检、财务核保层层加严。',
            '核保是对抗逆选择的第一道闸门：筛得越准，风险池越干净，价格越低；但"基因筛查"是明令禁止的——那会制造一批"生来不可保"的人（《健康保险管理办法》第38条）。',
            '核保越松保费越好卖，但逆选择会在赔付率上兑现；核保越严，获客越难、成本越高。选基因筛查必被驳回。'] },
    { key: 'wait', label: '等待期', group: 'C', type: 'slider', min: 0, max: 180, step: 30, unit: '天', def: 90,
      tip: ['合同生效后一段时间内出险不赔（健康险），是逆选择的第二道闸门。健康险上限 180 天。',
            '等待期挡的是"已知自己病了才来投保"的人；把它拆了等于把大门敞开。',
            '等待期越短产品越好卖，但带病体次日索赔的概率也越高——赔付率会用一个季度教会你。'] },
    { key: 'hesitation', label: '犹豫期', group: 'C', type: 'select', def: '15',
      options: [{ v: '10', l: '10 日' }, { v: '15', l: '15 日' }, { v: '20', l: '20 日' }, { v: '30', l: '30 日' }],
      tip: ['投保人收到合同后可无条件解约的冷静期，期内退保仅扣工本费。',
            '一年期以上产品必须约定犹豫期；监管口径（银保/互联网渠道）为 15 日。',
            '短于 15 日在银保与互联网渠道不可售（警告）；犹豫期是消费者权益的底线设计。'] },
    { key: 'exclusion', label: '免责范围', group: 'C', type: 'select', def: 'std',
      options: [{ v: 'std', l: '标准（法定三条＋险种常规）' }, { v: 'strict', l: '从严（另含高风险运动等）' }, { v: 'wide', l: '从宽（仅法定三条）' }],
      tip: ['免责条款列出保险公司不赔的情形；寿险/意外类必须包含法定三条（故意杀害、故意犯罪、2年内自杀）。',
            '免责是对不可保风险的边界划定：免责越窄，赔付敞口越大。',
            '从宽 = 竞争力↑风险↑，声誉风险扣分；从严 = 好卖程度下降但风控干净。'] }
  ];

  /* —— 险种模板 —— */
  var PRODUCTS = [
    /* ============ 4.1 定期寿险 ============ */
    {
      id: 'term', name: '定期寿险', cat: '定期寿险', type: 'long', icon: '🛡️',
      tagline: '纯保障·零储蓄·高杠杆',
      params: [
        { key: 'sa', label: '保额', group: 'A', type: 'slider', min: 50, max: 400, step: 10, unit: '万', def: 100,
          tip: ['身故/全残一次性给付的金额，定寿的核心杠杆所在。',
                '免体检限额约 100-150 万（互联网渠道更高）：限额内靠健康告知，超限须体检＋财务核保——核保是保额的代价。',
                '保额越高杠杆越大，但超过 150 万将提示需体检核保；给顶梁柱的建议是 10 倍年收入左右。'] },
        { key: 'term', label: '保障期间', group: 'A', type: 'select', def: '30',
          options: [{ v: '20', l: '20 年' }, { v: '30', l: '30 年' }, { v: 'to60', l: '至 60 岁' }, { v: 'to70', l: '至 70 岁' }],
          tip: ['承担身故风险的年限，到期合同终止、不返还。',
                '定寿只保"责任最重的年份"（房贷期+育儿期），所以便宜；保到终身就变成了必赔的终身寿。',
                '期间越长保费越贵：保 20 年约 383 元 vs 保 30 年约 1132 元（30岁男100万市场实价）。'] },
        { key: 'pay', label: '缴费期间', group: 'A', type: 'select', def: '30',
          options: [{ v: '1', l: '趸交' }, { v: '10', l: '10 年' }, { v: '20', l: '20 年' }, { v: '30', l: '30 年' }, { v: 'term', l: '缴至期满' }],
          tip: ['保费分几年交完。缴费期越长，单年压力越小，但退保概率对保费池的侵蚀越大。',
                '均衡保费本质是合同内的期限转换：年轻多缴、贴补年老。',
                '缴费期越长保费现金价值积累越慢；退保率假设对长缴费期产品更敏感。'] },
        { key: 'lapse', label: '继续率假设（年退保率）', group: 'B', type: 'slider', min: 5, max: 25, step: 1, unit: '%', def: 12,
          tip: ['每年预期退保的比例，同时衰减保费收集与给付敞口。',
                '退保的低价被称为 lapse-based pricing：用"赌你退保"支撑低价，国际上存在消费者权益争议。',
                'lapse ≥20% 声誉风险扣分——你在用客户的半途而废给另一批客户降价。'] }
      ],
      baseline: { sa: 100, term: '30', pay: '30', lapse: 12, age: 30, gender: 'M', rate: 1.75, expFirst: 55, expRenew: 12, margin: 10, underwriting: 'std', wait: 90, hesitation: '15', exclusion: 'std' },
      marketNote: '市场实价：大麦系 30岁男 100万/30年 ≈ 1132-1500 元/年；女性 ≈ 男×0.5-0.6。',
      richness: [
        { when: function (p) { return p.sa >= 150; }, pts: 5, label: '高保额杠杆' },
        { when: function (p) { return p.term === 'to70' || p.term === '30'; }, pts: 4, label: '长保障期' },
        { when: function (p) { return p.underwriting === 'strict'; }, pts: 4, label: '严格核保' }
      ],
      points: ['纯保障零储蓄所以便宜：30 年里身故累计概率只有几个百分点，保费几乎是"裸"的风险成本。',
               '保额超过 150 万提示需体检＋财务核保：免体检限额是核保风险的量化容忍度。',
               'lapse 定价的伦理争议：依赖退保的低价，等于让中途退保的人补贴坚持到底的人。']
    },

    /* ============ 4.2 终身寿险 ============ */
    {
      id: 'whole', name: '终身寿险', cat: '终身寿险', type: 'long', icon: '♾️',
      tagline: '必赔·储蓄为主·类锁定利率',
      params: [
        { key: 'sa', label: '保额', group: 'A', type: 'slider', min: 50, max: 500, step: 10, unit: '万', def: 100,
          tip: ['身故给付金额。终身寿必赔（死亡率→1），保额中储蓄积累占大头。',
                '定额终身寿是"2% 时代的类储蓄资产"：现价按预定利率复利增长，长期 IRR 逼近预定利率。',
                '保额越高，储蓄成分越大，保费越接近一笔强制储蓄计划。'] },
        { key: 'pay', label: '缴费期间', group: 'A', type: 'select', def: '20',
          options: [{ v: '1', l: '趸交' }, { v: '10', l: '10 年' }, { v: '15', l: '15 年' }, { v: '20', l: '20 年' }, { v: 'life', l: '终身缴费' }],
          tip: ['缴费期越短，单年保费越高、但利益确定越快。',
                '终身缴费把储蓄动作拉到最长，适合现金流平滑的客户。',
                '缴费期内退保损失最大——现价要为渠道费用和早期保障成本"还债"。'] }
      ],
      lapseFixedNote: '终身寿继续率固定 5%：储蓄型客户黏性高，不设滑杆——储蓄成分越重，客户越不会退。',
      baseline: { sa: 100, pay: '20', age: 30, gender: 'M', rate: 1.75, expFirst: 55, expRenew: 12, margin: 10, underwriting: 'std', wait: 90, hesitation: '15', exclusion: 'std' },
      marketNote: '市场价：定额终身寿 30岁男 100万/20年缴 ≈ 1-3 万/年（≈定寿 5-10 倍）。',
      richness: [
        { when: function (p) { return p.sa >= 200; }, pts: 5, label: '高保额' },
        { when: function (p) { return p.pay === '10' || p.pay === '15'; }, pts: 3, label: '短缴快现价' },
        { when: function (p) { return p.rate <= 1.5; }, pts: 4, label: '利率留安全边际' }
      ],
      points: ['必赔意味着保费大头是储蓄积累：终身寿 = 一份锁定预定利率的强制储蓄＋终身保障。',
               '现金价值表自 2023 年起须官网披露；前期现价远低于已缴保费是均衡保费＋退保扣费的共同结果。',
               '持有至身故的 IRR ≈ 预定利率附近——你在卖"2% 时代的类储蓄"，利差风险由公司兜底。']
    },

    /* ============ 4.3 两全保险 ============ */
    {
      id: 'endowment', name: '两全保险', cat: '两全保险', type: 'long', icon: '⚖️',
      tagline: '生死两全·储蓄最强·最贵',
      params: [
        { key: 'sa', label: '身故保额', group: 'A', type: 'slider', min: 10, max: 200, step: 5, unit: '万', def: 30,
          tip: ['保障期内身故给付的金额；生存至满期则给付满期生存金。',
                '"生死两全"= 无论生死都赔，所以是保障＋储蓄的全都贵。',
                '身故保额相对保费的杠杆远低于定寿——它本质是带保障的储蓄计划。'] },
        { key: 'term', label: '保障期间', group: 'A', type: 'select', def: '30', options: [{ v: '20', l: '20 年' }, { v: '25', l: '25 年' }, { v: '30', l: '30 年' }],
          tip: ['满期时一次性给付满期生存金。',
                '期间越长，储蓄复利积累越充分，满期杠杆越好看。',
                '期间越短，快速返还的倾向越强——正是监管重点打击的误导设计。'] },
        { key: 'pay', label: '缴费期间', group: 'A', type: 'select', def: '20', options: [{ v: '1', l: '趸交' }, { v: '10', l: '10 年' }, { v: '15', l: '15 年' }, { v: '20', l: '20 年' }],
          tip: ['保费分几年交完；已缴保费是年度生存金与满期金的计算基数之一。',
                '缴费期越长，每年压力越小；缴费期内退保损失最重。',
                '短缴+快返还的组合最容易被销售误导包装成"短期理财"。'] },
        { key: 'matureRatio', label: '满期生存金', group: 'A', type: 'select', def: '100',
          options: [{ v: '80', l: '已缴保费 × 80%' }, { v: '100', l: '已缴保费 × 100%' }, { v: '110', l: '已缴保费 × 110%' }, { v: '120', l: '已缴保费 × 120%' }],
          tip: ['生存至满期时一次性给付的金额基数。',
                '返本型设计满足"不出事就把钱拿回来"的心理账户，是两全最好卖的卖点。',
                '返还比例越高储蓄成分越重：保费大涨、保障被稀释，满 120% 基本是在卖存款。'] },
        { key: 'survStart', label: '年度生存金·返还起始年', group: 'A', type: 'select', def: 'none',
          options: [{ v: 'none', l: '无' }, { v: '5', l: '第 5 年' }, { v: '10', l: '第 10 年' }, { v: '20', l: '第 20 年' }],
          tip: ['每年返还一次生存金的起始年份；选"无"则只有满期给付。',
                '红线：首次给付须在生效满 5 年后（134 号文）——快速返还被监管定性为误导设计。',
                '起始年 <5 直接驳回；第 5 年＋顶格 20% 是在红线边缘跳舞。'] },
        { key: 'survRatio', label: '年度生存金·年返还比例', group: 'A', type: 'select', def: '5',
          options: [{ v: '5', l: '已缴保费 5%' }, { v: '10', l: '已缴保费 10%' }, { v: '15', l: '已缴保费 15%' }, { v: '20', l: '已缴保费 20%' }],
          tip: ['每年给付金额 = 比例 × 截至当年已缴保费。',
                '红线：每年 ≤ 已缴保费 20%（134 号文）——上限本身就是被"返还得越来越猛"逼出来的。',
                '比例越高，保费越贵、留给保障与利润的空间越小。'] }
      ],
      baseline: { sa: 30, term: '30', pay: '20', matureRatio: '100', survStart: 'none', survRatio: '5', age: 30, gender: 'M', rate: 1.75, expFirst: 55, expRenew: 12, margin: 10, underwriting: 'std', wait: 90, hesitation: '15', exclusion: 'std' },
      marketNote: '基准：30岁男 30万身故＋满期100%已缴/缴20年 ≈ 1.3-1.5 万/年。',
      richness: [
        { when: function (p) { return p.matureRatio === '110' || p.matureRatio === '120'; }, pts: 4, label: '高满期返还' },
        { when: function (p) { return p.survStart !== 'none'; }, pts: 3, label: '现金流规划' },
        { when: function (p) { return parseInt(p.term, 10) >= 30; }, pts: 3, label: '长期储蓄' }
      ],
      points: ['生死两全 = 最贵的保障＋储蓄混合体：无论生死都给付，保费自然最重。',
               '快速返还是监管重点打击对象：134 号文把首次生存金锁到第 5 年、比例锁在 20%。',
               '满期返本的心理账户让客户忽视货币时间价值——保费其实很贵。']
    },

    /* ============ 4.4 年金保险 ============ */
    {
      id: 'annuity', name: '年金保险', cat: '年金保险', type: 'long', icon: '🏜️',
      tagline: '长寿风险·反向死亡保障',
      params: [
        { key: 'benefit', label: '年领取额', group: 'A', type: 'slider', min: 1, max: 30, step: 0.5, unit: '万/年', def: 6,
          tip: ['到达领取年龄后每年给付的金额（终身或保证期内）。',
                '年金是"反向死亡保障"：活得越久领得越多，保的是长寿风险——钱没了人还在。',
                '领取额定得越高，现在要缴的保费越多；终身领取对利率和死亡率假设都极度敏感。'] },
        { key: 'startAge', label: '领取起始年龄', group: 'A', type: 'select', def: '60', options: [{ v: '55', l: '55 岁' }, { v: '60', l: '60 岁' }, { v: '65', l: '65 岁' }],
          tip: ['开始领取年金的年龄。',
                '越晚开始领，积累期越长、每元保费能买到的终身年金越多（复利＋死亡率折减）。',
                '越早领取越"划算"的感觉是错觉——精算等价原则下你只是把领取期拉长了。'] },
        { key: 'method', label: '领取方式', group: 'A', type: 'select', def: 'life',
          options: [{ v: 'life', l: '终身领取' }, { v: 'g10', l: '保证领取 10 年' }, { v: 'g20', l: '保证领取 20 年' }],
          tip: ['终身领到身故；保证领取 = 即使早逝，剩余年份也给付给受益人。',
                '保证领取 = 用确定性换总额：公司承担早逝给付，所以同等保费下保证期越长越贵。',
                '长寿客户选终身更优，担心早逝的客户会要求保证领取——逆选择在年金里方向相反。'] },
        { key: 'pay', label: '缴费期间', group: 'A', type: 'select', def: '10', options: [{ v: '1', l: '趸交' }, { v: '5', l: '5 年' }, { v: '10', l: '10 年' }, { v: '15', l: '15 年' }],
          tip: ['保费分几年交完，积累期从缴费起到领取开始。',
                '趸交即期年金最接近纯粹的"养老金买断"。',
                '缴费期越长利率敏感性越高——你在用今天的保费锁定几十年的领取承诺。'] }
      ],
      lapseFixedNote: '年金继续率固定 4%：领取型产品客户黏性最高（不设滑杆）。',
      baseline: { benefit: 6, startAge: '60', method: 'life', pay: '10', age: 30, gender: 'M', rate: 1.75, expFirst: 55, expRenew: 12, margin: 10, underwriting: 'std', wait: 90, hesitation: '15', exclusion: 'std' },
      marketNote: '引擎自洽：年领6万/60岁起/缴10年 → 年缴约 5.2-5.8 万；IRR（至85岁）≈1.7%-2.2%。',
      richness: [
        { when: function (p) { return p.method === 'g20'; }, pts: 5, label: '保证领取 20 年' },
        { when: function (p) { return p.startAge === '65'; }, pts: 3, label: '延迟领取' },
        { when: function (p) { return p.benefit >= 10; }, pts: 3, label: '高额年金' }
      ],
      points: ['年金对利率极敏感：预定利率 ±0.25%，同等领取的保费变动约 4-6%。',
               '年金定价用死亡率 = 基础表 × 0.75：买年金的人平均更长寿（自选择），这是反向死亡保障。',
               '保证领取 = 确定性换总额：公司多承担早逝风险，必然更贵或领得更少。']
    },

    /* ============ 4.5 百万医疗险 ============ */
    {
      id: 'medical', name: '百万医疗险', cat: '医疗保险', type: 'short', icon: '🏥',
      tagline: '高免赔·报销型·医疗通胀之敌',
      params: [
        { key: 'sa', label: '年度保额', group: 'A', type: 'select', def: '200',
          options: [{ v: '100', l: '100 万' }, { v: '200', l: '200 万' }, { v: '300', l: '300 万' }, { v: '400', l: '400 万' }, { v: '600', l: '600 万' }],
          tip: ['一年内累计报销上限。',
                '百万医疗的"百万"是营销杠杆：真实大额医疗费用极少触顶，保额从 200 万提到 600 万的边际成本很小，但"看起来更大"。',
                '高保额＋高免赔的组合需注意 7 号文"不得虚高保额"的披露要求。'] },
        { key: 'deduct', label: '免赔额', group: 'A', type: 'select', def: '10000',
          options: [{ v: '0', l: '0 免赔' }, { v: '5000', l: '5 千' }, { v: '10000', l: '1 万' }, { v: '15000', l: '1.5 万' }, { v: '20000', l: '2 万' }],
          tip: ['报销前由客户自付的年度门槛金额。',
                '免赔额有三重作用：过滤小额理赔的运营成本、抑制过度就医的道德风险、让低风险者以高免赔换低保费实现自我分类。',
                '免赔设 0 保费大涨且道德风险爆发；1 万是百万医疗的行业主流。'] },
        { key: 'payRatio', label: '赔付比例（经社保后）', group: 'A', type: 'select', def: '100',
          options: [{ v: '100', l: '100%' }, { v: '80', l: '80%' }, { v: '60', l: '60%' }],
          tip: ['扣除免赔额后按比例报销；未经社保结算通常降至 60%（双轨设计）。',
                '共付比例让客户分担边际费用，是对抗道德风险的经典工具。',
                '100% 报销体验最好，但每一次就医的边际成本全部落在保司身上。'] },
        { key: 'dirOut', label: '目录外责任', group: 'A', type: 'select', def: 'yes', options: [{ v: 'yes', l: '含' }, { v: 'no', l: '不含' }],
          tip: ['是否报销医保目录外的费用（自费药、自费耗材等）。',
                '目录外价格不受医保谈判约束、通胀最快，是长期敞口最危险的部分。',
                '含目录外是百万医疗的核心竞争力，去掉它保费降约四成但产品失去灵魂。'] },
        { key: 'special', label: '院外特药责任', group: 'A', type: 'select', def: 'yes', options: [{ v: 'yes', l: '含' }, { v: 'no', l: '不含' }],
          tip: ['报销院外购买的抗癌特药（超 90% 惠民保都含）。',
                '特药是癌症治疗的真实痛点：医院内开不到、患者只能外购。',
                '特药目录迭代快、单价高，责任设计与目录管理能力直接决定赔付率。'] },
        { key: 'renew', label: '续保类型', group: 'C', type: 'select', def: 'y20',
          options: [{ v: 'none', l: '一年期非保证续保' }, { v: 'y6', l: '保证续保 6 年' }, { v: 'y20', l: '保证续保 20 年（费率可调）' }],
          tip: ['非保证续保 = 每年可重定价/停售；保证续保 = 期内不得拒保、不得对个人单独调价。',
                '保证续保是卖给客户的看涨期权：逆选择累积＋通胀再定价受限，必须用期权费（×1.08/×1.18）和"费率可调"条款对冲。',
                '一年期产品不得暗示保证续保（7 号文）；20 年保证 + 乐观通胀假设 = 定价不审慎警告。'] },
        { key: 'service', label: '健康管理服务包', group: 'C', type: 'select', def: 'std',
          options: [{ v: 'none', l: '无' }, { v: 'std', l: '标准（净保费 8%）' }, { v: 'lux', l: '豪华（净保费 25%）' }],
          tip: ['嵌入产品中的健康管理服务（问诊、体检、导诊等）的成本分摊。',
                '红线：分摊成本不得超过净保费 20%（健康险办法），防止把健康服务做成变相返佣。',
                '豪华包直接触发驳回——教学点：服务是成本不是免费赠品。'] },
        { key: 'inflation', label: '医疗通胀假设', group: 'B', type: 'slider', min: 5, max: 12, step: 1, unit: '%', def: 8,
          tip: ['定价中对未来医疗费用年增长率的假设。全球医疗通胀约 10%/年，中国建议取 8-10%。',
                '20 年保证期下 10% 通胀 ≈ 成本 ×6.7：长期保证医疗险的生死参数。',
                '通胀假设 <8% 且选 20 年保证 → 委员会警告"定价假设不审慎"，风控通胀轴大幅扣分。'] }
      ],
      baseline: { sa: '200', deduct: '10000', payRatio: '100', dirOut: 'yes', special: 'yes', renew: 'y20', service: 'std', inflation: 8, age: 30, gender: 'M', rate: 1.75, expFirst: 12, expRenew: 12, margin: 10, underwriting: 'std', wait: 90, hesitation: '15', exclusion: 'std' },
      marketNote: '市场锚点：好医保长期医疗 30岁 259 元、60岁 3139 元（有社保）；无社保版 ×2-3。',
      richness: [
        { when: function (p) { return p.dirOut === 'yes'; }, pts: 6, label: '含目录外' },
        { when: function (p) { return p.special === 'yes'; }, pts: 6, label: '含院外特药' },
        { when: function (p) { return p.renew === 'y20'; }, pts: 8, label: '保证续保 20 年' },
        { when: function (p) { return p.renew === 'y6'; }, pts: 4, label: '保证续保 6 年' },
        { when: function (p) { return p.service !== 'none'; }, pts: 3, label: '健康服务' },
        { when: function (p) { return p.deduct === '0' || p.deduct === '5000'; }, pts: 4, label: '低免赔' }
      ],
      points: ['免赔额是百万医疗的价格支点：1 万免赔过滤掉 80% 的小额住院，保费降到年轻人买得起的水平。',
               '保证续保的代价 = 期权费：×1.08 / ×1.18 之外还必须"费率可调"，否则通胀会吃掉偿付能力。',
               '医疗通胀 10% 下 20 年成本 ×6.7——通胀假设是这个产品最要命的参数。']
    },

    /* ============ 4.6 重大疾病保险 ============ */
    {
      id: 'ci', name: '重大疾病保险', cat: '重大疾病保险', type: 'long', icon: '🫀',
      tagline: '收入损失补偿·定义即条款',
      params: [
        { key: 'sa', label: '基本保额', group: 'A', type: 'slider', min: 10, max: 150, step: 5, unit: '万', def: 50,
          tip: ['确诊约定重疾一次性给付的金额（轻症/中症按比例给付）。',
                '重疾险不是医疗费报销，是收入损失补偿：保额建议 = 3-5 倍年收入（治疗费＋3-5 年康复期收入缺口）。',
                '行业理赔年报提示重案件均赔付不足 15 万，保障缺口普遍很大。'] },
        { key: 'term', label: '保障期间', group: 'A', type: 'select', def: 'life', options: [{ v: '30', l: '30 年' }, { v: 'to70', l: '至 70 岁' }, { v: 'life', l: '终身' }],
          tip: ['重疾保障的期限；定期便宜 30%-50%。',
                '50 岁后重疾发生率指数式上升：保到 70 岁 vs 终身的差价，就是老年风险的价钱。',
                '保终身必然赔一次（一生累计罹患率男约 66%），储蓄成分也更高。'] },
        { key: 'pay', label: '缴费期间', group: 'A', type: 'select', def: '30', options: [{ v: '10', l: '10 年' }, { v: '20', l: '20 年' }, { v: '30', l: '30 年' }],
          tip: ['保费分几年缴清；被保险人豁免在轻/中/重疾后免掉剩余保费。',
                '长缴费 + 豁免的组合是"用时间换杠杆"：越早出险，免掉的保费越多。',
                '缴费期越长，继续率假设对定价的影响越大。'] },
        { key: 'light', label: '轻症给付比例', group: 'A', type: 'slider', min: 15, max: 40, step: 5, unit: '%', def: 30, redline: 30,
          tip: ['确诊轻度疾病（3 种规范轻症）给付基本保额的比例。红线 30%。',
                '2020 重疾新规把轻症比例锁在 30%：甲状腺癌 TNM Ⅰ 期等被降级进轻症，防止"癌症化营销"。',
                '>30% 直接驳回（2020 定义规范）；顶格 30% 是市场主流——天花板不是地板。'] },
        { key: 'mid', label: '中症给付比例', group: 'A', type: 'slider', min: 40, max: 70, step: 10, unit: '%', def: 60,
          tip: ['确诊中度疾病给付基本保额的比例（无监管强制上限）。',
                '市场惯例 50%-60%，60% 是当前主流上限。',
                '>60% 触发警告"超出市场惯例"：给付结构激进，利润测试难过。'] },
        { key: 'deathRider', label: '身故责任', group: 'A', type: 'select', def: 'none',
          options: [{ v: 'none', l: '无（消费型）' }, { v: 'refund', l: '返已缴保费' }, { v: 'full', l: '赔保额' }],
          tip: ['未出重疾而身故时的给付方式。',
                '消费型把每一分钱花在疾病风险上；含身故则必然赔一次，储蓄成分大幅上升（+15%/+55% 纯保费）。',
                '消费型性价比最高但"没出险钱就没了"——这是保障与储蓄的心理账户之争。'] },
        { key: 'multi', label: '重疾多次赔', group: 'A', type: 'select', def: 'single', options: [{ v: 'single', l: '单次' }, { v: 'group3', l: '分组 3 次' }],
          tip: ['重疾赔付次数；分组多次赔按组别各赔一次（间隔 1 年）。',
                '恶性肿瘤单独一组 = 最高发疾病出险后不挤占其他病种的赔付机会。',
                '多次赔 ×1.12 纯保费：第二次重疾的发生率不高但逆选择集中（理赔过的人更会续保）。'] },
        { key: 'cancer2', label: '恶性肿瘤二次赔', group: 'A', type: 'select', def: 'no', options: [{ v: 'no', l: '不含' }, { v: 'yes', l: '含（间隔 3 年）' }],
          tip: ['首次确诊满 3 年后新发/复发/转移/持续，再赔一次。',
                '癌症是重疾理赔的绝对主力（占 60%-75%），复发转移风险真实存在。',
                '×1.10 纯保费：高发附加项，卖点强、成本也实打实。'] },
        { key: 'extra60', label: '60 岁前额外给付', group: 'A', type: 'select', def: 'none',
          options: [{ v: 'none', l: '无' }, { v: '50', l: '额外 50%' }, { v: '80', l: '额外 80%' }, { v: '100', l: '额外 100%' }],
          tip: ['60 岁前确诊重疾额外给付基本保额的一定比例。',
                '当前市场最流行的设计：家庭责任最重的年份保额翻倍，正中"顶梁柱"痛点。',
                '额外比例越高越贵（+8%~18%）；≥80% 还会轻微放大道德风险（逆选择聚焦高龄前出险）。'] },
        { key: 'waiver', label: '被保险人豁免', group: 'A', type: 'select', def: 'yes', options: [{ v: 'yes', l: '含' }, { v: 'no', l: '不含' }],
          tip: ['确诊轻/中/重疾后豁免剩余全部保费，合同继续有效。',
                '行业标配（+3% 纯保费）：把"出险后还要继续缴费"这个体验死角补上。',
                '豁免的成本集中在缴费前期出险的保单——杠杆大、成本低，是少见的双赢设计。'] },
        { key: 'lapse', label: '继续率假设（年退保率）', group: 'B', type: 'slider', min: 4, max: 15, step: 1, unit: '%', def: 8,
          tip: ['每年预期退保比例。重疾险继续率显著优于定寿（健康焦虑黏住客户）。',
                '继续率是渠道质量的镜子：高退保渠道的定价会惩罚坚持缴费的好客户。',
                '继续率越差，同价产品利润越薄——给付端与保费端同时被侵蚀。'] }
      ],
      baseline: { sa: 50, term: 'life', pay: '30', light: 30, mid: 60, deathRider: 'none', multi: 'single', cancer2: 'no', extra60: 'none', waiver: 'yes', lapse: 8, age: 30, gender: 'M', rate: 1.75, expFirst: 55, expRenew: 12, margin: 10, underwriting: 'std', wait: 90, hesitation: '15', exclusion: 'std' },
      marketNote: '市场价：30岁男 50万/终身/30年缴/消费型 ≈ 4600-6900 元；至 70 岁 ≈ 3000-5600 元。',
      richness: [
        { when: function (p) { return p.light >= 30; }, pts: 4, label: '轻症顶格' },
        { when: function (p) { return p.mid >= 60; }, pts: 4, label: '中症 60%' },
        { when: function (p) { return p.multi === 'group3'; }, pts: 5, label: '重疾多次赔' },
        { when: function (p) { return p.cancer2 === 'yes'; }, pts: 5, label: '癌症二次赔' },
        { when: function (p) { return p.extra60 === '80' || p.extra60 === '100'; }, pts: 5, label: '60 岁前额外给付' },
        { when: function (p) { return p.extra60 === '50'; }, pts: 3, label: '60 岁前额外 50%' },
        { when: function (p) { return p.waiver === 'yes'; }, pts: 3, label: '被保险人豁免' },
        { when: function (p) { return p.deathRider !== 'none'; }, pts: 4, label: '含身故责任' },
        { when: function (p) { return p.term === 'life'; }, pts: 3, label: '保终身' }
      ],
      points: ['重疾险是收入损失补偿，不是医疗报销：保额对齐 3-5 倍年收入才有意义。',
               '2020 重疾新规：28 种重疾必含、轻症 ≤30%、甲状腺癌 Ⅰ 期降级轻症——定义即条款，条款即价格。',
               '恶性肿瘤占重疾理赔 60%-75%；女性癌症占比更高（86%），男性心梗/脑中风更突出。']
    },

    /* ============ 4.7 综合意外险 ============ */
    {
      id: 'accident', name: '综合意外险', cat: '意外伤害保险', type: 'short', icon: '🚑',
      tagline: '低发生率·职业定价·一年期',
      params: [
        { key: 'sa', label: '意外身故/伤残保额', group: 'A', type: 'slider', min: 10, max: 200, step: 10, unit: '万', def: 50,
          tip: ['意外身故给付 100% 保额；伤残按 1-10 级比例给付（1 级 100% → 10 级 10%）。',
                '意外险便宜的本质：发生率极低（身故理赔中意外仅占约 15%）、无储蓄成分、无利率风险。',
                '保额可以给得很高而保费很低——这是杠杆最高的人身险。'] },
        { key: 'occ', label: '职业覆盖', group: 'A', type: 'select', def: 'c13',
          options: [{ v: 'c13', l: '1-3 类（办公/内勤/轻体力）' }, { v: 'c14', l: '1-4 类（含一般体力/机械）' }, { v: 'c16', l: '1-6 类（含高空/矿工等高危）' }],
          tip: ['承保的职业类别范围，按覆盖的最高类取费率系数（1类1.0 → 6类5.0）。',
                '职业误报是意外险理赔纠纷的首要根源——"坐在办公室卖建材"的案例数不胜数。',
                '5-6 类职业费率是 1-3 类的 2-5 倍：高危职业两难（费率高→人群缩小→逆选择加重→拒保）。'] },
        { key: 'medRider', label: '意外医疗', group: 'A', type: 'select', def: 'm10080',
          options: [{ v: 'none', l: '不含' }, { v: 'm0100', l: '含（0 免赔 100%）' }, { v: 'm10080', l: '含（100 免赔 80%）' }],
          tip: ['报销意外导致的门诊/住院医疗费用。',
                '报销型受损失补偿原则约束；0 免赔 100% 体验最好但小额索赔的运营成本可能超过赔款本身。',
                '预期赔付约 80 元/年（1 类基准），免赔与比例是它的价格旋钮。'] },
        { key: 'allowance', label: '住院津贴', group: 'A', type: 'select', def: 'a50',
          options: [{ v: 'none', l: '无' }, { v: 'a50', l: '50 元/天' }, { v: 'a100', l: '100 元/天' }, { v: 'a150', l: '150 元/天（单次≤90天）' }],
          tip: ['因意外住院按天定额给付，单次上限 90 天。',
                '津贴型不受损失补偿约束，激励相容性差（可能诱导延长住院），所以必须设天数上限。',
                '≥100 元/天时道德风险系数上升——躺床每天有钱拿，是人就会多躺两天。'] },
        { key: 'suddenDeath', label: '猝死责任', group: 'A', type: 'select', def: 'no', options: [{ v: 'no', l: '不含' }, { v: 'yes', l: '含' }],
          tip: ['对"突发疾病死亡"（多为心源性）单独给付。',
                '猝死不满足意外四要素中的"非疾病"，意外险默认不赔——客户不懂，理赔时才懂。',
                '附加猝死 ×1.22：条款里写清楚，比什么都强。'] },
        { key: 'sport', label: '高风险运动扩展', group: 'A', type: 'select', def: 'no', options: [{ v: 'no', l: '不含' }, { v: 'yes', l: '含' }],
          tip: ['把潜水、跳伞、攀岩、赛车等从免责清单中放开。',
                '高风险运动是典型可付费拓展的免责项：风险可识别、可定价、可选择。',
                '扩展 ×1.08：为小众高风险人群单独定价，正是风险分类的正面案例。'] }
      ],
      baseline: { sa: 50, occ: 'c13', medRider: 'm10080', allowance: 'a50', suddenDeath: 'no', sport: 'no', age: 30, gender: 'M', rate: 1.75, expFirst: 15, expRenew: 12, margin: 10, underwriting: 'std', wait: 90, hesitation: '15', exclusion: 'std' },
      marketNote: '市场价：1 类 50 万综合意外（含意外医疗）≈ 100-200 元/年；5-6 类 100 万 1200-2500 元。',
      richness: [
        { when: function (p) { return p.medRider !== 'none'; }, pts: 5, label: '含意外医疗' },
        { when: function (p) { return p.medRider === 'm0100'; }, pts: 3, label: '0 免赔医疗' },
        { when: function (p) { return p.allowance !== 'none'; }, pts: 3, label: '住院津贴' },
        { when: function (p) { return p.allowance === 'a150'; }, pts: 2, label: '高津贴' },
        { when: function (p) { return p.suddenDeath === 'yes'; }, pts: 5, label: '含猝死责任' },
        { when: function (p) { return p.sport === 'yes'; }, pts: 3, label: '高风险运动' },
        { when: function (p) { return p.occ === 'c16'; }, pts: 6, label: '全职业覆盖' },
        { when: function (p) { return p.occ === 'c14'; }, pts: 3, label: '4 类职业覆盖' }
      ],
      points: ['意外四要素：外来的、突发的、非本意的、非疾病的——缺一不可，猝死就倒在"非疾病"上。',
               '伤残按等级比例给付（1 级 100% → 10 级 10%），统一的伤残评定标准是理赔定损的基础。',
               '职业误报 = 理赔纠纷首因；1-6 类全收的产品必须用分档价表把 5-6 类的 2-5 倍费率摆上台面。']
    },

    /* ============ 4.8 长期护理保险 ============ */
    {
      id: 'ltc', name: '长期护理保险', cat: '长期护理保险', type: 'long', icon: '🛏️',
      tagline: '失能给付·最长久期·利率敏感之王',
      params: [
        { key: 'benefit', label: '月度护理金', group: 'A', type: 'slider', min: 1000, max: 10000, step: 500, unit: '元/月', def: 2000,
          tip: ['触发给付条件后每月给付的金额。',
                '护理金对标的是失能后的护理成本（人力密集、随工资增长），不是医疗费。',
                '月给付越高保费越贵；给付与收入挂钩是防道德风险的行业惯例（替代比例 ≤70-80%）。'] },
        { key: 'benPeriod', label: '给付期限', group: 'A', type: 'select', def: '10', options: [{ v: '3', l: '3 年' }, { v: '5', l: '5 年' }, { v: '10', l: '10 年' }, { v: 'life', l: '终身' }],
          tip: ['触发后最长给付的年限。',
                '发生率低但给付期长 → 久期极长，是所有产品里的"利率敏感之王"。',
                '终身给付把长寿风险与失能风险叠加，是"活得最久的期权"。'] },
        { key: 'trigger', label: '触发条件', group: 'A', type: 'select', def: 'adl3',
          options: [{ v: 'adl3', l: '3 项 ADL 丧失' }, { v: 'adl2', l: '2 项 ADL 丧失' }, { v: 'adl2c', l: '2 项 ADL 或严重认知障碍' }],
          tip: ['日常生活活动能力（ADL）丧失项数或认知障碍，作为进入给付状态的标准。',
                '触发条件越宽发生率越高（3项=1.0 / 2项=1.6 / 2项或认知=2.1）；全国失能评估标准 2021 年才落地，数据稀缺。',
                '宽触发 = 好赔 = 客户喜欢 = 保费大涨 + 界定纠纷（"到底算不算 2 项"）。'] },
        { key: 'term', label: '保障期间', group: 'A', type: 'select', def: 'to80', options: [{ v: 'to70', l: '至 70 岁' }, { v: 'to80', l: '至 80 岁' }, { v: 'life', l: '终身' }],
          tip: ['可能触发给付的观察期。',
                '失能发生率随年龄指数上升，保障到 80 岁以后的敞口增长远快于直觉。',
                '社保长护险目前只保重度失能、以服务报销为主——商业产品在填它没填的坑。'] },
        { key: 'pay', label: '缴费期间', group: 'A', type: 'select', def: '20', options: [{ v: '10', l: '10 年' }, { v: '15', l: '15 年' }, { v: '20', l: '20 年' }],
          tip: ['保费分几年缴清（趸交为一次缴清），缴费期内失能通常豁免后续保费。',
                '缴费期内失能通常豁免后续保费（教学简化为不豁免），真实产品会做豁免设计。',
                '缴费期越长利率敏感性越高——久期在负债端和资产端同时拉长。'] }
      ],
      lapseFixedNote: '长护继续率固定 5%（保费端）、给付端 2%（服务型给付黏性高），不设滑杆。',
      baseline: { benefit: 2000, benPeriod: '10', trigger: 'adl3', term: 'to80', pay: '20', age: 40, gender: 'M', rate: 1.75, expFirst: 55, expRenew: 12, margin: 10, underwriting: 'std', wait: 90, hesitation: '15', exclusion: 'std' },
      marketNote: '基准：40 岁 / 月给付 2000 / 10 年给付期 / 缴 20 年 / 至 80 岁 ≈ 2000-3000 元/年。',
      richness: [
        { when: function (p) { return p.benPeriod === 'life'; }, pts: 5, label: '终身给付' },
        { when: function (p) { return p.benPeriod === '10'; }, pts: 3, label: '10 年给付期' },
        { when: function (p) { return p.trigger === 'adl2' || p.trigger === 'adl2c'; }, pts: 4, label: '宽触发条件' },
        { when: function (p) { return p.term === 'life'; }, pts: 3, label: '终身保障' },
        { when: function (p) { return p.benefit >= 4000; }, pts: 3, label: '高额护理金' }
      ],
      points: ['发生率低但给付期长 → 久期极长 → 利率敏感之王：利率假设差 0.25%，准备金差一截。',
               '失能数据稀缺：全国统一评估标准 2021 年才落地，商业经验多参照重疾表＋伤残等级拼凑。',
               '社保长护险 49 城试点、费率约 0.3% 工资基数、只保重度失能——商业长护在填"服务缺口"，不是和社保抢池子。']
    }
  ];

  /* ---------- 客群（GDD §5） ---------- */
  var CLUSTERS = [
    { id: 'newmiddle', name: '都市新中产 · 顶梁柱', portrait: '30 岁左右，房贷＋娃，预算敏感', fit: ['term', 'ci', 'accident', 'medical'], priceSens: 'high', reviewer: '林芳看重性价比与杠杆' },
    { id: 'pension', name: '中产家庭 · 养老储备', portrait: '40 岁，关注确定性长期收益', fit: ['annuity', 'endowment', 'whole'], priceSens: 'low', reviewer: '林芳看重利益演示与 IRR' },
    { id: 'labor', name: '建筑劳务群体', portrait: '35 岁，4-5 类职业，团险思路', fit: ['accident', 'medical'], priceSens: 'high', reviewer: '林芳看重职业覆盖与理赔纠纷' },
    { id: 'silver', name: '银发慢病群体', portrait: '55-65 岁，三高/结节', fit: ['medical', 'ltc'], priceSens: 'mid', reviewer: '老周严查核保与既往症表述' },
    { id: 'free', name: '自由模式', portrait: '无客群加成、无错配点评', fit: null, priceSens: 'mid', reviewer: '' }
  ];

  /* 法定三条免责（条款摘要区固定展示） */
  var LAW_EXCLUSIONS = [
    '投保人故意杀害被保险人不赔（《保险法》第43条）',
    '被保险人故意犯罪致死不赔（《保险法》第45条）',
    '合同成立/复效 2 年内自杀不赔，满 2 年应赔（《保险法》第44条）'
  ];

  AW.products = PRODUCTS;
  AW.sharedParams = SHARED;
  AW.clusters = CLUSTERS;
  AW.lawExclusions = LAW_EXCLUSIONS;

  AW.getProduct = function (id) {
    for (var i = 0; i < PRODUCTS.length; i++) if (PRODUCTS[i].id === id) return PRODUCTS[i];
    return null;
  };
  /* 合并参数定义（通用 + 专属），并应用短期险费用率默认覆盖 */
  AW.getParams = function (pid) {
    var p = AW.getProduct(pid);
    var list = [];
    var i, s;
    for (i = 0; i < SHARED.length; i++) {
      s = SHARED[i];
      var copy = {};
      for (var k in s) copy[k] = s[k];
      if (p.type === 'short' && s.key === 'expFirst' && typeof s.shortDef === 'number') {
        copy.def = (pid === 'accident') ? C.accExpenseDefault : C.medExpenseDefault;
      }
      list.push(copy);
    }
    for (i = 0; i < p.params.length; i++) list.push(p.params[i]);
    return list;
  };
  AW.getDefaultCfg = function (pid) {
    var defs = AW.getParams(pid), cfg = {};
    for (var i = 0; i < defs.length; i++) cfg[defs[i].key] = defs[i].def;
    return cfg;
  };
})();
