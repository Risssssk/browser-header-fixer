/**
 * 规则模型 & declarativeNetRequest 转换
 * 存储结构（chrome.storage.local）:
 * {
 *   rules: [{
 *     id: string,
 *     enabled: boolean,
 *     name: string,
 *     matchType: 'contains'|'startsWith'|'domain'|'exact'|'regex',
 *     pattern: string,
 *     headers: [{ name, value, operation: 'set'|'append'|'remove' }],
 *     resourceTypes: string[]  // 空数组 = 全部
 *   }]
 * }
 */

const MATCH_TYPES = {
  contains: {
    label: "包含",
    hint: "URL 中包含该关键词，例如 api.example.com",
  },
  startsWith: {
    label: "开头是",
    hint: "URL 以该字符串开头，例如 https://api.",
  },
  domain: {
    label: "域名",
    hint: "匹配该域名及其子域名，例如 example.com",
  },
  exact: {
    label: "完整 URL",
    hint: "精确匹配完整 URL",
  },
  regex: {
    label: "正则",
    hint: "Chrome DNR 正则，例如 ^https://api\\.example\\.com/",
  },
};

const HEADER_OPS = {
  set: "覆盖设置",
  append: "追加",
  remove: "删除",
};

const RESOURCE_TYPES = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "media",
  "websocket",
  "webtransport",
  "webbundle",
  "other",
];

const ALL_RESOURCE_TYPES = [...RESOURCE_TYPES];

function uid() {
  return "r_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 将用户 pattern 转为 DNR urlFilter / regexFilter */
function toDnrCondition(rule) {
  const pattern = (rule.pattern || "").trim();
  if (!pattern) throw new Error("匹配规则不能为空");

  const condition = {};

  if (rule.matchType === "regex") {
    // Chrome DNR regexFilter 限制：不能有前瞻/后顾等，长度有限
    condition.regexFilter = pattern;
  } else if (rule.matchType === "domain") {
    // ||domain^ 匹配 domain 及子域
    const host = pattern.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^\*\./, "");
    if (!host) throw new Error("域名无效");
    condition.urlFilter = `||${host}^`;
  } else if (rule.matchType === "exact") {
    // 完整 URL：左右锚定。^ 是分隔符，末尾用 |
    let url = pattern;
    if (!/^https?:\/\//i.test(url) && !url.includes("/")) {
      // 容忍只给 host 的情况
      condition.urlFilter = `|${url}|`;
    } else {
      condition.urlFilter = `|${url}|`;
    }
  } else if (rule.matchType === "startsWith") {
    // 前缀：左锚定
    condition.urlFilter = `|${pattern}*`;
  } else {
    // contains
    condition.urlFilter = `*${pattern}*`;
  }

  const types = (rule.resourceTypes || []).filter((t) => ALL_RESOURCE_TYPES.includes(t));
  condition.resourceTypes = types.length ? types : ALL_RESOURCE_TYPES;
  return condition;
}

function toDnrHeaders(headers) {
  return (headers || [])
    .filter((h) => h && h.name && h.name.trim())
    .map((h) => {
      const name = h.name.trim();
      const operation = h.operation || "set";
      if (operation === "remove") {
        return { header: name, operation: "remove" };
      }
      return {
        header: name,
        operation,
        value: String(h.value ?? ""),
      };
    });
}

/** 本地规则 → DNR 动态规则列表（每条本地规则可产生 1 条 DNR） */
function toDnrRules(rules) {
  const dnr = [];
  let id = 1;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!rule.headers || rule.headers.length === 0) continue;
    const requestHeaders = toDnrHeaders(rule.headers);
    if (requestHeaders.length === 0) continue;

    try {
      const condition = toDnrCondition(rule);
      dnr.push({
        id: id++,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders,
        },
        condition,
      });
    } catch (e) {
      console.warn("跳过无效规则", rule.id, e.message);
    }
  }
  return dnr;
}

function newRule(partial = {}) {
  return {
    id: uid(),
    enabled: true,
    name: "",
    matchType: "contains",
    pattern: "",
    headers: [{ name: "", value: "", operation: "set" }],
    resourceTypes: [],
    ...partial,
  };
}

function normalizeRule(raw) {
  return newRule({
    id: raw.id || uid(),
    enabled: raw.enabled !== false,
    name: raw.name || "",
    matchType: MATCH_TYPES[raw.matchType] ? raw.matchType : "contains",
    pattern: raw.pattern || "",
    headers: (raw.headers || []).map((h) => ({
      name: h.name || "",
      value: h.value ?? "",
      operation: HEADER_OPS[h.operation] ? h.operation : "set",
    })),
    resourceTypes: Array.isArray(raw.resourceTypes) ? raw.resourceTypes : [],
  });
}

async function loadRules() {
  const data = await chrome.storage.local.get(["rules"]);
  return (data.rules || []).map(normalizeRule);
}

async function saveRules(rules) {
  await chrome.storage.local.set({ rules });
  await syncDnr(rules);
}

async function syncDnr(rules) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);
  const addRules = toDnrRules(rules);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules,
  });
  return addRules.length;
}

function formatError(err) {
  return (err && err.message) || String(err) || "未知错误";
}

// 导出到全局（popup / options 共用）
if (typeof globalThis !== "undefined") {
  Object.assign(globalThis, {
    MATCH_TYPES,
    HEADER_OPS,
    RESOURCE_TYPES,
    ALL_RESOURCE_TYPES,
    uid,
    escapeRegex,
    toDnrCondition,
    toDnrHeaders,
    toDnrRules,
    newRule,
    normalizeRule,
    loadRules,
    saveRules,
    syncDnr,
    formatError,
  });
}
