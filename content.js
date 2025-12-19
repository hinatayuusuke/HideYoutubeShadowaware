// content.js
'use strict';

const DEBUG = false;
const DEBUG_PREFIX = '[HideViewCounts][debug]';
const debugLog = (...args) => {
  if (DEBUG) console.log(DEBUG_PREFIX, ...args);
};
const textSnippet = (text) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > 160 ? `${t.slice(0, 157)}...` : t;
};
const nodeLabel = (node) => {
  if (!node) return 'null';
  if (node.nodeType === Node.DOCUMENT_NODE) return 'document';
  if (node instanceof ShadowRoot) {
    const hostLabel = node.host ? nodeLabel(node.host) : 'unknown-host';
    return `shadowRoot(${hostLabel})`;
  }
  if (!(node instanceof Element)) return String(node.nodeName || 'node');
  const id = node.id ? `#${node.id}` : '';
  let cls = '';
  if (typeof node.className === 'string' && node.className.trim()) {
    const parts = node.className.trim().split(/\s+/).slice(0, 3);
    cls = `.${parts.join('.')}`;
  }
  return `<${node.tagName.toLowerCase()}${id}${cls}>`;
};
if (DEBUG) {
  document.documentElement?.setAttribute('data-yt-hide-views-debug', '1');
}

// queueScan is invoked before initialization finishes; reuse existing implementation when reinjected.
let queueScan = window.__YTHideViewsQueueScan__ || (() => {});
const HIDE_CSS_ID = 'yt-hide-views-style';
const HIDE_CSS_RULES = `
ytd-watch-info-text #view-count,
tp-yt-paper-tooltip #tooltip {
  display: none !important;
}
`;
const ensureHideCss = () => {
  if (!ENABLED) return;
  let style = document.getElementById(HIDE_CSS_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = HIDE_CSS_ID;
    style.textContent = HIDE_CSS_RULES;
    (document.head || document.documentElement).appendChild(style);
  }
};
const removeHideCss = () => {
  const style = document.getElementById(HIDE_CSS_ID);
  if (style) style.remove();
};

// 1. injector.jsをページに注入
const s = document.createElement('script');
s.src = chrome.runtime.getURL('injector.js');
s.onload = () => s.remove();
(document.head || document.documentElement).appendChild(s);


/*** ▼ 元のスクリプトのコアロジック（設定など）はほぼそのまま流用 ▼ ***/
const MAX_NODES_PER_TICK = 200;
const VIEW_PATTERNS = [
  /\bviews?\b/i, /回視聴/, /人\s*(?:が\s*)?視聴中/, /次观看|次觀看|觀看次數|觀看次數/i,
  /회\s*시청/i, /visualiza(?:ção|ções)?/i, /\bvistas?\b|\breproducciones?\b|\bvisualizaciones?\b/i,
  /\bvues?\b/i, /\baufrufe\b/i, /просмотр/i, /\bviews\b/i
];
const EXTRA_BADGES = [/watching now/i];

const HIDDEN_NODES = new WeakSet();
const HIDDEN_OBSERVERS = new WeakMap();
const observeHiddenNode = (el) => {
  if (!DEBUG || !el || HIDDEN_OBSERVERS.has(el)) return;
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      debugLog(
        'hidden node attribute change',
        nodeLabel(el),
        m.attributeName,
        'style=',
        el.getAttribute('style'),
        'aria-hidden=',
        el.getAttribute('aria-hidden')
      );
    }
  });
  try {
    obs.observe(el, { attributes: true, attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'] });
    HIDDEN_OBSERVERS.set(el, obs);
  } catch (e) {
    debugLog('hidden observer attach failed', nodeLabel(el), e);
  }
};
/*** ▲ ここまで流用 ▲ ***/


let ENABLED = true; // デフォルトはON

// 設定をストレージから読み込む
chrome.storage.sync.get({ enabled: true }, (data) => {
  ENABLED = data.enabled;
  console.log('[HideViewCounts] Initial state:', ENABLED);
  debugLog('debug enabled');
  if (ENABLED) {
    ensureHideCss();
    queueScan(document, 'initial-enabled'); // 有効なら初期スキャン
  }
});

// 設定変更をリッスン
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.enabled) {
    ENABLED = changes.enabled.newValue;
    console.log('[HideViewCounts] State changed:', ENABLED);
    // 有効になった場合は再スキャン、無効になった場合はページをリロードして元に戻すのが手軽
    if (ENABLED) {
        ensureHideCss();
        queueScan(document, 'enabled-changed');
    } else {
        removeHideCss();
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
      debugLog('new shadow root event', nodeLabel(e.detail.root));
      queueScan(e.detail.root, 'new-shadow-root');
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
    forEachElementWithShadowRoot(document, (el) => queueScan(el.shadowRoot, 'existing-shadow-root'));
  };
  const TARGET_CONTAINERS = [
    'ytd-watch-metadata', '#info', 'ytd-video-meta-block', 'ytd-rich-item-renderer',
    'ytd-grid-video-renderer', 'ytd-compact-video-renderer', 'ytd-reel-video-renderer',
    'ytd-reel-player-overlay-renderer'
  ];
  const TARGET_CONTAINER_SELECTOR = TARGET_CONTAINERS.join(', ');
  const CANDIDATE_SELECTORS = [
    'yt-formatted-string', '#metadata-line span', '.inline-metadata-item',
    '.metadata-stats span', 'span'
  ];
  const CANDIDATE_SELECTOR = CANDIDATE_SELECTORS.join(', ');
  const PROCESSED = new WeakSet();
  const hideNode = (el, info) => {
    el.style.setProperty('display', 'none', 'important');
    el.setAttribute('aria-hidden', 'true');
    HIDDEN_NODES.add(el);
    if (DEBUG) {
      el.setAttribute('data-yt-hide-views', '1');
      debugLog('hide', nodeLabel(el), 'wasHidden=', !!info?.wasHidden, 'text=', textSnippet(info?.text || el.textContent));
      observeHiddenNode(el);
    }
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
    debugLog('scanRoot', nodeLabel(root));
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
      if (!node || PROCESSED.has(node)) {
        if (DEBUG && node instanceof Element && !HIDDEN_NODES.has(node)) {
          const t = (node.textContent || '').trim();
          if (t && looksLikeViewCount(t)) {
            debugLog('processed node now matches view count (skipped)', nodeLabel(node), 'text=', textSnippet(t));
          }
        }
        return;
      }
      PROCESSED.add(node);
      if (node.closest('ytd-thumbnail, a#thumbnail, yt-img-shadow, img') ||
          node.querySelector?.('ytd-thumbnail, a#thumbnail, yt-img-shadow, img')) {
        return;
      }
      const t = (node.textContent || '').trim();
      if (!t || !looksLikeViewCount(t)) return;
      let target = null;
      if (node.matches?.(CANDIDATE_SELECTOR)) {
        target = node;
      } else {
        target = node.querySelector?.(CANDIDATE_SELECTOR) || null;
      }
      if (!target) return;
      if (target.closest('ytd-thumbnail, a#thumbnail, yt-img-shadow, img')) return;
      const wasHidden = HIDDEN_NODES.has(target) || target.getAttribute('aria-hidden') === 'true' || target.style?.display === 'none';
      hideNode(target, { wasHidden, text: t });
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
  queueScan = (rootOrNode, reason) => {
    pending.add(rootOrNode || document);
    if (DEBUG) {
      debugLog('queueScan', nodeLabel(rootOrNode || document), reason ? `reason=${reason}` : 'reason=none');
    }
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
      if (DEBUG) {
        debugLog('flush', 'items=', items.length);
      }
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
      if (m.type === 'childList') {
        for (const n of m.addedNodes) {
          if (!(n instanceof Element)) continue;
          queueScan(n, 'mutation-added');
          if (n.shadowRoot) queueScan(n.shadowRoot, 'mutation-added-shadow');
        }
        if (DEBUG) {
          for (const n of m.removedNodes) {
            if (!(n instanceof Element)) continue;
            if (n.matches?.('[data-yt-hide-views="1"]') || n.querySelector?.('[data-yt-hide-views="1"]')) {
              debugLog('hidden node removed', nodeLabel(n));
            }
          }
        }
      } else if (m.type === 'characterData' && DEBUG) {
        const parent = m.target?.parentElement;
        if (!parent) continue;
        if (TARGET_CONTAINER_SELECTOR && !parent.closest?.(TARGET_CONTAINER_SELECTOR)) continue;
        const t = (parent.textContent || '').trim();
        if (t && looksLikeViewCount(t) && !HIDDEN_NODES.has(parent)) {
          debugLog(
            'text mutation now matches view count',
            nodeLabel(parent),
            'processed=',
            PROCESSED.has(parent),
            'text=',
            textSnippet(t)
          );
        }
      }
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: DEBUG });

  queueScan(document, 'startup');
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
