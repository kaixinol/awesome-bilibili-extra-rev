// ==UserScript==
// @name         Awesome Bilibili Extra Settings Filter
// @namespace    awesome-bilibili-extra-rev
// @version      0.5
// @description  根据样式（斜体/删除线）过滤项目列表
// @author       Kaesinol
// @match        https://github.com/kaixinol/awesome-bilibili-extra-rev*
// @run-at       document-idle
// @grant        none
// @license MIT
// ==/UserScript==
(function () {
  'use strict';

  function bindLabelClick(input) {
    const parent = input.parentElement;
    if (!parent) return;

    parent.style.cursor = 'pointer';

    parent.addEventListener('click', (e) => {
      if (e.target === input) return;
      input.checked = !input.checked;
      input.dispatchEvent(new Event('change'));
    });
  }

  function applyFilters(checkbox1, checkbox2) {
    const tables = document.querySelectorAll('markdown-accessiblity-table table');

    tables.forEach(table => {
      const rows = table.querySelectorAll('tbody tr');

      rows.forEach(row => {
        const firstCell = row.querySelector('td:first-child');
        if (!firstCell) return;

        let hide = false;

        if (checkbox1.checked && firstCell.querySelector('em')) {
          hide = true;
        }

        if (checkbox2.checked && firstCell.querySelector('del, s')) {
          hide = true;
        }

        row.style.display = hide ? 'none' : '';
      });
    });
  }

  function init() {
    const note = document.querySelector('#user-content-setting-note');
    const inputs = document.querySelectorAll('#user-content-settings input');

    if (!note || inputs.length < 2) return;

    note.textContent = '已加载过滤器✅';

    inputs.forEach(i => i.disabled = false);

    const checkbox1 = inputs[0];
    const checkbox2 = inputs[1];

    bindLabelClick(checkbox1);
    bindLabelClick(checkbox2);

    const run = () => applyFilters(checkbox1, checkbox2);

    checkbox1.addEventListener('change', run);
    checkbox2.addEventListener('change', run);

    run();
  }

  // ✅ 关键：监听 GitHub Turbo 渲染、旧版 PJAX 和 URL 变化 (popstate)
  document.addEventListener('turbo:render', init);
  document.addEventListener('pjax:end', init);
  window.addEventListener('popstate', init);

  // ✅ 初始加载
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();