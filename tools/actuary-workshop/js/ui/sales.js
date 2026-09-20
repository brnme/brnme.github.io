/* =====================================================================
 * 精算工坊 · js/ui/sales.js（第四阶段「上架销售」界面，GDD-stage4 §16.1 §16.5）
 * 挂载 AW.uiSales：render / renderP1 / renderP2 / renderP3 / ledgerTab /
 * openListedModal（销售档案）/ currentId。
 * 复用 AW.render 的 showModal / toast / .stamp / .comp-row / .chip / .btn-* 体系；
 * 完成章 .stamp-sale（金橙）。deps() 延迟绑定（本文件先于 main.js 加载）。
 * ===================================================================== */
(function () {
  'use strict';
  var AW = (typeof window !== 'undefined') ? (window.AW = window.AW || {})
                                           : (globalThis.AW = globalThis.AW || {});
  var R = null;                  // 延迟取 AW.render（加载顺序：本文件先于 main.js）
  var D = null, E = null, FE = null;   // salesData / salesEngine / filingEngine

  var tab = 'p1';                // p1 | p2 | p3 | ledger
  var curId = null;              // 当前办理的 sale id
  var selPubId = null;           // P1 当前选中的公示产品 id

  function deps() {
    if (!R) R = AW.render;
    D = AW.salesData; E = AW.salesEngine; FE = AW.filingEngine;
    return !!(R && D && E && FE);
  }
  function esc(s) { return R.esc(s); }
  function money(n) { return R.money(n); }
  function st() { return AW.state; }
  function cur() {
    var ss = st().sales || [], i;
    for (i = 0; i < ss.length; i++) if (ss[i].id === curId) return ss[i];
    return null;
  }
  function pubById(id) {
    var ps = st().publications || [], i;
    for (i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i];
    return null;
  }
  function saleOfPub(pid2) {
    var ss = st().sales || [], i;
    for (i = 0; i < ss.length; i++) if (ss[i].pubId === pid2) return ss[i];
    return null;
  }
  function applyDelta(d) {
    if (!d) return;
    if (d.fee) st().budget -= d.fee;
    if (d.prestige) st().prestige = Math.max(0, st().prestige + d.prestige);
  }
  function saveHud() { AW.main.save(); R.renderHUD(); }
  function badgeHTML(c) {
    return '<span class="f-badge sp-' + c.status + '">' + esc(E.statusName(c.status)) + (c.status === 'listed' ? ' ✅' : '') + '</span>';
  }
  function optOf(dec, id) {
    var opt = null;
    if (dec && id != null) dec.options.forEach(function (o) { if (o.id === id) opt = o; });
    return opt;
  }
  /* 阶段五钩子：存在已上市产品时渲染「前往理赔季」入口（GDD-stage5 §17.3） */
  function hasListed() {
    var ss = st().sales || [], i;
    for (i = 0; i < ss.length; i++) if (ss[i].status === 'listed') return true;
    return false;
  }
  function gotoClaimsBtnHTML() {
    if (!hasListed()) return '';
    return '<div class="modal-actions"><button id="btn-goto-claims" class="btn-main">🏥 前往理赔季 →</button></div>';
  }
  function bindGotoClaims(body) {
    var gc = body.querySelector('#btn-goto-claims');
    if (gc) gc.addEventListener('click', function () { AW.main.gotoStage(5); });
  }

  /* ================= 主视图 ================= */
  function render() {
    if (!deps()) return;
    var root = document.getElementById('sales');
    if (!root) return;
    var c = cur();
    function tabBtn(key, label, disabled) {
      return '<button class="ftab ' + (tab === key ? 'on' : '') + '" data-ftab="' + key + '"' +
        (disabled ? ' disabled title="请先在「① 渠道布局」选择已公示的产品"' : '') + '>' + label + '</button>';
    }
    root.innerHTML =
      '<div class="ftabs">' +
      tabBtn('p1', '① 渠道布局') +
      tabBtn('p2', '② 物料合规', !c) +
      tabBtn('p3', '③ 首季经营', !c) +
      tabBtn('ledger', '🗂️ 销售台账') +
      '</div><div id="sales-body"></div>';
    var body = root.querySelector('#sales-body');
    var html = '', bind = null;
    if (tab === 'p2' && c) { html = p2HTML(c); bind = bindP2; }
    else if (tab === 'p3' && c) { html = p3HTML(c); bind = bindP3; }
    else if (tab === 'ledger') { html = ledgerHTML(); bind = bindLedger; }
    else { html = p1HTML(); bind = bindP1; }
    body.innerHTML = html;
    if (bind) bind(body);
    Array.prototype.slice.call(root.querySelectorAll('.ftab')).forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) { R.toast('请先在「① 渠道布局」选择已公示的产品', 'warn'); return; }
        tab = b.getAttribute('data-ftab');
        render();
      });
    });
  }

  /* ================= P1 渠道布局 ================= */
  function publishedPubs() {
    var ps = st().publications || [];
    return ps.filter(function (p) { return p.status === 'published'; });
  }
  function p1HTML() {
    var list = publishedPubs();
    var html = '<h2 class="step-title">上架销售 · P1 渠道布局</h2>';
    html += '<p class="dim">选择一份已完成公示的产品，确定主销渠道与佣金方案（报行合一）。' + esc(D.CHEN.p1Intro.split('。')[0] + '。') + '</p>';
    if (!list.length) {
      html += '<div class="empty-hint">还没有完成公示的产品。<br>先去「③ 批复公示」完成公示并取得注册号，再来这里上架销售。</div>';
      return html;
    }
    html += '<div class="fcard-grid">';
    list.forEach(function (p) {
      var guard = E.canList(p, st().sales || []);
      var dis = guard.reason === 'listed';
      html += '<div class="fcard ' + (selPubId === p.id ? 'sel' : '') + (dis ? ' dis' : '') + '" data-pid2="' + p.id + '">' +
        '<div class="fcard-top"><span class="f-badge sp-published">✅ 已公示</span>' +
        (dis ? '<span class="f-badge sp-listed">已上市</span>' :
         guard.reason === 'active' ? '<span class="f-badge s-act">销售中</span>' : '') + '</div>' +
        '<div class="fcard-name">' + esc(p.name) + '</div>' +
        '<div class="fcard-meta">' + esc(p.pidName) + ' · ' + esc(FE.routeName(p.route)) + ' · 注册号 ' + esc(p.regNo || '—') + '</div></div>';
    });
    html += '</div>';
    var c = cur();
    if (c && c.status === 'planning') {
      html += channelHTML(c);
    }
    return html;
  }
  function qualCardHTML() {
    var q = D.NET_QUAL, rows = '';
    q.company.forEach(function (r) {
      rows += '<div>· ' + esc(r.k) + '：<b>' + esc(r.v) + '</b>（要求 ' + esc(r.req) + ' <span class="ok-t">✓</span>）</div>';
    });
    return '<div class="sl-qual"><b>📶 互联网渠道资格卡（银保监办发〔2021〕108号）</b>' + rows +
      '<div>· 产品白名单：' + esc(q.whitelist) + '</div>' +
      '<div class="comp-basis">' + esc(q.conclusion) + '</div></div>';
  }
  function channelHTML(c) {
    var html = '<div class="route-box"><h3 class="sub-title">Q1 · 主销渠道 · ' + esc(c.name) + '</h3>' +
      '<p class="dim">' + esc(D.CHEN.qualCard) + '</p>' + qualCardHTML();
    var chs = E.channelQs();
    if (c.channel == null) {
      html += '<div class="opt-list">';
      chs.forEach(function (ch, idx) {
        html += '<label class="opt-item opt-row" data-ch="' + idx + '"><span><b>' + esc(ch.name) + '</b>　' + esc(ch.text) + '</span></label>';
      });
      html += '</div>';
    } else if (c.channelWrong) {
      html += '<div class="comp-row bad"><span class="comp-icon">✗</span><span class="comp-text">原选择：互联网渠道——护理保险不在 108 号文网销白名单（健康险除护理），监管通报 −¥1,000、声望 −1</span></div>' +
        '<div class="comp-row ok"><span class="comp-icon">✓</span><span class="comp-text">已强制改选：个险代理人</span></div>' +
        '<div class="comp-basis">依据：' + esc(D.LAW_NET) + '</div>';
    } else {
      var name = D.CH_NAMES[c.channel] || c.channel;
      html += '<div class="comp-row ok"><span class="comp-icon">✓</span><span class="comp-text">主销渠道：' + esc(name) + '</span></div>';
    }
    if (c.channel) {
      html += '<h3 class="sub-title">Q2 · 佣金方案 · 报行合一</h3>' +
        '<div class="law-box small">' + esc(D.LAW_BXH) + '</div>';
      var plans = E.commissionQs(c.pid);
      if (c.commission == null) {
        html += '<div class="opt-list">';
        plans.forEach(function (pl, idx) {
          html += '<label class="opt-item opt-row" data-plan="' + idx + '"><span><b>' + esc(pl.name) + '</b>　' + esc(pl.text) +
            '<br><span class="dim">' + esc(pl.note) + '</span></span></label>';
        });
        html += '</div>';
      } else {
        var pl0 = null;
        plans.forEach(function (pl) { if (pl.id === c.commission) pl0 = pl; });
        if (c.commissionWrong) {
          html += '<div class="comp-row bad"><span class="comp-icon">✗</span><span class="comp-text">原选择：C 说明制通道——「免报备特殊通道」不存在，−¥1,000、声望 −1</span></div>' +
            '<div class="comp-row ok"><span class="comp-icon">✓</span><span class="comp-text">已强制改选：A · 严格报行</span></div>';
        } else {
          html += '<div class="comp-row ' + (c.commission === 'B' ? 'bad' : 'ok') + '"><span class="comp-icon">' + (c.commission === 'B' ? '⚠' : '✓') + '</span>' +
            '<span class="comp-text">佣金方案：' + esc(pl0 ? pl0.name : c.commission) + '　' + esc(pl0 ? pl0.text : '') + '</span></div>';
          if (c.commission === 'B') html += '<div class="warn-legacy"><b>⚠ 陈砚提醒：账外加佣已埋雷</b>' + esc(D.CHEN.commissionB) + '</div>';
          if (c.commission === 'C') html += '<div class="suggest-box ok-box"><b>说明制通道</b>' + esc(D.CHEN.accidentC) + '</div>';
        }
        html += '<div class="modal-actions"><button id="btn-s1-next" class="btn-main">下一步：物料合规 →</button></div>';
      }
    }
    html += '</div>';
    return html;
  }
  function bindP1(body) {
    Array.prototype.slice.call(body.querySelectorAll('.fcard')).forEach(function (d) {
      d.addEventListener('click', function () {
        var pid2 = d.getAttribute('data-pid2');
        var p = pubById(pid2);
        if (!p) return;
        var guard = E.canList(p, st().sales || []);
        if (!guard.ok) {
          if (guard.reason === 'listed') R.toast('✅ ' + guard.text, 'info');
          else if (guard.reason === 'active') {
            curId = guard.sale.id; selPubId = pid2;
            var s2 = guard.sale.status;
            tab = s2 === 'planning' ? 'p1' : (s2 === 'material' ? 'p2' : 'p3');
            R.toast('该产品销售办理中，已为你打开对应步骤', 'info');
            render();
          }
          return;
        }
        var s = E.buildSale(p);
        st().sales.unshift(s);
        curId = s.id; selPubId = pid2;
        AW.main.save();
        R.toast('销售立项：' + p.name + '（注册号 ' + (p.regNo || '—') + '）', 'ok');
        render();
      });
    });
    Array.prototype.slice.call(body.querySelectorAll('.opt-row[data-ch]')).forEach(function (d) {
      d.addEventListener('click', function () {
        var c = cur();
        if (!c) return;
        var res = E.answerChannel(c, parseInt(d.getAttribute('data-ch'), 10));
        if (res.done || res.invalid) return;
        applyDelta(res);
        if (!res.ok) AW.main.checkMentorSales('channel_wrong', c);
        if (c.channel && c.commission) AW.main.eventUnlock('sale_channel');
        saveHud();
        render();
      });
    });
    Array.prototype.slice.call(body.querySelectorAll('.opt-row[data-plan]')).forEach(function (d) {
      d.addEventListener('click', function () {
        var c = cur();
        if (!c) return;
        var res = E.answerCommission(c, parseInt(d.getAttribute('data-plan'), 10));
        if (res.done || res.invalid) return;
        if (res.ok && res.plan === 'B') AW.main.checkMentorSales('commission_b', c);
        if (res.ok && res.plan === 'C') AW.main.checkMentorSales('commission_c', c);
        applyDelta(res);
        if (c.channel && c.commission) AW.main.eventUnlock('sale_channel');
        saveHud();
        render();
      });
    });
    var next = body.querySelector('#btn-s1-next');
    if (next) next.addEventListener('click', function () {
      var c = cur();
      if (c) { c.status = 'material'; c.log.push({ t: '渠道', text: '渠道布局完成，进入物料合规', date: '2026-09' }); AW.main.save(); }
      tab = 'p2'; render();
    });
  }

  /* ================= P2 物料合规 ================= */
  function p2HTML(c) {
    if (c.status === 'listed' || c.status === 'season') {
      return '<h2 class="step-title">上架销售 · P2 物料合规 <span class="chip">' + esc(c.name) + '</span> ' + badgeHTML(c) + '</h2>' +
        '<div class="route-box"><p>物料合规已完成，产品已开播——请前往「③ 首季经营」' + (c.status === 'listed' ? '（或查看上市结果）' : '') + '。</p>' +
        '<div class="modal-actions"><button id="btn-s2-gop3" class="btn-main">前往 ③ 首季经营 →</button></div></div>';
    }
    if (c.status === 'planning') {
      return '<h2 class="step-title">上架销售 · P2 物料合规 <span class="chip">' + esc(c.name) + '</span> ' + badgeHTML(c) + '</h2>' +
        '<div class="empty-hint">渠道布局尚未完成。<br>先在「① 渠道布局」确定主销渠道与佣金方案。</div>';
    }
    var items = E.materialItems(c.pid, c.channel);
    var dec1 = E.hesDecision(c.channel, c.cfg);
    var dec2 = E.talkDecision(c.pid);
    var rev = E.reviewMaterial(c);
    var html = '<h2 class="step-title">上架销售 · P2 物料合规 <span class="chip">' + esc(c.name) + '</span> ' + badgeHTML(c) + '</h2>';
    /* B1 物料检查单 */
    html += '<h3 class="sub-title">B1 · 销售物料检查单（缺必备项，合规审查不放行开播）</h3><div class="axis-grid">';
    items.forEach(function (d) {
      var on = c.materials.indexOf(d.key) >= 0;
      var na = d.attr === 'na';
      var mark = d.attr === 'req' ? ' <i class="req-mark">必备</i>' :
                 d.attr === 'na' ? ' <i class="na-mark">不适用</i>' : '';
      html += '<label class="axis-item ' + (on ? 'on' : '') + (na ? ' na-item' : '') + '" data-mat="' + d.key + '"' + (na ? ' title="本险种/渠道不适用"' : '') + '>' +
        '<input type="checkbox" ' + (on ? 'checked' : '') + (na ? ' disabled' : '') + '> <span>' + esc(d.name) + mark + '</span></label>';
    });
    html += '</div>';
    if (rev.missing.length) html += '<div class="suggest-box"><b>⚠ 缺必备销售物料</b>' + rev.missing.map(function (m) { return '<div>· ' + esc(m.name) + '</div>'; }).join('') + '<div class="comp-basis">依据：' + esc(D.LAW_SALE) + '</div></div>';
    if (rev.traps.length) html += '<div class="warn-legacy"><b>⚠ 老周提醒：清单里有违规物料</b>' + rev.traps.map(function (m) { return '<div>· 「' + esc(m.name) + '」——' + esc(m.note) + '</div>'; }).join('') + '<div>开播可以放行，但首季经营大概率被消保通报。</div></div>';
    if (rev.noise.length) html += '<div class="dim" style="margin-top:4px">💡 竞品对比表数据可查证，属正常竞争素材——保留依据备查即可。</div>';
    /* B2 文案终审 */
    html += '<h3 class="sub-title">B2·D1 · ' + esc(dec1.theme) + '</h3><div class="opt-list">';
    dec1.options.forEach(function (o) {
      html += '<label class="opt-item opt-row ' + (c.hesChoice === o.id ? 'sel' : '') + '" data-hes="' + o.id + '">' +
        '<input type="radio" name="heschoice" ' + (c.hesChoice === o.id ? 'checked' : '') + '><span>' + esc(o.text) + '</span></label>';
    });
    html += '</div><div class="comp-basis">法规依据：' + esc(dec1.law) + '</div>';
    html += '<h3 class="sub-title">B2·D2 · ' + esc(dec2.theme) + '</h3><div class="opt-list">';
    dec2.options.forEach(function (o) {
      html += '<label class="opt-item opt-row ' + (c.talkChoice === o.id ? 'sel' : '') + '" data-talk="' + o.id + '">' +
        '<input type="radio" name="talkchoice" ' + (c.talkChoice === o.id ? 'checked' : '') + '><span>' + esc(o.text) + '</span></label>';
    });
    html += '</div><div class="comp-basis">法规依据：' + esc(dec2.law) + '</div>';
    html += '<div class="modal-actions f2-nav">' +
      '<button id="btn-s2-back" class="btn-ghost">← 返回渠道布局</button>' +
      '<button id="btn-s2-launch" class="btn-main"' + (c.hesChoice != null && c.talkChoice != null ? '' : ' disabled title="先完成 D1/D2 文案终审决策"') + '>🚀 渠道开播（¥2,000）→ 进入首季经营</button></div>';
    if (c.hesChoice == null || c.talkChoice == null) html += '<div class="dim" style="margin-top:6px">犹豫期告知与销售话术两项文案终审未完成，不能开播。</div>';
    return html;
  }
  function bindP2(body) {
    var c = cur();
    if (!c) return;
    var gop3 = body.querySelector('#btn-s2-gop3');
    if (gop3) gop3.addEventListener('click', function () { tab = 'p3'; render(); });
    Array.prototype.slice.call(body.querySelectorAll('.axis-item[data-mat]')).forEach(function (d) {
      d.addEventListener('click', function (ev) {
        ev.preventDefault();
        if (d.classList.contains('na-item')) { R.toast('本险种/渠道不适用此项', 'info'); return; }
        var key = d.getAttribute('data-mat');
        var idx = c.materials.indexOf(key);
        if (idx >= 0) c.materials.splice(idx, 1);
        else {
          c.materials.push(key);
          var item = null;
          E.materialItems(c.pid, c.channel).forEach(function (it) { if (it.key === key) item = it; });
          if (item && item.attr === 'trap') {
            R.toast('⚠ ' + D.CHEN.trapWarn, 'warn');
            AW.main.checkMentorSales('material_trap', c);
          }
          if (item && item.attr === 'noise') R.toast('💡 竞品对比表数据可查证，属正常竞争素材——保留依据备查即可。', 'info');
        }
        saveHud();
        render();
      });
    });
    Array.prototype.slice.call(body.querySelectorAll('.opt-row[data-hes]')).forEach(function (d) {
      d.addEventListener('click', function (ev) {
        ev.preventDefault();
        c.hesChoice = d.getAttribute('data-hes');
        saveHud();
        render();
      });
    });
    Array.prototype.slice.call(body.querySelectorAll('.opt-row[data-talk]')).forEach(function (d) {
      d.addEventListener('click', function (ev) {
        ev.preventDefault();
        c.talkChoice = d.getAttribute('data-talk');
        saveHud();
        render();
      });
    });
    var back = body.querySelector('#btn-s2-back');
    if (back) back.addEventListener('click', function () { tab = 'p1'; render(); });
    var launch = body.querySelector('#btn-s2-launch');
    if (launch) launch.addEventListener('click', function () { doLaunch(c); });
  }
  function doLaunch(c) {
    var fee = D.FEES.launch.fee;
    /* 防软锁：沿用透支机制 */
    if (st().budget < fee) {
      if ((st().overdraftStreak || 0) >= 1) {
        R.toast('❌ 预算已连续透支，公司不再垫付。回「① 产品设计」通过评审赚取研发拨款后再来。', 'bad');
        return;
      }
      st().overdraftStreak = 1;
      R.toast('💰 预算不足，公司垫付销售启动费', 'warn');
    } else {
      st().overdraftStreak = 0;
    }
    var res = E.launchSale(c);
    if (!res.ok) {
      saveHud();
      if (res.reason === 'missing') {
        AW.main.checkMentorSales('material_refused', c);
        var html = '<h3>✋ 合规审查打回：销售物料不全</h3>' +
          '<div class="speech"><span class="speech-who">🧑‍⚖️ 老周（合规总监）：</span>' + esc(D.ZHOU.reviewReject) + '</div>' +
          res.review.missing.map(function (m) {
            return '<div class="comp-row bad"><span class="comp-icon">✗</span><span class="comp-name">' + esc(m.name) + '</span><span class="comp-text">' + esc(m.note) + '</span></div>';
          }).join('') +
          '<div class="law-box small" style="margin-top:10px">' + esc(D.LAW_SALE) + '</div>' +
          '<div class="modal-actions"><button id="btn-mat-back" class="btn-main">回去补齐 →</button></div>';
        R.showModal(html).querySelector('#btn-mat-back').addEventListener('click', function () { R.closeModal(); });
      } else if (res.reason === 'hes' || res.reason === 'talk') {
        var bad = res.hes && res.hes.reason === 'trap' ? res.hes : res.talk;
        var dec = bad ? bad.decision : null;
        var html2 = '<h3>✋ 合规审查打回：文案终审口径</h3>' +
          '<div class="speech"><span class="speech-who">🧑‍⚖️ 老周（合规总监）：</span>' + esc(D.ZHOU.decisionReject) + '</div>' +
          '<div class="comp-row bad"><span class="comp-icon">✗</span><span class="comp-text">' + esc(bad && bad.text ? bad.text : '文案口径不合规。') + '</span></div>' +
          (dec ? '<div class="comp-basis">依据：' + esc(dec.law) + '</div>' : '') +
          '<div class="modal-actions"><button id="btn-dec-back" class="btn-main">回去重选 →</button></div>';
        R.showModal(html2).querySelector('#btn-dec-back').addEventListener('click', function () { R.closeModal(); });
      } else {
        R.toast('犹豫期告知与销售话术两项终审都须完成才能开播。', 'warn');
      }
      render();
      return;
    }
    applyDelta({ fee: res.fee });
    AW.main.eventUnlock('sale_launch');
    saveHud();
    R.toast('🚀 渠道开播，进入首季经营（' + res.events.length + ' 个首季事件待应对）', 'ok');
    tab = 'p3';
    render();
  }

  /* ================= P3 首季经营 ================= */
  function reportTableHTML(c) {
    var s = E.settle(c);
    return '<table class="sl-report"><tr><th>保费收入</th><td>' + money(s.premium) + '</td></tr>' +
      '<tr><th>佣金支出</th><td>−' + money(s.commissionPaid) + '</td></tr>' +
      '<tr><th>罚没合计</th><td>' + (c.penalties ? '−' + money(c.penalties) : '—') + '</td></tr>' +
      '<tr><th>退保件数</th><td>' + s.surrenders + ' 件</td></tr>' +
      '<tr><th><b>首季净现金流</b></th><td class="' + (s.net >= 0 ? 'sl-netplus' : 'bad-t') + '"><b>' + money(s.net) + '</b></td></tr></table>';
  }
  function listedBoxHTML(c) {
    var evOk = c.events.filter(function (e2) { return e2.ok === true; }).length;
    var evBad = c.events.filter(function (e2) { return e2.ok === false; }).length;
    return '<div class="route-box"><h3 class="sub-title">✅ 上市成功</h3>' +
      '<p>销售档案号 <b>' + esc(c.fileNo || '') + '</b> · ' + esc(D.CH_NAMES[c.channel] || '') + ' · ' + esc(D.PLAN_NAMES[c.commission] || '') +
      ' · 事件应对 ✓' + evOk + ' / ✗' + evBad + ' · 累计费用 ' + money(c.fees) + ' · 沟通 ' + c.days + ' 天</p>' +
      reportTableHTML(c) +
      '<div class="dim" style="margin-top:6px">首季净现金流已计入研发预算。</div>' +
      '<div class="modal-actions"><button id="btn-sl-view" class="btn-main">查看销售档案</button>' +
      '<button id="btn-sl-ledger" class="btn-ghost">销售台账</button></div></div>' +
      gotoClaimsBtnHTML() +
      '<div class="dim">产品上市首季收官——出险勘察与理赔结算是下一阶段的故事。</div>';
  }
  function traceHTML(c) {
    var q = E.traceQ(c.pid);
    var html = '<div class="route-box"><h3 class="sub-title">📊 回溯报告决策 · ' + esc(q.theme) + '</h3>' +
      '<p>' + esc(q.question) + '</p>';
    if (c.trace.ok == null) {
      html += '<div class="opt-list">';
      q.options.forEach(function (o, idx) {
        html += '<label class="opt-item opt-row" data-trace="' + idx + '"><span>' + esc(o.text) + '</span></label>';
      });
      html += '</div><div class="comp-basis">法规依据：' + esc(q.law) + '</div>' +
        '<div class="dim" style="margin-top:6px">附注教学：与定价假设明显偏离须报告；产品停售的，自停售之日起 10 日内报告回溯结果。</div>';
    } else {
      var opt = q.options[c.trace.picked];
      if (c.trace.ok) {
        html += '<div class="comp-row ok"><span class="comp-icon">✓</span><span class="comp-text">' + esc(opt.text) + '</span></div>';
      } else {
        var right = null;
        q.options.forEach(function (o) { if (o.ok) right = o; });
        html += '<div class="comp-row bad"><span class="comp-icon">✗</span><span class="comp-text">你的回溯：' + esc(opt.text) + '</span></div>' +
          '<div class="comp-row ok"><span class="comp-icon">✓</span><span class="comp-text">已更正为：' + esc(right.text) + '</span></div>';
      }
      html += '<div class="comp-basis">依据：' + esc(q.law) + '</div>' +
        '<div class="sign-step"><button id="btn-s3-finalize" class="btn-submit">🏦 上市结算 · 领取销售档案号<br><span class="dim">产品状态 → 已上市 · 声望 +5</span></button></div>';
    }
    html += '</div>';
    return html;
  }
  function p3HTML(c) {
    var title = '<h2 class="step-title">上架销售 · P3 首季经营 <span class="chip">' + esc(c.name) + '</span> ' + badgeHTML(c) + '</h2>';
    if (c.status === 'listed') return title + listedBoxHTML(c);
    if (c.status !== 'season' || !c.events.length) {
      return title + '<div class="empty-hint">渠道尚未开播。<br>先在「② 物料合规」完成物料与文案终审，再渠道开播。</div>';
    }
    var html = title + '<p class="dim">首季事件按发生顺序逐一应对：答对 +2 声望；答错由合规部补救（¥2,000、声望 −1）。全部应对后完成回溯报告与上市结算。</p>';
    c.events.forEach(function (slot, idx) {
      var ev = E.eventById(slot.eid);
      if (!ev) return;
      var state = slot.ok == null ? 'pending' : (slot.ok ? 'ok' : 'bad');
      html += '<div class="event-card ' + state + '">' +
        '<div class="event-head"><span class="event-idx">' + (idx + 1) + '</span><b>' + esc(ev.title) + '</b>' +
        (state === 'pending' ? '<button class="btn-main event-go" data-eid="' + ev.id + '">' + (ev.auto ? '签收通知' : '应对') + ' →</button>' :
         state === 'ok' ? '<span class="f-badge sp-published">✓ 已妥善应对</span>' :
         '<span class="f-badge s-correcting">✗ 已补救</span>') + '</div>' +
        '<div class="event-q">' + esc(ev.question) + '</div>' +
        (slot.picked != null && ev.options[slot.picked] ? '<div class="comp-text">你司回应：' + esc(ev.options[slot.picked].text) + '</div>' : '') +
        '</div>';
    });
    if (E.eventsAllDone(c)) {
      html += traceHTML(c);
    }
    return html;
  }
  function bindP3(body) {
    var c = cur();
    if (!c) return;
    Array.prototype.slice.call(body.querySelectorAll('.event-go')).forEach(function (b) {
      b.addEventListener('click', function () { openEventModal(c, b.getAttribute('data-eid')); });
    });
    Array.prototype.slice.call(body.querySelectorAll('.opt-row[data-trace]')).forEach(function (d) {
      d.addEventListener('click', function () {
        var res = E.answerTrace(c, parseInt(d.getAttribute('data-trace'), 10));
        if (res.done || res.invalid) return;
        applyDelta(res);
        if (res.ok) AW.main.checkMentorSales('trace_ok', c);
        else AW.main.checkMentorSales('trace_bad', c);
        saveHud();
        render();
      });
    });
    var fin = body.querySelector('#btn-s3-finalize');
    if (fin) fin.addEventListener('click', function () { doFinalize(c); });
    var pv = body.querySelector('#btn-sl-view');
    if (pv) pv.addEventListener('click', function () { openListedModal(c); });
    var pl = body.querySelector('#btn-sl-ledger');
    if (pl) pl.addEventListener('click', function () { tab = 'ledger'; render(); });
    bindGotoClaims(body);
  }
  function openEventModal(c, eid) {
    var slot = null;
    c.events.forEach(function (s) { if (s.eid === eid) slot = s; });
    var ev = E.eventById(eid);
    if (!slot || !ev || slot.ok != null) return;
    var html = '<h3>📰 首季事件 · ' + esc(ev.title) + '</h3><p>' + esc(ev.question) + '</p>';
    if (ev.auto) {
      var cost = eid === 'e_inspect'
        ? '自动处理：没收账外金额（首季保费 ×8%）＋罚款 ¥20,000、声望 −2、整改 +5 天。'
        : '自动限期整改：费用 ¥3,000、声望 −2。整改后继续首季经营。';
      html += '<div class="law-box small">' + esc(ev.why) + '</div>' +
        '<div class="suggest-box"><b>处理</b>' + cost + '</div>' +
        '<div class="modal-actions"><button id="btn-ev-auto" class="btn-main">签收整改通知</button></div>';
      var m0 = R.showModal(html);
      m0.querySelector('#btn-ev-auto').addEventListener('click', function () {
        var res = E.answerEvent(c, eid, -1);
        applyDelta(res);
        AW.main.eventUnlock('sale_event');
        saveHud();
        R.closeModal();
        if (eid === 'e_inspect') {
          R.toast('⚠ 报行合一飞行检查：没收账外金额 ' + money(res.confiscated || 0) + '、罚款 ' + money(res.fine || 0) + '（声望 −2）', 'bad');
        } else {
          R.toast('⚠ 消保通报与媒体曝光：限期整改（¥3,000、声望 −2）', 'bad');
        }
        render();
      });
      return;
    }
    html += '<div class="opt-list">';
    ev.options.forEach(function (o, idx) {
      html += '<label class="opt-item opt-row" data-eidx="' + idx + '"><span>' + esc(o.text) + '</span></label>';
    });
    html += '</div>';
    var m = R.showModal(html);
    Array.prototype.slice.call(m.querySelectorAll('.opt-row')).forEach(function (d) {
      d.addEventListener('click', function () {
        var res = E.answerEvent(c, eid, parseInt(d.getAttribute('data-eidx'), 10));
        if (res.done || res.invalid) return;
        applyDelta(res);
        AW.main.eventUnlock('sale_event');
        saveHud();
        if (res.ok) AW.main.checkMentorSales('event_ok', c);
        else AW.main.checkMentorSales('event_bad', c);
        R.closeModal();
        openEventResultModal(c, ev, res);
      });
    });
  }
  function openEventResultModal(c, ev, res) {
    var html = '<h3>' + (res.ok ? '✅ 应对得当 · 客户与监管认可' : '⚠ 应对失当 · 合规部接管补救') + '</h3>' +
      '<div class="comp-row ' + (res.ok ? 'ok' : 'bad') + '"><span class="comp-icon">' + (res.ok ? '✓' : '✗') + '</span>' +
      '<span class="comp-text">你司回应：' + esc(res.option ? res.option.text : '') + '</span></div>' +
      '<div class="speech"><span class="speech-who">🧑‍⚖️ 复盘：</span>' + esc(ev.why) + '</div>' +
      (res.ok ? '<div class="suggest-box ok-box"><b>结果</b>声望 +2。</div>' :
        '<div class="suggest-box"><b>结果</b>合规部补救：¥2,000、声望 −1。</div>') +
      '<div class="modal-actions"><button id="btn-ev-done" class="btn-main">继续首季经营 →</button></div>';
    R.showModal(html).querySelector('#btn-ev-done').addEventListener('click', function () {
      R.closeModal();
      render();
    });
  }
  function doFinalize(c) {
    var d = E.finalize(c);
    applyDelta({ prestige: d.prestige });
    st().budget += d.settle.net; /* 首季净现金流计入研发预算（引擎不碰 HUD，落账在 UI） */
    AW.main.eventUnlock('sale_listed');
    AW.main.checkMentorSales('listed', c);
    saveHud();
    openListedModal(c);
    render();
  }

  /* ================= 销售台账 ================= */
  function ledgerHTML() {
    var ss = st().sales || [];
    var html = '<h2 class="step-title">销售台账</h2>';
    if (!ss.length) {
      html += '<div class="empty-hint">暂无销售记录。<br>在「① 渠道布局」选择已公示的产品开始上架。</div>';
      return html;
    }
    html += '<table class="filing-table ledger"><tr><th>产品名</th><th>险种</th><th>路径</th><th>渠道</th><th>佣金方案</th><th>物料</th><th>事件应对</th><th>首季净现金流</th><th>状态</th><th>累计费用</th><th>天数</th><th>操作</th></tr>';
    ss.forEach(function (s) {
      var evOk = 0, evBad = 0;
      s.events.forEach(function (e2) { if (e2.ok === true) evOk++; else if (e2.ok === false) evBad++; });
      var rev = E.reviewMaterial(s);
      var mat = (s.status === 'planning') ? '—' : (rev.ok ? '备齐' : '缺 ' + rev.missing.length + ' 项');
      var op = '';
      if (s.status === 'listed') op = '<button class="btn-ghost f-op" data-op="archive" data-sid="' + s.id + '">销售档案</button>';
      else op = '<button class="btn-ghost f-op" data-op="resume" data-sid="' + s.id + '">继续办理</button>';
      html += '<tr><td>' + esc(s.name) + (s.status === 'listed' ? ' ✅' : '') + '</td><td>' + esc(s.pidName) + '</td>' +
        '<td>' + esc(FE.routeName(s.route)) + '</td><td>' + esc(s.channel ? D.CH_NAMES[s.channel] : '—') + '</td>' +
        '<td>' + esc(s.commission ? D.PLAN_NAMES[s.commission] : '—') + '</td><td>' + esc(mat) + '</td>' +
        '<td>✓' + evOk + ' / ✗' + evBad + '</td>' +
        '<td>' + (s.status === 'listed' ? money(E.settle(s).net) : '—') + '</td>' +
        '<td>' + badgeHTML(s) + '</td><td>' + money(s.fees) + '</td><td>' + s.days + ' 天</td><td>' + op + '</td></tr>';
    });
    html += '</table><div class="dim" style="margin-top:8px">已上市产品进入持续经营；首季净现金流为演出数值，含罚没合计。产品上市首季收官——出险勘察与理赔结算是下一阶段的故事。</div>' +
      gotoClaimsBtnHTML();
    return html;
  }
  function bindLedger(body) {
    Array.prototype.slice.call(body.querySelectorAll('.f-op')).forEach(function (b) {
      b.addEventListener('click', function () {
        var s = null, ss = st().sales || [], i;
        for (i = 0; i < ss.length; i++) if (ss[i].id === b.getAttribute('data-sid')) s = ss[i];
        if (!s) return;
        if (b.getAttribute('data-op') === 'archive') { openListedModal(s); return; }
        curId = s.id;
        tab = s.status === 'planning' ? 'p1' : (s.status === 'material' ? 'p2' : 'p3');
        render();
      });
    });
    bindGotoClaims(body);
  }

  /* ================= 销售档案 ================= */
  function saleText(c) {
    var dec1 = E.hesDecision(c.channel, c.cfg || {});
    var dec2 = E.talkDecision(c.pid);
    var tq = E.traceQ(c.pid);
    var lines = [
      '《销售档案》',
      '产品名称：' + c.name + '（' + c.pidName + '）',
      '报送路径：' + FE.routeName(c.route) + ' · 回执编号：' + (c.receiptNo || '—') + ' · 注册号：' + (c.regNo || '—'),
      '销售档案号：' + (c.fileNo || '（未完成）'),
      '当前状态：' + E.statusName(c.status),
      '',
      '—— 渠道与佣金（报行合一） ——',
      '主销渠道：' + (c.channel ? D.CH_NAMES[c.channel] : '（未定）') + (c.channelWrong ? '（原选互联网渠道被通报，强制改选）' : ''),
      '佣金方案：' + (c.commission ? D.PLAN_NAMES[c.commission] : '（未定）') + (c.commissionWrong ? '（原选 C 说明制被退回，强制改 A）' : ''),
      '佣金率口径：' + Math.round(E.commissionRate(c) * 100) + '%',
      '',
      '—— 销售物料清单（终版） ——'
    ];
    E.materialItems(c.pid, c.channel).forEach(function (d) {
      var on = c.materials.indexOf(d.key) >= 0;
      lines.push((on ? '☑ ' : '☐ ') + d.name + (d.attr === 'na' ? '（不适用）' : d.attr === 'req' ? '（必备）' : ''));
    });
    var hOpt = optOf(dec1, c.hesChoice), tOpt = optOf(dec2, c.talkChoice);
    lines = lines.concat([
      '',
      '—— 物料文案终审 ——',
      'D1 ' + dec1.theme + '：' + (hOpt ? hOpt.text : '（未选择）'),
      'D2 ' + dec2.theme + '：' + (tOpt ? tOpt.text : '（未选择）')
    ]);
    if (c.events.length) {
      lines.push('');
      lines.push('—— 首季事件应对 ——');
      c.events.forEach(function (s) {
        var ev = E.eventById(s.eid);
        if (!ev) return;
        lines.push('事件：' + ev.title);
        if (s.auto || ev.auto) {
          lines.push('结果：自动整改/检查处置' + (s.eid === 'e_inspect' ? '（没收账外金额＋罚款 ¥20,000）' : '（¥3,000、声望 −2）'));
        } else if (s.picked != null && ev.options[s.picked]) {
          lines.push('回应：' + ev.options[s.picked].text);
          lines.push(s.ok ? '结果：应对得当（声望 +2）' : '结果：应对失当，合规部补救（¥2,000、声望 −1）');
        } else lines.push('结果：（未应对）');
      });
    }
    lines.push('');
    lines.push('—— 回溯报告（' + tq.theme + '） ——');
    var trOpt = c.trace.picked != null ? tq.options[c.trace.picked] : null;
    lines.push(tq.question);
    if (trOpt) {
      lines.push('选择：' + trOpt.text);
      lines.push(c.trace.ok ? '结果：口径正确（声望 +2）' : '结果：口径错误，已按 1275 号便函口径更正（−¥500、声望 −1）');
    } else lines.push('（未作答）');
    var s = E.settle(c);
    lines = lines.concat([
      '',
      '—— 首季经营快报 ——',
      '保费收入：¥' + s.premium.toLocaleString('zh-CN'),
      '佣金支出：¥' + s.commissionPaid.toLocaleString('zh-CN') + (s.confiscated ? '（账外 8pp 部分已被没收）' : ''),
      '罚没合计：¥' + (c.penalties || 0).toLocaleString('zh-CN'),
      '退保件数：' + s.surrenders + ' 件',
      '首季净现金流：¥' + s.net.toLocaleString('zh-CN'),
      '',
      '—— 结果 ——',
      '累计费用：¥' + c.fees.toLocaleString('zh-CN') + ' · 沟通天数：' + c.days + ' 天',
      '',
      '—— 过程日志 ——'
    ]).concat(c.log.map(function (l) { return '[' + l.t + '] ' + l.text; })).concat([
      '',
      '（首季保费、佣金率、退保件数均为教学化演出数值，不对应任何真实产品；销售档案号为虚构格式。《精算工坊》生成）'
    ]);
    return lines.join('\n');
  }
  function openListedModal(c) {
    var html = '<h3>🗂️ 销售档案 · ' + esc(c.name) + '</h3>' +
      '<div style="text-align:center"><div class="stamp stamp-sale">上市成功</div>' +
      '<div class="stamp-caption">销售档案号 <b>' + esc(c.fileNo || '（未完成）') + '</b> · ' + esc(c.name) + '</div></div>' +
      '<div class="memo-head" style="margin-top:10px">' + esc(c.pidName) + ' · ' + esc(FE.routeName(c.route)) + ' · ' + badgeHTML(c) + '</div>' +
      '<pre class="memo-pre">' + esc(saleText(c)) + '</pre>' +
      '<div class="modal-actions"><button id="btn-copy-sale" class="btn-ghost">📋 复制为文本</button></div>' +
      gotoClaimsBtnHTML();          /* GDD-stage5 §17.3：销售完成模态亦含「前往理赔季」入口（hasListed 条件） */
    var m = R.showModal(html, { wide: true });
    m.querySelector('#btn-copy-sale').addEventListener('click', function () {
      AW.main.copyText(saleText(c));
      R.toast('销售档案已复制到剪贴板', 'ok');
    });
    bindGotoClaims(m);
  }

  AW.uiSales = {
    render: render,
    renderP1: function () { tab = 'p1'; render(); },
    renderP2: function () { tab = 'p2'; render(); },
    renderP3: function () { tab = 'p3'; render(); },
    ledgerTab: function () { tab = 'ledger'; render(); },
    openListedModal: function (s) { if (deps()) openListedModal(s); },
    currentId: function () { return curId; }
  };
})();
