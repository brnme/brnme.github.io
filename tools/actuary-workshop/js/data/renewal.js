/* =====================================================================
 * 精算工坊 · js/data/renewal.js（第六阶段「续期经营季」静态数据，GDD-stage6 §18）
 * 挂载 AW.renewalData：SUBJECTS 回溯科目（1275号四必选+两陷阱）/
 * RATE_TIERS 调价四档（费率调整通知口径）/ BACKFLOW 假设回流项 /
 * EVENTS 事件池（e_r_* 确定性命中）/ FEES 经济数值 / STATUS_TEXT / CHEN 导师台词。
 * 法规锚点（research/02 03 04 高置信度）：
 *   〔费率调整通知 2020-04〕长期医疗险费率可调：满3年首调、间隔≥1年、单次设上限、
 *     不得对单个被保险人差别化调整；
 *   〔意外险办法 2021〕连续三年保费>500万且平均赔付率<50% 须及时调整费率；
 *   〔1275号便函〕>1年产品回溯发生率/费用率/退保率/投资收益率，停售后10日内仍须报告。
 * 续保率 keep / 逆选择因子 adverse / 单次上限 +20% 为游戏演出设定值【低】（§18.7）。
 * ===================================================================== */
(function () {
  'use strict';
  var AW = (typeof window !== 'undefined') ? (window.AW = window.AW || {})
                                           : (globalThis.AW = globalThis.AW || {});

  /* ---------- 回溯报告科目（1275号：>1年产品四科目全回溯） ---------- */
  var SUBJECTS = [
    { id: 's_incidence', name: '发生率 / 赔付率经验', must: true,
      why: '核心赔付假设的回溯科目——实际经验 vs 定价假设的第一对照。' },
    { id: 's_expense', name: '费用率（首年 / 续期）', must: true,
      why: '获取成本与维持费用分开回溯：首年 55% vs 续期 12% 的费差结构。' },
    { id: 's_lapse', name: '退保率 / 继续率', must: true,
      why: '继续率决定有效保单与费差基数——lapse 假设失真的产品赚不到后端。' },
    { id: 's_invest', name: '投资收益率', must: true,
      why: '长期险的准备金评估假设；偏离预定利率侵蚀费差与死差之和。' },
    { id: 't_only_lr', name: '只回溯赔付率，其余科目下季再看', trap: true,
      why: '1275号：>1年产品须四科目齐回溯——「只看赔付率」是科目不全，偏离明显须报告。' },
    { id: 't_stop', name: '本产品计划停售，可免于回溯', trap: true,
      why: '停售不豁免：停产后 10 日内仍须提交回溯报告。' }
  ];

  /* ---------- 费率调价四档（医疗险·费率可调；keep/adverse 为演出值【低】） ---------- */
  var RATE_TIERS = [
    { id: 'hold', name: '维持现价（0%）', rate: 0, keep: 0.88, adverse: 1.00, cap: true,
      note: '续保率最高（88%），健康体带病体都留下——赔付率未偏离时的默认解。' },
    { id: 'mild', name: '温和上调 +8%', rate: 0.08, keep: 0.80, adverse: 1.03, cap: true,
      note: '部分健康体流失，剩余人群赔付率小幅上行——温和纠偏。' },
    { id: 'full', name: '到位上调 +15%', rate: 0.15, keep: 0.70, adverse: 1.08, cap: true,
      note: '显著偏离时的到位纠偏，续保率换定价充足度。' },
    { id: 'aggr', name: '激进上调 +30%', rate: 0.30, keep: 0.45, adverse: 1.25, cap: false,
      note: '突破单次上限（演出值 +20%）：退保潮 + 逆选择恶化——死亡螺旋的起点。' }
  ];
  var CAP_RATE = 0.20;        /* 单次调整上限（演出值【低】：通知要求"单次设上限"未公布数） */
  var RENEW_EXP = 0.12;       /* 续期费用率（GDD §4.0 默认 12%） */
  var LAPSE = 0.12;           /* 继续率口径：年退保率默认 12%（非医疗险续期系数 = 1−lapse） */

  /* ---------- 假设回流项（经验数据回流二次定价，research/05:259 母本） ---------- */
  var BACKFLOW = [
    { id: 'b_am', name: '把理赔季实现的逆选择 / 道德风险系数（a/m）写回定价假设表',
      why: 'GDD §6.4：LR_real = 定价赔付率×(1+a+m)——实现值是下一版产品最贵的免费数据。' },
    { id: 'b_gratia', name: '通融赔款按费用假设注记，不混入赔付经验',
      why: '通融分账列支（research/05:177）——混桶会污染发生率假设，让下轮回溯失真。' },
    { id: 'b_deny', name: '拒赔 / 通融案分桶，修正下一版发生率与核保规则',
      why: '拒赔案暴露的逆选择入口（带病投保、职业误报）应回流核保问卷，而不只是拒赔了事。' }
  ];

  /* ---------- 事件池（确定性命中，m = { lra, tier, disc, accidentLow, medicalListed }） ---------- */
  var EVENTS = [
    {
      id: 'e_r_disc', title: '监管处罚：差别化调价',
      cond: function (m) { return !!m.disc; },
      question: '老客户投诉：同一份保证续保合同，新客户按旧费率投保、自己在续保时被单独加费。监管转办单要求说明费率调整的适用口径。',
      options: [
        { id: 'a', text: '承认违规：全体在保客户统一执行备案费率表，本次差别化调整作废并接受处罚', ok: true },
        { id: 'b', text: '新客户是获客让利、老客户是风险定价，属于两套商业策略不算差别化', ok: false },
        { id: 'c', text: '只对出过险的客户恢复原价，未出险的维持新价', ok: false }
      ],
      why: '〔费率调整通知〕不得因单个被保险人身体状况差异单独调整费率——按出险史、新老客户拆分执行都是差别化的变体。调价只能整表统一、重新备案。'
    },
    {
      id: 'e_r_spiral', title: '死亡螺旋：退保潮与赔付率反升',
      cond: function (m) { return m.tier === 'aggr'; },
      question: '费率上调 30% 后单季退保率过半，留下来的多是带病体——续期保费腰斩、赔付率不降反升。董事会问：下一步怎么办？',
      options: [
        { id: 'a', text: '停止激进调价，回溯客群结构，用无理赔优待与服务留驻健康体', ok: true },
        { id: 'b', text: '赔付率升了就再涨一轮，把亏损补回来', ok: false },
        { id: 'c', text: '严格核保续保客户，把带病体清退出去', ok: false }
      ],
      why: '死亡螺旋：涨价→健康体退保→剩余客群赔付率升→再涨价。出口只有一个——留住健康体（优待/服务），而不是继续筛选。清退带病体在保证续保期间是违约。'
    },
    {
      id: 'e_r_accident', title: '意外险赔付率红线',
      cond: function (m) { return !!m.accidentLow; },
      question: '监管数据通报：公司短期意外险已连续三年保费收入超 500 万元、平均赔付率低于 50%——《意外伤害保险业务监管办法》要求说明整改安排。',
      options: [
        { id: 'a', text: '下调费率或扩展责任，把赔付率提到合理区间，并对外披露', ok: true },
        { id: 'b', text: '赔付率低说明经营稳健，无需调整', ok: false },
        { id: 'c', text: '降低佣金费用替代费率调整，赔付率不变', ok: false }
      ],
      why: '意外险办法：连续三年>500万且平均赔付率<50% 须及时调整费率——低赔付率=定价过高，监管要的是让利消费者，不是改费用结构。'
    },
    {
      id: 'e_r_loyalty', title: '无理赔优待的留客账',
      cond: function (m) { return m.tier === 'hold' || m.tier === 'mild'; },
      question: '续保率尚可，运营提出：对连续两年无理赔客户降低次年免赔额（对标沪惠保 1.6万→1.2万 的无理赔优待）。是否采纳？',
      options: [
        { id: 'a', text: '采纳：无理赔优待留住健康体，对冲逆选择，长期降低组合赔付率', ok: true },
        { id: 'b', text: '不采纳：让利是真金白银，赔付率指标下不来', ok: false },
        { id: 'c', text: '只给投诉过的客户降免赔，息事宁人', ok: false }
      ],
      why: '无理赔优待是给健康体的「留下来的理由」——死亡螺旋的对冲工具。给投诉客户开小灶则是新的差别化风险。'
    },
    {
      id: 'e_r_none', title: '风平浪静的续期季',
      cond: function () { return true; },
      question: '本续期季无监管问询、无投诉集中、无赔付率偏离——陈砚：『平淡的一季是最好的精算成绩单。顺手把经验数据回流做了？』',
      options: [
        { id: 'a', text: '按部就班完成回溯与假设回流，把平淡保持成常态', ok: true },
        { id: 'b', text: '没有事件就提前收工，回流下季再说', ok: false }
      ],
      why: '回溯是法定动作，不是事件驱动的救火——没有偏离也要按期完成科目回溯。'
    }
  ];

  /* ---------- 经济数值 ---------- */
  var FEES = {
    reportWrong: { fee: 2000 },                      /* 回溯报告答错打回（¥2,000/次） */
    eventRight: { prestige: 2 },
    eventWrong: { fee: 2000, prestige: -1 },
    discPenalty: { fee: 5000, prestige: -2 },        /* 差别化调价违规 */
    loyaltyBonus: { prestige: 1, keepBonus: 0.03 },  /* 无理赔优待：续保率 +3pp（演出值） */
    backflowAll: { prestige: 2 },                    /* 假设回流三项全勾 */
    finalize: { prestige: 5 }
  };

  var STATUS_TEXT = {
    report: '经验回溯', rate: '费率调价', season: '第二季结算', done: '已收官'
  };

  /* ---------- 导师台词（续期季主讲的仍是总精算师陈砚） ---------- */
  var CHEN = {
    enter: '理赔季结案，进入续期经营季。回执和注册号都躺在档案里了——现在，真实世界开始给你的定价假设打分。',
    report: '回溯不是找茬，是产品 dead or alive 的体检。发生率、费用率、退保率、投资收益率——四科一项都不能少。',
    rateHold: '调价是期权行权：行权价是客户信任。涨价前先问一句——走掉的是谁？留下的又是谁？',
    spiral: '看见了吗？涨 30% 丢了过半的客户，留下的全是带病体。这就是死亡螺旋——涨价治不好涨价造成的病。',
    backflow: '经验数据是精算师唯一的复利。这一季的实现值，就是下一版产品的假设表。'
  };

  AW.renewalData = {
    SUBJECTS: SUBJECTS, RATE_TIERS: RATE_TIERS, BACKFLOW: BACKFLOW,
    EVENTS: EVENTS, FEES: FEES, STATUS_TEXT: STATUS_TEXT, CHEN: CHEN,
    CAP_RATE: CAP_RATE, RENEW_EXP: RENEW_EXP, LAPSE: LAPSE
  };
})();
