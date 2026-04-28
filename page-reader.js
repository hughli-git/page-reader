// ==UserScript==
// @name         网页逐句悬停朗读 (火山引擎版)
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  鼠标悬停在句子上时背景变色并自动朗读。支持超链接独立识别，支持句号/换行切割。
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

    // --- 配置与样式 ---
    const HIGHLIGHT_COLOR = 'rgba(255, 255, 0, 0.5)'; // 悬停底色
    GM_addStyle(`
        .tts-sentence-highlight { background-color: ${HIGHLIGHT_COLOR} !important; cursor: pointer; }
    `);

    const getConfig = () => ({
        appId: GM_getValue('volc_appid', ''),
        token: GM_getValue('volc_token', ''),
        voice: GM_getValue('volc_voice', 'BV001_streaming'),
    });

    const VOICE_LIST = [
        { name: "字节灿灿 (通用女声)", id: "BV001_streaming" },
        { name: "字节马可 (通用男声)", id: "BV002_streaming" },
        { name: "精品女声-甜美", id: "BV056_streaming" },
        { name: "精品男声-阳光", id: "BV051_streaming" },
        { name: "可爱童声", id: "BV007_streaming" }
    ];

    // --- 菜单命令 ---
    GM_registerMenuCommand("⚙️ 设置火山引擎配置", () => {
        const appId = prompt("请输入火山引擎 AppID:", GM_getValue('volc_appid', ''));
        const token = prompt("请输入火山引擎 Access Token:", GM_getValue('volc_token', ''));
        if (appId !== null) GM_setValue('volc_appid', appId);
        if (token !== null) GM_setValue('volc_token', token);
        alert("配置已保存！");
    });

    GM_registerMenuCommand("🔊 切换音色", () => {
        let menuText = "请选择音色编号:\n\n";
        VOICE_LIST.forEach((v, i) => menuText += `${i + 1}. ${v.name}\n`);
        const choice = prompt(menuText);
        if (choice && VOICE_LIST[choice - 1]) {
            const v = VOICE_LIST[choice - 1];
            GM_setValue('volc_voice', v.id);
            alert(`已切换至: ${v.name}`);
        }
    });

    // --- TTS 核心逻辑 ---
    let currentAudio = null;
    let lastRequest = null;
    let hoverTimer = null; // 用于防抖

    function stopSpeaking() {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.src = "";
            currentAudio = null;
        }
        if (lastRequest) {
            lastRequest.abort();
            lastRequest = null;
        }
    }

    function speak(text) {
        const config = getConfig();
        if (!config.appId || !config.token) return;

        stopSpeaking();
        if (!text || text.trim().length === 0) return;

        const requestData = {
            app: { appId: config.appId, token: config.token, cluster: "volcano_tts" },
            user: { uid: "tampermonkey_user" },
            audio: { encoding: "mp3", voice_type: config.voice, speed_ratio: 1.0, volume_ratio: 1.0, pitch_ratio: 1.0 },
            request: { reqid: crypto.randomUUID(), text: text, text_type: "plain", operation: "query" }
        };

        lastRequest = GM_xmlhttpRequest({
            method: "POST",
            url: "https://openspeech.bytedance.com/api/v1/tts",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer;${config.token}` },
            data: JSON.stringify(requestData),
            responseType: "json",
            onload: function(response) {
                lastRequest = null;
                if (response.status === 200 && response.response.data) {
                    currentAudio = new Audio(`data:audio/mp3;base64,${response.response.data}`);
                    currentAudio.play().catch(e => console.error("播放失败:", e));
                }
            }
        });
    }

    // --- DOM 处理：拆分句子 ---
    function processNode(node) {
        // 忽略脚本、样式、输入框以及已经被处理过的节点
        const ignoreTags = ['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA', 'NOSCRIPT', 'CANVAS', 'AUDIO', 'VIDEO'];
        if (ignoreTags.includes(node.tagName)) return;

        // 如果是超链接，整体作为一个单元
        if (node.tagName === 'A') {
            node.classList.add('tts-sentence-unit');
            return;
        }

        // 遍历子节点
        const childNodes = Array.from(node.childNodes);
        childNodes.forEach(child => {
            if (child.nodeType === Node.TEXT_NODE) {
                const text = child.textContent;
                if (text.trim().length === 0) return;

                // 匹配句子（以句号、问号、感叹号或换行符结尾）
                const sentences = text.match(/[^。！？\n\r]+[。！？\n\r]?|[\。！？\n\r]/g);
                if (sentences) {
                    const fragment = document.createDocumentFragment();
                    sentences.forEach(s => {
                        if (s.trim().length > 0) {
                            const span = document.createElement('span');
                            span.className = 'tts-sentence-unit';
                            span.textContent = s;
                            fragment.appendChild(span);
                        } else {
                            fragment.appendChild(document.createTextNode(s));
                        }
                    });
                    child.replaceWith(fragment);
                }
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                processNode(child);
            }
        });
    }

    // 初始化处理页面已有的文本
    const containers = document.querySelectorAll('p, li, div, h1, h2, h3, h4, h5, h6, article, section, span');
    containers.forEach(el => {
        // 仅处理最直接的容器，避免重复包裹
        if (el.children.length === 0 || Array.from(el.childNodes).some(n => n.nodeType === Node.TEXT_NODE)) {
            // 这里简单处理，生产环境可能需要更复杂的判定
        }
    });
    // 粗暴但简单的方法：只针对常见的文本容器
    document.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6').forEach(processNode);

    // --- 事件监听 ---
    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest('.tts-sentence-unit');
        if (target) {
            // 清除旧的定时器
            if (hoverTimer) clearTimeout(hoverTimer);

            // 添加高亮
            target.classList.add('tts-sentence-highlight');

            // 延迟 300ms 触发朗读，防止鼠标掠过时乱响
            hoverTimer = setTimeout(() => {
                const text = target.innerText || target.textContent;
                speak(text.trim());
            }, 300);
        }
    });

    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest('.tts-sentence-unit');
        if (target) {
            if (hoverTimer) clearTimeout(hoverTimer);
            target.classList.remove('tts-sentence-highlight');
            stopSpeaking();
        }
    });

    // Esc 键停止
    document.addEventListener('keydown', (e) => {
        if (e.key === "Escape") stopSpeaking();
    });

    // 针对动态加载的内容（可选）
    // console.log("逐句朗读脚本已就绪...");
})();