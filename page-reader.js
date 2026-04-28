// ==UserScript==
// @name         中文字符选中即读 (火山引擎版)
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  鼠标选中文字后，通过火山引擎 TTS 自动朗读。需在菜单中配置 AppID 和 Token。
// @author       Gemini
// @match        *://*/*
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      openspeech.bytedance.com
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置管理 ---
    const getConfig = () => ({
        appId: GM_getValue('volc_appid', ''),
        token: GM_getValue('volc_token', ''),
        voice: GM_getValue('volc_voice', 'BV001_streaming'), // 默认：灿灿
    });

    // 常用音色列表 (可以根据火山文档自行添加)
    const VOICE_LIST = [
        { name: "字节灿灿 (通用女声)", id: "BV001_streaming" },
        { name: "字节马可 (通用男声)", id: "BV002_streaming" },
        { name: "精品女声-甜美", id: "BV056_streaming" },
        { name: "精品男声-阳光", id: "BV051_streaming" },
        { name: "可爱童声", id: "BV007_streaming" }
    ];

    // --- 注册油猴菜单 ---
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
    let lastRequest = null; // 记录上一次的网络请求

    function stopSpeaking() {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.src = ""; // 清空资源防止后台继续加载
            currentAudio = null;
        }
        // 2. 强行掐断还在传输中的网络请求
        if (lastRequest) {
            lastRequest.abort();
            lastRequest = null;
        }
    }

    function speak(text) {
        const config = getConfig();
        if (!config.appId || !config.token) {
            console.warn("火山引擎 AppID 或 Token 未配置，请在油猴菜单中设置。");
            return;
        }

        stopSpeaking();

        // 构造请求体
        const requestData = {
            app: {
                appid: config.appId,
                token: config.token,
                cluster: "volcano_tts"
            },
            user: { uid: "tampermonkey_user" },
            audio: {
                encoding: "mp3",
                voice_type: config.voice,
                speed_ratio: 1.0,
                volume_ratio: 1.0,
                pitch_ratio: 1.0,
            },
            request: {
                reqid: crypto.randomUUID(),
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
            onload: function(response) {
                // 请求完成，重置 lastRequest
                lastRequest = null;
                if (response.status === 200 && response.response.data) {
                    const audioBase64 = response.response.data;
                    const audioSrc = `data:audio/mp3;base64,${audioBase64}`;

                    currentAudio = new Audio(audioSrc);
                    currentAudio.play().catch(e => console.error("播放失败:", e));
                    console.log("火山引擎正在朗读...");
                } else {
                    console.error("火山引擎接口错误:", response.response.message || "未知错误");
                }
            },
            onerror: function(err) {
                console.error("请求失败:", err);
            }
        });
    }

    // --- 事件监听 ---
    document.addEventListener('mouseup', function() {
        // 使用 setTimeout 确保获取到最新的 selection
        setTimeout(() => {
            const selection = window.getSelection();
            const selectedText = selection.toString().trim();

            if (selectedText.length >= 1 && selectedText.length <= 500) {
                speak(selectedText);
            }
        }, 50);
    });

    // 键盘按下 Esc 停止播放
    document.addEventListener('keydown', (e) => {
        if (e.key === "Escape") stopSpeaking();
    });

})();