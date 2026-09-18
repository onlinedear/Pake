// Rooter 内网文档链接 -> 外网链接 自动重写
(function () {
  'use strict';

  // 域名映射表：内网域名 -> 外网域名
  var DOMAIN_MAP = {
    'rooter.mcd.ai': 'rooter.mcdonalds.cn'
  };

  function rewrite(url) {
    if (!url) return url;
    try {
      var u = new URL(url, window.location.href);
      var mapped = DOMAIN_MAP[u.hostname];
      if (mapped) {
        u.hostname = mapped;
        return u.href;
      }
    } catch (e) {
      /* 非法 URL，保持原样 */
    }
    return url;
  }

  function rewriteAnchors(root) {
    var anchors = (root || document).querySelectorAll('a[href]');
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var original = a.getAttribute('href');
      var rewritten = rewrite(original);
      if (rewritten !== original) {
        a.setAttribute('href', rewritten);
      }
    }
  }

  // 点击兜底：即使链接是动态拼接、href 属性没被提前改到，也在点击瞬间改写
  document.addEventListener(
    'click',
    function (e) {
      var target = e.target;
      var a = target && target.closest ? target.closest('a[href]') : null;
      if (!a) return;
      var original = a.getAttribute('href');
      var rewritten = rewrite(original);
      if (rewritten !== original) {
        a.setAttribute('href', rewritten);
      }
    },
    true
  );

  // 初始改写
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      rewriteAnchors(document);
    });
  } else {
    rewriteAnchors(document);
  }

  // 监听动态渲染的链接
  var timer = null;
  var observer = new MutationObserver(function () {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      rewriteAnchors(document);
    }, 300);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href']
  });
})();

// ==== Rooter 本地优先助手（合并注入）====

// ============================================================================
// Rooter 本地优先助手 — 注入脚本 (custom.js)
// ----------------------------------------------------------------------------
// 用途：
//   1) 直接放进 Pake 仓库 src-tauri/src/inject/custom.js —— 编译后即真注入脚本
//   2) 也能在浏览器 DevTools Console 里粘贴运行，对着 Rooter 页面调试交互
//
// 现阶段定位（fake）：UI 与交互逻辑全真；"操作本机"的调用为占位，
//   检测到不在 Tauri 环境时走演示分支，不真执行。等桥打通后把占位换成
//   真的 window.__TAURI__.core.invoke('fs_*', ...) 即可，UI 一行不用改。
//
// 依赖：无。纯原生 JS + CSS，不引入任何库。
// ============================================================================
(function () {
  'use strict';

  // 防重复注入
  if (window.__ROOTER_LOCAL_ASSIST__) return;
  window.__ROOTER_LOCAL_ASSIST__ = true;

  // --------------------------------------------------------------------------
  // 环境判定：是否跑在 Pake/Tauri 里（决定"操作本机"是真调用还是占位演示）
  // --------------------------------------------------------------------------
  const IN_TAURI = !!(window.__TAURI__ && window.__TAURI__.core);
  function invoke(cmd, args) {
    if (IN_TAURI) return window.__TAURI__.core.invoke(cmd, args);
    // 浏览器调试：占位，返回演示数据
    console.log('[本地助手·演示] 将调用', cmd, args);
    return Promise.resolve({ __demo: true, cmd, args });
  }

  // --------------------------------------------------------------------------
  // 状态（会话级；不跨会话记忆放权 —— 每次新加载默认最保守档）
  // --------------------------------------------------------------------------
  const STATE = {
    tier: 'ask',          // ask | agentic | autonomous，默认最保守
    localProject: null,   // 选中的本机文件夹；null = 未选，此时锁死 ask 档
  };

  // --------------------------------------------------------------------------
  // 本地项目跨页持久化（方式 1）
  //   发消息后 Rooter 跳到 /ai-chat?chatId=xxx，脚本全局注入、SPA 不重载，
  //   但为稳妥仍把本地项目存进 localStorage，切页/刷新后读回，工具栏继续显示。
  //   两份 key：全局一份作默认回退，另按 chatId 一份（一个会话绑一个本地项目）。
  //   注意：路径属本机状态，只落 localStorage、绝不写进云端 URL（避免泄露目录结构）。
  // --------------------------------------------------------------------------
  const LP_KEY = 'rla:localProject';
  function currentChatId() {
    try { return new URLSearchParams(location.search).get('chatId') || ''; }
    catch (e) { return ''; }
  }
  function lpKeyForChat() {
    const id = currentChatId();
    return id ? LP_KEY + ':' + id : '';
  }
  function saveLocalProject(folder) {
    try {
      const val = folder ? JSON.stringify(folder) : '';
      // 全局默认
      if (val) localStorage.setItem(LP_KEY, val); else localStorage.removeItem(LP_KEY);
      // 按会话
      const ck = lpKeyForChat();
      if (ck) { if (val) localStorage.setItem(ck, val); else localStorage.removeItem(ck); }
    } catch (e) { /* 隐私模式等，忽略 */ }
  }
  function loadLocalProject() {
    try {
      const ck = lpKeyForChat();
      const raw = (ck && localStorage.getItem(ck)) || localStorage.getItem(LP_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // 最近选过的本地文件夹（真环境下拉列表数据来源，取代假的 DEMO_FOLDERS）
  const RECENT_KEY = 'rla:recentFolders';
  function recentFolders() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function addRecentFolder(folder) {
    if (!folder || !folder.path) return;
    try {
      let list = recentFolders().filter((f) => f.path !== folder.path);
      list.unshift({ path: folder.path, name: folder.name || folder.path });
      list = list.slice(0, 8);   // 最多留 8 个
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch (e) { /* 忽略 */ }
  }

  const TIERS = {
    ask: {
      icon: 'hand',
      name: '请求批准',
      desc: '工作区内自由读写；越界写入、危险命令及电脑操控首次操作每个应用都需确认',
    },
    agentic: {
      icon: 'eye',
      name: '替我审批',
      desc: '越界操作交 AI 审核；电脑操控先确认本任务，再自动放行已识别的普通应用，浏览器、通讯和未知应用仍问你。可能误判',
    },
    autonomous: {
      icon: 'alert',
      name: '完全自主',
      desc: '电脑操控先确认本任务，再自动执行已识别的普通操作；浏览器、通讯和未知应用仍问你，系统红线始终禁止',
    },
  };

  // --------------------------------------------------------------------------
  // 内联 SVG 图标（tabler 风格线性描边，跟 Rooter 原生一致；跟随 currentColor）
  // --------------------------------------------------------------------------
  function svg(paths, size) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size||16}" height="${size||16}" `
      + `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" `
      + `stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto">${paths}</svg>`;
  }
  const ICONS = {
    // 文件夹（与 Rooter 原生"选择项目"完全同款 tabler-icon-folder）
    folder: svg('<path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2"/>'),
    hand: svg('<path d="M8 13v-8.5a1.5 1.5 0 0 1 3 0v7.5"/><path d="M11 11.5v-2a1.5 1.5 0 0 1 3 0v2.5"/><path d="M14 10.5a1.5 1.5 0 0 1 3 0v1.5"/><path d="M17 11.5a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1 -6 6h-2c-2.7 0 -3.5 -1 -4.5 -2l-4.5 -6c-.5 -.7 -.5 -1.8 .5 -2.3s2 -.3 2.7 .5l1.3 1.6"/>'),
    eye: svg('<path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6"/>'),
    alert: svg('<path d="M12 9v4"/><path d="M10.36 3.9l-8.28 14a1.9 1.9 0 0 0 1.64 2.85h16.56a1.9 1.9 0 0 0 1.64 -2.85l-8.28 -14a1.9 1.9 0 0 0 -3.28 0"/><path d="M12 16h.01"/>'),
    caret: svg('<path d="M6 9l6 6l6 -6"/>', 14),
    cloud: svg('<path d="M6.657 18c-2.572 0 -4.657 -2.007 -4.657 -4.483c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.486c0 1.927 -1.551 3.487 -3.465 3.487h-11.878"/>'),
    computer: svg('<path d="M3 4m0 1a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1z"/><path d="M7 20h10"/><path d="M9 16v4"/><path d="M15 16v4"/>'),
    plus: svg('<path d="M12 5v14"/><path d="M5 12h14"/>', 15),
  };

  // 演示用的假本机文件夹
  const DEMO_FOLDERS = [
    { path: '~/Desktop/报告', name: '桌面 / 报告' },
    { path: '~/Downloads', name: '下载' },
    { path: '~/Documents/Work', name: '文稿 / Work' },
  ];

  // --------------------------------------------------------------------------
  // 样式（跟随明暗；不硬编码单边前景/背景色）
  // --------------------------------------------------------------------------
  const css = `
  .rla-chip{display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 8px;
    border-radius:8px;border:none;background:transparent;cursor:pointer;font-size:13px;
    color:inherit;user-select:none;white-space:nowrap;transition:background .15s}
  .rla-chip:hover{background:var(--rla-chip-hover,rgba(128,128,128,.12))}
  .rla-chip[disabled]{opacity:.45;cursor:not-allowed}
  .rla-chip .rla-caret{opacity:.6}
  .rla-tier-ask{color:#16a34a}
  .rla-tier-agentic{color:#2563eb}
  .rla-tier-autonomous{color:#dc2626}

  .rla-pop{position:fixed;z-index:2147483000;min-width:220px;max-width:320px;
    border-radius:14px;padding:8px;box-shadow:0 12px 40px rgba(0,0,0,.28);
    background:var(--rla-pop-bg,#1f1f22);color:var(--rla-pop-fg,#f2f2f2);
    border:1px solid rgba(128,128,128,.25)}
  @media (prefers-color-scheme: light){
    .rla-pop{background:#fff;color:#1a1a1a}
  }
  .rla-opt{display:flex;gap:10px;padding:11px 12px;border-radius:10px;cursor:pointer}
  .rla-opt:hover{background:rgba(128,128,128,.14)}
  .rla-opt[aria-selected="true"]{background:rgba(128,128,128,.20)}
  .rla-opt[data-disabled="true"]{opacity:.4;cursor:not-allowed}
  .rla-opt .ic{line-height:1.2;flex:0 0 auto;opacity:.85}
  .rla-opt .tt{font-weight:600;font-size:13.5px;margin-bottom:3px}
  /* 紧凑单行（仿 Rooter 原生"选择项目"下拉）：小图标 + 一行文字 */
  .rla-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;
    cursor:pointer;font-size:13px}
  .rla-row:hover{background:rgba(128,128,128,.12)}
  .rla-row[aria-selected="true"]{background:rgba(128,128,128,.16)}
  .rla-row .ic{flex:0 0 auto;opacity:.75;display:inline-flex}
  .rla-row .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rla-sep{height:1px;margin:6px 4px;background:rgba(128,128,128,.2)}
  .rla-hd{padding:6px 10px 2px;font-size:12px;opacity:.55}
  .rla-opt .dd{font-size:11.5px;opacity:.65;line-height:1.5}

  .rla-mask{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.4);
    display:flex;align-items:center;justify-content:center}
  .rla-card{width:380px;max-width:88vw;border-radius:16px;padding:22px;
    background:var(--rla-pop-bg,#1f1f22);color:var(--rla-pop-fg,#f2f2f2);
    box-shadow:0 20px 60px rgba(0,0,0,.4)}
  @media (prefers-color-scheme: light){ .rla-card{background:#fff;color:#1a1a1a} }
  .rla-card h3{margin:0 0 10px;font-size:16px}
  .rla-card p{margin:0 0 18px;font-size:13px;opacity:.8;line-height:1.6}
  .rla-card .row{display:flex;justify-content:flex-end;gap:10px}
  .rla-btn{height:34px;padding:0 16px;border-radius:9px;border:1px solid rgba(128,128,128,.3);
    background:transparent;color:inherit;cursor:pointer;font-size:13px}
  .rla-btn.primary{background:#dc2626;border-color:#dc2626;color:#fff}
  .rla-btn.safe{background:#2563eb;border-color:#2563eb;color:#fff}
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // --------------------------------------------------------------------------
  // 通用弹出层
  // --------------------------------------------------------------------------
  function popupNear(anchorEl, contentEl) {
    closeAnyPop();
    const pop = document.createElement('div');
    pop.className = 'rla-pop';
    pop.appendChild(contentEl);
    document.body.appendChild(pop);
    const r = anchorEl.getBoundingClientRect();
    // 优先显示在锚点上方（输入框在底部）
    const top = r.top - pop.offsetHeight - 8;
    pop.style.left = Math.max(8, r.left) + 'px';
    pop.style.top = (top > 8 ? top : r.bottom + 8) + 'px';
    window.__rlaPop = pop;
    setTimeout(() => document.addEventListener('mousedown', outsideClose), 0);
    function outsideClose(e) {
      if (!pop.contains(e.target) && e.target !== anchorEl) closeAnyPop();
    }
    pop.__outsideClose = outsideClose;
    return pop;
  }
  function closeAnyPop() {
    if (window.__rlaPop) {
      document.removeEventListener('mousedown', window.__rlaPop.__outsideClose);
      window.__rlaPop.remove();
      window.__rlaPop = null;
    }
  }

  // --------------------------------------------------------------------------
  // 三档选择器
  // --------------------------------------------------------------------------
  function renderTierChip() {
    const t = TIERS[STATE.tier];
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'rla-chip rla-tier-' + STATE.tier;
    chip.dataset.rla = 'tier-chip';
    chip.innerHTML = `${ICONS[t.icon]}<span>${t.name}</span>${ICONS.caret}`;
    chip.onclick = (e) => { e.stopPropagation(); openTierMenu(chip); };
    return chip;
  }

  function openTierMenu(anchor) {
    const box = document.createElement('div');
    const noProject = !STATE.localProject;
    Object.keys(TIERS).forEach((key) => {
      const t = TIERS[key];
      // 未选本地项目：只有 ask 可用，其余置灰
      const disabled = noProject && key !== 'ask';
      const opt = document.createElement('div');
      opt.className = 'rla-opt';
      opt.setAttribute('aria-selected', String(key === STATE.tier));
      opt.dataset.disabled = String(disabled);
      opt.title = disabled ? '先选择一个本地项目，才能开放更高权限' : '';
      opt.innerHTML = `<div class="ic">${ICONS[t.icon]}</div><div><div class="tt">${t.name}</div><div class="dd">${t.desc}</div></div>`;
      opt.onclick = () => {
        if (disabled) return;
        selectTier(key, anchor);
      };
      box.appendChild(opt);
    });
    popupNear(anchor, box);
  }

  function selectTier(key, anchor) {
    // 升到"完全自主"弹一次二次确认；降档不弹
    const order = { ask: 0, agentic: 1, autonomous: 2 };
    const isUpgradeToTop = key === 'autonomous' && order[key] > order[STATE.tier];
    const commit = () => {
      STATE.tier = key;
      closeAnyPop();
      refreshTierChip();
    };
    if (isUpgradeToTop) {
      confirmDialog(
        '开启完全自主？',
        '完全自主档下，AI 会自动执行已识别的普通操作，不再每步问你。系统红线始终禁止。确定开启？',
        '我确定', 'primary', commit
      );
    } else {
      commit();
    }
  }

  function refreshTierChip() {
    const old = document.querySelector('[data-rla="tier-chip"]');
    if (old) old.replaceWith(renderTierChip());
    refreshTierLock();
  }

  // 未选本地项目时，把三档 chip 锁死在 ask 并可点开看提示（选项内置灰）
  function refreshTierLock() {
    // ask 档在无项目时仍可点开（让用户看到"去选项目"的引导），故不整体 disabled
  }

  // --------------------------------------------------------------------------
  // 本地项目入口 —— 复用 Rooter 原生"选择项目"按钮的结构与图标，放在其左边
  //   同款 class（_projectButton_ / _projectName_）+ 同款 folder SVG，文字="本地项目"
  //   加 data-rla 便于识别与重挂判定。
  // --------------------------------------------------------------------------
  function nativeProjectButtonClass() {
    // 取真实按钮的 class 以完全同款（哈希会变，故运行时读取）；读不到用兜底
    const real = document.querySelector('button[class*="_projectButton_"]');
    return real ? real.className : '_projectButton_pbxck_38';
  }
  function nativeNameClass() {
    const real = document.querySelector('span[class*="_projectName_"]');
    return real ? real.className : '_projectName_pbxck_64';
  }

  function renderProjectChip() {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = nativeProjectButtonClass();   // 与原生"选择项目"完全同款
    chip.dataset.rla = 'project-chip';
    chip.setAttribute('aria-label', '本地项目');
    chip.setAttribute('aria-haspopup', 'dialog');
    const label = STATE.localProject ? STATE.localProject.name : '本地项目';
    chip.innerHTML = `${ICONS.folder}<span class="${nativeNameClass()}">${label}</span>`;
    chip.onclick = (e) => { e.stopPropagation(); openProjectMenu(chip); };
    return chip;
  }

  function openProjectMenu(anchor) {
    const box = document.createElement('div');
    const head = document.createElement('div');
    head.className = 'rla-hd';
    head.textContent = IN_TAURI ? '最近的本地文件夹' : '本地文件夹（演示）';
    box.appendChild(head);

    // 真环境：列最近选过的文件夹；浏览器：列演示假数据
    const folders = IN_TAURI ? recentFolders() : DEMO_FOLDERS;

    if (folders.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'rla-row';
      empty.style.opacity = '.55';
      empty.innerHTML = `<span class="ic">${ICONS.folder}</span><span class="nm">还没有，点下方添加</span>`;
      box.appendChild(empty);
    }

    folders.forEach((f) => {
      const row = document.createElement('div');
      row.className = 'rla-row';
      row.title = f.path;   // 路径改到悬浮提示，行内只留名字（仿原生）
      row.setAttribute('aria-selected', String(STATE.localProject && STATE.localProject.path === f.path));
      row.innerHTML = `<span class="ic">${ICONS.folder}</span><span class="nm">${f.name}</span>`;
      row.onclick = () => { pickProject(f); };
      box.appendChild(row);
    });

    const sep = document.createElement('div');
    sep.className = 'rla-sep';
    box.appendChild(sep);

    const add = document.createElement('div');
    add.className = 'rla-row';
    add.title = IN_TAURI ? '打开系统选择器' : '（演示）添加一个假文件夹';
    add.innerHTML = `<span class="ic">${ICONS.plus}</span><span class="nm">添加本地文件夹…</span>`;
    add.onclick = async () => {
      if (IN_TAURI) {
        // 真环境：弹原生系统选择器，返回 {path, name}
        try {
          const picked = await invoke('pick_directory', {});
          if (picked && picked.path) {
            const folder = { path: picked.path, name: picked.name || picked.path };
            addRecentFolder(folder);
            pickProject(folder);
          }
          // 用户取消（path 为空）：什么都不做
        } catch (e) {
          console.error('[本地助手] 选择目录失败：', e);
          confirmDialog('无法选择目录', String(e && e.message || e), '知道了', 'safe', null);
        }
      } else {
        // 浏览器演示：加一个假的
        pickProject({ path: '~/NewFolder-' + Date.now(), name: '新文件夹（演示）' });
      }
    };
    box.appendChild(add);

    if (STATE.localProject) {
      const clear = document.createElement('div');
      clear.className = 'rla-row';
      clear.title = '回到纯云端对话，权限锁回"请求批准"';
      clear.innerHTML = `<span class="ic" style="opacity:.55">${ICONS.plus}</span><span class="nm">取消选择</span>`;
      clear.onclick = () => { pickProject(null); };
      box.appendChild(clear);
    }

    popupNear(anchor, box);
  }

  function pickProject(folder) {
    STATE.localProject = folder;
    saveLocalProject(folder);   // 跨页持久化
    // 取消本地项目时，权限强制降回最保守档
    if (!folder) STATE.tier = 'ask';
    closeAnyPop();
    const old = document.querySelector('[data-rla="project-chip"]');
    if (old) old.replaceWith(renderProjectChip());
    refreshTierChip();
  }

  // --------------------------------------------------------------------------
  // 审批弹窗（危险操作时弹；这里提供通用确认框，也用于二次确认）
  // --------------------------------------------------------------------------
  function confirmDialog(title, body, okText, okClass, onOk) {
    const mask = document.createElement('div');
    mask.className = 'rla-mask';
    mask.innerHTML = `<div class="rla-card">
      <h3>${title}</h3><p>${body}</p>
      <div class="row">
        <button class="rla-btn" data-act="cancel">取消</button>
        <button class="rla-btn ${okClass || 'safe'}" data-act="ok">${okText || '确定'}</button>
      </div></div>`;
    document.body.appendChild(mask);
    mask.querySelector('[data-act="cancel"]').onclick = () => mask.remove();
    mask.querySelector('[data-act="ok"]').onclick = () => { mask.remove(); onOk && onOk(); };
    mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
  }

  // 演示：模拟一次"AI 想越界写文件"触发的审批
  window.__rlaDemoApproval = function () {
    confirmDialog(
      '需要你批准',
      'AI 想写入工作区以外的文件：<br><code>~/Desktop/外部报告.xlsx</code><br>当前档位"请求批准"，越界写入需你确认。',
      '允许本次', 'safe',
      () => confirmDialog('已允许', '（演示）这里会真正执行写入。', '好', 'safe', null)
    );
  };

  // --------------------------------------------------------------------------
  // 挂载：锚点来自真机探测（Rooter = Mantine + CSS Modules）
  //   模型选择器：button[aria-label^="模型"]（稳）或 ._modelTrigger_*（哈希，会随版本变）
  //   选择项目栏：._projectBar_*（本地项目 chip 并进这里）
  //   哈希 class 每次构建可能变，所以一律"aria-label 优先，class 前缀兜底"。
  // --------------------------------------------------------------------------
  function findModelTrigger() {
    return document.querySelector('button[aria-label^="模型"]') ||
           document.querySelector('button[class*="_modelTrigger_"]');
  }
  function findProjectBar() {
    const projBtn = document.querySelector('button[aria-label="选择项目"]') ||
                    document.querySelector('button[class*="_projectButton_"]');
    return projBtn ? projBtn.parentElement : null;   // _projectBar_*
  }

  // 路 B：把 Rooter 原生"选择项目"按钮的【可见文字】改成"云端项目"。
  //   只改 span 的文字，不动 aria-label（定位仍靠 aria-label="选择项目"）；
  //   仅当当前显示"选择项目"时改（选中某云端项目后显示项目名，此时不动）。
  //   由 observer + 轮询反复调用，压住 React 重渲染带来的回跳。
  function renameCloudProject() {
    const btn = document.querySelector('button[aria-label="选择项目"]:not([data-rla])');
    if (!btn) return;
    const nameSpan = btn.querySelector('span[class*="_projectName_"]') ||
                     btn.querySelector('span');
    if (nameSpan && nameSpan.textContent.trim() === '选择项目') {
      nameSpan.textContent = '云端项目';
    }
  }

  // 兜底：锚点找不到时，把 chip 收进右下角一个浮动条
  function floatFallback(chip) {
    let bar = document.querySelector('[data-rla="floatbar"]');
    if (!bar) {
      bar = document.createElement('div');
      bar.dataset.rla = 'floatbar';
      bar.style.cssText =
        'display:flex;gap:8px;align-items:center;position:fixed;right:16px;bottom:16px;' +
        'z-index:2147482000;padding:8px;border-radius:12px;' +
        'background:var(--rla-chip-bg,rgba(128,128,128,.12));backdrop-filter:blur(6px)';
      document.body.appendChild(bar);
    }
    bar.appendChild(chip);
  }

  function mount() {
    // 只在聊天页挂载：聊天页才有输入框 textarea._inputTextarea_；
    // 登录页/其他页没有，避免 chip 飘到登录页右下角。
    const composer = document.querySelector('textarea[class*="_inputTextarea_"]');
    if (!composer) {
      // 不是聊天页：清掉可能残留的 chip 和浮动条
      document.querySelectorAll('[data-rla="tier-chip"],[data-rla="project-chip"],[data-rla="floatbar"]')
        .forEach((el) => el.remove());
      return false;
    }
    if (document.querySelector('[data-rla="tier-chip"]')) return true; // 已挂

    const modelTrigger = findModelTrigger();
    const projectBar = findProjectBar();

    // 三档 chip → 插到模型选择器左边（同一行工具条内）
    if (modelTrigger && modelTrigger.parentElement) {
      const tierChip = renderTierChip();
      tierChip.style.marginRight = '8px';
      modelTrigger.parentElement.insertBefore(tierChip, modelTrigger);
    } else {
      floatFallback(renderTierChip());   // 找不到就右下角浮动兜底
    }

    // 本地项目 chip → 放到"选择项目"按钮前面（_projectBar 的最前）
    if (projectBar) {
      const nativeProjBtn = projectBar.querySelector('button[aria-label="选择项目"]')
        || projectBar.querySelector('button[class*="_projectButton_"]:not([data-rla])')
        || projectBar.firstChild;
      projectBar.insertBefore(renderProjectChip(), nativeProjBtn);
    } else if (modelTrigger && modelTrigger.parentElement) {
      const p = renderProjectChip();
      p.style.marginRight = '8px';
      modelTrigger.parentElement.insertBefore(p, modelTrigger);
    } else {
      floatFallback(renderProjectChip());
    }
    return true;
  }

  // Rooter 是 SPA，DOM 会重建；用轮询+observer 兜底保证 chip 常驻
  // 跨页恢复：chatId 变化或本地项目未加载时，从 localStorage 读回并刷新 chip
  let _lastChatId = null;
  function syncLocalProjectFromStore() {
    const id = currentChatId();
    const chatChanged = id !== _lastChatId;
    // 首页(无 chatId)选好项目 → 发消息跳到 /ai-chat?chatId=xxx：
    //   此时该 chatId 还没绑定，用全局默认(loadLocalProject 已回退到 LP_KEY)恢复，
    //   并顺手把它绑定到这个新 chatId 上。
    if (chatChanged) {
      const restored = loadLocalProject();
      if (restored && (!STATE.localProject || STATE.localProject.path !== restored.path)) {
        STATE.localProject = restored;
      }
      // 把当前选中绑定到这个 chatId（若有）
      if (STATE.localProject && id) saveLocalProject(STATE.localProject);
      _lastChatId = id;
      // 刷新已存在的 chip 文字
      const old = document.querySelector('[data-rla="project-chip"]');
      if (old) old.replaceWith(renderProjectChip());
      refreshTierChip();
    }
  }

  // ==========================================================================
  // 输入框拦截层：@file:<路径> —— 发送前把本机文件内容读出来拼进消息
  //   触发：手动前缀 @file:（不自动扫描，避免误伤 + 便于法务交代）
  //   读取：走 fs_read（2MB 上限、只读文本、路径红线；浏览器演示环境为占位）
  //   例：  @file:/Users/me/report.txt 帮我总结
  //     → 【本地文件 report.txt】\n<内容>\n【文件结束】 帮我总结
  // ==========================================================================
  const FILE_TOKEN_RE = /@file:\s*("([^"]+)"|'([^']+)'|(\S+))/g;
  let _rlaExpanding = false;   // 防止重写后重新提交时二次拦截

  function findComposer() {
    return document.querySelector('textarea')
      || document.querySelector('[contenteditable="true"]')
      || document.querySelector('[role="textbox"]');
  }
  function readComposerText(el) {
    if (!el) return '';
    return ('value' in el && el.value != null) ? el.value : (el.textContent || '');
  }
  // React 受控组件：必须用原生 setter + 派发 input 事件，否则 React 不认新值
  function setComposerText(el, text) {
    if (!el) return;
    if ('value' in el) {
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
  }
  async function expandFileTokens(text) {
    const tokens = [];
    let m;
    FILE_TOKEN_RE.lastIndex = 0;
    while ((m = FILE_TOKEN_RE.exec(text)) !== null) {
      tokens.push({ raw: m[0], path: m[2] || m[3] || m[4] });
    }
    if (tokens.length === 0) return { text, changed: false, errors: [] };
    const errors = [];
    let result = text;
    for (const t of tokens) {
      const name = t.path.split('/').pop() || t.path;
      let block;
      if (IN_TAURI) {
        try {
          const content = await invoke('fs_read', { path: t.path });
          block = `【本地文件 ${name}】\n${content}\n【文件结束】`;
        } catch (e) {
          errors.push(`${name}: ${e && e.message ? e.message : e}`);
          continue;
        }
      } else {
        block = `【本地文件 ${name}（演示环境未真实读取）】`;
      }
      result = result.replace(t.raw, block);
    }
    return { text: result, changed: errors.length < tokens.length, errors };
  }
  async function interceptSubmit(el, resend) {
    const original = readComposerText(el);
    if (!/@file:/.test(original)) return false;
    const { text, errors } = await expandFileTokens(original);
    if (errors.length) {
      confirmDialog(
        '部分本地文件未能读取',
        errors.join('；') + '。已读取的仍会带上，未读取的保留原样。',
        '继续发送', 'safe',
        () => { _rlaExpanding = true; setComposerText(el, text); setTimeout(() => { resend(); _rlaExpanding = false; }, 30); }
      );
      return true;
    }
    _rlaExpanding = true;
    setComposerText(el, text);
    setTimeout(() => { resend(); _rlaExpanding = false; }, 30);
    return true;
  }
  function installComposerInterceptor() {
    if (window.__rlaComposerHooked) return;
    window.__rlaComposerHooked = true;
    document.addEventListener('keydown', (e) => {
      if (_rlaExpanding) return;
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      const el = e.target;
      const isComposer = el && (el.tagName === 'TEXTAREA'
        || (el.getAttribute && el.getAttribute('contenteditable') === 'true')
        || (el.getAttribute && el.getAttribute('role') === 'textbox'));
      if (!isComposer) return;
      if (!/@file:/.test(readComposerText(el))) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const resend = () => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      };
      interceptSubmit(el, resend);
    }, true);
    document.addEventListener('click', (e) => {
      if (_rlaExpanding) return;
      const btn = e.target.closest
        ? e.target.closest('button[type="submit"], button[aria-label*="发送"], button[class*="send"], button[class*="_send"]')
        : null;
      if (!btn) return;
      const el = findComposer();
      if (!el || !/@file:/.test(readComposerText(el))) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const resend = () => btn.click();
      interceptSubmit(el, resend);
    }, true);
    console.log('[本地助手] 输入框拦截层就绪：用 @file:<路径> 附带本机文件内容');
  }

  // --------------------------------------------------------------------------
  // 诊断浮层：一加载就在右下角显示脚本真实状态（不用开控制台）
  //   显示：脚本版本 / IN_TAURI / 输入框找到否 / 发送按钮找到否 / 拦截装否
  //   点右上角 × 可关闭；仅用于调试期定位问题。
  // --------------------------------------------------------------------------
  const RLA_VERSION = 'diag-1';
  function renderDiag() {
    let d = document.getElementById('rla-diag');
    if (!d) {
      d = document.createElement('div');
      d.id = 'rla-diag';
      d.style.cssText =
        'position:fixed;left:12px;bottom:12px;z-index:2147483000;' +
        'font:11px/1.5 -apple-system,monospace;color:#0f0;background:rgba(0,0,0,.82);' +
        'padding:8px 10px;border-radius:8px;max-width:360px;white-space:pre-wrap;' +
        'box-shadow:0 2px 12px rgba(0,0,0,.3)';
      document.body.appendChild(d);
    }
    const ta = document.querySelector('textarea[class*="_inputTextarea_"]') || document.querySelector('textarea');
    const send = document.querySelector('button[aria-label="发送"]') || document.querySelector('button[class*="_sendBtn_"]');
    d.textContent =
      `[本地助手 ${RLA_VERSION}]\n` +
      `IN_TAURI=${IN_TAURI}  拦截=${!!window.__rlaComposerHooked}\n` +
      `输入框=${ta ? 'OK' : '无'}  发送按钮=${send ? 'OK' : '无'}\n` +
      `本地项目=${STATE.localProject ? STATE.localProject.name : '未选'}\n` +
      `点这里发我截图 · 双击隐藏`;
    d.ondblclick = () => d.remove();
  }

  function ensureMounted() {
    try { syncLocalProjectFromStore(); mount(); renameCloudProject(); installComposerInterceptor(); renderDiag(); }
    catch (e) { /* noop */ }
  }
  // 启动即先恢复一次（脚本首次注入时可能已在会话页）
  try { const r = loadLocalProject(); if (r) STATE.localProject = r; } catch (e) {}
  ensureMounted();
  const mo = new MutationObserver(() => ensureMounted());
  mo.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(ensureMounted, 2000);

  // 暴露给控制台手动测试
  window.__rlaState = STATE;
  console.log('[Rooter 本地助手] 注入就绪。IN_TAURI=', IN_TAURI,
    '。控制台可调 window.__rlaDemoApproval() 看审批弹窗。');
})();
