/* =====================================================================
 * 精算工坊 · js/data/mentor.js
 * 总精算师 陈砚（🧑‍🦳）实时点评规则（IF-THEN，GDD §10 + GDD-stage2 §14.3）
 * + 产品委员会三成员台词池（GDD §8 评审演出）。
 * 规则 ctx = { pid, p(参数), priced(引擎输出), filing(当前申报,阶段二), publication(当前公示,阶段三), sale(当前销售,阶段四), claim(当前案件,阶段五), event(阶段二~五事件), flags:{firstStep2, firstEngine, firstPass} }
 * ===================================================================== */
(function () {
  'use strict';
  var AW = (typeof window !== 'undefined') ? (window.AW = window.AW || {})
                                           : (globalThis.AW = globalThis.AW || {});

  var RULES = [
    { id: 'm_wait0', text: '等待期是逆选择的过滤器。你把它拆了，等于把大门敞开——带病的人会在生效第二天来索赔。',
      when: function (c) { return c.p.wait === 0; } },
    { id: 'm_infl', text: '二十年的保证，配上一个乐观的通胀假设。十年后回头看今天的价格，你会出一身冷汗。',
      when: function (c) { return c.pid === 'medical' && c.p.renew === 'y20' && c.p.inflation < 8; } },
    { id: 'm_icap', text: '你在利率的高点卖出了几十年的刚性承诺。1996 年的前辈们也是这么想的——后来那叫利差损。',
      when: function (c) { return c.p.rate >= 2.0 && AW.getProduct(c.pid).type === 'long'; } },
    { id: 'm_deduct0', text: '零免赔很性感，但每一笔小额理赔的运营成本可能比赔款本身还贵。你在卖保险，不是办慈善晚会。',
      when: function (c) { return c.pid === 'medical' && parseInt(c.p.deduct, 10) === 0; } },
    { id: 'm_gene', text: '停。用基因信息核保是《健康保险管理办法》明令禁止的——那会制造一批"生来不可保"的人。',
      when: function (c) { return c.p.underwriting === 'gene'; } },
    { id: 'm_lapse', text: '价格很漂亮，但你赌的是四分之一的客户每年退保。lapse-based pricing 在国际上是有伦理争议的。',
      when: function (c) { return c.pid === 'term' && c.p.lapse >= 25; } },
    { id: 'm_margin30', text: '30% 的利润加载？我们做的是保险，不是抢钱。监管会问，消费者更会问。',
      when: function (c) { return c.p.margin >= 30; } },
    { id: 'm_margin0', text: '零边际定价很慷慨——慷慨到股东和偿付能力都要皱眉。精算的第一课：不确定性本身就有成本。',
      when: function (c) { return c.p.margin === 0; } },
    { id: 'm_light30', text: '轻症顶格用到监管上限没有错，但记住那是天花板，不是地板。',
      when: function (c) { return c.pid === 'ci' && c.p.light >= 30; } },
    { id: 'm_sudden', text: '猝死不算意外——它是疾病。客户不懂，理赔时才懂。条款里写清楚，比什么都强。',
      when: function (c) { return c.pid === 'accident' && c.p.suddenDeath === 'no'; } },
    { id: 'm_134', text: '满 5 年、顶格 20%——你在红线的边缘跳舞。134 号文就是这么被写出来的。',
      when: function (c) { return c.pid === 'endowment' && c.p.survStart === '5' && parseInt(c.p.survRatio, 10) >= 20; } },
    { id: 'm_silver', text: '给慢病老人卖医疗险，还用最松的核保？你的赔付率会在第一个季度就告诉你什么叫逆选择。',
      when: function (c) { return c.pid === 'medical' && c.p.underwriting === 'loose' && typeof AW.state !== 'undefined' && AW.state.clusterId === 'silver'; } },
    { id: 'm_step2', text: '三块面板，就是精算师的三观：卖什么责任、用什么假设、如何控制人性。',
      when: function (c) { return c.flags.firstStep2; } },
    { id: 'm_engine', text: '注意右侧仪表盘——每动一个滑杆，保费、赔付率、利润都在变。定价没有标准答案，只有权衡。',
      when: function (c) { return c.flags.firstEngine; } },
    { id: 'm_excl', text: '免责越窄，产品越好卖，敞口越大。先想清楚：哪些风险我们真的不敢接？',
      when: function (c) { return c.p.exclusion === 'wide'; } },
    { id: 'm_occ6', text: '六类全收，包括矿工和爆破员？brave。但费率表会如实反映你的勇气。',
      when: function (c) { return c.pid === 'accident' && c.p.occ === 'c16'; } },
    { id: 'm_exp90', text: '首年费用吃掉九成保费——渠道的胃口是无底的，退保的人在替他们买单。',
      when: function (c) { return c.p.expFirst >= 90; } },
    { id: 'm_pass', text: '备案回执只是开始。产品卖出去之后，定价假设要在真实世界里接受回溯检验——那是另一个故事，下个版本见。',
      when: function (c) { return c.flags.firstPass; } },
    { id: 'm_mid70', text: '中症 70%？市场上 60% 已经是主流上限。给付结构这么激进，利润测试报告打算怎么写？',
      when: function (c) { return c.pid === 'ci' && c.p.mid >= 70; } },
    { id: 'm_annuity30', text: '一年领 30 万的年金，先想想卖给谁——掏得起的人不需要你推销，需要的人掏不起。定价之前先想客群。',
      when: function (c) { return c.pid === 'annuity' && c.p.benefit >= 30; } },
    { id: 'm_ltc_life', text: '终身给付的长护是"活得最久的期权"——久期之王。你对利率的每一个假设，都会被未来几十年放大。',
      when: function (c) { return c.pid === 'ltc' && c.p.benPeriod === 'life'; } },
    { id: 'm_sa600', text: '600 万保额主要是营销杠杆——真实医疗费用极少触顶。别忘了 7 号文：不得设定虚高保额。',
      when: function (c) { return c.pid === 'medical' && parseInt(c.p.sa, 10) >= 600; } },
    { id: 'm_old', text: '高龄客群的费率是年轻人的十倍以上。这不是歧视，是发生率表的诚实——但你要想清楚谁买得起、谁愿意买。',
      when: function (c) { return c.p.age >= 60; } },
    { id: 'm_hisa', text: '定寿拉到 300 万以上，免体检限额就到头了：超限必须叠加体检与财务核保——否则你是在花钱买逆选择。',
      when: function (c) { return c.pid === 'term' && c.p.sa >= 300; } },
    { id: 'm_margin25', text: '25% 以上的利润加载，监管会问"定价是否偏高侵害消费者"，你的消保审查和利润测试都备好了吗？',
      when: function (c) { return c.p.margin > 25 && c.p.margin < 30; } },
    { id: 'm_allow150', text: '150 元一天的住院津贴——津贴型产品最大的敌人，是人性的躺床冲动。天数上限就是为它准备的。',
      when: function (c) { return c.pid === 'accident' && c.p.allowance === 'a150'; } },
    { id: 'm_cheap', text: '价格压到基准的七折以下，委员会会问你两个问题：假设是不是太乐观？还是打算赔本赚吆喝？',
      when: function (c) { return c.priced && c.priced.vsBase != null && c.priced.vsBase < 0.7; } },

    /* ---------- 阶段二「监管申报」（ctx.filing 存在时才可能触发，GDD-stage2 §14.3） ---------- */
    { id: 'm_f_route', text: '《保险法》第 135 条就是审批与备案的分界线：新开发的人寿保险险种报审批，其余备案。¥1,000 沟通成本买这条边界，不亏——下不为例。',
      when: function (c) { return c.filing && c.filing.routeFixed; } },
    { id: 'm_f_axes', text: '缺了必选的敏感性分析就想让我签字？利润测试是精算报告的骨架，利率、发生率这些轴就是骨架里的钢筋。补齐了再来。',
      when: function (c) { return c.filing && c.filing.lastSignRefused; } },
    { id: 'm_f_extra', text: '与本品风险无关的敏感性轴，勾了也只是徒增篇幅。监管想看的是你懂不懂自己的风险在哪里，不是谁勾得多。',
      when: function (c) { return c.filing && c.filing.extraAxes && c.filing.extraAxes.length > 0; } },
    { id: 'm_f_hard', text: '条款表述是备案材料的门面——表述硬错误被补正，费率表算得再漂亮也到不了回执那一步。逐字读条款，是法律责任人和总精算师的共同功课。',
      when: function (c) { return c.filing && c.filing.errors && c.filing.errors.length > 0; } },
    { id: 'm_f_inq', text: '问询函答得漂亮。记住这个要领：书面回应要给数据、给情景测试结论，不要给态度——监管看的是证据，不是信心。',
      when: function (c) { return c.filing && c.filing.inquiry && c.filing.inquiry.answeredOk === true; } },
    { id: 'm_f_receipt', text: '回执到手了。但请记住那行小字：已备案的条款费率不得擅自修改——要改，就得重新走一遍今天这条路。',
      when: function (c) { return c.filing && c.filing.status === 'receipt'; } },
    { id: 'm_f_inq_bad', text: '问询答复被打了回来。「投资收益能覆盖」「历史经验稳定」这类话在问询函里一文不值——监管要的是敏感性测试和审慎口径。书面补充说明里，把数据摆出来。',
      when: function (c) { return c.filing && c.filing.inquiry && c.filing.inquiry.answeredOk === false; } },

    /* ---------- 阶段三「批复公示」（ctx.publication 存在时才可能触发，GDD-stage3 §15.3） ---------- */
    { id: 'm_p_wrong', text: '批复文件都要读错，¥500 的更正费不冤。回执锁定的是条款费率，给的是销售资格——这两件事，一个字都不能含糊。',
      when: function (c) { return c.publication && c.event === 'interpret_wrong'; } },
    { id: 'm_p_allok', text: '三题全对，读文件的基本功不错。大多数合规事故不是坏心，而是没把文件读懂——你已经领先一步。',
      when: function (c) { return c.publication && c.event === 'interpret_allok'; } },
    { id: 'm_p_trap', text: '精算报告和利润测试是给监管看的，不是给公众看的。披露不当和披露缺失一样违规——老周警告过了，抽查罚单可不会提前打招呼。',
      when: function (c) { return c.publication && c.event === 'disc_trap'; } },
    { id: 'm_p_noise', text: '停售公告？产品还没开卖。披露清单的每一项都有它的时点——知道「此刻该发什么」，和知道「永远什么都不发」一样重要。',
      when: function (c) { return c.publication && c.event === 'disc_noise'; } },
    { id: 'm_p_refused', text: '缺必备披露项还想上线？上市销售前未按要求披露的不得销售——8 号令这条不是建议。把清单当 checklist 用，一条条核。',
      when: function (c) { return c.publication && c.event === 'disc_refused'; } },
    { id: 'm_p_eok', text: '这次应对得体。公示期的质疑是免费的公众教育素材——前提是给数据、给依据、有分寸，不给态度、不许诺、不贬低同业。',
      when: function (c) { return c.publication && c.event === 'event_ok'; } },
    { id: 'm_p_ebad', text: '应对失分了。「个人行为」「风险自担」「赔付率低是效率高」——这些话术每一句都在把舆情升级成监管事件。公示期的答案只有一种：整改、数据、依据。',
      when: function (c) { return c.publication && c.event === 'event_bad'; } },
    { id: 'm_p_pub', text: '公示完成，注册号落档。条款费率在阳光下、在监管视野里、在竞争对手的案头——从现在起，你定的每个假设都有人盯着对账。',
      when: function (c) { return c.publication && c.event === 'published'; } },

    /* ---------- 阶段四「上架销售」（ctx.sale 存在时才可能触发，GDD-stage4 §16.3） ---------- */
    { id: 'm_s_ltcnet', text: '长护险不在互联网人身险白名单里——108 号文把「健康险除护理」划得清清楚楚。监管通报 −¥1,000 是学费：选渠道之前先查产品资格。',
      when: function (c) { return c.sale && c.event === 'channel_wrong'; } },
    { id: 'm_s_bplan', text: '账外加佣 8 个百分点，当场没人罚你——但飞行检查已经在路上了。报行合一的账要算全年：没收、罚款、声望，最后净现金流一定比老实执行更难看。',
      when: function (c) { return c.sale && c.event === 'commission_b'; } },
    { id: 'm_s_accc', text: '意外险走说明制通道：超短期个人费用率上限 5 个百分点以内、附总经理书面说明报备——合规的「突破」都有名有据。这正是报行合一留给精算师的弹性空间。',
      when: function (c) { return c.sale && c.event === 'commission_c' && c.pid === 'accident'; } },
    { id: 'm_s_mattrap', text: '高档演示、存款话术、停售炒作——勾了这些物料，老周的警告只是预告片，首季的消保通报才是正片。销售误导的处罚案例，全是从一张宣传页开始的。',
      when: function (c) { return c.sale && c.event === 'material_trap'; } },
    { id: 'm_s_matmiss', text: '缺必备物料就想开播？条款、免责提示、犹豫期告知是底线三件套——《保险销售行为管理办法》不允许「先卖着再补」。把清单当 checklist 用，一条条核。',
      when: function (c) { return c.sale && c.event === 'material_refused'; } },
    { id: 'm_s_eok', text: '首季事件应对得当。销售期的投诉是免费的整改清单——答得有依据、有分寸，监管看到的就不是麻烦，是内控。',
      when: function (c) { return c.sale && c.event === 'event_ok'; } },
    { id: 'm_s_ebad', text: '首季应对失分了。「个人行为」「客户签字了」「赔付率低是效率高」——这些话每一句都在把投诉升级成处罚。答案只有一种：整改、数据、依据。',
      when: function (c) { return c.sale && c.event === 'event_bad'; } },
    { id: 'm_s_listed', text: '上市成功。看一眼首季快报：报行合一约束下，老实执行备案佣金的公司净现金流反而更好看——这就是「报与行一致」的市场逻辑。出险勘察与理赔结算是下一阶段的故事。',
      when: function (c) { return c.sale && c.event === 'listed'; } },

    /* ---------- 阶段五「理赔季」（ctx.claim 存在时才可能触发，GDD-stage5；
     * 事件名由 ui/claims.js 经 AW.main.checkMentorClaims(evt, claim) 派发 ---------- */
    { id: 'm_c_tier', text: '勘察档位不是预算旋钮，是证据旋钮。该深不深，证据不足、拒赔变败诉；不该深深，成本和时效两头亏——档位跟着案情走，不跟着心情走。',
      when: function (c) { return c.claim && c.event === 'tier_wrong'; } },
    { id: 'm_c_doc', text: '《保险法》22 条要求一次性通知补充单证——挤牙膏式索料把 2 天的事拖成 7 天，还倒贴一条投诉。补料清单一次列全，是核赔的基本功。',
      when: function (c) { return c.claim && c.event === 'doc_trap'; } },
    { id: 'm_c_conceal', text: '带病投保案有三个出口：证据坐实走 16 条拒赔不退费；证据不足硬拒就是败诉加错赔三十万；心一软给付就是滥赔。深度调查不是成本，是你站在哪条路上的路标。',
      when: function (c) { return c.claim && c.event === 'case_conceal'; } },
    { id: 'm_c_gratia', text: '通融给付是理赔唯一的合规弹性：分账列支、负责人审批、金额设锚。它留给真正特殊的困难，不是留给「客户很可怜」的即兴发挥。',
      when: function (c) { return c.claim && c.event === 'case_gratia'; } },
    { id: 'm_c_bene', text: '受益人故意害人：43 条受益权丧失，保险金按 42 条转遗产给付其他继承人。引用 27 条欺诈必败——条款序号在法庭上就是战斗力。',
      when: function (c) { return c.claim && c.event === 'case_beneficiary'; } },
    { id: 'm_c_late', text: '核定超 30 日，23 条的逾期利息就开始走表——1.5% 一个月，投诉另计。时限链不是流程图，是计息器。',
      when: function (c) { return c.claim && c.event === 'case_late' && c.claim.late && !c.claim.lateExpected; } },
    { id: 'm_c_lawsuit', text: '错误条款拒赔＝法庭上必败：补付、利息、诉讼费、投诉一样不少。拒赔通知的每一个条款引用，都要经得起对方律师逐字读。',
      when: function (c) { return c.claim && c.event === 'deny_bad'; } },
    { id: 'm_c_final', text: '理赔档案归档了。总给付、调查成本、罚息罚款三本账摆在一起——核赔台前是单证，台后是《保险法》21 到 27 条的时限链，你现在已经走完全程。',
      when: function (c) { return c.claim && c.event === 'finalized'; } },
    { id: 'm_r_enter', text: '续期经营季：真实世界的成绩单到了。回溯四科目、调价一条通道、回流一桶经验——这三件事做完，你的定价假设才算完成了一次迭代。',
      when: function (c) { return c.event === 'enter'; } },
    { id: 'm_r_report', text: '回溯报告被打回了。科目不全不是聚焦，是偷懒——发生率、费用率、退保率、投资收益率，四科一项都少不得。',
      when: function (c) { return c.event === 'report_bad'; } },
    { id: 'm_r_rate', text: '调价决策前先看偏差表：偏离健康带才动手，幅度跟着偏离走。记住——调价通道一年只能走一次，且是整表统一。',
      when: function (c) { return c.event === 'rate_enter' && c.renewal && !c.renewal.disc && c.renewal.ratePicked !== 'aggr'; } },
    { id: 'm_r_disc', text: '新老客户两套费率？费率调整通知写得明白：不得差别化调整。这条红线的名字叫公平——出过险的客户更不能被单独惩罚。',
      when: function (c) { return c.event === 'rate_enter' && c.renewal && c.renewal.disc; } },
    { id: 'm_r_spiral', text: '涨 30%？先算算谁在走：健康体走光之后，剩下的每一张保单都比涨价前更贵。死亡螺旋不是新闻标题，是你的续期报表。',
      when: function (c) { return c.event === 'spiral'; } },
    { id: 'm_r_settle', text: '看续期模型那张表：费用从 55% 掉到 12%——长期险的钱在后端。但后端有个前提：客户还在。继续率是费差的分母。',
      when: function (c) { return c.event === 'settle'; } },
    { id: 'm_r_backflow', text: '假设回流三项全勾——通融分账、拒赔分桶、a/m 写回。这一季的经验，下一版的假设表已经收到了。',
      when: function (c) { return c.event === 'finalize' && c.renewal && c.renewal.backflowPicked && c.renewal.backflowPicked.length >= 3; } },
    { id: 'm_r_final', text: '续期季收官。回溯、调价、回流——闭环走通了。两季报表放在一起看：产品不是卖出去就完了，是活下去才算数。',
      when: function (c) { return c.event === 'finalize'; } }
  ];

  /* ---------- 委员会台词池（依得分选择，每角色 2-4 句） ---------- */
  var COMMITTEE = {
    chen: {
      name: '总精算师 陈砚', icon: '🧑‍🦳',
      pick: function (s, ctx) {
        var lines = [];
        if (ctx.piReal < 0) lines.push('按你的假设，实际赔付率会显著偏离定价——这份保单是在赔本赚吆喝，盈利分我给不上去。');
        if (ctx.rate >= 2.0) lines.push('顶格利率叠加这份责任，利差风险全压在公司资产负债表上。再降一点，给自己留口气。');
        if (ctx.piReal >= 0.05 && ctx.piReal < 0.15) lines.push('利润测试落在最舒服的区间：假设审慎、边际够用，签我的名字没问题。');
        if (lines.length === 0) lines.push('假设总体审慎，利润测试可解释。记住：今天签的每个数字，五年后都要被回溯对账。');
        return lines.slice(0, 2);
      }
    },
    lin: {
      name: '销售总监 林芳', icon: '👩‍💼',
      pick: function (s, ctx) {
        var lines = [];
        if (ctx.r > 1.3) lines.push('比市场基准贵三成？客户用脚投票，这个价格渠道不会替你卖力。');
        if (ctx.mismatch) lines.push('这个客群要的不是这个产品——定位不清，再好的条款也讲不出卖点。');
        if (ctx.r < 0.9) lines.push('性价比打得过竞品，杠杆演示也漂亮，这单我来想办法推。');
        if (lines.length === 0) lines.push('价格与责任匹配度尚可。要是能把演示利益再讲清楚一点，我会更好卖。');
        return lines.slice(0, 2);
      }
    },
    zhou: {
      name: '合规总监 老周', icon: '🧑‍⚖️',
      pick: function (s, ctx) {
        var lines = [];
        if (ctx.hasReject) lines.push('红线就在条款里写着，驳回没有商量余地。改完再来。');
        if (ctx.warnings > 0) lines.push('有几条警告不构成驳回，但通报批评里全是这种"警告级"问题堆出来的案例。');
        if (ctx.hasReject === false && ctx.warnings === 0) lines.push('条款表述干净、依据齐全，备案材料我这边可以过。');
        return lines.slice(0, 2);
      }
    }
  };

  AW.mentor = { rules: RULES, committee: COMMITTEE };
})();
