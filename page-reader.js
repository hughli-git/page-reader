// ==UserScript==
// @name         网页逐句悬停朗读 (修复加强版)
// @namespace    http://tampermonkey.net/
// @version      3.1
// @description  鼠标悬停变色并朗读。链接独立，普通句子不被链接切断。修复了无法朗读的问题。
// @author       Gemini
// @match        *://*/*
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      openspeech.bytedance.com
// ==/UserScript==

(function() {
    'use strict';

    // --- 样式配置 ---
    const HIGHLIGHT_BG = 'rgba(255, 255, 0, 0.4)';
    GM_addStyle(`
        .v-tts-highlight { background-color: ${HIGHLIGHT_BG} !important; border-radius: 2px; }
    `);

    // --- 配置管理 ---
    const getConfig = () => ({
        appId: GM_getValue('volc_appid', ''),
        token: GM_getValue('volc_token', ''),
        voice: GM_getValue('volc_voice', 'BV001_streaming'),
    });

    // --- 语音核心 ---
    let currentAudio = null;
    let lastRequest = null;
    let hoverTimer = null;
    let lastText = ""; // 防止重复触发

    function stopSpeaking() {
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
        if (lastRequest) { lastRequest.abort(); lastRequest = null; }
    }

    function speak(text) {
        if (!text || text === lastText) return;
        const config = getConfig();
        if (!config.appId || !config.token) {
            console.warn("TTS: 请先在油猴菜单配置 AppID 和 Token");
            return;
        }

        stopSpeaking();
        lastText = text;

        // 简易 UUID 替代 crypto.randomUUID (兼容性更好)
        const reqid = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

        const requestData = {
            app: { appid: config.appId, token: config.token, cluster: "volcano_tts" },
            user: { uid: "user_123" },
            audio: {
                encoding: "mp3",
                voice_type: config.voice,
                speed_ratio: 1.0,
                volume_ratio: 1.0,
                pitch_ratio: 1.0,
            },
            request: {
                reqid: reqid,
                text: text,
                text_type: "plain",
                operation: "query"
            }
        };

        lastRequest = GM_xmlhttpRequest({
            method: "POST",
            url: "https://openspeech.bytedance.com/api/v1/tts",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer;${config.token}`
            },
            data: JSON.stringify(requestData),
            responseType: "json",
            onload: function(res) {
                if (res.status === 200 && res.response && res.response.data) {
                    const audioSrc = `data:audio/mp3;base64,${res.response.data}`;
                    currentAudio = new Audio(audioSrc);
                    currentAudio.play().catch(e => console.error("播放失败:", e));
                } else {
                    console.error("TTS 接口报错:", res.response ? res.response.message : "未知错误");
                    lastText = ""; // 报错了清空，允许重试
                }
            },
            onerror: () => { lastText = ""; }
        });
    }

    // --- 文本提取逻辑 ---
    // 获取鼠标下的句子
    function getSentenceFromEvent(e) {
        const target = e.target;

        // 1. 如果是超链接，直接返回超链接文字
        if (target.tagName === 'A' || target.closest('a')) {
            const link = target.tagName === 'A' ? target : target.closest('a');
            return { text: link.innerText.trim(), element: link };
        }

        // 2. 如果是普通文本，寻找包含当前位置的“断句”
        const selection = window.getSelection();
        const range = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (!range) return null;

        const container = range.startContainer;
        if (container.nodeType !== Node.TEXT_NODE) return null;

        const fullText = container.textContent;
        const offset = range.startOffset;

        // 向前向后寻找标点符号断句（。！？\n）
        const stopChars = /[。！？\n\r]/;
        let start = offset;
        while (start > 0 && !stopChars.test(fullText[start - 1])) {
            start--;
        }
        let end = offset;
        while (end < fullText.length && !stopChars.test(fullText[end])) {
            end++;
        }

        // 如果后面跟着标点，把标点也带上
        if (end < fullText.length && stopChars.test(fullText[end])) {
            end++;
        }

        const sentence = fullText.substring(start, end).trim();
        if (sentence.length < 2) return null; // 过滤单个字符

        // 为了实现高亮，我们还是需要包裹这个范围
        return { text: sentence, range: [start, end], node: container };
    }

    // --- 交互处理 ---
    let highlightSpan = document.createElement('span');
    highlightSpan.className = 'v-tts-highlight';

    document.addEventListener('mousemove', (e) => {
        // 防抖：避免鼠标移动过程中高频触发
        if (hoverTimer) clearTimeout(hoverTimer);

        hoverTimer = setTimeout(() => {
            const result = getSentenceFromEvent(e);

            // 清理旧高亮
            removeHighlight();

            if (result) {
                if (result.element) {
                    // 处理链接高亮
                    result.element.classList.add('v-tts-highlight');
                } else {
                    // 处理普通文本高亮 (不破坏 DOM 的临时方案)
                    applyTextHighlight(result.node, result.range);
                }
                speak(result.text);
            } else {
                stopSpeaking();
                lastText = "";
            }
        }, 200); // 200ms 悬停判定
    });

    function removeHighlight() {
        document.querySelectorAll('.v-tts-highlight').forEach(el => {
            if (el.tagName === 'A') {
                el.classList.remove('v-tts-highlight');
            } else {
                // 还原被包裹的文本
                const parent = el.parentNode;
                if (parent) {
                    parent.replaceChild(document.createTextNode(el.innerText), el);
                    parent.normalize(); // 合并相邻文本节点
                }
            }
        });
    }

    function applyTextHighlight(node, rangeIndices) {
        try {
            const text = node.textContent;
            const before = text.substring(0, rangeIndices[0]);
            const mid = text.substring(rangeIndices[0], rangeIndices[1]);
            const after = text.substring(rangeIndices[1]);

            const span = document.createElement('span');
            span.className = 'v-tts-highlight';
            span.innerText = mid;

            const fragment = document.createDocumentFragment();
            fragment.appendChild(document.createTextNode(before));
            fragment.appendChild(span);
            fragment.appendChild(document.createTextNode(after));

            node.replaceWith(fragment);
        } catch (e) {}
    }

    // --- 菜单 ---
    GM_registerMenuCommand("⚙️ 配置火山引擎", () => {
        const appId = prompt("AppID:", GM_getValue('volc_appid', ''));
        const token = prompt("Access Token:", GM_getValue('volc_token', ''));
        if (appId) GM_setValue('volc_appid', appId);
        if (token) GM_setValue('volc_token', token);
        alert("保存成功！");
    });

    document.addEventListener('keydown', (e) => { if (e.key === "Escape") stopSpeaking(); });

})();