// content.js
'use strict';

// queueScan is invoked before initialization finishes; reuse existing implementation when reinjected.
let queueScan = window.__YTHideViewsQueueScan__ || (() => {});

// 1. injector.jsをページに注入
const s = document.createElement('script');
s.src = chrome.runtime.getURL('injector.js');
s.onload = () => s.remove();
(document.head || document.documentElement).appendChild(s);


/*** ▼ 元のスクリプトのコアロジック（設定など）はほぼそのまま流用 ▼ ***/
const MAX_NODES_PER_TICK = 200;
const VIEW_PATTERNS = [
  /\bviews?\b/i, /回視聴/, /人が視聴中/, /次观看|次觀看|觀看次數|觀看次數/i,
  /회\s*시청/i, /visualiza(?:ção|ções)?/i, /\bvistas?\b|\breproducciones?\b|\bvisualizaciones?\b/i,
  /\bvues?\b/i, /\baufrufe\b/i, /просмотр/i, /\bviews\b/i
];
const EXTRA_BADGES = [/watching now/i];
/*** ▲ ここまで流用 ▲ ***/


let ENABLED = true; // デフォルトはON

// 設定をストレージから読み込む
chrome.storage.sync.get({ enabled: true }, (data) => {
  ENABLED = data.enabled;
  console.log('[HideViewCounts] Initial state:', ENABLED);
  if (ENABLED) {
    queueScan(document); // 有効なら初期スキャン
  }
});

// 設定変更をリッスン
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.enabled) {
    ENABLED = changes.enabled.newValue;
    console.log('[HideViewCounts] State changed:', ENABLED);
    // 有効になった場合は再スキャン、無効になった場合はページをリロードして元に戻すのが手軽
    if (ENABLED) {
        queueScan(document);
    } else {
        window.location.reload();
    }
  }
});


// すでにパッチ済みかを防ぐフラグ (content script用)
if (window.__YTHideViewsPatched__) { /* 何もしない */ }
else {
  window.__YTHideViewsPatched__ = true;

  // injector.jsが発火するカスタムイベントをリッスン
  window.addEventListener('__yt_hide_views_new_shadow_root', (e) => {
    if (e.detail && e.detail.root) {
      queueScan(e.detail.root);
    }
  });


  // --- ▼ 以下、元のユーザースクリプトの大部分を貼り付け ---
  // scanExistingOpenShadows, TARGET_CONTAINERS, CANDIDATE_SELECTORS,
  // PROCESSED, hideNode, looksLikeViewCount, scanRoot, pending,
  // queueScan, scheduleFlush, MutationObserver, forEachElementWithShadowRoot
  // ...
  // ただし、attachShadowのパッチ部分は injector.js に移したので削除する
  // --- ▲ ここまで ---


  // 以下に元のスクリプトから必要な関数をコピー＆ペーストします
  // ※ Element.prototype.attachShadow の書き換え部分は削除してください
  const scanExistingOpenShadows = () => {
    forEachElementWithShadowRoot(document, (el) => queueScan(el.shadowRoot));
  };
  const TARGET_CONTAINERS = [
    'ytd-watch-metadata', '#info', 'ytd-video-meta-block', 'ytd-rich-item-renderer',
    'ytd-grid-video-renderer', 'ytd-compact-video-renderer', 'ytd-reel-video-renderer',
    'ytd-reel-player-overlay-renderer'
  ];
  const CANDIDATE_SELECTORS = [
    'yt-formatted-string', '#metadata-line span', '.inline-metadata-item',
    '.metadata-stats span', 'span'
  ];
  const PROCESSED = new WeakSet();
  const hideNode = (el) => {
    el.style.setProperty('display', 'none', 'important');
    el.setAttribute('aria-hidden', 'true');
  };
  const looksLikeViewCount = (text) => {
    if (!text) return false;
    const hasNumber = /[\d０-９]+/.test(text) || /[.,\s]K|M|B|万|萬|亿|億/.test(text);
    if (!hasNumber) return false;
    for (const re of VIEW_PATTERNS) if (re.test(text)) return true;
    for (const re of EXTRA_BADGES) if (re.test(text)) return true;
    return false;
  };
  const scanRoot = (root) => {
    if (!ENABLED || !root) return;
    let processedCount = 0;
    const scopeNodes = [];
    if (root.querySelectorAll) {
      try {
        TARGET_CONTAINERS.forEach(sel => {
          root.querySelectorAll(sel).forEach(n => scopeNodes.push(n));
        });
      } catch {}
    }
    const consider = (node) => {
      if (!node || PROCESSED.has(node)) return;
      PROCESSED.add(node);
      if (node.closest('ytd-thumbnail, a#thumbnail, yt-img-shadow, img') ||
          node.querySelector?.('ytd-thumbnail, a#thumbnail, yt-img-shadow, img')) {
        return;
      }
      const t = (node.textContent || '').trim();
      if (!t || !looksLikeViewCount(t)) return;
      let target = null;
      if (node.matches?.('#metadata-line span, .inline-metadata-item, .metadata-stats span, yt-formatted-string, span')) {
        target = node;
      } else {
        target = node.querySelector?.('#metadata-line span, .inline-metadata-item, .metadata-stats span, yt-formatted-string, span') || null;
      }
      if (!target) return;
      if (target.closest('ytd-thumbnail, a#thumbnail, yt-img-shadow, img')) return;
      hideNode(target);
    };
    const walk = (ctx) => {
      for (const sel of CANDIDATE_SELECTORS) {
        let list = [];
        try { list = ctx.querySelectorAll(sel); } catch {} 
        for (const el of list) {
          consider(el);
          if (++processedCount >= MAX_NODES_PER_TICK) return true;
        }
      }
      return false;
    };
    for (const scope of scopeNodes) {
      if (walk(scope)) return;
      if (scope.shadowRoot) {
        if (walk(scope.shadowRoot)) return;
      }
    }
    if (scopeNodes.length === 0) walk(root);
  };
  const pending = new Set();
  queueScan = (rootOrNode) => {
    pending.add(rootOrNode || document);
    scheduleFlush();
  };
  let flushScheduled = false;
  const scheduleFlush = () => {
    if (flushScheduled) return;
    flushScheduled = true;
    const runner = () => {
      flushScheduled = false;
      const items = Array.from(pending);
      pending.clear();
      for (const node of items) {
        const root = node.nodeType === Node.DOCUMENT_NODE ? node : (node.shadowRoot || node);
        scanRoot(root || document);
      }
    };
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(runner, { timeout: 200 });
    } else if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(runner);
    } else {
      setTimeout(runner, 16);
    }
  };
  window.__YTHideViewsQueueScan__ = queueScan;

  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (!(n instanceof Element)) continue;
        queueScan(n);
        if (n.shadowRoot) queueScan(n.shadowRoot);
      }
    }
  }).observe(document.documentElement, { subtree: true, childList: true });

  queueScan(document);
  scanExistingOpenShadows();

  function forEachElementWithShadowRoot(root, cb) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    let el = walker.currentNode;
    while (el) {
      if (el.shadowRoot) cb(el);
      el = walker.nextNode();
    }
  }
} // end of __YTHideViewsPatched__ check
