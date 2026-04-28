// ==UserScript==
// @name         网页逐句悬停朗读 (链接整合版)
// @namespace    http://tampermonkey.net/
// @version      4.1
// @description  鼠标悬停变色并朗读，自动整合跨标签句子（含链接、表格等），格式化处理更稳健
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
        .v-tts-span-active { background-color: ${HIGHLIGHT_BG} !important; border-radius: 3px; transition: background 0.2s; }
    `);

    const getConfig = () => ({
        appId: GM_getValue('volc_appid', ''),
        token: GM_getValue('volc_token', ''),
        voice: GM_getValue('volc_voice', 'BV001_streaming'),
    });

    // --- TTS 引擎 ---
    let currentAudio = null;
    let lastRequest = null;
    let hoverTimer = null;
    let lastSpokenText = "";

    function stopSpeaking() {
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
        if (lastRequest) { lastRequest.abort(); lastRequest = null; }
    }

    function speak(text) {
        text = text.trim();
        if (!text || text === lastSpokenText || text.length < 2) return;

        const config = getConfig();
        if (!config.appId || !config.token) return;

        stopSpeaking();
        lastSpokenText = text;

        const reqid = Math.random().toString(36).slice(2);
        const requestData = {
            app: { appid: config.appId, token: config.token, cluster: "volcano_tts" },
            user: { uid: "user_js" },
            audio: { encoding: "mp3", voice_type: config.voice, speed_ratio: 1.0, volume_ratio: 1.0, pitch_ratio: 1.0 },
            request: { reqid: reqid, text: text, text_type: "plain", operation: "query" }
        };

        lastRequest = GM_xmlhttpRequest({
            method: "POST",
            url: "https://openspeech.bytedance.com/api/v1/tts",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer;${config.token}` },
            data: JSON.stringify(requestData),
            responseType: "json",
            onload: function(res) {
                if (res.status === 200 && res.response && res.response.data) {
                    currentAudio = new Audio(`data:audio/mp3;base64,${res.response.data}`);
                    currentAudio.play().catch(e => {});
                }
            }
        });
    }

    // --- 核心算法：获取包含链接的完整句子，并避免跨表格单元格 ---
    function getFullSentence(e) {
        const target = e.target;

        // 1. 忽略表单等交互元素，避免误触
        if (target.matches('input, textarea, select, button, option, label, [contenteditable="true"]')) return null;

        // 2. 如果直接点在链接上，独立处理链接
        if (target.tagName === 'A') {
            return { text: target.innerText, nodes: [target] };
        }

        // 3. 寻找最近的块级容器，特别加入 td、th，避免跨单元格破坏表格布局
        const container = target.closest('p, li, h1, h2, h3, h4, h5, h6, td, th, article, section, div[class*="content"]');
        if (!container) return null;

        const fullText = container.innerText;
        const range = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (!range) return null;

        // 获取鼠标位置在 innerText 中的偏移
        const preRange = document.createRange();
        preRange.selectNodeContents(container);
        preRange.setEnd(range.startContainer, range.startOffset);
        const offset = preRange.toString().length;

        // 以标点符号断句
        const delimiters = /[。！？\n\r]|(\.\s)/;

        // 向前找开头
        let start = offset;
        while (start > 0 && !delimiters.test(fullText[start - 1])) {
            start--;
        }

        // 向后找结尾
        let end = offset;
        while (end < fullText.length && !delimiters.test(fullText[end])) {
            end++;
        }
        if (end < fullText.length) end++; // 包含标点

        const sentenceText = fullText.substring(start, end).trim();
        if (sentenceText.length < 2) return null;

        // 4. 将字符偏移还原为 DOM 节点（仅在当前容器内）
        const finalRange = document.createRange();
        let currentPos = 0;
        let startNode, startOffset, endNode, endOffset;

        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
            const len = node.textContent.length;
            if (!startNode && currentPos + len >= start) {
                startNode = node;
                startOffset = Math.max(0, start - currentPos);
            }
            if (currentPos + len >= end) {
                endNode = node;
                endOffset = Math.min(node.textContent.length, end - currentPos);
                break;
            }
            currentPos += len;
        }

        if (startNode && endNode) {
            finalRange.setStart(startNode, Math.max(0, startOffset));
            finalRange.setEnd(endNode, Math.min(endNode.textContent.length, endOffset));
            return { text: sentenceText, range: finalRange };
        }

        return null;
    }

    // --- 高亮处理 ---
    let highlightWrapper = document.createElement('span');
    highlightWrapper.className = 'v-tts-span-active';

    function applyHighlight(range) {
        removeHighlight();
        try {
            const content = range.extractContents();
            highlightWrapper.innerHTML = '';
            highlightWrapper.appendChild(content);
            range.insertNode(highlightWrapper);
        } catch (e) {
            console.error("高亮失败", e);
        }
    }

    function removeHighlight() {
        if (highlightWrapper.parentNode) {
            const parent = highlightWrapper.parentNode;
            while (highlightWrapper.firstChild) {
                parent.insertBefore(highlightWrapper.firstChild, highlightWrapper);
            }
            parent.removeChild(highlightWrapper);
            parent.normalize(); // 合并断开的文本节点
        }
    }

    function createRangeFromNode(node) {
        const r = document.createRange();
        r.selectNode(node);
        return r;
    }

    // --- 事件监听 ---
    document.addEventListener('mousemove', (e) => {
        if (hoverTimer) clearTimeout(hoverTimer);

        hoverTimer = setTimeout(() => {
            // 如果鼠标还在原来的高亮区，不重复处理
            if (e.target.closest('.v-tts-span-active')) return;

            const result = getFullSentence(e);
            if (result) {
                if (result.text !== lastSpokenText) {
                    applyHighlight(result.range || createRangeFromNode(result.nodes[0]));
                    speak(result.text);
                }
            } else {
                removeHighlight();
                stopSpeaking();
                lastSpokenText = "";
            }
        }, 100);
    });

    document.addEventListener('mouseout', (e) => {
        // 如果鼠标移出当前有效区域，延迟清除高亮（避免闪烁）
        if (!e.relatedTarget || !e.relatedTarget.closest('.v-tts-span-active')) {
            setTimeout(() => {
                if (!document.querySelector('.v-tts-span-active')?.contains(document.activeElement)) {
                    removeHighlight();
                    stopSpeaking();
                    lastSpokenText = "";
                }
            }, 150);
        }
    });

    // --- 快捷键 ---
    document.addEventListener('keydown', (e) => {
        if (e.key === "Escape") {
            stopSpeaking();
            removeHighlight();
            lastSpokenText = "";
        }
    });

    // --- 菜单 ---
    GM_registerMenuCommand("⚙️ 配置火山引擎", () => {
        const appId = prompt("AppID:", GM_getValue('volc_appid', ''));
        const token = prompt("Access Token:", GM_getValue('volc_token', ''));
        if (appId) GM_setValue('volc_appid', appId);
        if (token) GM_setValue('volc_token', token);
        alert("保存成功！");
    });

})();