// ==UserScript==
// @name         中文字符指即读 (增强版)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  鼠标移动到汉字上时自动朗读，增加激活提醒
// @author       Gemini
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let lastChar = '';
    let synth = window.speechSynthesis;
    let isActivated = false; // 是否已点击激活

    // 创建一个悬浮提示框，告诉用户需要点击
    const tip = document.createElement('div');
    tip.innerHTML = '📢 语音脚本已加载，<b>请点击页面任意处激活</b>';
    tip.style = 'position:fixed; top:10px; right:10px; z-index:9999; background:#fffbe6; border:1px solid #ffe58f; padding:8px 15px; border-radius:4px; font-size:12px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.15);';
    document.body.appendChild(tip);

    // 用户点击页面后激活
    window.addEventListener('click', () => {
        if (!isActivated) {
            isActivated = true;
            tip.innerHTML = '✅ 语音已激活，移动鼠标到汉字上试试';
            setTimeout(() => tip.style.display = 'none', 2000);

            // 预热语音引擎 (有些浏览器首跳需要空运行一次)
            let msg = new SpeechSynthesisUtterance('');
            synth.speak(msg);
            console.log("语音引擎已激活");
        }
    }, { once: true });

    function speak(text) {
        if (!isActivated) return;

        if (synth.speaking) synth.cancel();

        let utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN';
        // 尝试获取中文嗓音，如果没指定，浏览器会自动选默认的
        let voices = synth.getVoices();
        let zhVoice = voices.find(v => v.lang.includes('zh-CN'));
        if (zhVoice) utterance.voice = zhVoice;

        utterance.onend = () => console.log('读完啦:', text);
        utterance.onerror = (e) => console.error('朗读出错:', e);

        synth.speak(utterance);
    }

    document.addEventListener('mousemove', function(e) {
        if (!isActivated) return;

        let range, textNode, offset, char;

        if (document.caretRangeFromPoint) {
            range = document.caretRangeFromPoint(e.clientX, e.clientY);
            if (!range) return;
            textNode = range.startContainer;
            offset = range.startOffset;
        } else if (document.caretPositionFromPoint) {
            let position = document.caretPositionFromPoint(e.clientX, e.clientY);
            if (!position) return;
            textNode = position.offsetNode;
            offset = position.offset;
        }

        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
            char = textNode.textContent.charAt(offset);

            // 匹配汉字或英文单词
            if (/[\u4e00-\u9fa5]/.test(char)) {
                if (char !== lastChar) {
                    console.log("捕获到汉字:", char);
                    lastChar = char;
                    speak(char);
                }
            } else {
                lastChar = '';
            }
        }
    }, { passive: true });
})();