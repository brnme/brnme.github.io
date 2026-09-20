/* =====================================================================
 * 精算工坊 · js/ui/approval.js（第三阶段「批复公示」界面，GDD-stage3 §15.1 §15.5）
 * 挂载 AW.uiApproval：render / renderP1 / renderP2 / renderP3 / ledgerTab /
 * openReceiptViewModal / openEventModal / openPublishedModal / openArchiveModal。
 * 复用 AW.render 的 showModal / toast / .stamp / .comp-row / .chip / .btn-* 体系。
 * ===================================================================== */
(function () {
  'use strict';
  var AW = (typeof window !== 'undefined') ? (window.AW = window.AW || {})
                                           : (globalThis.AW = globalThis.AW || {});
  var R = null;                  // 延迟取 AW.render（加载顺序：本文件先于 main.js）
  var D = null, E = null, FE = null;   // approvalData / approvalEngine / filingEngine

  var tab = 'p1';                // p1 | p2 | p3 | ledger
  var curId = null;              // 当前办理的 publication id
  var selFilingId = null;        // P1 当前选中的申报（回执产品）

  function deps() {
    if (!R) R = AW.render;
    D = AW.approvalData; E = AW.approvalEngine; FE = AW.filingEngine;
    return !!(R && D && E && FE);
  }
  function esc(s) { return R.esc(s); }
  function money(n) { return R.money(n); }
  function st() { return AW.state; }
  function cur() {
    var ps = st().publications || [], i;
    for (i = 0; i < ps.length; i++) if (ps[i].id === curId) return ps[i];
    return null;
  }
  function filingById(id) {
    var fs = st().filings || [], i;
    for (i = 0; i < fs.length; i++) if (fs[i].id === id) return fs[i];
    return null;
  }
  function pubOfFiling(fid) {
    var ps = st().publications || [], i;
    for (i = 0; i < ps.length; i++) if (ps[i].filingId === fid) return ps[i];
    return null;
  }
  function applyDelta(d) {
    if (!d) return;
    if (d.fee) st().budget -= d.fee;
    if (d.prestige) st().prestige = Math.max(0, st().prestige + d.prestige);
  }
  function saveHud() { AW.main.save(); R.renderHUD(); }
  function badgeHTML(p) {
    return '<span class="f-badge sp-' + p.status + '">' + esc(E.statusName(p.status)) + (p.status === 'published' ? ' ✅' : '') + '</span>';
  }

  /* ================= 主视图 ================= */
  function render() {
    if (!deps()) return;
    var root = document.getElementById('approval');
    if (!root) return;
    var c = cur();
    function tabBtn(key, label, disabled) {
      return '<button class="ftab ' + (tab === key ? 'on' : '') + '" data-ftab="' + key + '"' +
        (disabled ? ' disabled title="请先在「① 批复解读」选择产品"' : '') + '>' + label + '</button>';
    }
    root.innerHTML =
      '<div class="ftabs">' +
      tabBtn('p1', '① 批复解读') +
      tabBtn('p2', '② 注册披露', !c) +
      tabBtn('p3', '③ 公示应对', !c) +
      tabBtn('ledger', '🗂️ 公示台账') +
      '</div><div id="approval-body"></div>';
    var body = root.querySelector('#approval-body');
    var html = '', bind = null;
    if (tab === 'p2' && c) { html = p2HTML(c); bind = bindP2; }
    else if (tab === 'p3' && c) { html = p3HTML(c); bind = bindP3; }
    else if (tab === 'ledger') { html = ledgerHTML(); bind = bindLedger; }
    else { html = p1HTML(); bind = bindP1; }
    body.innerHTML = html;
    if (bind) bind(body);
    Array.prototype.slice.call(root.querySelectorAll('.ftab')).forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) { R.toast('请先在「① 批复解读」选择已取得回执的产品', 'warn'); return; }
        tab = b.getAttribute('data-ftab');
        render();
      });
    });
  }

  /* ================= P1 批复解读 ================= */
  function receiptFilings() {
    var fs = st().filings || [];
    return fs.filter(function (f) { return f.status === 'receipt'; });
  }
  function p1HTML() {
    var list = receiptFilings();
    var html = '<h2 class="step-title">批复公示 · P1 批复解读</h2>';
    html += '<p class="dim">选择一份已取得回执的申报，读懂批复文件后再办理注册披露。' + esc(D.CHEN.p1Intro.split('。')[0] + '。') + '</p>';
    if (!list.length) {
      html += '<div class="empty-hint">还没有取得回执的申报。<br>先去「② 监管申报」完成报送并取得回执，再来这里办理公示。</div>';
      return html;
    }
    html += '<div class="fcard-grid">';
    list.forEach(function (f) {
      var guard = E.canPublish(f, st().publications || []);
      var dis = !guard.ok;
      html += '<div class="fcard ' + (selFilingId === f.id ? 'sel' : '') + (dis ? ' dis' : '') + '" data-fid="' + f.id + '">' +
        '<div class="fcard-top"><span class="f-badge s-receipt">' + esc(FE.routeName(f.route)) + '回执</span>' +
        (guard.reason === 'published' ? '<span class="f-badge sp-published">✅ 已公示</span>' :
         guard.reason === 'active' ? '<span class="f-badge s-act">公示中</span>' : '') + '</div>' +
        '<div class="fcard-name">' + esc(f.name) + '</div>' +
        '<div class="fcard-meta">' + esc(f.pidName) + ' · 回执号 ' + esc(f.receiptNo || '—') + '</div></div>';
    });
    html += '</div>';
    var c = cur();
    if (c && c.status === 'reading') {
      html += interpretHTML(c);
    }
    return html;
  }
  function interpretHTML(c) {
    var qs = E.interpretQs(c.pid);
    var html = '<div class="route-box"><h3 class="sub-title">批复解读三题 · ' + esc(c.name) + '</h3>' +
      '<p class="dim">批复文件实拍：<button class="btn-ghost" id="btn-view-receipt2" style="padding:3px 12px;font-size:11px">📄 查看批复文件/回执</button></p>';
    qs.forEach(function (q) {
      var pickedIdx = c.interpret.answers[q.id];
      var wronged = c.interpret.wrong.indexOf(q.id) >= 0;
      var done = pickedIdx != null;
      html += '<div class="pub-q"><p><b>' + q.theme + '</b>　' + esc(q.question) + '</p>';
      if (done && wronged) {
        var wrongOpt = q.options[pickedIdx];
        var rightOpt = null;
        q.options.forEach(function (o) { if (o.ok) rightOpt = o; });
        html += '<div class="comp-row bad"><span class="comp-icon">✗</span><span class="comp-text">你的登记：' + esc(wrongOpt.text) + '</span></div>' +
          '<div class="comp-row ok"><span class="comp-icon">✓</span><span class="comp-text">已更正为：' + esc(rightOpt.text) + '</span></div>' +
          '<div class="comp-basis">依据：' + esc(q.law) + '</div>';
      } else if (done) {
        html += '<div class="comp-row ok"><span class="comp-icon">✓</span><span class="comp-text">' + esc(q.options[pickedIdx].text) + '</span></div>';
      } else {
        html += '<div class="opt-list">';
        q.options.forEach(function (o, idx) {
          html += '<label class="opt-item opt-row" data-qid="' + q.id + '" data-oidx="' + idx + '"><span>' + esc(o.text) + '</span></label>';
        });
        html += '</div>';
      }
      html += '</div>';
    });
    var allDone = E.interpretComplete(c);
    html += '<div class="modal-actions f2-nav">' +
      (allDone && E.interpretAllRight(c) ? '<span class="ok-t">三题全对，一次性通过 ✓（声望 +1）</span>' : '') +
      '<button id="btn-p1-next" class="btn-main"' + (allDone ? '' : ' disabled title="三题答完后进入下一步"') + '>下一步：注册披露 →</button></div>';
    if (!allDone) html += '<div class="dim" style="margin-top:6px">答错一题扣登记更正费 ¥500、声望 −1，系统自动更正——读文件的能力也是精算师的基本功。</div>';
    html += '</div>';
    return html;
  }
  function bindP1(body) {
    Array.prototype.slice.call(body.querySelectorAll('.fcard')).forEach(function (d) {
      d.addEventListener('click', function () {
        var fid = d.getAttribute('data-fid');
        var f = filingById(fid);
        if (!f) return;
        var guard = E.canPublish(f, st().publications || []);
        if (!guard.ok) {
          if (guard.reason === 'published') R.toast('✅ ' + guard.text, 'info');
          else {
            curId = guard.pub.id; selFilingId = fid;
            var st2 = guard.pub.status;
            tab = st2 === 'reading' ? 'p1' : (st2 === 'registering' ? 'p2' : 'p3');
            R.toast('该产品公示进行中，已为你打开对应步骤', 'info');
            render();
          }
          return;
        }
        var p = E.buildPublication(f);
        st().publications.unshift(p);
        curId = p.id; selFilingId = fid;
        AW.main.eventUnlock('pub_interpret');
        AW.main.save();
        openReceiptViewModal(f, p);
        render();
      });
    });
    Array.prototype.slice.call(body.querySelectorAll('.opt-row[data-qid]')).forEach(function (d) {
      d.addEventListener('click', function () {
        var c = cur();
        if (!c) return;
        var res = E.answerInterpret(c, d.getAttribute('data-qid'), parseInt(d.getAttribute('data-oidx'), 10));
        if (res.done || res.invalid) return;
        applyDelta(res);
        saveHud();
        if (!res.ok) AW.main.checkMentorApproval('interpret_wrong', c);
        else if (res.allOk) AW.main.checkMentorApproval('interpret_allok', c);
        render();
      });
    });
    var rv = body.querySelector('#btn-view-receipt2');
    if (rv) rv.addEventListener('click', function () {
      var c = cur();
      var f = c ? filingById(c.filingId) : null;
      if (f) openReceiptViewModal(f, c, true);
    });
    var next = body.querySelector('#btn-p1-next');
    if (next) next.addEventListener('click', function () {
      var c = cur();
      if (c) { c.status = 'registering'; c.log.push({ t: '披露', text: '批复解读完成，进入注册披露', date: '2026-09' }); AW.main.save(); }
      tab = 'p2'; render();
    });
  }
  function openReceiptViewModal(f, p, readonly) {
    var html = '<h3>📄 ' + (f.route === 'approval' ? '批复文件' : '备案回执') + '（实拍）</h3>' +
      '<div style="text-align:center"><div class="stamp stamp-pass">' + (f.route === 'approval' ? '批复文件' : '备案回执') + '</div>' +
      '<div class="stamp-caption">编号 <b>' + esc(f.receiptNo || '—') + '</b> · ' + esc(f.name) + '</div></div>' +
      '<div class="mat-kv" style="margin-top:12px">' +
      '<div>产品名称：' + esc(f.name) + '（' + esc(f.pidName) + '）</div>' +
      '<div>报送路径：' + esc(FE.routeName(f.route)) + '（' + (E.catOf(f.pid)) + '）</div>' +
      '<div>签收单位：国家金融监督管理总局（教学演出）</div></div>' +
      '<div class="law-box small" style="margin-top:10px">📖 ' + esc(D.LAW_LOCK) + '</div>' +
      '<div class="speech"><span class="speech-who">🧑‍🦳 陈砚：</span>' + esc(readonly ? D.CHEN.p2Intro : D.CHEN.p1Intro) + '</div>' +
      '<div class="modal-actions"><button id="btn-rec-go" class="btn-main">' + (readonly ? '关闭' : '开始批复解读 →') + '</button></div>';
    R.showModal(html).querySelector('#btn-rec-go').addEventListener('click', function () { R.closeModal(); });
  }

  /* ================= P2 注册披露 ================= */
  function p2HTML(c) {
    if (c.status === 'published') return publishedBoxHTML(c);
    var items = E.disclosureItems(c.pid);
    var dec = E.demoDecision(c.pid);
    var rev = E.reviewDisclosure(c);
    var html = '<h2 class="step-title">批复公示 · P2 注册披露 <span class="chip">' + esc(c.name) + '</span> ' + badgeHTML(c) + '</h2>';
    /* A 注册登记表 */
    html += '<h3 class="sub-title">A · 产品注册登记表</h3><div class="mat-list">' +
      '<div class="comp-row ok filing-mat"><span class="comp-icon">✓</span><span class="comp-name">注册登记信息</span>' +
      '<span class="comp-text">回执 ' + esc(c.receiptNo || '—') + ' · 类别 ' + esc(E.catOf(c.pid)) + ' · 条款 T-2026-' + esc(c.receiptNo ? c.receiptNo.slice(-4) : '0000') + ' · 费率表 F-2026-' + esc(c.receiptNo ? c.receiptNo.slice(-4) : '0000') + '</span>' +
      '<button class="btn-ghost mat-view" data-mat="regform">查看</button></div></div>';
    /* B1 披露清单 */
    html += '<h3 class="sub-title">B1 · 官网披露清单勾选（缺必备项，合规审查不放行）</h3><div class="axis-grid">';
    items.forEach(function (d) {
      var on = c.disclosure.indexOf(d.key) >= 0;
      var na = d.attr === 'na';
      var mark = d.attr === 'req' ? ' <i class="req-mark">必备</i>' :
                 d.attr === 'na' ? ' <i class="na-mark">不适用</i>' : '';
      html += '<label class="axis-item ' + (on ? 'on' : '') + (na ? ' na-item' : '') + '" data-disc="' + d.key + '"' + (na ? ' title="一年期产品不适用"' : '') + '>' +
        '<input type="checkbox" ' + (on ? 'checked' : '') + (na ? ' disabled' : '') + '> <span>' + esc(d.name) + mark + '</span></label>';
    });
    html += '</div>';
    if (rev.missing.length) html += '<div class="suggest-box"><b>⚠ 缺必备披露项</b>' + rev.missing.map(function (m) { return '<div>· ' + esc(m.name) + '</div>'; }).join('') + '<div class="comp-basis">依据：' + esc(D.LAW_8) + '</div></div>';
    if (rev.traps.length) html += '<div class="warn-legacy"><b>⚠ 老周提醒：报送类材料不是公众披露材料</b>' + rev.traps.map(function (m) { return '<div>· 「' + esc(m.name) + '」挂上官网属披露不当，公示期可能被监管抽查</div>'; }).join('') + '</div>';
    /* B2 演示口径 */
    html += '<h3 class="sub-title">B2 · 产品说明书：' + esc(dec.theme) + '</h3><div class="opt-list">';
    dec.options.forEach(function (o) {
      html += '<label class="opt-item opt-row ' + (c.demoChoice === o.id ? 'sel' : '') + '" data-demo="' + o.id + '">' +
        '<input type="radio" name="demochoice" ' + (c.demoChoice === o.id ? 'checked' : '') + '><span>' + esc(o.text) + '</span></label>';
    });
    html += '</div><div class="comp-basis">法规依据：' + esc(dec.law) + '</div>';
    html += '<div class="modal-actions f2-nav">' +
      '<button id="btn-p2-back" class="btn-ghost">← 返回解读</button>' +
      '<button id="btn-p2-launch" class="btn-main"' + (c.demoChoice != null ? '' : ' disabled title="先完成 B2 演示口径决策"') + '>📤 披露上线（¥2,000）→ 进入公示期</button></div>';
    if (c.demoChoice == null) html += '<div class="dim" style="margin-top:6px">演示口径未作选择，不能上线披露。</div>';
    return html;
  }
  function bindGoSales(body) {
    var gs = body.querySelector('#btn-go-sales');
    if (gs) gs.addEventListener('click', function () { AW.main.gotoStage(4); });
  }
  function bindP2(body) {
    var c = cur();
    if (!c) return;
    bindGoSales(body);
    var rf = body.querySelector('.mat-view[data-mat="regform"]');
    if (rf) rf.addEventListener('click', function () { openRegFormModal(c); });
    Array.prototype.slice.call(body.querySelectorAll('.axis-item[data-disc]')).forEach(function (d) {
      d.addEventListener('click', function (ev) {
        ev.preventDefault();
        if (d.classList.contains('na-item')) { R.toast('一年期产品无此项', 'info'); return; }
        var key = d.getAttribute('data-disc');
        var idx = c.disclosure.indexOf(key);
        if (idx >= 0) c.disclosure.splice(idx, 1);
        else {
          c.disclosure.push(key);
          var item = null;
          E.disclosureItems(c.pid).forEach(function (it) { if (it.key === key) item = it; });
          if (item && item.attr === 'trap') {
            R.toast('⚠ ' + D.CHEN.trapWarn, 'warn');
            AW.main.checkMentorApproval('disc_trap', c);
          }
          if (item && item.attr === 'noise') {
            R.toast('💡 ' + D.CHEN.noiseStop, 'info');
            AW.main.checkMentorApproval('disc_noise', c);
          }
        }
        saveHud();
        render();
      });
    });
    Array.prototype.slice.call(body.querySelectorAll('.opt-row[data-demo]')).forEach(function (d) {
      d.addEventListener('click', function (ev) {
        ev.preventDefault();
        c.demoChoice = d.getAttribute('data-demo');
        saveHud();
        render();
      });
    });
    var back = body.querySelector('#btn-p2-back');
    if (back) back.addEventListener('click', function () { tab = 'p1'; render(); });
    var launch = body.querySelector('#btn-p2-launch');
    if (launch) launch.addEventListener('click', function () { doLaunch(c); });
  }
  function openRegFormModal(c) {
    var html = '<h3>🗂️ 产品注册登记表（预览）</h3>' +
      '<table class="memo-table">' +
      '<tr><td>产品名称</td><td>' + esc(c.name) + '</td></tr>' +
      '<tr><td>产品类别</td><td>' + esc(E.catOf(c.pid)) + '</td></tr>' +
      '<tr><td>报送路径</td><td>' + esc(FE.routeName(c.route)) + '（' + (c.route === 'approval' ? '《保险法》135条：新开发的人寿保险险种' : '其余险种事后检核') + '）</td></tr>' +
      '<tr><td>回执/批复编号</td><td>' + esc(c.receiptNo || '—') + '</td></tr>' +
      '<tr><td>条款编号</td><td>T-2026-' + esc(c.receiptNo ? c.receiptNo.slice(-4) : '0000') + '</td></tr>' +
      '<tr><td>费率表编号</td><td>F-2026-' + esc(c.receiptNo ? c.receiptNo.slice(-4) : '0000') + '</td></tr>' +
      '<tr><td>注册登记号</td><td>' + (c.regNo ? esc(c.regNo) : '（公示完成后分配）') + '</td></tr></table>' +
      '<div class="comp-basis">编号格式为教学演出；现实产品注册编号由监管产品信息系统分配。</div>';
    R.showModal(html + '<div class="modal-actions"><button class="btn-ghost" id="btn-rf-close">关闭</button></div>')
      .querySelector('#btn-rf-close').addEventListener('click', function () { R.closeModal(); });
  }
  function doLaunch(c) {
    var fee = D.FEES.disclosureLaunch.fee;
    /* 防软锁：沿用透支机制 */
    if (st().budget < fee) {
      if ((st().overdraftStreak || 0) >= 1) {
        R.toast('❌ 预算已连续透支，公司不再垫付。回「① 产品设计」通过评审赚取研发拨款后再来。', 'bad');
        return;
      }
      st().overdraftStreak = 1;
      R.toast('💰 预算不足，公司垫付披露运营费', 'warn');
    } else {
      st().overdraftStreak = 0;
    }
    var res = E.launchDisclosure(c);
    if (!res.ok) {
      saveHud();
      if (res.reason === 'missing') {
        AW.main.checkMentorApproval('disc_refused', c);
        var html = '<h3>✋ 合规审查打回：披露清单不全</h3>' +
          '<div class="speech"><span class="speech-who">🧑‍⚖️ 老周（合规总监）：</span>' + esc(D.ZHOU.reviewReject) + '</div>' +
          res.review.missing.map(function (m) {
            return '<div class="comp-row bad"><span class="comp-icon">✗</span><span class="comp-name">' + esc(m.name) + '</span><span class="comp-text">' + esc(m.note) + '</span></div>';
          }).join('') +
          '<div class="law-box small" style="margin-top:10px">' + esc(D.LAW_8) + '</div>' +
          '<div class="modal-actions"><button id="btn-disc-back" class="btn-main">回去补齐 →</button></div>';
        R.showModal(html).querySelector('#btn-disc-back').addEventListener('click', function () { R.closeModal(); });
      } else {
        var dm = res.demo || {};
        var why = dm.text || '演示口径不合规。';
        var law = dm.decision ? dm.decision.law : '';
        var html2 = '<h3>✋ 合规审查打回：说明书演示口径</h3>' +
          '<div class="speech"><span class="speech-who">🧑‍⚖️ 老周（合规总监）：</span>' + esc(D.ZHOU.demoReject) + '</div>' +
          '<div class="comp-row bad"><span class="comp-icon">✗</span><span class="comp-text">' + esc(why) + '</span></div>' +
          (law ? '<div class="comp-basis">依据：' + esc(law) + '</div>' : '') +
          '<div class="modal-actions"><button id="btn-demo-back" class="btn-main">回去重选 →</button></div>';
        R.showModal(html2).querySelector('#btn-demo-back').addEventListener('click', function () { R.closeModal(); });
      }
      render();
      return;
    }
    applyDelta({ fee: res.fee });
    AW.main.eventUnlock('pub_disclosure');
    AW.main.checkMentorApproval('disc_launch', c);
    saveHud();
    R.toast('📢 官网披露上线，进入公示期（' + res.events.length + ' 个公示期事件待应对）', 'ok');
    tab = 'p3';
    render();
  }

  /* ================= P3 公示应对 ================= */
  function publishedBoxHTML(c) {
    var evOk = c.events.filter(function (e2) { return e2.ok === true; }).length;
    var evBad = c.events.filter(function (e2) { return e2.ok === false; }).length;
    return '<div class="route-box"><h3 class="sub-title">✅ 公示完成</h3>' +
      '<p>注册登记号 <b>' + esc(c.regNo || '') + '</b> · 事件应对 ✓' + evOk + ' / ✗' + evBad + ' · 累计费用 ' + money(c.fees) + ' · 沟通 ' + c.days + ' 天</p>' +
      '<div class="modal-actions"><button id="btn-pub-view" class="btn-main">查看公示完成书</button>' +
      '<button id="btn-pub-arch" class="btn-ghost">公示档案</button></div></div>' +
      '<div class="modal-actions"><button id="btn-go-sales" class="btn-main">前往上架销售 →</button></div>';
  }
  function p3HTML(c) {
    if (c.status === 'published') return '<h2 class="step-title">批复公示 · P3 公示应对 <span class="chip">' + esc(c.name) + '</span> ' + badgeHTML(c) + '</h2>' + publishedBoxHTML(c);
    var html = '<h2 class="step-title">批复公示 · P3 公示应对 <span class="chip">' + esc(c.name) + '</span> ' + badgeHTML(c) + '</h2>';
    if (!c.events.length) {
      html += '<div class="empty-hint">公示尚未上线。<br>先在「② 注册披露」完成披露上线。</div>';
      return html;
    }
    html += '<p class="dim">披露上线后进入公示期。以下事件按发生顺序逐一应对：答对 +2 声望；答错由合规部补救（¥2,000、声望 −1）。</p>';
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
    var allDone = E.eventsAllDone(c);
    if (allDone) {
      html += '<div class="sign-step"><button id="btn-finalize" class="btn-submit">🏛️ 完成公示 · 领取注册登记号<br><span class="dim">产品状态 → 已公示·可上市 · 声望 +5</span></button></div>';
    }
    return html;
  }
  function bindP3(body) {
    var c = cur();
    if (!c) return;
    bindGoSales(body);
    Array.prototype.slice.call(body.querySelectorAll('.event-go')).forEach(function (b) {
      b.addEventListener('click', function () { openEventModal(c, b.getAttribute('data-eid')); });
    });
    var fin = body.querySelector('#btn-finalize');
    if (fin) fin.addEventListener('click', function () { doFinalize(c); });
    var pv = body.querySelector('#btn-pub-view');
    if (pv) pv.addEventListener('click', function () { openPublishedModal(c); });
    var pa = body.querySelector('#btn-pub-arch');
    if (pa) pa.addEventListener('click', function () { openArchiveModal(c); });
  }
  function openEventModal(c, eid) {
    var slot = null;
    c.events.forEach(function (s) { if (s.eid === eid) slot = s; });
    var ev = E.eventById(eid);
    if (!slot || !ev || slot.ok != null) return;
    var html = '<h3>📰 公示期事件 · ' + esc(ev.title) + '</h3><p>' + esc(ev.question) + '</p>';
    if (ev.auto) {
      html += '<div class="law-box small">' + esc(ev.why) + '</div>' +
        '<div class="suggest-box"><b>处理</b>限期整改：费用 ¥3,000、声望 −2、沟通 +5 天。整改后继续公示。</div>' +
        '<div class="modal-actions"><button id="btn-ev-auto" class="btn-main">签收整改通知</button></div>';
      var m0 = R.showModal(html);
      m0.querySelector('#btn-ev-auto').addEventListener('click', function () {
        var res = E.answerEvent(c, eid, -1);
        applyDelta(res);
        AW.main.eventUnlock('pub_event');
        saveHud();
        R.closeModal();
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
        AW.main.eventUnlock('pub_event');
        saveHud();
        if (res.ok) AW.main.checkMentorApproval('event_ok', c);
        else AW.main.checkMentorApproval('event_bad', c);
        R.closeModal();
        openEventResultModal(c, ev, res);
      });
    });
  }
  function openEventResultModal(c, ev, res) {
    var html = '<h3>' + (res.ok ? '✅ 应对得当 · 舆情平息' : '⚠ 应对失当 · 合规部接管补救') + '</h3>' +
      '<div class="comp-row ' + (res.ok ? 'ok' : 'bad') + '"><span class="comp-icon">' + (res.ok ? '✓' : '✗') + '</span>' +
      '<span class="comp-text">你司回应：' + esc(res.option ? res.option.text : '') + '</span></div>' +
      '<div class="speech"><span class="speech-who">🧑‍⚖️ 复盘：</span>' + esc(ev.why) + '</div>' +
      (res.ok ? '<div class="suggest-box ok-box"><b>结果</b>声望 +2。</div>' :
        '<div class="suggest-box"><b>结果</b>合规部补救：¥2,000、声望 −1。</div>') +
      '<div class="modal-actions"><button id="btn-ev-done" class="btn-main">继续公示 →</button></div>';
    R.showModal(html).querySelector('#btn-ev-done').addEventListener('click', function () {
      R.closeModal();
      render();
    });
  }
  function doFinalize(c) {
    var d = E.finalize(c);
    applyDelta({ prestige: d.prestige });
    AW.main.eventUnlock('pub_published');
    AW.main.checkMentorApproval('published', c);
    saveHud();
    openPublishedModal(c);
    render();
  }
  function openPublishedModal(c) {
    var html = '<h3>🏛️ 公示完成书</h3>' +
      '<div style="text-align:center"><div class="stamp stamp-pub">公示完成</div>' +
      '<div class="stamp-caption">注册登记号 <b>' + esc(c.regNo || '') + '</b> · ' + esc(c.name) + '</div></div>' +
      '<div class="mat-kv" style="margin-top:12px">' +
      '<div>产品：' + esc(c.name) + '（' + esc(c.pidName) + '）</div>' +
      '<div>路径：' + esc(FE.routeName(c.route)) + ' · 回执 ' + esc(c.receiptNo || '—') + '</div>' +
      '<div>官网披露：条款/费率表/' + (E.isLong(c.pid) ? '现价表/说明书/' : '') + '在售目录 已上线</div>' +
      '<div>累计费用 ' + money(c.fees) + ' · 沟通 ' + c.days + ' 天</div></div>' +
      '<div class="law-box small" style="margin-top:10px">📖 教学尾注：产品完成公示、具备上市销售条件。上市后进入持续信息披露与产品回溯——实际经验与定价假设明显偏离须报告（衔接 ④ 上架销售与 ⑦ 产品回溯）。</div>' +
      '<div class="speech"><span class="speech-who">🧑‍🦳 陈砚：</span>' + esc(D.CHEN.published) + '</div>' +
      '<div class="modal-actions"><button id="btn-pub-ledger" class="btn-main">查看公示台账</button><button id="btn-pub-close" class="btn-ghost">关闭</button></div>';
    var m = R.showModal(html);
    m.querySelector('#btn-pub-ledger').addEventListener('click', function () { R.closeModal(); tab = 'ledger'; render(); });
    m.querySelector('#btn-pub-close').addEventListener('click', function () { R.closeModal(); });
  }

  /* ================= 公示台账 ================= */
  function ledgerHTML() {
    var ps = st().publications || [];
    var html = '<h2 class="step-title">公示台账</h2>';
    if (!ps.length) {
      html += '<div class="empty-hint">暂无公示记录。<br>在「① 批复解读」选择已取得回执的申报开始办理。</div>';
      return html;
    }
    html += '<table class="filing-table ledger"><tr><th>产品名</th><th>险种</th><th>回执号</th><th>注册号</th><th>状态</th><th>事件应对</th><th>累计费用</th><th>天数</th><th>操作</th></tr>';
    ps.forEach(function (p) {
      var evOk = 0, evBad = 0;
      p.events.forEach(function (s) { if (s.ok === true) evOk++; else if (s.ok === false) evBad++; });
      var op = '';
      if (p.status === 'published') op = '<button class="btn-ghost f-op" data-op="archive" data-pid2="' + p.id + '">公示档案</button>';
      else op = '<button class="btn-ghost f-op" data-op="resume" data-pid2="' + p.id + '">继续办理</button>';
      html += '<tr><td>' + esc(p.name) + (p.status === 'published' ? ' ✅' : '') + '</td><td>' + esc(p.pidName) + '</td>' +
        '<td>' + esc(p.receiptNo || '—') + '</td><td>' + esc(p.regNo || '—') + '</td>' +
        '<td>' + badgeHTML(p) + '</td><td>✓' + evOk + ' / ✗' + evBad + '</td><td>' + money(p.fees) + '</td><td>' + p.days + ' 天</td><td>' + op + '</td></tr>';
    });
    html += '</table><div class="dim" style="margin-top:8px">已公示产品具备上市销售条件。<button id="btn-go-sales" class="btn-main" style="margin-left:10px">前往上架销售 →</button></div>';
    return html;
  }
  function bindLedger(body) {
    bindGoSales(body);
    Array.prototype.slice.call(body.querySelectorAll('.f-op')).forEach(function (b) {
      b.addEventListener('click', function () {
        var p = null, ps = st().publications, i;
        for (i = 0; i < ps.length; i++) if (ps[i].id === b.getAttribute('data-pid2')) p = ps[i];
        if (!p) return;
        if (b.getAttribute('data-op') === 'archive') { openArchiveModal(p); return; }
        curId = p.id;
        tab = p.status === 'reading' ? 'p1' : (p.status === 'registering' ? 'p2' : 'p3');
        render();
      });
    });
  }

  /* ================= 公示档案 ================= */
  function publicationText(c) {
    var qs = E.interpretQs(c.pid);
    var dec = E.demoDecision(c.pid);
    var lines = [
      '《批复公示档案》',
      '产品名称：' + c.name + '（' + c.pidName + '）',
      '报送路径：' + FE.routeName(c.route) + ' · 回执编号：' + (c.receiptNo || '—'),
      '注册登记号：' + (c.regNo || '（未完成）'),
      '当前状态：' + E.statusName(c.status),
      '',
      '—— 批复解读 ——'
    ];
    qs.forEach(function (q) {
      var picked = c.interpret.answers[q.id];
      var right = null;
      q.options.forEach(function (o) { if (o.ok) right = o; });
      lines.push(q.theme + '：' + (picked == null ? '（未答）' :
        (c.interpret.wrong.indexOf(q.id) >= 0 ? '答错（' + q.options[picked].text + '）→ 更正为：' + right.text : q.options[picked].text)));
    });
    lines.push('');
    lines.push('—— 官网披露清单 ——');
    E.disclosureItems(c.pid).forEach(function (d) {
      var on = c.disclosure.indexOf(d.key) >= 0;
      lines.push((on ? '☑ ' : '☐ ') + d.name + (d.attr === 'na' ? '（不适用）' : d.attr === 'req' ? '（必备）' : ''));
    });
    if (dec) {
      var dOpt = null;
      dec.options.forEach(function (o) { if (o.id === c.demoChoice) dOpt = o; });
      lines.push('');
      lines.push('—— 说明书演示口径 ——');
      lines.push(dec.question);
      lines.push(dOpt ? '选择：' + dOpt.text : '（未选择）');
    }
    if (c.events.length) {
      lines.push('');
      lines.push('—— 公示期事件应对 ——');
      c.events.forEach(function (s) {
        var ev = E.eventById(s.eid);
        if (!ev) return;
        lines.push('事件：' + ev.title);
        if (s.auto) lines.push('结果：监管抽查自动整改（¥3,000、声望 −2）');
        else if (s.picked != null && ev.options[s.picked]) {
          lines.push('回应：' + ev.options[s.picked].text);
          lines.push(s.ok ? '结果：应对得当（声望 +2）' : '结果：应对失当，合规部补救（¥2,000、声望 −1）');
        } else lines.push('结果：（未应对）');
      });
    }
    lines = lines.concat([
      '',
      '—— 结果 ——',
      '累计费用：¥' + c.fees.toLocaleString('zh-CN') + ' · 沟通天数：' + c.days + ' 天',
      '',
      '—— 过程日志 ——'
    ]).concat(c.log.map(function (l) { return '[' + l.t + '] ' + l.text; })).concat([
      '',
      '（公示期为教学化演出概念，对应现实的持续信息披露义务；注册号与编号格式为虚构。《精算工坊》生成）'
    ]);
    return lines.join('\n');
  }
  function openArchiveModal(c) {
    var html = '<h3>🗂️ 公示档案 · ' + esc(c.name) + '</h3>' +
      '<div class="memo-head">' + esc(c.pidName) + ' · ' + FE.routeName(c.route) + ' · ' + badgeHTML(c) +
      (c.regNo ? ' · 注册号 <b>' + esc(c.regNo) + '</b>' : '') + '</div>' +
      '<pre class="memo-pre">' + esc(publicationText(c)) + '</pre>' +
      '<div class="modal-actions"><button id="btn-copy-pub" class="btn-ghost">📋 复制为文本</button></div>';
    var m = R.showModal(html, { wide: true });
    m.querySelector('#btn-copy-pub').addEventListener('click', function () {
      AW.main.copyText(publicationText(c));
      R.toast('公示档案已复制到剪贴板', 'ok');
    });
  }

  AW.uiApproval = {
    render: render,
    renderP1: function () { tab = 'p1'; render(); },
    renderP2: function () { tab = 'p2'; render(); },
    renderP3: function () { tab = 'p3'; render(); },
    ledgerTab: function () { tab = 'ledger'; render(); },
    openPublishedModal: function (p) { if (deps()) openPublishedModal(p); },
    openArchiveModal: function (p) { if (deps()) openArchiveModal(p); },
    currentId: function () { return curId; }
  };
})();
