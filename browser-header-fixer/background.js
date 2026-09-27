/**
 * Service Worker
 * 负责：
 * 1. 启动时把已存规则同步到 declarativeNetRequest
 * 2. 存储变化时自动同步
 */

importScripts("shared.js");

async function bootstrap() {
  try {
    const rules = await loadRules();
    const count = await syncDnr(rules);
    console.log(`[HeaderFixer] 已加载 ${rules.length} 条规则，生效 ${count} 条 DNR 规则`);
  } catch (e) {
    console.error("[HeaderFixer] 初始化失败", e);
  }
}

chrome.runtime.onInstalled.addListener(bootstrap);
chrome.runtime.onStartup.addListener(bootstrap);

// 打开时也同步一次（service worker 可能被回收后重建）
bootstrap();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.rules) return;
  const rules = (changes.rules.newValue || []).map(normalizeRule);
  syncDnr(rules)
    .then((count) => {
      console.log(`[HeaderFixer] 规则已更新，生效 ${count} 条`);
    })
    .catch((e) => console.error("[HeaderFixer] 同步失败", e));
});

// 允许 popup 查询当前生效规则数
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "GET_DNR_STATUS") {
    chrome.declarativeNetRequest
      .getDynamicRules()
      .then((rules) => {
        sendResponse({ ok: true, activeDnrCount: rules.length });
      })
      .catch((e) => sendResponse({ ok: false, error: formatError(e) }));
    return true; // async
  }
  return false;
});
