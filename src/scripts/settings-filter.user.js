// ==UserScript==
// @name         Awesome Bilibili Extra Settings Filter
// @namespace    awesome-bilibili-extra
// @version      0.2
// @description  根据样式（斜体/删除线）过滤项目列表
// @author       Kaesinol
// @match        https://github.com/kaixinol/awesome-bilibili-extra-rev
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @license MIT
// ==/UserScript==

(function () {
  'use strict';

  function applyFilters() {
    const hideInactive = GM_getValue('hide-inactive', false);
    const hideArchived = GM_getValue('hide-archived', false);

    // 更新 checkbox 状态
    const inactiveBox = document.getElementById('hide-inactive');
    const archivedBox = document.getElementById('hide-archived');
    if (inactiveBox) inactiveBox.checked = hideInactive;
    if (archivedBox) archivedBox.checked = hideArchived;

    // 获取所有表格行
    const rows = document.querySelectorAll('table tr');

    rows.forEach((row) => {
      const link = row.querySelector('td a');
      if (!link) return;

      // 检查是否包含斜体或删除线
      // GitHub Markdown: *text* -> <em>, ~~text~~ -> <del>
      const isItalic = window.getComputedStyle(link).fontStyle === 'italic' || link.closest('em') || link.querySelector('em');
      const isStrike = window.getComputedStyle(link).textDecorationLine.includes('line-through') || link.closest('del, s') || link.querySelector('del, s');

      let shouldHide = false;
      if (hideInactive && isItalic) shouldHide = true;
      if (hideArchived && isStrike) shouldHide = true;

      row.style.display = shouldHide ? 'none' : '';
    });
  }

  function attachListeners() {
    const inactiveBox = document.getElementById('hide-inactive');
    const archivedBox = document.getElementById('hide-archived');

    if (inactiveBox) {
      inactiveBox.addEventListener('change', (e) => {
        GM_setValue('hide-inactive', e.target.checked);
        applyFilters();
      });
    }

    if (archivedBox) {
      archivedBox.addEventListener('change', (e) => {
        GM_setValue('hide-archived', e.target.checked);
        applyFilters();
      });
    }
  }

  function init() {
    // 1. 更新提示文本 (如果脚本成功运行)
    const note = document.getElementById('setting-note');
    if (note) {
      note.innerText = '过滤器已成功加载 ✅';
      note.style.color = 'green';
    }

    // 2. 绑定 Checkbox 事件
    attachListeners();

    // 3. 初始化运行过滤
    applyFilters();

    // 4. 监听 DOM 变化
    new MutationObserver(() => {
        if (!document.getElementById('hide-inactive')) {
            attachListeners();
        }
        applyFilters();
    }).observe(document.body, { childList: true, subtree: true });
  }

  init();
})();
