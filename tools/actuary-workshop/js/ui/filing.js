/* =====================================================================
 * 精算工坊 · js/ui/filing.js（第二阶段「监管申报」界面，GDD-stage2 §14.1 §14.5）
 * 挂载 AW.uiFiling：render / renderF1 / renderF2 / renderF3 / ledgerTab /
 * openInquiryModal / openReceiptModal / openCorrectionModal / openArchiveModal。
 * 复用 AW.render 的 showModal / toast / .stamp / .comp-row / .chip / .btn-* 体系。
 * ===================================================================== */
(function () {
  'use strict';
  var AW = (typeof window !== 'undefined') ? (window.AW = window.AW || {})
                                           : (globalThis.AW = globalThis.AW || {});
  var R = null;               // 延迟取 AW.render（加载顺序：本文件先于 main.js）
  var D = null, E = null;     // AW.filingData / AW.filingEngine

  var tab = 'f1';             // f1 | f2 | f3 | ledger
  var curId = null;           // 当前编辑的 filing id
  var selArchId = null;       // F1 当前选中的归档
  var selRoute = null;        // F1 路径题选择 'approval' | 'filing'

  function deps() {
    if (!R) R = AW.render;
    D = AW.filingData; E = AW.filingEngine;
    return !!(R && D && E);
  }
  function esc(s) { return R.esc(s); }
  function money(n) { return R.money(n); }
  function st() { return AW.state; }
  function cur() {
    var fs = st().filings || [], i;
    for (i = 0; i < fs.length; i++) if (fs[i].id === curId) return fs[i];
    return null;
  }
  function findArch(id) {
    var i;
    for (i = 0; i < st().archives.length; i++) if (st().archives[i].id === id) return st().archives[i];
    return null;
  }
  function filingForArch(archId) {
    var fs = st().filings || [], i;
    for (i = 0; i < fs.length; i++) if (fs[i].archId === archId) return fs[i];
    return null;
  }
  function applyDelta(d) {
    if (!d) return;
    if (d.fee) st().budget -= d.fee;
    if (d.prestige) st().prestige = Math.max(0, st().prestige + d.prestige);
  }
  function saveHud() { AW.main.save(); R.renderHUD(); }
  function routeText(r) { return E.routeName(r); }
  function badgeHTML(f) {
    return '<span class="f-badge s-' + f.status + '">' + esc(E.statusName(f.status)) + (f.status === 'receipt' ? ' 🔒' : '') + '</span>';
  }
  function optLabel(pid, key, val) {
    var defs = AW.getParams(pid), i, j;
    for (i = 0; i < defs.length; i++) {
      if (defs[i].key !== key || !defs[i].options) continue;
      for (j = 0; j < defs[i].options.length; j++) {
        if (String(defs[i].options[j].v) === String(val)) return defs[i].options[j].l;
      }
    }
    return String(val);
  }

  /* ================= 主视图 ================= */
  function render() {
    if (!deps()) return;
    var root = document.getElementById('filing');
    if (!root) return;
    var c = cur();
    function tabBtn(key, label, disabled) {
      return '<button class="ftab ' + (tab === key ? 'on' : '') + '" data-ftab="' + key + '"' +
        (disabled ? ' disabled title="请先在「① 选件定路」选择产品"' : '') + '>' + label + '</button>';
    }
    root.innerHTML =
      '<div class="ftabs">' +
      tabBtn('f1', '① 选件定路') +
      tabBtn('f2', '② 材料编制', !c) +
      tabBtn('f3', '③ 签字报送', !c) +
      tabBtn('ledger', '🗂️ 申报台账') +
      '</div><div id="filing-body"></div>';
    var body = root.querySelector('#filing-body');
    var html = '', bind = null;
    if (tab === 'f2' && c) { html = f2HTML(c); bind = bindF2; }
    else if (tab === 'f3' && c) { html = f3HTML(c); bind = bindF3; }
    else if (tab === 'ledger') { html = ledgerHTML(); bind = bindLedger; }
    else { html = f1HTML(); bind = bindF1; }
    body.innerHTML = html;
    if (bind) bind(body);
    var tabs = root.querySelectorAll('.ftab');
    Array.prototype.slice.call(tabs).forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) { R.toast('请先在「① 选件定路」选择已归档的产品', 'warn'); return; }
        tab = b.getAttribute('data-ftab');
        render();
      });
    });
  }

  /* ================= F1 选件定路 ================= */
  function f1HTML() {
    var list = st().archives;
    var html = '<h2 class="step-title">监管申报 · F1 选件定路</h2>';
    html += '<p class="dim">选择一份「已归档且未取得回执」的产品，回答报送路径题后进入材料编制。审批与备案的边界见《保险法》第 135 条。</p>';
    if (!list.length) {
      html += '<div class="empty-hint">案头还没有归档产品。<br>先回「① 产品设计」完成评审，通过归档后再来申报。</div>';
      return html;
    }
    html += '<div class="fcard-grid">';
    list.forEach(function (a) {
      var guard = E.canFile(a, st().filings);
      var dis = !guard.ok;
      html += '<div class="fcard ' + (selArchId === a.id ? 'sel' : '') + (dis ? ' dis' : '') + '" data-arch="' + a.id + '">' +
        '<div class="fcard-top"><span class="arch-grade g-' + a.grade + '">' + a.grade + '</span>' +
        (guard.reason === 'receipt' ? '<span class="f-badge s-receipt">🔒 已备案</span>' :
         guard.reason === 'active' ? '<span class="f-badge s-act">申报中</span>' : '') + '</div>' +
        '<div class="fcard-name">' + esc(a.name) + '</div>' +
        '<div class="fcard-meta">' + esc(a.pidName) + ' · 首年保费 ' + money(a.gross) + '</div></div>';
    });
    html += '</div>';
    var arch = selArchId ? findArch(selArchId) : null;
    if (arch) {
      var warns = E.warnsOf(arch);
      html += '<div class="route-box"><h3 class="sub-title">报送路径题：' + esc(arch.name) + '</h3>' +
        '<p>本产品应向监管申请<b>审批</b>还是<b>备案</b>？</p>' +
        '<div class="opt-grid">' +
        '<div class="opt-item ' + (selRoute === 'approval' ? 'sel' : '') + '" data-route="approval"><b>审批</b><span class="dim">事前把关 · 逐字审阅</span></div>' +
        '<div class="opt-item ' + (selRoute === 'filing' ? 'sel' : '') + '" data-route="filing"><b>备案</b><span class="dim">事后检核 · 年度通报</span></div>' +
        '</div>' +
        '<div class="modal-actions"><button id="btn-route-ok" class="btn-main"' + (selRoute ? '' : ' disabled') + '>确认报送路径</button></div></div>';
      if (warns.length) {
        html += '<div class="warn-legacy"><b>⚠ 评审遗留警告项（监管问询大概率围绕这些展开）</b>' +
          warns.map(function (w) { return '<div>· 【' + w + '】' + esc(D.WARN_TEXT[w] || '详见备忘录') + '</div>'; }).join('') + '</div>';
      }
    }
    return html;
  }
  function bindF1(body) {
    Array.prototype.slice.call(body.querySelectorAll('.fcard')).forEach(function (d) {
      d.addEventListener('click', function () {
        var id = d.getAttribute('data-arch');
        var arch = findArch(id);
        var guard = E.canFile(arch, st().filings);
        if (!guard.ok) {
          var f0 = filingForArch(id);
          if (guard.reason === 'receipt') R.toast('🔒 ' + guard.text, 'warn');
          else {
            curId = f0.id; selArchId = id; tab = 'f2';
            R.toast('该产品申报进行中，已为你打开材料编制', 'info');
            render();
          }
          return;
        }
        selArchId = (selArchId === id) ? null : id;
        selRoute = null;
        render();
      });
    });
    Array.prototype.slice.call(body.querySelectorAll('.opt-item')).forEach(function (d) {
      d.addEventListener('click', function () {
        selRoute = d.getAttribute('data-route');
        render();
      });
    });
    var ok = body.querySelector('#btn-route-ok');
    if (ok) ok.addEventListener('click', confirmRoute);
  }
  function confirmRoute() {
    var arch = findArch(selArchId);
    if (!arch || !selRoute) return;
    var f = E.buildFiling(arch);
    var res = E.answerRoute(f, selRoute);
    st().filings.unshift(f);
    curId = f.id;
    applyDelta(res);
    AW.main.eventUnlock('filing_route');
    AW.main.checkMentorFiling('route', f);
    saveHud();
    openRouteModal(f, res);
    tab = 'f2';
    render();
  }
  function openRouteModal(f, res) {
    var html = '<h3>' + (res.ok ? '✅ 报送路径判定' : '⛔ 监管退回：报送方式错误') + '</h3>' +
      '<div class="law-box small" style="margin-bottom:10px">' + esc(D.LAW_135) + '</div>' +
      '<p><b>' + esc(f.name) + '</b>（' + esc(f.pidName) + '，人寿保险险种判定：' + (E.routeOf(f.pid) === 'approval' ? '是 → 审批' : '否 → 备案') + '）</p>';
    if (!res.ok) {
      html += '<div class="suggest-box"><b>退回处理</b>误选「' + routeText(res.correct === 'approval' ? 'filing' : 'approval') +
        '」，沟通成本 <b>−¥' + res.fee.toLocaleString('zh-CN') + '</b>、声望 <b>−1</b>；路径已强制修正为「' + routeText(res.correct) + '」。</div>';
    }
    html += '<div class="speech"><span class="speech-who">🧑‍🦳 陈砚：</span>' + esc(res.ok ? D.CHEN.routeOk[res.correct] : D.CHEN.routeWrong) + '</div>';
    html += '<div class="modal-actions"><button id="btn-route-go" class="btn-main">进入材料编制 →</button></div>';
    var m = R.showModal(html);
    m.querySelector('#btn-route-go').addEventListener('click', function () { R.closeModal(); });
  }

  /* ================= F2 材料编制 ================= */
  function f2HTML(c) {
    var comp = E.completeness(c);
    var dec = E.termDecision(c.pid, c.cfg);
    var html = '<h2 class="step-title">监管申报 · F2 材料编制 <span class="chip">' + esc(c.name) + '</span> ' + badgeHTML(c) + '</h2>';
    html += '<div class="filing-prog"><i style="width:' + comp + '%"></i></div>' +
      '<div class="dim prog-cap">材料完整度 ' + comp + '% ＝ 自动材料 60 ＋ 表述决策 20 ＋ 必选敏感性轴 20</div>';
    if (c.status === 'correcting' && c.errors.length) {
      html += '<div class="suggest-box"><b>📮 监管补正通知（其他材料已保留，修改表述后到 F3 重新报送 · 补正重报费 ¥3,000）</b>' +
        c.errors.map(function (e2) { return '<div>· ' + esc(e2.text) + '</div><div class="comp-basis">依据：' + esc(e2.law) + '</div>'; }).join('') + '</div>';
    }
    /* A 自动生成材料 */
    var covNow = E.axisCoverage(c);
    html += '<h3 class="sub-title">A · 自动生成材料</h3><div class="mat-list">';
    c.materials.forEach(function (m2) {
      var readyNow = m2.key === 'report' ? covNow.missing.length === 0 : m2.ready;
      var icon = m2.na ? 'ℹ' : (readyNow ? '✓' : '…');
      var cls = m2.na ? 'na' : (readyNow ? 'ok' : 'warn');
      html += '<div class="comp-row filing-mat ' + cls + '"><span class="comp-icon">' + icon + '</span>' +
        '<span class="comp-name">' + esc(m2.name) + '</span><span class="comp-text">' + esc(m2.note) + '</span>' +
        '<button class="btn-ghost mat-view" data-mat="' + m2.key + '">查看</button></div>';
    });
    html += '</div>';
    /* B1 条款表述决策 */
    if (dec) {
      html += '<h3 class="sub-title">B1 · 条款表述决策（' + esc(dec.theme) + '）</h3><div class="opt-list">';
      dec.options.forEach(function (o) {
        html += '<label class="opt-item opt-row ' + (c.termChoice === o.id ? 'sel' : '') + '" data-opt="' + o.id + '">' +
          '<input type="radio" name="termchoice" ' + (c.termChoice === o.id ? 'checked' : '') + '>' +
          '<span>' + esc(o.text) + '</span></label>';
      });
      html += '</div><div class="comp-basis">法规依据：' + esc(dec.law) + '</div>';
    }
    /* B2 敏感性分析勾选 */
    var cov = E.axisCoverage(c);
    html += '<h3 class="sub-title">B2 · 精算报告 · 敏感性分析勾选（必选轴缺一，总精算师拒签）</h3><div class="axis-grid">';
    D.SENS_AXES.forEach(function (ax) {
      var label = E.axisLabel(c.pid, ax.key);
      var req = false;
      cov.required.forEach(function (a) { if (a.key === ax.key) req = true; });
      var on = c.axes.indexOf(ax.key) >= 0;
      html += '<label class="axis-item ' + (on ? 'on' : '') + '" data-axis="' + ax.key + '">' +
        '<input type="checkbox" ' + (on ? 'checked' : '') + '> <span>' + esc(label) + '</span>' +
        (req ? ' <i class="req-mark">必选</i>' : '') + '</label>';
    });
    html += '</div>';
    html += '<div class="modal-actions f2-nav">' +
      '<button id="btn-f2-back" class="btn-ghost">← 返回选件</button>' +
      '<button id="btn-f2-next" class="btn-main"' + (c.termChoice != null ? '' : ' disabled title="先完成 B1 条款表述决策"') + '>下一步：签字报送 →</button></div>';
    if (c.termChoice == null) html += '<div class="dim" style="margin-top:6px">表述决策未作选择，不允许进入签字报送。</div>';
    return html;
  }
  function bindF2(body) {
    var c = cur();
    Array.prototype.slice.call(body.querySelectorAll('.mat-view')).forEach(function (b) {
      b.addEventListener('click', function () { openMatModal(c, b.getAttribute('data-mat')); });
    });
    Array.prototype.slice.call(body.querySelectorAll('.opt-row')).forEach(function (d) {
      d.addEventListener('click', function (ev) {
        ev.preventDefault();
        c.termChoice = d.getAttribute('data-opt');
        saveHud();
        render();
      });
    });
    Array.prototype.slice.call(body.querySelectorAll('.axis-item')).forEach(function (d) {
      d.addEventListener('click', function (ev) {
        ev.preventDefault();
        var key = d.getAttribute('data-axis');
        var idx = c.axes.indexOf(key);
        if (idx >= 0) c.axes.splice(idx, 1);
        else {
          c.axes.push(key);
          var cov = E.axisCoverage(c);
          c.extraAxes = cov.extra.slice();
          if (cov.extra.indexOf(key) >= 0) {
            R.toast('💡 ' + D.CHEN.extraAxis, 'info');
            AW.main.checkMentorFiling('axes_extra', c);
          }
        }
        saveHud();
        render();
      });
    });
    var back = body.querySelector('#btn-f2-back');
    if (back) back.addEventListener('click', function () { tab = 'f1'; render(); });
    var next = body.querySelector('#btn-f2-next');
    if (next) next.addEventListener('click', function () {
      if (c.termChoice == null) { R.toast('先完成 B1 条款表述决策', 'warn'); return; }
      tab = 'f3'; render();
    });
  }

  /* ---- 材料预览模态 ---- */
  function openMatModal(c, key) {
    var html = '', title = '';
    if (key === 'form') {
      title = (c.route === 'approval' ? '产品审批申请表' : '产品备案表') + '（预览）';
      var arch = findArch(c.archId);
      html = '<table class="memo-table"><tr><td>产品名称</td><td>' + esc(c.name) + '</td></tr>' +
        '<tr><td>险种类别</td><td>' + esc(c.pidName) + '</td></tr>' +
        '<tr><td>评审结论</td><td>' + c.grade + ' 级 · 通过·准予报送备案</td></tr>' +
        '<tr><td>首年保费</td><td>' + money(c.gross) + '</td></tr>' +
        (arch && arch.paramRows ? arch.paramRows.map(function (r0) { return '<tr><td>' + esc(r0[0]) + '</td><td>' + esc(r0[1]) + '</td></tr>'; }).join('') : '') +
        '</table><div class="comp-basis">名称合规复用评审 R9 结论（条款费率管理办法＋7 号文）。</div>';
    } else if (key === 'clause') {
      title = '保险条款（草案）预览';
      html = '<div class="law-box small"><b>法定三条免责（正文加粗提示）</b>' +
        AW.lawExclusions.map(function (l) { return '<div>· ' + esc(l) + '</div>'; }).join('') + '</div>' +
        '<div class="mat-kv"><div>犹豫期：' + esc(optLabel(c.pid, 'hesitation', c.cfg.hesitation)) + '（一年期以上产品，银保/互联网渠道口径 15 日）</div>' +
        '<div>等待期：' + esc(c.cfg.wait) + ' 天' + (c.pid === 'medical' || c.pid === 'ci' || c.pid === 'ltc' ? '（健康险上限 180 天）' : '') + '</div>' +
        '<div>免责范围：' + esc(optLabel(c.pid, 'exclusion', c.cfg.exclusion)) + '</div>' +
        (c.pid === 'medical' ? '<div>续保表述：' + esc(optLabel(c.pid, 'renew', c.cfg.renew)) + '</div>' : '') +
        '</div><div class="comp-basis">依据：《保险法》第17条（免责提示与明确说明）、《保险销售行为管理办法》（犹豫期）。</div>';
    } else if (key === 'rate') {
      title = '费率表（20/30/40/50/60 岁五档）';
      var isLong = AW.getProduct(c.pid).type === 'long';
      var rows = '';
      [20, 30, 40, 50, 60].forEach(function (age) {
        var cfg2 = {}, k;
        for (k in c.cfg) cfg2[k] = c.cfg[k];
        cfg2.age = age;
        var r0 = AW.pricing.price(c.pid, cfg2);
        var cell = isLong
          ? (r0.perThousand > 0 ? R.money2(r0.perThousand) + ' <span class="dim">/千元保额</span>' : money(r0.gross) + ' <span class="dim">/年</span>')
          : money(r0.gross) + ' <span class="dim">/年</span>';
        rows += '<tr' + (age === c.cfg.age ? ' class="on"' : '') + '><td>' + age + ' 岁' + (age === c.cfg.age ? '（定价年龄）' : '') + '</td><td>' + cell + '</td></tr>';
      });
      html = '<table class="filing-table"><tr><th>投保年龄</th><th>' + (isLong ? '每千元保额费率' : '年保费') + '</th></tr>' + rows + '</table>' +
        '<div class="comp-basis">' + (AW.getProduct(c.pid).type === 'long' ? '年金/长护以年领/月给付为口径，展示年缴保费。' : '短期险按年龄档展示年保费。') + '费率实时取自定价引擎。</div>';
    } else if (key === 'cv') {
      title = '现金价值表＋计算方法';
      if (AW.getProduct(c.pid).type !== 'long') {
        html = '<div class="empty-hint">一年期产品无现金价值表。</div><div class="comp-basis">现金价值源于均衡保费下的责任准备金积累，一年期产品不存在跨期储蓄。</div>';
      } else {
        var r1 = AW.pricing.price(c.pid, c.cfg);
        html = '<table class="filing-table"><tr><th>年度末</th><th>现金价值</th><th>占已缴保费</th></tr>' +
          '<tr><td>t=1</td><td>' + money(r1.cv ? r1.cv.cv1 : 0) + '</td><td>' + (r1.cv ? R.pct(r1.cv.cv1Ratio, 0) : '—') + '</td></tr>' +
          '<tr><td>t=5</td><td>' + (r1.cv && r1.cv.cv5 != null ? money(r1.cv.cv5) : '—') + '</td><td>' + (r1.cv && r1.cv.cv5Ratio != null ? R.pct(r1.cv.cv5Ratio, 0) : '—') + '</td></tr></table>' +
          '<div class="comp-basis">计算方法：CV_t ＝ 责任准备金_t ×（1−退保扣费_t），首年扣费 100%（教学口径）；报送须附全表及计算说明。</div>';
      }
    } else if (key === 'paidup') {
      title = '减额交清功能说明';
      html = '<p>投保人停止缴费时，可以合同当时的现金价值扣除欠缴保费后，作为一次交清的全部保费，相应减少保险金额，合同继续有效。减额交清保额表随本说明一并报送。</p>' +
        '<div class="comp-basis">长期储蓄型产品（终身寿/两全/年金）备案材料常规附件。</div>';
    } else if (key === 'report') {
      var cov = E.axisCoverage(c);
      title = '精算报告（定价假设＋利润测试＋敏感性分析）';
      var rp = AW.pricing.price(c.pid, c.cfg);
      html = '<div class="mat-kv">' +
        '<div>定价假设：预定利率 ' + esc(c.cfg.rate) + '% · 首年费用 ' + esc(c.cfg.expFirst) + '% · 风险边际 ' + esc(c.cfg.margin) + '%</div>' +
        '<div>首年保费 ' + money(rp.gross) + ' · 定价赔付率 ' + R.pct(rp.lr, 1) + ' · 实现赔付率 ' + R.pct(rp.lrReal != null ? rp.lrReal : rp.lr, 1) + '</div>' +
        '<div>已勾敏感性轴：' + (c.axes.length ? c.axes.map(function (k) { return esc(E.axisLabel(c.pid, k)); }).join('、') : '（无）') + '</div>' +
        '<div>必选轴：' + cov.required.map(function (a) { return esc(a.label); }).join('、') + '</div>' +
        '<div class="' + (cov.missing.length ? 'bad-t' : 'ok-t') + '">' + (cov.missing.length ? '缺：' + cov.missing.map(function (a) { return esc(a.label); }).join('、') : '必选轴已齐备 ✓') + '</div></div>' +
        '<div class="comp-basis">利润测试须含定价假设、边际论证与敏感性分析——缺必选轴，总精算师将拒签精算声明。</div>';
    } else {
      return;
    }
    R.showModal('<h3>📄 ' + esc(title) + '</h3>' + html +
      '<div class="modal-actions"><button class="btn-ghost" id="btn-mat-close">关闭</button></div>')
      .querySelector('#btn-mat-close').addEventListener('click', function () { R.closeModal(); });
  }

  /* ================= F3 签字报送 ================= */
  function f3HTML(c) {
    var html = '<h2 class="step-title">监管申报 · F3 签字报送 <span class="chip">' + esc(c.name) + '</span> ' + badgeHTML(c) + '</h2>';
    if (c.status === 'receipt') {
      html += '<div class="route-box"><h3 class="sub-title">✅ 申报完成</h3>' +
        '<p>' + routeText(c.route) + '回执：<b>' + esc(c.receiptNo || '') + '</b> · 累计费用 ' + money(c.fees) + ' · 监管沟通 ' + c.days + ' 天</p>' +
        '<div class="modal-actions"><button id="btn-view-receipt" class="btn-main">查看回执</button>' +
        '<button id="btn-f3-archive" class="btn-ghost">查看申报档案</button></div></div>' +
        '<div class="dim">🔒 已备案条款费率不得擅自修改——修改须重新申报。</div>';
      return html;
    }
    if (c.status === 'inquiry') {
      html += '<div class="route-box"><h3 class="sub-title">📮 监管问询函待答复</h3><p>监管已就本产品发出问询函，请及时答复。</p>' +
        '<div class="modal-actions"><button id="btn-f3-inquiry" class="btn-main">打开问询函</button></div></div>';
      return html;
    }
    var cov = E.axisCoverage(c);
    html += '<h3 class="sub-title">内部审查 · 签字责任人制度</h3>';
    /* 轴覆盖清单 */
    html += '<div class="mat-list"><div class="comp-row ' + (cov.missing.length ? 'bad' : 'ok') + '">' +
      '<span class="comp-icon">' + (cov.missing.length ? '✗' : '✓') + '</span><span class="comp-name">必选敏感性轴</span>' +
      '<span class="comp-text">' + (cov.missing.length ? '缺：' + cov.missing.map(function (a) { return esc(a.label); }).join('、') : '已齐备') + '</span></div>' +
      (cov.extra.length ? '<div class="comp-row na"><span class="comp-icon">i</span><span class="comp-name">额外勾选</span><span class="comp-text">与本品风险无关，徒增篇幅</span></div>' : '') +
      '</div>';
    /* 1 陈砚精算声明 */
    html += '<div class="sign-step">';
    if (!c.signedActuary) {
      html += '<p><b>① 总精算师 · 精算声明</b>　<span class="dim">审「必选轴是否齐全 + 评审遗留警告是否有说明」</span></p>' +
        '<button id="btn-sign-actuary" class="btn-main">请陈砚审签精算声明</button>';
    } else {
      html += '<div class="stamp stamp-sign">陈砚 · 总精算师 · 精算声明 ✓</div>';
    }
    html += '</div>';
    /* 2 老周法律声明 */
    html += '<div class="sign-step">' + (c.signedLegal ?
      '<p><b>② 法律责任人 · 法律声明</b>　<span class="dim">' + esc(zhouLine(c.pid)) + '</span></p>' :
      '<p><b>② 法律责任人 · 法律声明</b>　<span class="dim">待总精算师签批后自动签</span></p>') + '</div>';
    /* 3 报送 */
    var fee = c.status === 'correcting' ? D.FEES.correction.fee : (c.route === 'approval' ? D.FEES.submitApproval.fee : D.FEES.submitFiling.fee);
    html += '<div class="sign-step"><p><b>③ 报送监管</b>　<span class="dim">' + routeText(c.route) + '路径 · 本次费用 ' + money(fee) +
      (c.status === 'correcting' ? '（补正重报）' : '') + '</span></p>' +
      '<button id="btn-submit-filing" class="btn-submit"' + (c.signedActuary && c.signedLegal ? '' : ' disabled') + '>📤 报送' + routeText(c.route) + '<br><span class="dim">' +
      (c.route === 'approval' ? '监管沟通约 15 天' : '监管沟通约 3 天') + ' · 审批必经问询，备案视警告与抽查</span></button></div>';
    if (!c.signedActuary) html += '<div class="dim">先取得总精算师精算声明与法律责任人法律声明，方可报送。</div>';
    return html;
  }
  function bindF3(body) {
    var c = cur();
    var sign = body.querySelector('#btn-sign-actuary');
    if (sign) sign.addEventListener('click', function () {
      var res = E.signActuary(c);
      saveHud();
      if (!res.ok) {
        AW.main.checkMentorFiling('sign_refused', c);
        var html = '<h3>✋ 总精算师拒签</h3><p class="dim">内部治理先于监管——签字责任人制度意味着：过不了陈砚这一关，就到不了监管那一关。</p>' +
          res.reasons.map(function (r0) { return '<div class="comp-row bad"><span class="comp-icon">✗</span><span class="comp-text">' + esc(r0.text) + '</span></div>'; }).join('') +
          '<div class="speech"><span class="speech-who">🧑‍🦳 陈砚：</span>' + esc(D.CHEN.signRefuse) + '</div>' +
          '<div class="modal-actions"><button id="btn-sign-back" class="btn-main">回到 F2 补材料</button></div>';
        R.showModal(html).querySelector('#btn-sign-back').addEventListener('click', function () {
          R.closeModal(); tab = 'f2'; render();
        });
        render();
        return;
      }
      c.signedActuary = true;
      c.signedLegal = true;
      AW.main.checkMentorFiling('sign_ok', c);
      saveHud();
      var html2 = '<h3>✍️ 内部审查签章</h3>' +
        '<div style="text-align:center"><div class="stamp stamp-sign">陈砚 · 总精算师 · 精算声明 ✓</div></div>' +
        '<div class="speech"><span class="speech-who">🧑‍🦳 陈砚：</span>' + esc(D.CHEN.signPass) + '</div>' +
        '<div class="speech"><span class="speech-who">🧑‍⚖️ 老周（法律责任人）：</span>' + esc(zhouLine(c.pid)) + '</div>' +
        '<div class="modal-actions"><button id="btn-sign-done" class="btn-main">去报送 →</button></div>';
      R.showModal(html2).querySelector('#btn-sign-done').addEventListener('click', function () {
        R.closeModal(); render();
      });
      render();
    });
    var inq = body.querySelector('#btn-f3-inquiry');
    if (inq) inq.addEventListener('click', function () { openInquiryModal(c); });
    var vr = body.querySelector('#btn-view-receipt');
    if (vr) vr.addEventListener('click', function () { openReceiptModal(c); });
    var fa = body.querySelector('#btn-f3-archive');
    if (fa) fa.addEventListener('click', function () { openArchiveModal(c); });
    var sub = body.querySelector('#btn-submit-filing');
    if (sub) sub.addEventListener('click', function () { doSubmit(c); });
  }
  function zhouLine(pid) {
    return D.ZHOU_SIGNOFF[pid] || D.ZHOU_SIGNOFF_FALLBACK;
  }
  function doSubmit(c) {
    var fee = c.status === 'correcting' ? D.FEES.correction.fee : (c.route === 'approval' ? D.FEES.submitApproval.fee : D.FEES.submitFiling.fee);
    /* 防软锁：预算不足允许透支一次，连续第二次需回阶段一赚拨款 */
    if (st().budget < fee) {
      if ((st().overdraftStreak || 0) >= 1) {
        R.toast('❌ 预算已连续透支，公司不再垫付。回「① 产品设计」通过评审赚取研发拨款后再来报送。', 'bad');
        return;
      }
      st().overdraftStreak = 1;
      R.toast('💰 预算不足，公司垫付报送费（评审通过回款后偿还）', 'warn');
    } else {
      st().overdraftStreak = 0;
    }
    var res = E.submitFiling(c);
    applyDelta(res);
    saveHud();
    if (res.outcome === 'reject') {
      AW.main.eventUnlock('filing_reject');
      AW.main.checkMentorFiling('hard_error', c);
      openCorrectionModal(c, res);
      render();
      return;
    }
    if (res.outcome === 'inquiry') {
      AW.main.eventUnlock('filing_inquiry');
      AW.main.checkMentorFiling('inquiry', c);
      openInquiryModal(c);
      render();
      return;
    }
    if (res.outcome === 'receipt') doReceipt(c);
  }
  function doReceipt(c) {
    var d = E.applyReceipt(c);
    applyDelta({ prestige: d.prestige });
    AW.main.eventUnlock('filing_receipt');
    AW.main.checkMentorFiling('receipt', c);
    saveHud();
    openReceiptModal(c);
    render();
  }
  function openCorrectionModal(c, res) {
    var html = '<h3>📮 监管补正通知</h3><p class="dim">以下条款表述与监管口径不符，须补正后重新报送（其他材料保留）。</p>' +
      res.errors.map(function (e2) {
        return '<div class="comp-row bad"><span class="comp-icon">✗</span><span class="comp-text">' + esc(e2.text) + '</span></div>' +
          '<div class="comp-basis">依据：' + esc(e2.law) + '</div>';
      }).join('') +
      '<div class="suggest-box"><b>处理</b>声望 −1；回到 F2 修改表述后重新报送（补正重报费 ¥3,000、监管沟通 +5 天）。</div>' +
      '<div class="modal-actions"><button id="btn-corr-fix" class="btn-main">回到 F2 修改表述 →</button></div>';
    R.showModal(html).querySelector('#btn-corr-fix').addEventListener('click', function () {
      R.closeModal(); tab = 'f2'; render();
    });
  }
  function openInquiryModal(c) {
    if (!c.inquiry) return;
    var q = E.inquiryById(c.inquiry.qid);
    if (!q) return;
    if (c.inquiry.answeredOk != null) { openInquiryResultModal(c, q, c.inquiry.answeredOk); return; }
    var html = '<h3>📮 监管问询函 · ' + esc(q.title) + '</h3>' +
      '<p>' + esc(q.question) + '</p><div class="opt-list">';
    q.options.forEach(function (o, idx) {
      html += '<label class="opt-item opt-row" data-iidx="' + idx + '"><span>' + esc(o.text) + '</span></label>';
    });
    html += '</div><div class="comp-basis">答对声望 +2；答复不充分将被要求书面补充说明（¥2,000、声望 −1），仍可取得回执。</div>';
    var m = R.showModal(html);
    Array.prototype.slice.call(m.querySelectorAll('.opt-row')).forEach(function (d) {
      d.addEventListener('click', function () {
        var r0 = E.answerInquiry(c, parseInt(d.getAttribute('data-iidx'), 10));
        if (r0.done || r0.invalid) return;
        applyDelta(r0);
        saveHud();
        if (r0.ok) AW.main.checkMentorFiling('inquiry_ok', c);
        openInquiryResultModal(c, q, r0.ok, r0);
      });
    });
  }
  function openInquiryResultModal(c, q, ok, r0) {
    var picked = q.options[c.inquiry.picked];
    var html = '<h3>' + (ok ? '✅ 问询答复获采纳' : '📄 答复不充分 · 书面补充说明') + '</h3>' +
      '<div class="comp-row ' + (ok ? 'ok' : 'warn') + '"><span class="comp-icon">' + (ok ? '✓' : '⚠') + '</span>' +
      '<span class="comp-text">你司答复：' + esc(picked ? picked.text : '') + '</span></div>' +
      '<div class="speech"><span class="speech-who">⚖️ 监管反馈：</span>' + esc(q.why) + '</div>';
    if (ok) html += '<div class="suggest-box ok-box"><b>结果</b>声望 +2，问询了结。</div>';
    else html += '<div class="suggest-box"><b>结果</b>监管要求书面补充说明（已自动附补充承诺）：费用 ¥2,000、声望 −1；补充后仍可取得回执。</div>';
    html += '<div class="modal-actions"><button id="btn-inq-receipt" class="btn-main">' + (ok ? '领取备案回执 →' : '凭补充说明领取回执 →') + '</button></div>';
    R.showModal(html).querySelector('#btn-inq-receipt').addEventListener('click', function () {
      R.closeModal();
      doReceipt(cur() || c);
    });
  }
  function openReceiptModal(c) {
    var html = '<h3>🏅 ' + routeText(c.route) + '回执' + (c.route === 'approval' ? ' / 批复文件' : '') + '</h3>' +
      '<div style="text-align:center"><div class="stamp stamp-pass">备案回执</div>' +
      '<div class="stamp-caption">回执编号 <b>' + esc(c.receiptNo || '') + '</b> · ' + esc(c.name) + '</div></div>' +
      '<div class="law-box small" style="margin-top:12px">📖 教学尾注：已备案条款费率不得擅自修改——任何调整均须重新履行申报程序。使用未备案条款费率是历年监管处罚的高频事由。</div>' +
      '<div class="modal-actions"><button id="btn-rec-next3" class="btn-main">🏛️ 前往批复公示 →</button>' +
      '<button id="btn-rec-ledger" class="btn-ghost">查看申报台账</button><button id="btn-rec-close" class="btn-ghost">关闭</button></div>';
    var m = R.showModal(html);
    m.querySelector('#btn-rec-next3').addEventListener('click', function () { R.closeModal(); AW.main.gotoStage(3); });
    m.querySelector('#btn-rec-ledger').addEventListener('click', function () { R.closeModal(); tab = 'ledger'; render(); });
    m.querySelector('#btn-rec-close').addEventListener('click', function () { R.closeModal(); });
  }

  /* ================= 申报台账 ================= */
  function ledgerHTML() {
    var fs = st().filings || [];
    var html = '<h2 class="step-title">申报台账</h2>';
    if (!fs.length) {
      html += '<div class="empty-hint">暂无申报记录。<br>在「① 选件定路」选择已归档的产品开始申报。</div>';
      return html;
    }
    html += '<table class="filing-table ledger"><tr><th>产品名</th><th>险种</th><th>路径</th><th>状态</th><th>累计费用</th><th>沟通天数</th><th>操作</th></tr>';
    fs.forEach(function (f) {
      var op = '';
      if (f.status === 'receipt') op = '<button class="btn-ghost f-op" data-op="archive" data-fid="' + f.id + '">申报档案</button>' +
        '<button class="btn-ghost f-op" data-op="pub" data-fid="' + f.id + '">批复公示 →</button>';
      else if (f.status === 'inquiry') op = '<button class="btn-ghost f-op" data-op="inquiry" data-fid="' + f.id + '">答复问询</button>';
      else if (f.status === 'draft' || f.status === 'correcting') op = '<button class="btn-ghost f-op" data-op="edit" data-fid="' + f.id + '">继续编制</button>';
      else op = '<span class="dim">监管审阅中</span>';
      html += '<tr><td>' + esc(f.name) + (f.status === 'receipt' ? ' 🔒' : '') + '</td><td>' + esc(f.pidName) + '</td>' +
        '<td>' + routeText(f.route) + (f.routeFixed ? ' <span class="dim">(曾答错)</span>' : '') + '</td>' +
        '<td>' + badgeHTML(f) + '</td><td>' + money(f.fees) + '</td><td>' + f.days + ' 天</td><td>' + op + '</td></tr>';
    });
    html += '</table><div class="dim" style="margin-top:8px">已备案产品锁定：条款费率不得擅自修改，修改须重新申报。</div>';
    return html;
  }
  function bindLedger(body) {
    Array.prototype.slice.call(body.querySelectorAll('.f-op')).forEach(function (b) {
      b.addEventListener('click', function () {
        var f = null, fs = st().filings, i;
        for (i = 0; i < fs.length; i++) if (fs[i].id === b.getAttribute('data-fid')) f = fs[i];
        if (!f) return;
        var op = b.getAttribute('data-op');
        if (op === 'edit') { curId = f.id; tab = 'f2'; render(); return; }
        if (op === 'inquiry') { curId = f.id; openInquiryModal(f); return; }
        if (op === 'archive') { openArchiveModal(f); return; }
        if (op === 'pub') { AW.main.gotoStage(3); return; }
      });
    });
  }

  /* ================= 申报档案（回执后可点开） ================= */
  function filingText(c) {
    var dec = E.termDecision(c.pid, c.cfg);
    var lines = [
      '《监管申报档案》',
      '产品名称：' + c.name + '（' + c.pidName + '）',
      '报送路径：' + routeText(c.route) + (c.routeFixed ? '（曾答错，被监管退回后修正）' : ''),
      '路径判定依据：' + D.LAW_135,
      '',
      '—— 报送材料 ——'
    ].concat(c.materials.map(function (m2) {
      return (m2.na ? '○ ' : (m2.ready ? '✓ ' : '… ')) + m2.name + (m2.na ? '（不适用：' + m2.note + '）' : '');
    })).concat([
      '',
      '—— 条款表述决策 ——',
      dec ? dec.question : ''
    ]);
    if (dec) {
      dec.options.forEach(function (o) {
        if (o.id === c.termChoice) lines.push('√ ' + o.text);
      });
    }
    lines = lines.concat([
      '',
      '—— 敏感性分析勾选 ——',
      c.axes.length ? c.axes.map(function (k) { return E.axisLabel(c.pid, k); }).join('；') : '（无）',
      ''
    ]);
    if (c.inquiry) {
      var q = E.inquiryById(c.inquiry.qid);
      lines.push('—— 问询与答复 ——');
      if (q) {
        lines.push('问询：' + q.title + '——' + q.question);
        if (c.inquiry.picked != null && q.options[c.inquiry.picked]) {
          lines.push('答复：' + q.options[c.inquiry.picked].text);
          lines.push(c.inquiry.answeredOk ? '结果：答复获监管采纳（声望 +2）' : '结果：答复不充分，提交书面补充说明（¥2,000、声望 −1）');
        }
      }
      lines.push('');
    }
    lines = lines.concat([
      '—— 结果 ——',
      c.status === 'receipt' ? '回执编号：' + c.receiptNo : '当前状态：' + E.statusName(c.status),
      '累计费用：¥' + c.fees.toLocaleString('zh-CN') + ' · 监管沟通天数：' + c.days + ' 天',
      '',
      '—— 过程日志 ——'
    ]).concat(c.log.map(function (l) { return '[' + l.t + '] ' + l.text; })).concat([
      '',
      '（已备案条款费率不得擅自修改——修改须重新申报。《精算工坊》生成 · 监管沟通天数为演出数值）'
    ]);
    return lines.join('\n');
  }
  function openArchiveModal(c) {
    var html = '<h3>🗂️ 申报档案 · ' + esc(c.name) + '</h3>' +
      '<div class="memo-head">' + esc(c.pidName) + ' · ' + routeText(c.route) + ' · ' + badgeHTML(c) +
      (c.receiptNo ? ' · 回执编号 <b>' + esc(c.receiptNo) + '</b>' : '') + '</div>' +
      '<pre class="memo-pre">' + esc(filingText(c)) + '</pre>' +
      '<div class="modal-actions"><button id="btn-copy-filing" class="btn-ghost">📋 复制为文本</button></div>';
    var m = R.showModal(html, { wide: true });
    m.querySelector('#btn-copy-filing').addEventListener('click', function () {
      AW.main.copyText(filingText(c));
      R.toast('申报档案已复制到剪贴板', 'ok');
    });
  }

  AW.uiFiling = {
    render: render,
    renderF1: function () { tab = 'f1'; render(); },
    renderF2: function () { tab = 'f2'; render(); },
    renderF3: function () { tab = 'f3'; render(); },
    ledgerTab: function () { tab = 'ledger'; render(); },
    openInquiryModal: function (f) { if (deps()) openInquiryModal(f); },
    openReceiptModal: function (f) { if (deps()) openReceiptModal(f); },
    openCorrectionModal: function (f, res) { if (deps()) openCorrectionModal(f, res); },
    openArchiveModal: function (f) { if (deps()) openArchiveModal(f); },
    openRouteModal: function (f, res) { if (deps()) openRouteModal(f, res); },
    currentId: function () { return curId; }
  };
})();
