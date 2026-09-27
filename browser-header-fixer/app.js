/* global MATCH_TYPES, HEADER_OPS, RESOURCE_TYPES, newRule, normalizeRule, loadRules, saveRules, formatError */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let rules = [];
let editingId = null;
let draftHeaders = [];
let draftResourceTypes = [];
let currentTabUrl = "";

// ─── utils ───
function toast(msg, ms = 1800) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), ms);
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function matchTypeLabel(t) {
  return (MATCH_TYPES[t] && MATCH_TYPES[t].label) || t;
}

function opLabel(op) {
  return (HEADER_OPS[op] && HEADER_OPS[op].label) || op;
}

// ─── status bar ───
async function refreshStatus() {
  const active = rules.filter((r) => r.enabled).length;
  const totalHeaders = rules
    .filter((r) => r.enabled)
    .reduce((n, r) => n + (r.headers || []).filter((h) => h.name).length, 0);

  const dot = $("#status-dot");
  const text = $("#status-text");
  if (active > 0) {
    dot.classList.remove("off");
    text.textContent = `已启用 ${active} 条规则 · ${totalHeaders} 个请求头`;
  } else {
    dot.classList.add("off");
    text.textContent = "当前没有启用的规则";
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabUrl = tab?.url || "";
    let display = currentTabUrl;
    if (currentTabUrl.startsWith("http")) {
      try {
        display = new URL(currentTabUrl).host + new URL(currentTabUrl).pathname;
      } catch (_) {}
    }
    $("#status-url").textContent = display || "—";
    $("#status-url").title = currentTabUrl || "";
  } catch (_) {
    $("#status-url").textContent = "—";
  }
}

// ─── rule list ───
function renderRules() {
  const box = $("#content");
  if (!rules.length) {
    box.innerHTML = `
      <div class="empty">
        <div class="empty-icon">↗</div>
        <h3>还没有规则</h3>
        <p>添加一条规则，在访问指定网址时<br/>自动带上你需要的自定义请求头。</p>
        <button class="btn btn-primary" id="empty-add">添加第一条规则</button>
      </div>`;
    $("#empty-add")?.addEventListener("click", () => openModal());
    return;
  }

  box.innerHTML = rules
    .map((r) => {
      const headers = (r.headers || []).filter((h) => h.name);
      const headerHtml = headers
        .slice(0, 4)
        .map((h) => {
          const opClass = h.operation || "set";
          const val = h.operation === "remove" ? "（删除）" : h.value;
          return `
          <div class="header-row">
            <span class="op ${esc(opClass)}">${esc((h.operation || "set").toUpperCase())}</span>
            <span class="hn" title="${esc(h.name)}">${esc(h.name)}</span>
            <span class="hv" title="${esc(val)}">${esc(val)}</span>
            <span></span>
          </div>`;
        })
        .join("");
      const more =
        headers.length > 4
          ? `<div class="hint" style="padding:2px 4px;color:var(--muted);font-size:11px">… 还有 ${headers.length - 4} 个请求头</div>`
          : "";

      return `
      <article class="rule ${r.enabled ? "" : "disabled"}" data-id="${esc(r.id)}">
        <div class="rule-head">
          <label class="switch" title="${r.enabled ? "已启用" : "已停用"}">
            <input type="checkbox" class="toggle" ${r.enabled ? "checked" : ""} data-id="${esc(r.id)}" />
            <span class="slider"></span>
          </label>
          <div class="rule-title">
            <div class="name">${esc(r.name || "未命名规则")}</div>
            <div class="meta">
              <span class="badge">${esc(matchTypeLabel(r.matchType))}</span>
              ${esc(r.pattern || "（未填匹配）")}
            </div>
          </div>
        </div>
        <div class="rule-body">
          ${headerHtml || '<div class="hint" style="color:var(--muted)">未配置请求头</div>'}
          ${more}
        </div>
        <div class="rule-actions">
          <button class="btn btn-ghost btn-sm btn-edit" data-id="${esc(r.id)}">编辑</button>
          <button class="btn btn-danger btn-sm btn-del" data-id="${esc(r.id)}">删除</button>
        </div>
      </article>`;
    })
    .join("");

  // events
  $$(".toggle", box).forEach((el) => {
    el.addEventListener("change", async () => {
      const rule = rules.find((x) => x.id === el.dataset.id);
      if (!rule) return;
      rule.enabled = el.checked;
      try {
        await saveRules(rules);
        renderRules();
        await refreshStatus();
        toast(rule.enabled ? "已启用" : "已停用");
      } catch (e) {
        toast("保存失败：" + formatError(e));
      }
    });
  });

  $$(".btn-edit", box).forEach((el) => {
    el.addEventListener("click", () => {
      const rule = rules.find((x) => x.id === el.dataset.id);
      if (rule) openModal(rule);
    });
  });

  $$(".btn-del", box).forEach((el) => {
    el.addEventListener("click", async () => {
      const id = el.dataset.id;
      const rule = rules.find((x) => x.id === id);
      if (!rule) return;
      if (!confirm(`确定删除规则「${rule.name || "未命名"}」？`)) return;
      rules = rules.filter((x) => x.id !== id);
      try {
        await saveRules(rules);
        renderRules();
        await refreshStatus();
        toast("已删除");
      } catch (e) {
        toast("删除失败：" + formatError(e));
      }
    });
  });
}

// ─── modal / form ───
function updatePatternHint() {
  const t = $("#f-match-type").value;
  $("#f-pattern-hint").textContent = (MATCH_TYPES[t] && MATCH_TYPES[t].hint) || "";
  const ph = {
    contains: "api.example.com",
    startsWith: "https://api.example.com/",
    domain: "example.com",
    exact: "https://api.example.com/v1/users",
    regex: "^https://api\\.example\\.com/",
  };
  $("#f-pattern").placeholder = ph[t] || "";
}

function renderHeaderEditors() {
  const box = $("#headers-box");
  if (!draftHeaders.length) {
    draftHeaders = [{ name: "", value: "", operation: "set" }];
  }
  box.innerHTML = draftHeaders
    .map(
      (h, i) => `
    <div class="header-edit" data-idx="${i}">
      <div class="head-row">
        <input type="text" class="h-name" placeholder="Header 名" value="${esc(h.name)}" />
        <input type="text" class="h-value" placeholder="Header 值" value="${esc(h.value)}" ${h.operation === "remove" ? "disabled" : ""} />
        <select class="h-op">
          <option value="set" ${h.operation === "set" ? "selected" : ""}>覆盖</option>
          <option value="append" ${h.operation === "append" ? "selected" : ""}>追加</option>
          <option value="remove" ${h.operation === "remove" ? "selected" : ""}>删除</option>
        </select>
        <button type="button" class="remove-h" title="移除">×</button>
      </div>
    </div>`
    )
    .join("");

  $$(".header-edit", box).forEach((row) => {
    const idx = Number(row.dataset.idx);
    $(".h-name", row).addEventListener("input", (e) => {
      draftHeaders[idx].name = e.target.value;
    });
    $(".h-value", row).addEventListener("input", (e) => {
      draftHeaders[idx].value = e.target.value;
    });
    $(".h-op", row).addEventListener("change", (e) => {
      draftHeaders[idx].operation = e.target.value;
      renderHeaderEditors();
    });
    $(".remove-h", row).addEventListener("click", () => {
      draftHeaders.splice(idx, 1);
      if (!draftHeaders.length) draftHeaders = [{ name: "", value: "", operation: "set" }];
      renderHeaderEditors();
    });
  });
}

function renderResourceChips() {
  const box = $("#resource-chips");
  const labels = {
    main_frame: "页面",
    sub_frame: "子页面",
    xmlhttprequest: "XHR/Fetch",
    websocket: "WebSocket",
    script: "脚本",
    stylesheet: "样式",
    image: "图片",
    media: "媒体",
    font: "字体",
    ping: "Ping",
    other: "其他",
    object: "插件对象",
    csp_report: "CSP",
    webtransport: "WebTransport",
    webbundle: "WebBundle",
  };
  // 只展示常用，减少噪音
  const show = [
    "main_frame",
    "sub_frame",
    "xmlhttprequest",
    "websocket",
    "script",
    "stylesheet",
    "image",
    "media",
    "font",
    "other",
    "ping",
    "object",
    "csp_report",
    "webtransport",
    "webbundle",
  ];
  box.innerHTML = show
    .map((t) => {
      const on = draftResourceTypes.includes(t);
      return `<label class="chip ${on ? "on" : ""}" data-rt="${t}">
        <input type="checkbox" ${on ? "checked" : ""} />
        ${labels[t] || t}
      </label>`;
    })
    .join("");

  $$(".chip", box).forEach((chip) => {
    chip.addEventListener("click", (e) => {
      e.preventDefault();
      const t = chip.dataset.rt;
      if (draftResourceTypes.includes(t)) {
        draftResourceTypes = draftResourceTypes.filter((x) => x !== t);
      } else {
        draftResourceTypes = [...draftResourceTypes, t];
      }
      renderResourceChips();
    });
  });
}

function openModal(rule) {
  editingId = rule ? rule.id : null;
  $("#modal-title").textContent = rule ? "编辑规则" : "添加规则";

  $("#f-name").value = rule?.name || "";
  $("#f-match-type").value = rule?.matchType || "contains";
  $("#f-pattern").value = rule?.pattern || "";
  draftHeaders = (rule?.headers || []).map((h) => ({ ...h }));
  if (!draftHeaders.length) draftHeaders = [{ name: "", value: "", operation: "set" }];
  draftResourceTypes = [...(rule?.resourceTypes || [])];

  updatePatternHint();
  renderHeaderEditors();
  renderResourceChips();

  $("#modal").classList.add("open");
  setTimeout(() => $("#f-pattern").focus(), 50);
}

function closeModal() {
  $("#modal").classList.remove("open");
  editingId = null;
}

async function saveFromModal() {
  const name = $("#f-name").value.trim();
  const matchType = $("#f-match-type").value;
  const pattern = $("#f-pattern").value.trim();

  if (!pattern) {
    toast("请填写匹配内容");
    $("#f-pattern").focus();
    return;
  }

  const headers = draftHeaders
    .filter((h) => h.name && h.name.trim())
    .map((h) => ({
      name: h.name.trim(),
      value: h.operation === "remove" ? "" : (h.value ?? ""),
      operation: h.operation || "set",
    }));

  if (!headers.length) {
    toast("至少配置一个请求头");
    return;
  }

  const payload = {
    name: name || `${matchTypeLabel(matchType)}: ${pattern}`,
    matchType,
    pattern,
    headers,
    resourceTypes: [...draftResourceTypes],
  };

  const isEdit = Boolean(editingId);
  if (editingId) {
    const idx = rules.findIndex((r) => r.id === editingId);
    if (idx >= 0) {
      rules[idx] = normalizeRule({ ...rules[idx], ...payload, enabled: rules[idx].enabled });
    }
  } else {
    rules = [...rules, normalizeRule({ ...payload, enabled: true, id: undefined })];
  }

  try {
    await saveRules(rules);
    closeModal();
    renderRules();
    await refreshStatus();
    toast(isEdit ? "已保存" : "已添加");
  } catch (e) {
    toast("保存失败：" + formatError(e));
  }
}

// ─── import / export / clear ───
function exportJson() {
  const blob = new Blob([JSON.stringify({ version: 1, rules }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `header-fixer-rules-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("已导出");
}

async function importJson(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const incoming = Array.isArray(data) ? data : data.rules;
    if (!Array.isArray(incoming)) throw new Error("JSON 格式不正确，需要 { rules: [...] }");

    const normalized = incoming.map(normalizeRule);
    // 合并：同 id 覆盖，否则追加
    const map = new Map(rules.map((r) => [r.id, r]));
    for (const r of normalized) map.set(r.id, r);
    rules = [...map.values()];
    await saveRules(rules);
    renderRules();
    await refreshStatus();
    toast(`已导入 ${normalized.length} 条规则`);
  } catch (e) {
    toast("导入失败：" + formatError(e));
  }
}

async function clearAll() {
  if (!rules.length) {
    toast("没有可清空的规则");
    return;
  }
  if (!confirm(`确定清空全部 ${rules.length} 条规则？此操作不可恢复。`)) return;
  rules = [];
  await saveRules(rules);
  renderRules();
  await refreshStatus();
  toast("已清空");
}

// ─── wire up ───
function bindChrome() {
  $("#btn-add").addEventListener("click", () => openModal());
  $("#btn-export").addEventListener("click", exportJson);
  $("#btn-clear").addEventListener("click", clearAll);
  $("#btn-import").addEventListener("click", () => $("#file-import").click());
  $("#file-import").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) importJson(f);
    e.target.value = "";
  });

  $("#modal-close").addEventListener("click", closeModal);
  $("#btn-cancel").addEventListener("click", closeModal);
  $("#btn-save").addEventListener("click", saveFromModal);
  $("#btn-add-header").addEventListener("click", () => {
    draftHeaders.push({ name: "", value: "", operation: "set" });
    renderHeaderEditors();
  });
  $("#f-match-type").addEventListener("change", updatePatternHint);

  $("#f-use-current").addEventListener("click", () => {
    if (!currentTabUrl) {
      toast("无法获取当前页面 URL");
      return;
    }
    try {
      const u = new URL(currentTabUrl);
      const sel = $("#f-match-type");
      if (sel.value === "domain") {
        $("#f-pattern").value = u.hostname.replace(/^www\./, "");
      } else if (sel.value === "exact") {
        $("#f-pattern").value = currentTabUrl;
      } else if (sel.value === "startsWith") {
        $("#f-pattern").value = u.origin + u.pathname;
      } else if (sel.value === "regex") {
        $("#f-pattern").value = "^" + escapeRegexSafe(currentTabUrl.split("?")[0]);
      } else {
        $("#f-pattern").value = u.hostname;
      }
      toast("已填入当前页面");
    } catch (_) {
      toast("当前页面不是标准 URL");
    }
  });

  $("#modal").addEventListener("click", (e) => {
    if (e.target.id === "modal") closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && $("#modal").classList.contains("open")) {
      saveFromModal();
    }
  });

  $("#btn-options")?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

function escapeRegexSafe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function init() {
  bindChrome();
  rules = await loadRules();
  renderRules();
  await refreshStatus();

  // 规则变化时刷新（options / popup 同步）
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.rules) return;
    rules = (changes.rules.newValue || []).map(normalizeRule);
    renderRules();
    refreshStatus();
  });
}

init().catch((e) => {
  console.error(e);
  $("#content").innerHTML = `<div class="empty"><h3>初始化失败</h3><p>${esc(formatError(e))}</p></div>`;
});
