# Header Fixer · 浏览器自定义请求头插件

Chrome 浏览器扩展：访问指定网址时，自动固定添加 / 修改 / 删除自定义请求头。

适用于开发调试、接口联调、测试环境切换、临时注入调试头等场景。

## 功能特性

- **按网址规则注入请求头**：只对匹配的站点生效
- **五种匹配方式**
  - 包含：URL 中出现关键词
  - 开头是：URL 前缀匹配
  - 域名：匹配主域及全部子域
  - 完整 URL：精确匹配
  - 正则：Chrome DNR 正则语法
- **三种 Header 操作**：覆盖设置（set）/ 追加（append）/ 删除（remove）
- **一条规则多个 Header**，可同时配置
- **资源类型过滤**：可限制只作用于 XHR/Fetch、WebSocket、页面主文档等
- **一键启停**：规则可单独开关
- **本地持久化**：保存在 `chrome.storage`，重启浏览器后仍生效
- **导入 / 导出 JSON**：方便多机同步或备份规则
- **Manifest V3** + `declarativeNetRequest`，无远程代码、不收集数据

## 安装

1. 下载或克隆本仓库

   ```bash
   git clone https://github.com/Risssssk/browser-header-fixer.git
   ```

2. 打开 Chrome，访问 `chrome://extensions`

3. 打开右上角 **开发者模式**

4. 点击 **加载已解压的扩展程序**，选择目录中的 `browser-header-fixer` 文件夹

5. 点击工具栏扩展图标即可开始使用

> 仓库根目录的 `index.html` 是说明页，浏览器直接打开可查看界面预览和安装指引。

## 使用说明

### 添加规则

1. 点击工具栏图标，选择 **＋ 添加规则**
2. 填写规则名称（可选）
3. 选择匹配方式，填写匹配内容
   - 例如：匹配方式选「域名」，填 `api.example.com`
4. 添加请求头，填写名称和值
   - 例如：`Authorization` = `Bearer xxx`
5. 保存

之后访问匹配站点时，请求会自动带上这些 Header。

### 匹配方式示例

| 匹配方式 | 示例 | 生效范围 |
|---------|------|---------|
| 包含 | `api.example.com` | URL 中含该关键词的请求 |
| 开头是 | `https://api.example.com/` | 以前缀开头的 URL |
| 域名 | `example.com` | 该域名及所有子域 |
| 完整 URL | `https://api.example.com/v1/me` | 精确匹配该地址 |
| 正则 | `^https://api\.example\.com/` | 匹配正则的 URL |

### 生效范围

不勾选 = 全部请求类型。也可只勾选部分：

- 页面（main_frame）
- 子页面（sub_frame）
- XHR/Fetch（xmlhttprequest）
- WebSocket
- 脚本 / 样式 / 图片 / 媒体 / 字体 等

### 规则 JSON 格式

支持导入 / 导出，格式如下：

```json
{
  "version": 1,
  "rules": [
    {
      "id": "r_demo",
      "enabled": true,
      "name": "测试环境 Token",
      "matchType": "domain",
      "pattern": "api.example.com",
      "headers": [
        { "name": "Authorization", "value": "Bearer xxx", "operation": "set" },
        { "name": "X-Env", "value": "staging", "operation": "set" }
      ],
      "resourceTypes": ["xmlhttprequest", "websocket", "main_frame"]
    }
  ]
}
```

## 目录结构

```text
browser-header-fixer/
├── manifest.json     清单文件（Manifest V3）
├── background.js     Service Worker，同步 DNR 规则
├── shared.js         规则模型与 declarativeNetRequest 转换
├── app.js            弹窗 / 设置页交互逻辑
├── popup.html        工具栏弹窗
├── popup.css         样式（支持浅色 / 深色）
├── options.html      独立设置页
└── icons/            16 / 32 / 48 / 128 图标

index.html            项目说明与界面预览页
```

## 技术说明

| 项目 | 说明 |
|------|------|
| 清单版本 | Manifest V3 |
| 核心 API | `chrome.declarativeNetRequest` |
| 规则存储 | `chrome.storage.local` |
| 网络权限 | `<all_urls>`（用于修改目标站请求头） |
| 远程代码 | 无 |
| 数据收集 | 无 |

## 注意事项

- 修改请求头会影响真实网络请求，请**仅在你有权调试 / 测试的站点**上使用
- 请勿用于伪造身份或绕过安全控制
- 规则保存在浏览器本地，卸载扩展或清除扩展数据后会丢失，请自行导出备份
- 若某条规则不生效，检查：匹配方式是否正确、规则是否启用、资源类型是否勾选过窄

## License

MIT
