/* =====================================================================
 * 精算工坊 · js/ui/render.js
 * 界面渲染：HUD / 六阶段 / 向导三步 / 精算仪表盘 / 雷达图 / 弹窗 /
 * 评审演出 / 知识图鉴 / 案头档案 / 导师条 / toast。（GDD §1-3 §8 §9 §11）
 * ===================================================================== */
(function () {
  'use strict';
  var AW = (typeof window !== 'undefined') ? (window.AW = window.AW || {})
                                           : (globalThis.AW = globalThis.AW || {});
  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(n) { return n == null ? '—' : '¥' + Math.round(n).toLocaleString('zh-CN'); }
  function money2(n) { return n == null ? '—' : '¥' + (Math.round(n * 100) / 100).toLocaleString('zh-CN', { minimumFractionDigits: n < 100 ? 1 : 0 }); }
  function pct(n, d) { return (n * 100).toFixed(d == null ? 1 : d) + '%'; }

  /* ================= 数字滚动 ================= */
  var tweens = {};
  function tween(key, el, to, fmtFn) {
    if (!el) return;
    var from = tweens[key] != null ? tweens[key] : (to || 0);
    if (from === to) { el.textContent = fmtFn(to); return; }
    var t0 = performance.now(), dur = 300;
    if (tweens[key + '_raf']) cancelAnimationFrame(tweens[key + '_raf']);
    function step(t) {
      var k = Math.min(1, (t - t0) / dur);
      var val = from + (to - from) * (1 - Math.pow(1 - k, 2));
      el.textContent = fmtFn(val);
      if (k < 1) tweens[key + '_raf'] = requestAnimationFrame(step);
      else tweens[key] = to;
    }
    tweens[key + '_raf'] = requestAnimationFrame(step);
    tweens[key] = to;
  }

  /* ================= toast ================= */
  function toast(msg, type) {
    var root = $('#toast-root');
    var el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.innerHTML = msg;
    root.appendChild(el);
    setTimeout(function () { el.classList.add('show'); }, 20);
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
    }, 3600);
  }

  /* ================= 模态 ================= */
  function showModal(html, opts) {
    var root = $('#modal-root');
    root.innerHTML = '<div class="modal-mask"><div class="modal ' + ((opts && opts.wide) ? 'modal-wide' : '') + '">' +
      '<button class="modal-close" title="关闭">✕</button>' + html + '</div></div>';
    root.querySelector('.modal-mask').addEventListener('click', function (e) {
      if (e.target === this) closeModal();
    });
    root.querySelector('.modal-close').addEventListener('click', closeModal);
    return root.querySelector('.modal');
  }
  function closeModal() { $('#modal-root').innerHTML = ''; }

  /* ================= SVG 组件 ================= */
  function radarSVG(axes, size, color) {
    size = size || 220;
    var cx = size / 2, cy = size / 2 + 6, R = size / 2 - 34, n = axes.length;
    function pt(i, r) {
      var ang = -Math.PI / 2 + i * 2 * Math.PI / n;
      return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
    }
    var s = '<svg class="radar" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">';
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      var pts = [];
      for (var i = 0; i < n; i++) { var p = pt(i, R * f); pts.push(p[0].toFixed(1) + ',' + p[1].toFixed(1)); }
      s += '<polygon points="' + pts.join(' ') + '" class="radar-grid"/>';
    });
    for (var i = 0; i < n; i++) {
      var p2 = pt(i, R);
      s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p2[0].toFixed(1) + '" y2="' + p2[1].toFixed(1) + '" class="radar-grid"/>';
    }
    var vp = [];
    for (i = 0; i < n; i++) { var pv = pt(i, R * Math.max(0, Math.min(100, axes[i].val)) / 100); vp.push(pv[0].toFixed(1) + ',' + pv[1].toFixed(1)); }
    s += '<polygon points="' + vp.join(' ') + '" class="radar-val" style="fill:' + (color || '#f0a832') + '33" stroke="' + (color || '#f0a832') + '"/>';
    for (i = 0; i < n; i++) {
      var lp = pt(i, R + 17);
      var anchor = lp[0] > cx + 4 ? 'start' : lp[0] < cx - 4 ? 'end' : 'middle';
      s += '<text x="' + lp[0].toFixed(1) + '" y="' + (lp[1] + 4).toFixed(1) + '" text-anchor="' + anchor + '" class="radar-label">' + axes[i].key + ' ' + Math.round(axes[i].val) + '</text>';
    }
    return s + '</svg>';
  }
  function gaugeSVG(val, label, cls) {
    var v = Math.max(0, Math.min(1, val));
    return '<div class="gauge ' + (cls || '') + '">' +
      '<svg width="120" height="72" viewBox="0 0 120 72">' +
      '<path d="M 12 64 A 48 48 0 0 1 108 64" pathLength="100" class="gauge-bg"/>' +
      '<path d="M 12 64 A 48 48 0 0 1 108 64" pathLength="100" class="gauge-fg" stroke-dasharray="' + (v * 100).toFixed(1) + ' 100"/>' +
      '<text x="60" y="56" text-anchor="middle" class="gauge-num">' + (val * 100).toFixed(1) + '%</text></svg>' +
      '<div class="gauge-label">' + label + '</div></div>';
  }

  /* ================= HUD ================= */
  var RANKS = [['助理精算师', 0], ['精算师', 30], ['高级精算师', 70], ['资深精算师', 120]];
  function rankOf(prestige) {
    var idx = 0;
    for (var i = 0; i < RANKS.length; i++) if (prestige >= RANKS[i][1]) idx = i;
    return { idx: idx, name: RANKS[idx][0], next: RANKS[idx + 1] || null, cur: RANKS[idx][1] };
  }
  function renderHUD() {
    var st = AW.state;
    var rk = rankOf(st.prestige);
    $('#hud-rank-name').textContent = rk.name;
    var fill = rk.next ? (st.prestige - rk.cur) / (rk.next[1] - rk.cur) * 100 : 100;
    $('#hud-rank-fill').style.width = Math.max(4, Math.min(100, fill)) + '%';
    $('#hud-rank-next').textContent = rk.next ? ('下一级 ' + rk.next[0] + ' · ' + st.prestige + '/' + rk.next[1]) : ('已满级 · 声望 ' + st.prestige);
    tween('budget', $('#hud-budget'), st.budget, function (v) { return money(v); });
    tween('prestige', $('#hud-prestige'), st.prestige, function (v) { return '' + Math.round(v); });
    $('#gallery-count').textContent = st.unlockedCards.length + '/' + AW.knowledge.cards.length;
    $('#archive-count').textContent = st.archives.length;
  }

  /* ================= 六阶段流程条 ================= */
  var STAGES = [
    { name: '① 产品设计', open: true, hint: '' },
    { name: '② 监管申报', open: true, hint: '预告：材料清单与总精算师签字——条款、费率表、现金价值表、精算报告一并报送。' },
    { name: '③ 批复公示', open: true, hint: '预告：备案回执与公示——已备案条款费率不得擅自修改。' },
    { name: '④ 上架销售', open: true, hint: '预告：渠道与报行合一——备案的佣金费用结构不得账外突破。' },
    { name: '⑤ 出险勘察', open: true, hint: '预告：现场与调查——职业误报与既往症会在这一步现形。' },
    { name: '⑥ 理赔结算', open: true, hint: '预告：定损与给付——定价假设在真实世界里接受回溯检验。', stage: 5 },
    { name: '⑦ 续期经营', open: true, hint: '预告：回溯与调价——经验数据回流，费率回溯与第二季经营。', stage: 6 }
  ];
  var OPEN_TEXT = '产品设计 / 监管申报 / 批复公示 / 上架销售 / 出险勘察 / 理赔结算 / 续期经营。';
  function renderStages() {
    var el = $('#stagebar');
    var curStage = (AW.state && AW.state.stage) || 1;
    el.innerHTML = STAGES.map(function (s, i) {
      var idx = i + 1;
      var stageOf = s.stage || idx;      /* ⑥结算/⑦续期为独立格但复用 stage 5/6 */
      var cls = s.open ? 'open' : 'locked';
      if (s.open && stageOf === curStage) cls += ' cur';
      return '<div class="stage ' + cls + '" data-stage="' + idx + '">' +
        (s.open ? s.name : s.name + ' <span class="lock">🔒</span>') + '</div>';
    }).join('');
    $$('#stagebar .stage').forEach(function (d) {
      var idx = parseInt(d.getAttribute('data-stage'), 10);
      var s = STAGES[idx - 1];
      d.addEventListener('click', function () {
        if (s.open) { AW.main.gotoStage(s.stage || idx); return; }
        showModal('<h3>🔒 ' + esc(s.name) + '</h3><p class="dim">本阶段将在后续版本开放。当前版本开放：<b>' + OPEN_TEXT + '</b></p>' +
          '<p class="stage-hint">' + s.hint + '</p>');
        AW.main.eventUnlock('stage');
      });
    });
  }

  /* ================= Step1 立项 ================= */
  function renderStep1() {
    var st = AW.state;
    var html = '<h2 class="step-title">Step 1 · 立项：选择险种与目标客群</h2>';
    html += '<div class="pcards">';
    AW.products.forEach(function (p) {
      html += '<div class="pcard ' + (st.pid === p.id ? 'sel' : '') + '" data-pid="' + p.id + '">' +
        '<div class="pcard-icon">' + p.icon + '</div><div class="pcard-name">' + p.name + '</div>' +
        '<div class="pcard-tag">' + esc(p.tagline) + '</div></div>';
    });
    html += '</div><h3 class="sub-title">目标客群</h3><div class="clusters">';
    AW.clusters.forEach(function (c) {
      html += '<div class="ccard ' + (st.clusterId === c.id ? 'sel' : '') + '" data-cid="' + c.id + '">' +
        '<div class="ccard-name">' + c.name + '</div><div class="ccard-desc">' + esc(c.portrait) + '</div>' +
        '<div class="ccard-fit">适配：' + (c.fit ? c.fit.map(function (f) { var pr = AW.getProduct(f); return pr ? pr.name : f; }).join(' / ') : '任意') + '</div></div>';
    });
    html += '</div>';
    $('#step1').innerHTML = html;
    $$('#step1 .pcard').forEach(function (d) {
      d.addEventListener('click', function () { AW.main.selectProduct(d.getAttribute('data-pid')); });
    });
    $$('#step1 .ccard').forEach(function (d) {
      d.addEventListener('click', function () { AW.main.selectCluster(d.getAttribute('data-cid')); });
    });
  }

  /* ================= Step2 设计 ================= */
  function paramControl(def, pid) {
    var val = AW.state.params[def.key] != null ? AW.state.params[def.key] : def.def;
    var ctl = '';
    if (def.type === 'slider') {
      var redTick = '';
      if (def.redline != null) {
        var pos = (def.redline - def.min) / (def.max - def.min) * 100;
        redTick = '<i class="redline-tick" style="left:' + pos.toFixed(1) + '%" title="红线 ' + def.redline + def.unit + '"></i>';
      }
      ctl = '<div class="slider-wrap">' +
        '<span class="slider-min">' + def.min + def.unit + '</span>' +
        '<input type="range" min="' + def.min + '" max="' + def.max + '" step="' + def.step + '" value="' + val + '" data-key="' + def.key + '">' + redTick +
        '<span class="slider-max">' + def.max + def.unit + '</span>' +
        '<span class="slider-badge" data-badge="' + def.key + '">' + val + def.unit + '</span></div>';
    } else {
      ctl = '<select data-key="' + def.key + '">' + def.options.map(function (o) {
        return '<option value="' + o.v + '"' + (String(val) === String(o.v) ? ' selected' : '') + '>' + o.l + '</option>';
      }).join('') + '</select>';
    }
    var tip = '<div class="tipbox"><b>💡 ' + esc(def.label) + '</b>' +
      '<br><u>定义</u> ' + esc(def.tip[0]) + '<br><u>思想</u> ' + esc(def.tip[1]) + '<br><u>后果</u> ' + esc(def.tip[2]) + '</div>';
    return '<div class="param" data-pid="' + pid + '"><div class="param-head"><span class="param-label">' + def.label + '</span>' +
      '<span class="param-idea">💡</span></div>' + ctl + tip + '</div>';
  }
  function renderStep2() {
    var st = AW.state;
    if (!st.pid) {
      $('#step2').innerHTML = '<div class="empty-hint">⬅ 请先在 Step 1 选择险种与客群</div>';
      return;
    }
    var prod = AW.getProduct(st.pid);
    var defs = AW.getParams(st.pid);
    var groups = { A: 'A · 责任与形态', B: 'B · 定价假设', C: 'C · 条款与风控' };
    if (!st.paramTab) st.paramTab = 'A';
    var html = '<h2 class="step-title">Step 2 · 设计：' + prod.icon + ' ' + prod.name +
      (prod.lapseFixedNote ? ' <span class="chip">ℹ️ ' + esc(prod.lapseFixedNote) + '</span>' : '') + '</h2>';
    html += '<div class="ptabs">' + Object.keys(groups).map(function (g) {
      return '<button class="ptab ' + (st.paramTab === g ? 'on' : '') + '" data-tab="' + g + '">' + groups[g] + '</button>';
    }).join('') + '</div>';
    html += '<div class="param-grid">';
    defs.forEach(function (d) {
      if (d.group === st.paramTab) html += paramControl(d, st.pid);
    });
    html += '</div>';
    $('#step2').innerHTML = html;
    $$('#step2 .ptab').forEach(function (b) {
      b.addEventListener('click', function () { st.paramTab = b.getAttribute('data-tab'); renderStep2(); });
    });
    $$('#step2 input[type=range], #step2 select').forEach(function (inp) {
      var onVal = function () {
        var key = inp.getAttribute('data-key');
        var def = null;
        defs.forEach(function (d) { if (d.key === key) def = d; });
        var v = inp.value;
        if (def && def.type === 'slider' && def.step < 1) v = parseFloat(v);
        else if (def && def.type === 'slider') v = parseInt(v, 10);
        AW.main.setParam(key, v, def);
        var badge = document.querySelector('[data-badge="' + key + '"]');
        if (badge && def) badge.textContent = v + (def.unit || '');
      };
      inp.addEventListener('input', onVal);
      inp.addEventListener('change', onVal);
    });
  }

  /* ================= Step3 自检 ================= */
  var STATUS_ICON = { pass: '✓', warn: '⚠', reject: '✗', info: 'ℹ', na: '—' };
  var STATUS_CLS = { pass: 'ok', warn: 'warn', reject: 'bad', info: 'info', na: 'na' };
  function fullProductName() { return AW.main.fullProductName(); }
  function findingsHTML(comp) {
    var html = '<div class="comp-list">';
    comp.findings.forEach(function (f) {
      html += '<div class="comp-row ' + STATUS_CLS[f.status] + '" data-rid="' + f.id + '">' +
        '<span class="comp-icon">' + STATUS_ICON[f.status] + '</span><span class="comp-id">' + f.id + '</span>' +
        '<span class="comp-name">' + esc(f.name) + '</span><span class="comp-text">' + esc(f.text) + '</span></div>';
      if (f.status !== 'pass' && f.status !== 'na') html += '<div class="comp-basis">依据：' + esc(f.basis) + '</div>';
    });
    html += '</div>';
    return html;
  }
  function renderStep3() {
    var st = AW.state;
    if (!st.pid) {
      $('#step3').innerHTML = '<div class="empty-hint">⬅ 请先在 Step 1 选择险种与客群</div>';
      return;
    }
    var priced = st.priced;
    var comp = AW.compliance.check(st.pid, st.params, priced, st.productName);
    st.lastFindings = comp;
    var html = '<h2 class="step-title">Step 3 · 自检：合规与风控预览</h2>';
    html += '<div class="name-box"><label>产品命名（说明文字 ≤10 字，禁词：理财/投资/自动续保/承诺续保/终身限额）</label>' +
      '<div class="name-row"><span class="name-company">南山人寿</span>' +
      '<input id="pname-input" maxlength="20" placeholder="自定义说明文字" value="' + esc(st.productName) + '">' +
      '<span class="name-cat">' + AW.main.nameCategorySuffix() + '</span></div>' +
      '<div class="name-full">完整名称：' + esc(fullProductName()) + '</div></div>';
    html += '<div id="comp-live">' + findingsHTML(comp) + '</div>';
    if (AW.scoring) {
      var axes = AW.scoring.riskAxes(st.pid, priced.params, priced).axes;
      html += '<div class="step3-bottom"><div class="radar-box">' + radarSVG(axes, 230) + '<div class="radar-cap">风险五轴（安全度 0-100）</div></div>';
      html += '<div class="submit-box"><div class="law-box small"><b>法定三条免责（条款固定展示）</b>' +
        AW.lawExclusions.map(function (l) { return '<div>· ' + esc(l) + '</div>'; }).join('') + '</div>' +
        '<button id="btn-submit" class="btn-submit">📋 提交产品委员会评审<br><span class="dim">消耗研发预算 ¥20,000 · 驳回不退</span></button></div></div>';
    }
    if (st.suggestions && st.suggestions.length) {
      html += '<div class="suggest-box"><b>📌 上次驳回修改建议</b>' + st.suggestions.map(function (s) { return '<div>· ' + esc(s) + '</div>'; }).join('') + '</div>';
    }
    $('#step3').innerHTML = html;
    var pin = $('#pname-input');
    pin.addEventListener('input', function () {
      st.productName = pin.value;
      $('.name-full').textContent = '完整名称：' + fullProductName();
      AW.main.setParam('____name', pin.value, null);   // 触发合规刷新
    });
    var btn = $('#btn-submit');
    if (btn) btn.addEventListener('click', function () { AW.main.submitReview(); });
  }
  /* 实时刷新：仅更新合规列表（避免重建命名输入框导致失焦） */
  function updateStep3Live() {
    var st = AW.state, live = $('#comp-live');
    if (!st.pid || !st.priced || !live) return;
    var comp = AW.compliance.check(st.pid, st.params, st.priced, st.productName);
    st.lastFindings = comp;
    live.innerHTML = findingsHTML(comp);
  }

  /* ================= 仪表盘 ================= */
  function renderDashboard() {
    var st = AW.state, d = $('#dash');
    if (!st.pid || !st.priced) {
      d.innerHTML = '<h3>精算仪表盘</h3><div class="empty-hint">选择险种后，这里将实时显示定价结果。<br><br>每动一个滑杆，保费、赔付率、利润都会变。</div>';
      return;
    }
    var r = st.priced;
    var prod = AW.getProduct(st.pid);
    var html = '<h3>精算仪表盘 <span class="chip">' + prod.icon + ' ' + prod.name + '</span></h3>';
    html += '<div class="dash-premium"><div class="dash-big" id="dash-gross">' + money(r.gross) + '</div>' +
      '<div class="dash-cap">' + (prod.type === 'long' ? '首年保费（均衡保费 · 续期同）' : '年保费（一年期）') + '</div></div>';
    html += '<div class="dash-grid2">';
    html += '<div class="dash-cell"><b>' + (r.perThousand > 0 ? money2(r.perThousand) : '—') + '</b><span>每千元保额费率</span></div>';
    html += '<div class="dash-cell"><b>' + (r.vsBase != null ? pct(r.vsBase, 0) : '—') + '</b><span>vs 市场基准</span></div>';
    html += '</div>';
    var lrDisp = r.lrReal != null ? r.lrReal : r.lr;
    var piDisp = r.piReal != null ? r.piReal : (1 - r.margin);
    html += '<div class="gauge-row">' + gaugeSVG(lrDisp, '预期赔付率' + (r.lrReal != null ? '（实现）' : '（定价）'), 'lr') +
      gaugeSVG(Math.max(0, piDisp), '预期利润率' + (r.piReal != null ? '（实现）' : ''), piDisp < 0 ? 'bad' : 'ok') + '</div>';
    html += '<div class="vsbase"><div class="vsbase-bar"><i style="width:' + Math.min(100, (r.vsBase || 1) * 50) + '%"></i><em class="vsbase-mark"></em></div>' +
      '<div class="dim">r = ' + (r.vsBase || 1).toFixed(2) + '（r&lt;0.7 提示低价竞争 / 定价不足嫌疑）</div></div>';
    if (r.a != null) {
      html += '<div class="dash-am">逆选择系数 <b>+' + pct(r.a, 0) + '</b> · 道德风险系数 <b>+' + pct(r.m, 0) + '</b></div>';
    }
    /* 附加展示 */
    html += '<div class="dash-extra">';
    if (r.cv) {
      html += '<div class="dash-cell wide"><b>' + money(r.cv.cv1) + '</b><span>首年末现金价值（退保扣费 100%）</span></div>';
      if (r.cv.cv5 != null) html += '<div class="dash-cell wide"><b>' + money(r.cv.cv5) + '</b><span>第 5 年末现价（占已缴保费 ' + pct(r.cv.cv5Ratio, 0) + '）</span></div>';
    }
    if (r.irr != null) html += '<div class="dash-cell wide"><b>' + pct(r.irr, 2) + '</b><span>' + esc((r.extras && r.extras.irrNote) || '内部收益率') + '</span></div>';
    if (st.pid === 'term' && r.params.sa > 150) html += '<div class="dash-note">⚠ 保额超 150 万：免体检限额到头，需体检＋财务核保</div>';
    if (st.pid === 'endowment' && r.extras && r.extras.maturityPay) html += '<div class="dash-cell wide"><b>' + money(r.extras.maturityPay) + '</b><span>满期生存金（参考）</span></div>';
    if (st.pid === 'annuity' && r.extras) html += '<div class="dash-cell wide"><b>' + money(r.extras.totalPaid) + '</b><span>累计应缴保费</span></div>';
    if (st.pid === 'medical' && r.extras) {
      html += '<div class="dash-cell wide"><b>' + money(r.extras.noSocialPrice) + '</b><span>无社保客群参考价（×2.2）</span></div>';
      html += '<div class="dash-note">' + esc(r.extras.renewLabel) + ' · 健康服务占净保费 ' + r.extras.svcRatio + '%' + (r.extras.inflationLoad > 1 ? ' · 通胀审慎加载 ×' + r.extras.inflationLoad.toFixed(2) : '') + '</div>';
    }
    if (st.pid === 'accident' && r.extras && r.extras.classTable) {
      html += '<div class="dash-note"><b>分职业档价表</b>（覆盖最高类取系数 ' + r.extras.occFactor.toFixed(2) + '）</div>';
      html += '<div class="classtable">' + r.extras.classTable.map(function (c) {
        return '<div class="' + (occCls(st.params.occ, c.cls) ? 'on' : '') + '"><span>' + c.cls + '类</span><b>' + Math.round(c.price) + '</b></div>';
      }).join('') + '</div>';
    }
    if (st.pid === 'ltc') html += '<div class="dash-note">触发系数 ×' + (r.extras ? r.extras.triggerFactor : 1) + ' · 失能后死亡率 = 基础表 ×3.5</div>';
    html += '</div>';
    d.innerHTML = html;
  }

  /* ================= 阶段进度面板（阶段二~五；阶段一仍为精算仪表盘） =================
   * 修复沿袭缺陷：gotoStage 后 #dash 仍停留阶段一内容。
   * 刷新点 = gotoStage()（main.js）+ save()（main.js，落账即同步）。 */
  function renderStageDash() {
    var st = AW.state, d = $('#dash');
    if (!d || !st) return;
    var stage = st.stage || 1;
    if (stage === 2) renderFilingDash(st, d);
    else if (stage === 3) renderApprovalDash(st, d);
    else if (stage === 4) renderSalesDash(st, d);
    else if (stage === 5) renderClaimsDash(st, d);
    else if (stage === 6) renderRenewalDash(st, d);
    else renderDashboard();
  }
  function dashRows(rows) {
    return '<div class="dash-list">' + rows.join('') + '</div>';
  }
  function renderFilingDash(st, d) {
    var E = AW.filingEngine, fs = st.filings || [];
    var html = '<h3>申报进度 <span class="chip">② 监管申报</span></h3>';
    if (!fs.length) {
      d.innerHTML = html + '<div class="empty-hint">还没有在办的申报。<br><br>在阶段一完成评审归档后，来这里立项报送；中断的草稿可从台账「继续编制」恢复。</div>';
      return;
    }
    var receipts = 0, fees = 0, days = 0;
    fs.forEach(function (f) { if (f.status === 'receipt') receipts++; fees += (f.fees || 0); days += (f.days || 0); });
    html += '<div class="dash-premium"><div class="dash-big">' + receipts + ' / ' + fs.length + '</div><div class="dash-cap">已获回执 / 在办申报</div></div>';
    html += '<div class="dash-grid2"><div class="dash-cell"><b>' + money(fees) + '</b><span>申报费用累计</span></div>' +
      '<div class="dash-cell"><b>' + days + ' 日</b><span>监管用时累计</span></div></div>';
    var rows = fs.map(function (f) {
      var sub = f.status === 'receipt' ? ('回执 ' + f.receiptNo) : (f.status === 'inquiry' ? '问询函待处理' : '');
      return '<div class="dash-row"><span class="f-badge s-' + f.status + '">' + esc(E.statusName(f.status)) + '</span>' +
        '<span class="dash-row-name" title="' + esc(f.name) + '">' + esc(f.name) + '</span><span class="dash-row-sub">' + esc(sub) + '</span></div>';
    });
    d.innerHTML = html + dashRows(rows);
  }
  function renderApprovalDash(st, d) {
    var E = AW.approvalEngine, ps = st.publications || [];
    var html = '<h3>公示进度 <span class="chip">③ 批复公示</span></h3>';
    if (!ps.length) {
      d.innerHTML = html + '<div class="empty-hint">还没有公示立项。<br><br>在阶段二获得备案回执的产品，来这里解读条款、公开披露、领注册号。</div>';
      return;
    }
    var published = 0, fees = 0, days = 0;
    ps.forEach(function (p) { if (p.status === 'published') published++; fees += (p.fees || 0); days += (p.days || 0); });
    html += '<div class="dash-premium"><div class="dash-big">' + published + ' / ' + ps.length + '</div><div class="dash-cap">已公示领号 / 在办公示</div></div>';
    html += '<div class="dash-grid2"><div class="dash-cell"><b>' + money(fees) + '</b><span>公示费用累计</span></div>' +
      '<div class="dash-cell"><b>' + days + ' 日</b><span>公示用时累计</span></div></div>';
    var rows = ps.map(function (p) {
      var sub = p.status === 'published' ? ('注册 ' + p.regNo) : (p.status === 'events' ? '事件待办' : '');
      return '<div class="dash-row"><span class="f-badge sp-' + p.status + '">' + esc(E.statusName(p.status)) + '</span>' +
        '<span class="dash-row-name" title="' + esc(p.name) + '">' + esc(p.name) + '</span><span class="dash-row-sub">' + esc(sub) + '</span></div>';
    });
    d.innerHTML = html + dashRows(rows);
  }
  function renderSalesDash(st, d) {
    var E = AW.salesEngine, ss = st.sales || [];
    var html = '<h3>销售进度 <span class="chip">④ 上架销售</span></h3>';
    if (!ss.length) {
      d.innerHTML = html + '<div class="empty-hint">还没有销售立项。<br><br>在阶段三完成公示的产品，来这里定渠道、编物料、上市开卖。</div>';
      return;
    }
    var premium = 0, payout = 0, net = 0, listed = 0;
    ss.forEach(function (s) {
      if (s.status !== 'listed') return;
      listed++;
      var r = E.settle(s);
      premium += r.premium; payout += r.commissionPaid + (s.penalties || 0); net += r.net;
    });
    html += '<div class="dash-premium"><div class="dash-big">' + money(net) + '</div><div class="dash-cap">已上市 ' + listed + ' / ' + ss.length + ' · 净现金流累计</div></div>';
    html += '<div class="dash-grid2"><div class="dash-cell"><b>' + money(premium) + '</b><span>首季保费累计</span></div>' +
      '<div class="dash-cell"><b>' + money(payout) + '</b><span>佣金＋罚没累计</span></div></div>';
    var rows = ss.map(function (s) {
      return '<div class="dash-row"><span class="f-badge sp-' + s.status + '">' + esc(E.statusName(s.status)) + '</span>' +
        '<span class="dash-row-name" title="' + esc(s.name) + '">' + esc(s.name) + '</span><span class="dash-row-sub">' + esc(s.status === 'listed' ? (s.fileNo || '') : '') + '</span></div>';
    });
    d.innerHTML = html + dashRows(rows);
  }
  function renderClaimsDash(st, d) {
    var E = AW.claimsEngine, D = AW.claimsData, cs = st.claims || [];
    var html = '<h3>理赔季进度 <span class="chip">⑤ 勘察与结算</span></h3>';
    if (!cs.length) {
      d.innerHTML = html + '<div class="empty-hint">还没有案件队列。<br><br>进入第五阶段后，将按已上市险种派生 10 桩案件（未上市险种为灰卡教学案）。</div>';
      return;
    }
    var closed = 0;
    cs.forEach(function (c) { if (c.status === 'closed') closed++; });
    var l = E.lrOf(st.sales || [], cs);
    var s = E.settle(cs);
    html += '<div class="dash-premium"><div class="dash-big">' + closed + ' / ' + cs.length + '</div><div class="dash-cap">已结案 / 案件总数</div></div>';
    html += '<div class="dash-grid2"><div class="dash-cell"><b>' + money(l.pool) + '</b><span>保单池保费</span></div>' +
      '<div class="dash-cell"><b>' + money(s.netPaid) + '</b><span>理赔净流出（当前）</span></div></div>';
    var rows = cs.map(function (c) {
      var t = E.caseById(c.caseKey);
      var dots = (c.docsDone ? '✓' : '·') + '单证 ' + (c.surveyDone ? '✓' : '·') + '勘察 ' + (c.adjDone ? '✓' : '·') + '核定';
      var badge = c.grayed
        ? '<span class="f-badge sc-gray">灰卡 · 未上市</span>'
        : '<span class="f-badge sc-' + c.status + '">' + esc(D.STATUS_TEXT[c.status] || c.status) + '</span>';
      var nm = t ? t.title : c.caseKey;
      return '<div class="dash-row">' + badge + '<span class="dash-row-name" title="' + esc(nm) + '">' + esc(nm) + '</span>' +
        '<span class="dash-row-sub">' + dots + '</span></div>';
    });
    var tail = (cs[0] && cs[0].fileNo) ? '<div class="dash-note">结案档案号 ' + esc(cs[0].fileNo) + '</div>' : '';
    d.innerHTML = html + dashRows(rows) + tail;
  }
  function renderRenewalDash(st, d) {
    var E = AW.renewalEngine;
    var html = '<h3>续期经营进度 <span class="chip">⑦ 回溯与调价</span></h3>';
    var r = st.renewal;
    if (!r) {
      d.innerHTML = html + '<div class="empty-hint">续期经营季尚未开启。<br><br>理赔季收官（结案档案号 CL-2026-XXXX）后，这里将开启第二个保单年度：回溯 → 调价 → 第二季结算。</div>';
      return;
    }
    var s2 = null;
    if (r.status === 'season' || r.status === 'done') {
      try { s2 = E.settle2(st.sales || [], st.claims || [], r); } catch (e) { s2 = null; }
    }
    html += '<div class="dash-premium"><div class="dash-big">' +
      (s2 ? money(s2.total.net2) : E.statusName(r.status)) + '</div>' +
      '<div class="dash-cap">' + (s2 ? '第二季净现金流' : '当前环节') + '</div></div>';
    if (s2) {
      html += '<div class="dash-grid2"><div class="dash-cell"><b>' + money(s2.total.r2) + '</b><span>续期保费合计</span></div>' +
        '<div class="dash-cell"><b>' + (s2.total.lr2 != null ? pct(s2.total.lr2) : '—') + '</b><span>第二季赔付率</span></div></div>';
    }
    var rows = [];
    E.listedOf(st.sales || []).forEach(function (s) {
      var p = null;
      if (s2) s2.per.forEach(function (x) { if (x.pid === s.pid) p = x; });
      var sub = s.pid === 'medical' && r.ratePicked ? E.tierById(r.ratePicked).name
        : (p ? '续期 ×' + p.mult.toFixed(2) : '');
      rows.push('<div class="dash-row"><span class="f-badge sr-' + r.status + '">' + esc(E.statusName(r.status)) + '</span>' +
        '<span class="dash-row-name" title="' + esc(pidNameOf(s.pid)) + '">' + esc(pidNameOf(s.pid)) + '</span>' +
        '<span class="dash-row-sub">' + esc(sub) + '</span></div>');
    });
    var evs = E.eventsOf(r), pending = 0;
    evs.forEach(function (x) { if (x.ok == null) pending++; });
    var tail = (r.fileNo ? '档案号 ' + r.fileNo : '') + (pending ? (r.fileNo ? ' · ' : '') + '事件待办 ' + pending : '');
    d.innerHTML = html + dashRows(rows) + (tail ? '<div class="dash-note">' + esc(tail) + '</div>' : '');
  }
  function pidNameOf(pid) {
    try { var p = AW.getProduct(pid); return p ? p.name : pid; } catch (e) { return pid; }
  }

  function occCls(occSel, c) {
    var max = occSel === 'c13' ? 3 : occSel === 'c14' ? 4 : 6;
    return c <= max;
  }

  /* ================= 导师条 ================= */
  function pushMentor(text) {
    var st = AW.state;
    st.mentorLines.push(text);
    if (st.mentorLines.length > 3) st.mentorLines.shift();
    var box = $('#mentor-lines');
    box.innerHTML = st.mentorLines.map(function (t, i) {
      return '<div class="mentor-line ' + (i === st.mentorLines.length - 1 ? 'newest' : '') + '">' + esc(t) + '</div>';
    }).join('');
  }

  /* ================= 知识图鉴 ================= */
  function galleryModal() {
    var st = AW.state;
    var html = '<h3>📖 知识图鉴 <span class="dim">' + st.unlockedCards.length + '/' + AW.knowledge.cards.length + '</span></h3>';
    html += '<div class="gal-body"><div class="gal-cats">';
    AW.knowledge.cats.forEach(function (cat) {
      var cards = AW.knowledge.cards.filter(function (c) { return c.cat === cat.id; });
      html += '<div class="gal-cat"><div class="gal-cat-name" style="border-color:' + cat.color + '">' + cat.name + '</div><div class="gal-grid">';
      cards.forEach(function (c) {
        var unlocked = st.unlockedCards.indexOf(c.id) >= 0;
        html += '<div class="gal-card ' + (unlocked ? 'unlocked' : 'locked') + '" style="border-top-color:' + cat.color + '" data-k="' + c.id + '">' +
          (unlocked ? esc(c.title) : '🔒 ？？？') + '</div>';
      });
      html += '</div></div>';
    });
    html += '</div><div class="gal-detail" id="gal-detail"><div class="dim">点击已解锁的卡片查看全文；未解锁卡片随参数操作与评审逐步点亮。</div></div></div>';
    var m = showModal(html, { wide: true });
    Array.prototype.slice.call(m.querySelectorAll('.gal-card.unlocked')).forEach(function (d) {
      d.addEventListener('click', function () {
        var card = AW.knowledge.getCard(d.getAttribute('data-k'));
        var cat = AW.knowledge.cats.filter(function (x) { return x.id === card.cat; })[0];
        $('#gal-detail').innerHTML = '<div class="kcate" style="color:' + cat.color + '">' + cat.name + '</div>' +
          '<div class="ktitle">' + esc(card.title) + '</div><div class="ktext">' + esc(card.text) + '</div>' +
          (card.tags && card.tags.length ? '<div class="ktags">关联参数：' + card.tags.join(' / ') + '</div>' : '');
      });
    });
  }

  /* ================= 案头档案 ================= */
  function archivesModal() {
    var st = AW.state;
    var html = '<h3>🗂️ 案头档案（已归档 ' + st.archives.length + '）</h3>';
    if (!st.archives.length) html += '<div class="dim">暂无归档。评审通过的产品会生成《产品精算备忘录》存入案头。</div>';
    html += '<div class="arch-list">';
    st.archives.forEach(function (a, i) {
      var locked = st.filings && st.filings.some(function (f) { return f.archId === a.id && f.status === 'receipt'; });
      html += '<div class="arch-row" data-i="' + i + '"><span class="arch-grade g-' + a.grade + '">' + a.grade + '</span>' +
        '<span class="arch-name">' + esc(a.name) + (locked ? ' 🔒' : '') + '</span><span class="arch-meta">' + esc(a.pidName) + ' · ' + a.date + ' · 总分 ' + a.total.toFixed(1) + '</span></div>';
    });
    html += '</div><div id="arch-detail"></div>';
    if (st.archives.length) html += '<div class="modal-actions"><button id="btn-export-all" class="btn-ghost">📤 导出全部档案（复制为文本）</button></div>';
    var m = showModal(html, { wide: true });
    Array.prototype.slice.call(m.querySelectorAll('.arch-row')).forEach(function (d) {
      d.addEventListener('click', function () {
        var a = st.archives[parseInt(d.getAttribute('data-i'), 10)];
        $('#arch-detail').innerHTML = '<pre class="memo-pre">' + esc(a.memoText) + '</pre>' +
          '<div class="modal-actions"><button class="btn-ghost" id="btn-copy-memo">📋 复制本备忘录</button></div>';
        $('#btn-copy-memo').addEventListener('click', function () { AW.main.copyText(a.memoText); toast('备忘录已复制到剪贴板', 'ok'); });
      });
    });
    var ex = m.querySelector('#btn-export-all');
    if (ex) ex.addEventListener('click', function () {
      AW.main.copyText(st.archives.map(function (a) { return a.memoText; }).join('\n\n====================\n\n'));
      toast('全部档案已复制为文本', 'ok');
    });
  }

  function resetModal() {
    var m = showModal('<h3>♻️ 重置进度</h3><p>将清空：声望、预算、职级、知识图鉴、案头档案。<br>该操作不可恢复，确定继续吗？</p>' +
      '<div class="modal-actions"><button id="btn-reset-yes" class="btn-danger">确定重置</button><button id="btn-reset-no" class="btn-ghost">再想想</button></div>');
    m.querySelector('#btn-reset-yes').addEventListener('click', function () { AW.main.hardReset(); });
    m.querySelector('#btn-reset-no').addEventListener('click', closeModal);
  }

  /* ================= 评审演出 ================= */
  function reviewModal(findings, result, ctx, onArchive) {
    var html = '<h3>📋 产品委员会评审 · ' + esc(ctx.productName) + '</h3><div id="rv-comp" class="rv-comp"></div>' +
      '<div id="rv-score" class="rv-score"></div><div id="rv-stamp"></div><div id="rv-memo"></div>';
    var m = showModal(html, { wide: true });
    var listEl = m.querySelector('#rv-comp');
    var i = 0;
    function nextRow() {
      if (i < findings.findings.length) {
        var f = findings.findings[i++];
        var row = document.createElement('div');
        row.className = 'comp-row ' + STATUS_CLS[f.status] + ' rv-anim';
        row.innerHTML = '<span class="comp-icon">' + STATUS_ICON[f.status] + '</span><span class="comp-id">' + f.id + '</span>' +
          '<span class="comp-name">' + esc(f.name) + '</span><span class="comp-text">' + esc(f.text) + '</span>';
        listEl.appendChild(row);
        setTimeout(nextRow, 250);
      } else {
        setTimeout(showScores, 400);
      }
    }
    function showScores() {
      var s = result;
      m.querySelector('#rv-score').innerHTML =
        '<div class="rv-dims">' +
        '<div class="rv-dim"><span>合规</span><b>' + s.compliance.toFixed(0) + '</b></div>' +
        '<div class="rv-dim"><span>盈利</span><b>' + s.profit + '</b></div>' +
        '<div class="rv-dim"><span>竞争力</span><b>' + s.competitive.toFixed(0) + '</b></div>' +
        '<div class="rv-dim"><span>风控</span><b>' + s.risk.toFixed(0) + '</b></div>' +
        '<div class="rv-total">总分 <b>' + s.total.toFixed(1) + '</b> · 评级 <span class="grade g-' + s.grade + '">' + s.grade + '</span></div></div>' +
        '<div id="rv-speech"></div>';
      var speeches = m.querySelector('#rv-speech');
      var lines = [];
      var C = AW.mentor.committee;
      var ctx2 = {
        piReal: s.piReal, rate: ctx.p.rate, r: s.r, mismatch: s.mismatch,
        hasReject: findings.hasReject, warnings: findings.cnt.warn
      };
      ['chen', 'lin', 'zhou'].forEach(function (k) {
        C[k].pick(s, ctx2).forEach(function (t) { lines.push({ who: C[k].name, icon: C[k].icon, text: t }); });
      });
      var j = 0;
      function nextLine() {
        if (j < lines.length) {
          var L = lines[j++];
          var d = document.createElement('div');
          d.className = 'speech rv-anim';
          d.innerHTML = '<span class="speech-who">' + L.icon + ' ' + esc(L.who) + '：</span>' + esc(L.text);
          speeches.appendChild(d);
          setTimeout(nextLine, 650);
        } else { setTimeout(showStamp, 350); }
      }
      nextLine();
    }
    function showStamp() {
      var pass = result.verdict === 'pass';
      var stamp = m.querySelector('#rv-stamp');
      stamp.innerHTML = '<div class="stamp ' + (pass ? 'stamp-pass' : 'stamp-reject') + '">' + (pass ? '备案受理' : '退回修改') + '</div>' +
        '<div class="stamp-caption">' + (pass ? '通过 · 准予报送备案' : result.verdict === 'redo' ? '打回 · 暂缓（总分 <60）' : '驳回 · 退回修改') + '</div>';
      if (!pass) {
        var sug = findings.findings.filter(function (f) { return f.status === 'reject' || f.status === 'warn'; })
          .map(function (f) { return '【' + f.id + '】' + f.text + '（依据：' + f.basis + '）'; });
        stamp.innerHTML += '<div class="suggest-box"><b>修改建议</b>' + sug.map(function (s) { return '<div>· ' + esc(s) + '</div>'; }).join('') + '</div>';
      } else {
        stamp.innerHTML += '<div class="dim">《产品精算备忘录》已生成并归档至案头档案。</div>';
        stamp.innerHTML += '<div class="modal-actions"><button id="btn-view-memo" class="btn-main">📄 查看备忘录</button>' +
          '<button id="btn-goto-filing" class="btn-main">🏛️ 前往监管申报 →</button>' +
          '<button id="btn-rv-close" class="btn-ghost">返回工作台</button></div>';
        m.querySelector('#btn-view-memo').addEventListener('click', function () {
          m.querySelector('#rv-memo').innerHTML = memoHTML(ctx.archive, true);
          var cp = m.querySelector('#btn-copy-memo2');
          if (cp) cp.addEventListener('click', function () { AW.main.copyText(ctx.archive.memoText); toast('备忘录已复制到剪贴板', 'ok'); });
          m.querySelector('#btn-view-memo').style.display = 'none';
        });
        m.querySelector('#btn-goto-filing').addEventListener('click', function () {
          closeModal();
          AW.main.gotoStage(2);
        });
        m.querySelector('#btn-rv-close').addEventListener('click', closeModal);
      }
    }
    setTimeout(nextRow, 250);
  }

  /* ================= 备忘录 ================= */
  function memoHTML(a, withCopy) {
    var s = a;
    var html = '<div class="memo"><h3>📄 产品精算备忘录</h3>' +
      '<div class="memo-head"><b>' + esc(s.name) + '</b> · ' + esc(s.pidName) + ' · ' + s.date +
      ' · 评级 <span class="grade g-' + s.grade + '">' + s.grade + '</span>（总分 ' + s.total.toFixed(1) + '）</div>';
    html += '<div class="memo-grid"><div><h4>参数摘要</h4><table class="memo-table">';
    s.paramRows.forEach(function (r) { html += '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>'; });
    html += '</table></div><div><h4>保费与费率</h4><table class="memo-table">' +
      '<tr><td>首年/续期保费</td><td>' + money(s.gross) + '</td></tr>' +
      '<tr><td>每千元保额费率</td><td>' + (s.perThousand > 0 ? money2(s.perThousand) : '—') + '</td></tr>' +
      '<tr><td>定价赔付率</td><td>' + pct(s.lr) + '</td></tr>' +
      '<tr><td>实现赔付率</td><td>' + pct(s.lrReal) + '</td></tr>' +
      '<tr><td>实现利润率</td><td>' + pct(s.piReal) + '</td></tr>' +
      '<tr><td>vs 市场基准</td><td>r = ' + s.r.toFixed(2) + '</td></tr></table>' +
      '<div class="memo-radar">' + radarSVG(s.scoreAxes, 190, '#43b581') + '</div></div></div>';
    html += '<h4>设计思想解读</h4><ol class="memo-points">' + s.thoughts.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol>';
    html += '<div class="memo-sign">总精算师签批意见（陈砚）：' + esc(s.signoff) + '</div>';
    if (withCopy) html += '<div class="modal-actions"><button id="btn-copy-memo2" class="btn-ghost">📋 复制为文本</button></div>';
    html += '</div>';
    return html;
  }

  AW.render = {
    renderHUD: renderHUD, renderStages: renderStages, renderStep1: renderStep1,
    renderStep2: renderStep2, renderStep3: renderStep3, updateStep3Live: updateStep3Live,
    renderDashboard: renderDashboard, renderStageDash: renderStageDash,
    pushMentor: pushMentor, toast: toast, showModal: showModal, closeModal: closeModal,
    galleryModal: galleryModal, archivesModal: archivesModal, resetModal: resetModal,
    reviewModal: reviewModal, memoHTML: memoHTML, rankOf: rankOf, radarSVG: radarSVG,
    money: money, money2: money2, pct: pct, esc: esc
  };
})();
