// ==UserScript==
// @name         中文字符双击即读
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  双击网页文字，如果是单字或两个字的词语则自动朗读
// @author       Gemini
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const synth = window.speechSynthesis;

    function speak(text) {
        if (synth.speaking) {
            synth.cancel();
        }
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN';
        utterance.rate = 1.0;
        synth.speak(utterance);
    }

    // 监听全局双击事件
    document.addEventListener('dblclick', function() {
        // 获取选中的文本并去掉空格
        let selectedText = window.getSelection().toString().trim();

        // 逻辑判断：
        // 1. 不能为空
        // 2. 长度为 1 或 2（满足用户要求的“单字或两个字的词”）
        if (selectedText.length > 0 && selectedText.length <= 2) {
            console.log("正在朗读选中内容:", selectedText);
            speak(selectedText);
        } else {
            console.log("选中内容长度不符（仅限1-2字）:", selectedText);
        }
    });

})();