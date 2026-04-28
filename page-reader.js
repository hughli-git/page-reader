// ==UserScript==
// @name         网页逐句悬停朗读 (结构无损版)
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  鼠标悬停高亮句子并朗读，完全不破坏页面结构（CSS Highlight API + 安全降级）
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
        .v-tts-span-active { background-color: ${HIGHLIGHT_BG} !important; border-radius: 3px; }
        ::highlight(v-tts-highlight) { background-color: ${HIGHLIGHT_BG}; }
    `);

    // --- 配置 ---
    const getConfig = () => ({
        appId: GM_getValue('volc_appid', ''),
        token: GM_getValue('volc_token', ''),
        voice: GM_getValue('volc_voice', 'BV001_streaming'),
    });

    // --- TTS 引擎 ---
    let currentAudio = null;
    let lastRequest = null;
    let hoverTimer = null;
    let lastSpokenText = '';

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
                    currentAudio.play().catch(() => {});
                }
            }
        });
    }

    // --- 断句核心：获取当前句子文字与 DOM Range ---
    function getFullSentence(e) {
        const target = e.target;
        // 忽略表单控件和已有高亮区域
        if (target.matches('input, textarea, select, button, option, label, [contenteditable="true"], .v-tts-span-active')) return null;
        if (target.tagName === 'A') {
            return { text: target.innerText, nodes: [target] };
        }

        // 寻找最近的块级/单元格容器，确保不跨 td/th 破坏表格
        const container = target.closest('p, li, h1, h2, h3, h4, h5, h6, td, th, article, section, div[class*="content"]');
        if (!container) return null;

        const fullText = container.innerText;
        const range = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (!range) return null;

        // 计算鼠标在 innerText 中的偏移
        const preRange = document.createRange();
        preRange.selectNodeContents(container);
        preRange.setEnd(range.startContainer, range.startOffset);
        const offset = preRange.toString().length;

        // 按标点分句
        const delimiters = /[。！？\n\r]|(\.\s)/;
        let start = offset;
        while (start > 0 && !delimiters.test(fullText[start - 1])) start--;
        let end = offset;
        while (end < fullText.length && !delimiters.test(fullText[end])) end++;
        if (end < fullText.length) end++;

        const sentenceText = fullText.substring(start, end).trim();
        if (sentenceText.length < 2) return null;

        // 将字符偏移还原为 DOM Range（仅限容器内文本节点）
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

    // ---------- 高亮策略 ----------
    const highlightSystem = (() => {
        // 策略1：CSS Highlight API（完全不影响 DOM）
        if (typeof Highlight !== 'undefined' && CSS.highlights) {
            return {
                apply(range) {
                    CSS.highlights.delete('v-tts-highlight');
                    if (range) {
                        const high = new Highlight(range);
                        CSS.highlights.set('v-tts-highlight', high);
                    }
                },
                remove() {
                    CSS.highlights.delete('v-tts-highlight');
                }
            };
        }
        // 策略2：安全降级——仅包裹文本节点，自动避开块级元素
        let activeSpans = [];
        const BLOCK_TAGS = /^(P|DIV|H[1-6]|LI|UL|OL|SECTION|ARTICLE|HEADER|FOOTER|NAV|ASIDE|BLOCKQUOTE|TABLE|TBODY|TR|TD|TH|PRE)$/i;

        function containsBlockElement(range) {
            const frag = range.cloneContents();
            return frag.querySelector('*') && Array.from(frag.querySelectorAll('*')).some(el => BLOCK_TAGS.test(el.tagName));
        }

        function wrapRangeWithSpans(range) {
            const spans = [];
            // 只处理 startContainer 和 endContainer 是文本节点的情况（我们的生成保证如此）
            const startText = range.startContainer;
            const endText = range.endContainer;
            if (startText === endText) {
                const newNode = startText.splitText(range.startOffset);
                const middleNode = newNode.splitText(range.endOffset - range.startOffset);
                const span = document.createElement('span');
                span.className = 'v-tts-span-active';
                startText.parentNode.insertBefore(span, middleNode);
                span.appendChild(middleNode);
                spans.push(span);
            } else {
                // 开始节点
                const startMiddle = startText.splitText(range.startOffset);
                const startSpan = document.createElement('span');
                startSpan.className = 'v-tts-span-active';
                startText.parentNode.insertBefore(startSpan, startMiddle);
                startSpan.appendChild(startMiddle);
                spans.push(startSpan);

                // 中间完整节点（遍历文本节点）
                const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
                let node;
                while (node = walker.nextNode()) {
                    if (node === startText || node === endText) continue;
                    if (range.intersectsNode(node)) {
                        const span = document.createElement('span');
                        span.className = 'v-tts-span-active';
                        node.parentNode.insertBefore(span, node);
                        span.appendChild(node);
                        spans.push(span);
                    }
                }
                // 结束节点
                const endMiddle = endText.splitText(range.endOffset);
                const endSpan = document.createElement('span');
                endSpan.className = 'v-tts-span-active';
                endText.parentNode.insertBefore(endSpan, endText); // endText 现在是前半部分
                endSpan.appendChild(endText);
                spans.push(endSpan);
            }
            return spans;
        }

        return {
            apply(range) {
                this.remove();
                if (!range) return;
                // 如果高亮范围中包含块级元素，放弃高亮（只朗读，不改造 DOM）
                if (containsBlockElement(range)) return;
                try {
                    activeSpans = wrapRangeWithSpans(range);
                } catch (e) {
                    console.warn('高亮包裹失败，已跳过', e);
                    activeSpans = [];
                }
            },
            remove() {
                activeSpans.forEach(span => {
                    const parent = span.parentNode;
                    if (parent) {
                        while (span.firstChild) parent.insertBefore(span.firstChild, span);
                        parent.removeChild(span);
                        parent.normalize();
                    }
                });
                activeSpans = [];
            }
        };
    })();

    function applyHighlight(range) {
        highlightSystem.remove();
        if (range) highlightSystem.apply(range);
    }
    function removeHighlight() {
        highlightSystem.remove();
    }

    // 为链接节点创建临时 Range
    function createRangeFromNode(node) {
        const r = document.createRange();
        r.selectNode(node);
        return r;
    }

    // --- 事件监听 ---
    document.addEventListener('mousemove', (e) => {
        if (hoverTimer) clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => {
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
                lastSpokenText = '';
            }
        }, 100);
    });

    document.addEventListener('mouseout', (e) => {
        if (!e.relatedTarget || !e.relatedTarget.closest('.v-tts-span-active')) {
            setTimeout(() => {
                if (!document.querySelector('.v-tts-span-active')?.contains(document.activeElement)) {
                    removeHighlight();
                    stopSpeaking();
                    lastSpokenText = '';
                }
            }, 150);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            stopSpeaking();
            removeHighlight();
            lastSpokenText = '';
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