// injector.js
(() => {
  'use strict';
  // すでにパッチ済みかを防ぐフラグ
  if (window.__YTHideViewsInjectorPatched__) return;
  window.__YTHideViewsInjectorPatched__ = true;

  const origAttach = Element.prototype.attachShadow;
  try {
    Element.prototype.attachShadow = function(init) {
      // 拡張機能からイベントで通知を受け取れるように、mode: 'open' を強制
      const root = origAttach.call(this, { ...init, mode: 'open' });
      // 新しいShadowRootが作られたことを示すカスタムイベントを発火
      window.dispatchEvent(new CustomEvent('__yt_hide_views_new_shadow_root', { detail: { root } }));
      return root;
    };
  } catch (e) {
    console.debug('[HideViewCounts] attachShadow patch failed:', e);
  }
})();