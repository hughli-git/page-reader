// ==UserScript==
// @name         网页逐句悬停朗读 (链接整合版)
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  鼠标悬停变色并朗读，自动整合跨标签句子（如含链接的句子）。
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
    // 使用伪元素或 Range 高亮，这里采用覆盖层方案或直接包裹方案
    // 为保证不破坏 A 标签，我们采用动态包裹临时 Span 的方式
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

    // --- 核心算法：获取包含链接的完整句子 ---
    function getFullSentence(e) {
        const target = e.target;

        // 1. 如果直接点在链接上，按照要求独立处理链接
        if (target.tagName === 'A') {
            return { text: target.innerText, nodes: [target] };
        }

        // 2. 寻找最近的块级父容器 (P, DIV, LI 等)
        const container = target.closest('p, li, h1, h2, h3, h4, h5, h6, article, div[class*="content"]');
        if (!container) return null;

        const fullText = container.innerText;
        const selection = window.getSelection();
        const range = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (!range) return null;

        // 获取鼠标点击位置在 innerText 中的大致偏移
        // 这里通过临时 Selection 获取
        const preRange = document.createRange();
        preRange.selectNodeContents(container);
        preRange.setEnd(range.startContainer, range.startOffset);
        const offset = preRange.toString().length;

        // 以标点符号断句：。！？ \n 以及英文句号
        const delimiters = /[。！？\n\r]|(\. )/;

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

        // 3. 确定需要高亮的范围 (使用 Range 对象)
        const finalRange = document.createRange();

        // 这是一个精密操作：将字符偏移还原为 DOM 节点
        let currentPos = 0;
        let startNode, startOffset, endNode, endOffset;

        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
            const len = node.textContent.length;
            if (!startNode && currentPos + len >= start) {
                startNode = node;
                startOffset = start - currentPos;
            }
            if (currentPos + len >= end) {
                endNode = node;
                endOffset = end - currentPos;
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
            // 使用 extractContents 会移动真实的 DOM，对于 A 标签来说很稳
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

    function createRangeFromNode(node) {
        const r = document.createRange();
        r.selectNode(node);
        return r;
    }

    // --- 菜单 ---
    GM_registerMenuCommand("⚙️ 配置火山引擎", () => {
        const appId = prompt("AppID:", GM_getValue('volc_appid', ''));
        const token = prompt("Access Token:", GM_getValue('volc_token', ''));
        if (appId) GM_setValue('volc_appid', appId);
        if (token) GM_setValue('volc_token', token);
        alert("保存成功！");
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === "Escape") {
            stopSpeaking();
            removeHighlight();
            lastSpokenText = "";
        }
    });

})();