'use strict';

const enabledSwitch = document.getElementById('enabled-switch');

// 現在の設定を読み込み、スイッチの状態に反映
chrome.storage.sync.get({ enabled: true }, (data) => {
  enabledSwitch.checked = data.enabled;
});

// スイッチが変更されたら設定を保存
enabledSwitch.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: enabledSwitch.checked });
});