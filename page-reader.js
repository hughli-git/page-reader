// ==UserScript==
// @name         网页逐句悬停朗读(tts_v3接口)
// @namespace    http://tampermonkey.net/
// @version      5.3
// @description  鼠标悬停高亮句子并朗读，完全不破坏页面结构（CSS Highlight API + 安全降级）
// @author       Gemini
// @match        *://*.minecraft.wiki/*
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
    const V3_TTS_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
    const DEFAULT_V3_RESOURCE_ID = "volc.service_type.10029";
    const DEFAULT_V3_SPEAKER = "zh_female_shuangkuaisisi_moon_bigtts";

    function getVoiceConfig() {
        const savedVoice = GM_getValue('volc_voice', DEFAULT_V3_SPEAKER);
        return /^BV\d/i.test(savedVoice) ? DEFAULT_V3_SPEAKER : savedVoice;
    }

    const getConfig = () => ({
        appId: GM_getValue('volc_appid', ''),
        token: GM_getValue('volc_token', ''),
        voice: getVoiceConfig(),
        resourceId: GM_getValue('volc_resource_id', DEFAULT_V3_RESOURCE_ID)
    });

    // --- TTS 引擎 ---
    let currentAudio = null;
    let currentAudioStream = null;
    let lastRequest = null;
    let hoverTimer = null;
    let lastSpokenText = '';
    let speechRequestId = 0;

    const IGNORE_SELECTOR = 'input, textarea, select, button, option, label, [contenteditable="true"], .v-tts-span-active';
    const TEXT_CONTAINER_SELECTOR = [
        'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'td', 'th', 'dt', 'dd', 'figcaption', 'caption', 'blockquote',
        '.hatnote', '[role="note"]', '.msgbox-title', '.msgbox-text',
        '.infobox-row-label', '.infobox-row-field', '.gallerytext', '.mob-name'
    ].join(', ');
    const TEXT_NODE = Node.TEXT_NODE;

    function stopSpeaking() {
        speechRequestId++;
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
        if (currentAudioStream) { currentAudioStream.abort(); currentAudioStream = null; }
        if (lastRequest) { lastRequest.abort(); lastRequest = null; }
    }

    function makeRequestId() {
        if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    function decodeBase64Bytes(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    function createStreamingAudio() {
        const chunks = [];
        let started = false;
        let closed = false;
        let objectUrl = '';
        let mediaSource = null;
        let sourceBuffer = null;
        let queue = [];
        const audio = new Audio();
        currentAudio = audio;

        function playOnce() {
            if (!audio.src) return;
            if (started) return;
            started = true;
            audio.play().catch(() => { started = false; });
        }

        function appendNext() {
            if (!sourceBuffer || sourceBuffer.updating) return;
            if (queue.length) {
                sourceBuffer.appendBuffer(queue.shift());
                return;
            }
            if (closed && mediaSource && mediaSource.readyState === 'open') {
                try { mediaSource.endOfStream(); } catch (e) {}
            }
        }

        function playFallback() {
            if (!chunks.length) return;
            const blob = new Blob(chunks, { type: 'audio/mpeg' });
            objectUrl = URL.createObjectURL(blob);
            audio.src = objectUrl;
            playOnce();
        }

        const canStream = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg');
        if (canStream) {
            mediaSource = new MediaSource();
            objectUrl = URL.createObjectURL(mediaSource);
            audio.src = objectUrl;
            mediaSource.addEventListener('sourceopen', () => {
                if (!mediaSource || mediaSource.readyState !== 'open') return;
                sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
                sourceBuffer.addEventListener('updateend', appendNext);
                appendNext();
            }, { once: true });
        }

        return {
            append(bytes) {
                chunks.push(bytes);
                if (mediaSource) {
                    queue.push(bytes);
                    appendNext();
                    playOnce();
                }
            },
            close() {
                closed = true;
                if (mediaSource) {
                    appendNext();
                    return;
                }
                playFallback();
            },
            abort() {
                closed = true;
                queue = [];
                if (objectUrl) URL.revokeObjectURL(objectUrl);
                audio.removeAttribute('src');
                audio.load();
            }
        };
    }

    function speak(text) {
        text = text.trim();
        if (!text || text === lastSpokenText || text.length < 2) return;
        const config = getConfig();
        if (!config.appId || !config.token) return;
        stopSpeaking();
        lastSpokenText = text;
        const requestId = speechRequestId;
        const audioStream = createStreamingAudio();
        currentAudioStream = audioStream;
        let processedLength = 0;
        let pendingLine = '';

        const requestData = {
            user: {
                uid: "user_js"
            },
            req_params: {
                text: text,
                speaker: config.voice,
                audio_params: {
                    format: "mp3",
                    sample_rate: 24000
                }
            }
        };

        function handleLine(line) {
            if (!line || requestId !== speechRequestId) return;
            let payload;
            try {
                payload = JSON.parse(line);
            } catch (e) {
                return;
            }
            if (payload.data) {
                audioStream.append(decodeBase64Bytes(payload.data));
                return;
            }
            const code = Number(payload.code);
            if (payload.error || (payload.code != null && code !== 20000000 && code !== 0)) {
                console.warn('TTS V3 请求失败', payload);
            }
        }

        function processResponseText(responseText, flush) {
            if (requestId !== speechRequestId || !responseText) return;
            const nextText = responseText.slice(processedLength);
            processedLength = responseText.length;
            const lines = (pendingLine + nextText).split(/\r?\n/);
            pendingLine = flush ? '' : lines.pop();
            lines.forEach(handleLine);
            if (flush && pendingLine) handleLine(pendingLine);
        }

        lastRequest = GM_xmlhttpRequest({
            method: "POST",
            url: V3_TTS_URL,
            headers: {
                "Content-Type": "application/json",
                "X-Api-App-Id": config.appId,
                "X-Api-Access-Key": config.token,
                "X-Api-Resource-Id": config.resourceId,
                "X-Api-Request-Id": makeRequestId()
            },
            data: JSON.stringify(requestData),
            responseType: "text",
            onprogress: function(res) {
                processResponseText(res.responseText || '', false);
            },
            onload: function(res) {
                if (requestId !== speechRequestId) return;
                processResponseText(res.responseText || '', true);
                audioStream.close();
                lastRequest = null;
            },
            onerror: function(err) {
                if (requestId !== speechRequestId) return;
                console.warn('TTS V3 请求失败', err);
                audioStream.abort();
                lastRequest = null;
            },
            onabort: function() {
                if (requestId === speechRequestId) lastRequest = null;
            }
        });
    }

    function isSentenceBoundary(text, index) {
        const char = text[index];
        if (!char) return false;
        if ('。！？!?\n\r'.includes(char)) return true;
        return char === '.' && (index === text.length - 1 || /\s/.test(text[index + 1]));
    }

    function getCaretRangeFromPoint(x, y) {
        if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
        if (document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(x, y);
            if (!pos) return null;
            const range = document.createRange();
            range.setStart(pos.offsetNode, pos.offset);
            range.collapse(true);
            return range;
        }
        return null;
    }

    function isVisibleTextNode(node) {
        if (!node || node.nodeType !== TEXT_NODE || !node.textContent.trim()) return false;
        const parent = node.parentElement;
        if (!parent || parent.closest(IGNORE_SELECTOR)) return false;
        const range = document.createRange();
        range.selectNodeContents(node);
        const visible = Array.from(range.getClientRects()).some(rect => rect.width > 0 && rect.height > 0);
        range.detach();
        return visible;
    }

    function isPointInTextNode(node, x, y) {
        if (!isVisibleTextNode(node)) return false;
        const range = document.createRange();
        range.selectNodeContents(node);
        const hit = Array.from(range.getClientRects()).some(rect =>
            x >= rect.left - 1 && x <= rect.right + 1 &&
            y >= rect.top - 1 && y <= rect.bottom + 1
        );
        range.detach();
        return hit;
    }

    function isPointOnText(container, x, y) {
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                return isVisibleTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
        });
        let node;
        while (node = walker.nextNode()) {
            if (isPointInTextNode(node, x, y)) return true;
        }
        return false;
    }

    function textNodesIn(container) {
        const nodes = [];
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                return isVisibleTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
        });
        let node;
        while (node = walker.nextNode()) nodes.push(node);
        return nodes;
    }

    function locateTextPosition(nodes, absoluteOffset) {
        let currentPos = 0;
        for (const node of nodes) {
            const len = node.textContent.length;
            if (absoluteOffset <= currentPos + len) {
                return { node, offset: Math.max(0, absoluteOffset - currentPos) };
            }
            currentPos += len;
        }
        const last = nodes[nodes.length - 1];
        return last ? { node: last, offset: last.textContent.length } : null;
    }

    // --- 断句核心：获取当前句子文字与 DOM Range ---
    function getFullSentence(e) {
        const target = e.target;
        if (!(target instanceof Element)) return null;
        // 忽略表单控件和已有高亮区域
        if (target.closest(IGNORE_SELECTOR)) return null;

        const link = target.closest('a');
        if (link) {
            const text = (link.innerText || link.textContent || link.getAttribute('aria-label') || link.title || '').trim();
            if (text.length < 1) return null;
            return { text, nodes: [link] };
        }

        const range = getCaretRangeFromPoint(e.clientX, e.clientY);
        if (!range) return null;
        if (!isPointInTextNode(range.startContainer, e.clientX, e.clientY)) return null;

        const rangeElement = range.startContainer.nodeType === TEXT_NODE
            ? range.startContainer.parentElement
            : range.startContainer;
        if (!(rangeElement instanceof Element) || rangeElement.closest(IGNORE_SELECTOR)) return null;

        const rangeLink = rangeElement.closest('a');
        if (rangeLink) {
            const text = (rangeLink.innerText || rangeLink.textContent || rangeLink.getAttribute('aria-label') || rangeLink.title || '').trim();
            if (text.length < 1) return null;
            return { text, nodes: [rangeLink] };
        }

        // 寻找最近的块级/单元格容器，确保不跨 td/th 破坏表格
        const container = rangeElement.closest(TEXT_CONTAINER_SELECTOR) || target.closest(TEXT_CONTAINER_SELECTOR);
        if (!container) return null;
        if (!isPointOnText(container, e.clientX, e.clientY)) return null;

        const nodes = textNodesIn(container);
        const textParts = [];
        let offset = -1;
        let currentPos = 0;
        for (const node of nodes) {
            textParts.push(node.textContent);
            if (node === range.startContainer) offset = currentPos + range.startOffset;
            currentPos += node.textContent.length;
        }
        if (offset < 0) return null;

        const fullText = textParts.join('');

        // 按标点分句
        let start = offset;
        while (start > 0 && !isSentenceBoundary(fullText, start - 1)) start--;
        let end = offset;
        while (end < fullText.length && !isSentenceBoundary(fullText, end)) end++;
        if (end < fullText.length) end++;
        while (start < end && /\s/.test(fullText[start])) start++;
        while (end > start && /\s/.test(fullText[end - 1])) end--;

        const sentenceText = fullText.substring(start, end).trim();
        if (sentenceText.length < 2) return null;

        // 将字符偏移还原为 DOM Range（仅限容器内文本节点）
        const finalRange = document.createRange();
        const startPos = locateTextPosition(nodes, start);
        const endPos = locateTextPosition(nodes, end);
        if (startPos && endPos) {
            finalRange.setStart(startPos.node, Math.min(startPos.node.textContent.length, startPos.offset));
            finalRange.setEnd(endPos.node, Math.min(endPos.node.textContent.length, endPos.offset));
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

    function clearActive() {
        removeHighlight();
        stopSpeaking();
        lastSpokenText = '';
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
                applyHighlight(result.range || createRangeFromNode(result.nodes[0]));
                speak(result.text);
            } else {
                clearActive();
            }
        }, 100);
    });

    document.documentElement.addEventListener('mouseleave', clearActive);
    window.addEventListener('blur', clearActive);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            clearActive();
        }
    });

    // --- 菜单 ---
    GM_registerMenuCommand("⚙️ 配置火山引擎", () => {
        const appId = prompt("AppID:", GM_getValue('volc_appid', ''));
        const token = prompt("Access Token:", GM_getValue('volc_token', ''));
        const speaker = prompt("V3 Speaker:", getVoiceConfig());
        const resourceId = prompt("V3 Resource ID:", GM_getValue('volc_resource_id', DEFAULT_V3_RESOURCE_ID));
        if (appId) GM_setValue('volc_appid', appId);
        if (token) GM_setValue('volc_token', token);
        if (speaker) GM_setValue('volc_voice', speaker);
        if (resourceId) GM_setValue('volc_resource_id', resourceId);
        alert("保存成功！");
    });
})();
