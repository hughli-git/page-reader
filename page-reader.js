// ==UserScript==
// @name         中文字符选中即读 (支持声音切换)
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  鼠标拖动选中或双击文字后，自动朗读。可通过油猴菜单切换声音引擎。
// @author       Gemini
// @match        *://*/*
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function() {
    'use strict';

    const synth = window.speechSynthesis;
    let voices = [];

    // 获取保存的声音名称
    const getSavedVoiceName = () => GM_getValue('selectedVoiceName', '');

    // 获取并过滤中文声音列表
    function getChineseVoices() {
        return synth.getVoices().filter(v => v.lang.includes('zh') || v.lang.includes('CN'));
    }

    // 注册切换声音的菜单命令
    function registerVoiceMenu() {
        const zhVoices = getChineseVoices();
        if (zhVoices.length === 0) return;

        // 清除旧菜单（如果脚本热重载）
        // 注意：标准油猴API不支持直接清除，这里通过重新注册覆盖逻辑
        GM_registerMenuCommand("🔊 切换/查看当前声音", () => {
            const currentVoiceName = getSavedVoiceName();
            let menuText = "请选择声音编号 (当前: " + (currentVoiceName || "系统默认") + "):\n\n";

            zhVoices.forEach((v, index) => {
                menuText += `${index + 1}. ${v.name} ${v.localService ? '(离线)' : '(在线)'}\n`;
            });

            const choice = prompt(menuText);
            if (choice && zhVoices[choice - 1]) {
                const newVoice = zhVoices[choice - 1];
                GM_setValue('selectedVoiceName', newVoice.name);
                alert("已切换至: " + newVoice.name);
            }
        });
    }

    function speak(text) {
        if (synth.speaking) {
            synth.cancel();
        }

        const utterance = new SpeechSynthesisUtterance(text);
        const zhVoices = getChineseVoices();
        const savedName = getSavedVoiceName();

        // 查找匹配的声音对象
        let selectedVoice = zhVoices.find(v => v.name === savedName);

        // 如果没设过或者找不到，优先找 Edge 的晓晓 (Xiaoxiao)，其次找 Google
        if (!selectedVoice) {
            selectedVoice = zhVoices.find(v => v.name.includes('Xiaoxiao')) ||
                            zhVoices.find(v => v.name.includes('Google')) ||
                            zhVoices[0];
        }

        if (selectedVoice) {
            utterance.voice = selectedVoice;
            // 打印一下，方便你在控制台确认当前用的是哪个引擎
            console.log("当前引擎:", selectedVoice.name);
        }

        utterance.lang = 'zh-CN';
        utterance.rate = 1.0; // 稍微快一点点更自然
        synth.speak(utterance);
    }

    // 关键：监听声音列表加载
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = () => {
            registerVoiceMenu();
        };
    }

    // 初始执行一次
    setTimeout(registerVoiceMenu, 1000);

    document.addEventListener('mouseup', function() {
        setTimeout(() => {
            const selection = window.getSelection();
            const selectedText = selection.toString().trim();

            if (selectedText.length >= 1 && selectedText.length <= 500) {
                speak(selectedText);
            }
        }, 10);
    });

})();