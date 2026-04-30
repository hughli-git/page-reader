# page-reader

一个用于网页逐句悬停朗读的 Tampermonkey（油猴）脚本。鼠标移动到页面文字上时，脚本会自动识别当前文字内容，高亮对应文本，并通过火山引擎 TTS 接口朗读。

当前脚本主要面向 `minecraft.wiki` 页面使用：

```javascript
// @match *://*.minecraft.wiki/*
```

## 功能特性

- 鼠标悬停在普通文本上时，自动识别并选中当前整句话
- 鼠标悬停在超链接上时，只选中并朗读该链接文本
- 鼠标悬停在空白区域或表单控件上时，不选中任何文字
- 使用 CSS Highlight API 高亮文本，尽量不修改页面 DOM
- 在不支持 CSS Highlight API 的浏览器中，自动降级为安全的 `span` 包裹高亮
- 支持按 `Esc`、鼠标离开页面或窗口失焦时停止朗读并清除高亮
- 通过油猴菜单配置火山引擎 AppID、Access Token 和音色

## 文件说明

| 文件 | 说明 |
| --- | --- |
| `page-reader.js` | 油猴脚本主体 |

## 安装方式

1. 在浏览器中安装 Tampermonkey / Violentmonkey 等用户脚本管理器。
2. 新建用户脚本。
3. 将 `page-reader.js` 的内容复制到用户脚本编辑器中并保存。
4. 打开匹配的网站页面，例如 `https://zh.minecraft.wiki/` 下的页面。
5. 在油猴菜单中选择“配置火山引擎”，填写：
   - `AppID`
   - `Access Token`
   - `Voice`
   - `Speed Ratio`

## 使用方式

1. 打开脚本匹配的网页。
2. 将鼠标移动到文字上：
   - 普通文本：高亮并朗读当前整句话。
   - 链接文本：只高亮并朗读链接本身。
   - 空白区域：清除高亮，不朗读。
3. 按 `Esc` 可立即停止朗读并清除高亮。

## 配置说明

脚本通过 `GM_setValue` / `GM_getValue` 保存以下配置：

| 配置项 | 说明 | 默认值 |
| --- | --- | --- |
| `volc_appid` | 火山引擎 TTS AppID | 空 |
| `volc_token` | 火山引擎 TTS Access Token | 空 |
| `volc_voice` | TTS 音色 | `BV001_streaming` |
| `volc_speed_ratio` | 朗读语速倍率，输入无效或小于等于 0 时使用默认值 | `1.0` |

脚本中列出的常用音色：

| 音色 | 说明 |
| --- | --- |
| `BV700_V2_streaming` | 灿灿 2.0 |
| `BV001_V2_streaming` | 通用女声 2.0 |
| `BV700_streaming` | 灿灿 |
| `BV001_streaming` | 通用女声 |
| `BV002_streaming` | 通用男声 |

## 朗读接口

脚本调用火山引擎 TTS v1 接口：

```text
https://openspeech.bytedance.com/api/v1/tts
```

油猴脚本头部已声明连接权限：

```javascript
// @connect openspeech.bytedance.com
```

如果没有配置 `AppID` 或 `Access Token`，脚本仍会执行选中文字和高亮逻辑，但不会发起朗读请求。

## 选中文字规则

- 如果鼠标位于链接上，直接使用链接的 `innerText` / `textContent` / `aria-label` / `title` 作为朗读文本。
- 如果鼠标位于普通文本节点上，脚本会向上查找最近的文本容器，并在容器内按句号、问号、感叹号、换行等边界截取当前句子。
- 表单控件、可编辑区域和当前高亮区域会被忽略。
- 表格单元格会作为独立容器处理，避免跨 `td` / `th` 选中不相关内容。

## 注意事项

- 当前脚本匹配范围仅限 `*.minecraft.wiki`。
- TTS 朗读依赖火山引擎接口和有效的账号配置。
- 不同浏览器对 CSS Highlight API 的支持不同，脚本已内置降级方案。
- 降级高亮方案会临时包裹文本节点，复杂页面结构中仍需重点测试。
