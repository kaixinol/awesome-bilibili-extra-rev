// ==UserScript==
// @name         Awesome Bilibili Extra Settings Filter
// @namespace    awesome-bilibili-extra-rev
// @version      0.7
// @description  根据样式（斜体/删除线）过滤项目列表
// @author       Kaesinol
// @match        https://github.com/kaixinol/awesome-bilibili-extra-rev*
// @run-at       document-idle
// @grant        none
// @license MIT
// ==/UserScript==

(() => {
  'use strict';

  const ARTICLE_SELECTOR = 'article.markdown-body.entry-content.container-lg';
  const observers = new WeakMap();
  let bodyObserver = null;

  function bindLabelClick(input) {
    const parent = input.parentElement;
    if (!parent || parent.dataset.abfClickBound) return;

    parent.dataset.abfClickBound = '1';
    parent.style.cursor = 'pointer';

    parent.addEventListener('click', (e) => {
      if (e.target === input) return;
      input.checked = !input.checked;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  function applyFilters(article, italicBox, strikeBox) {
    article
      .querySelectorAll('markdown-accessiblity-table table, markdown-accessibility-table table')
      .forEach((table) => {
        table.querySelectorAll('tbody tr').forEach((row) => {
          const firstCell = row.querySelector('td:first-child');
          if (!firstCell) return;

          const hide =
            (italicBox.checked && firstCell.querySelector('em')) ||
            (strikeBox.checked && firstCell.querySelector('del, s'));

          row.style.display = hide ? 'none' : '';
        });
      });
  }

  function initArticle(article) {
    if (article.dataset.abfInit) return;

    const note = article.querySelector('#user-content-setting-note');
    const inputs = article.querySelectorAll('#user-content-settings input');
    if (!note || inputs.length < 2) return;

    article.dataset.abfInit = '1';

    note.textContent = '已加载过滤器✅';
    inputs.forEach((i) => (i.disabled = false));

    const [italicBox, strikeBox] = inputs;
    bindLabelClick(italicBox);
    bindLabelClick(strikeBox);

    const run = () => applyFilters(article, italicBox, strikeBox);

    italicBox.addEventListener('change', run);
    strikeBox.addEventListener('change', run);

    run();

    const mo = new MutationObserver(run);
    mo.observe(article, { childList: true, subtree: true });
    observers.set(article, mo);
  }

  function scan() {
    document.querySelectorAll(ARTICLE_SELECTOR).forEach(initArticle);
  }

  function start() {
    scan();

    if (bodyObserver) return;
    bodyObserver = new MutationObserver(scan);
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('turbo:render', start);
  document.addEventListener('pjax:end', start);
  window.addEventListener('popstate', start);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
