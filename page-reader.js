// ==UserScript==
// @name         中文字符指即读
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  鼠标移动到汉字上时自动朗读该汉字
// @author       Gemini
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let lastChar = ''; // 记录上一个朗读的字符，防止重复触发
    let synth = window.speechSynthesis;

    // 配置语音参数
    function speak(text) {
        // 如果正在朗读，先停止（可选，为了流畅度通常直接取消前一个）
        if (synth.speaking) {
            synth.cancel();
        }

        let utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN'; // 设置为中文
        utterance.rate = 1.0; // 语速
        utterance.pitch = 1.0; // 音调
        synth.speak(utterance);
    }

    // 核心逻辑：获取鼠标位置的字符
    document.addEventListener('mousemove', function(e) {
        let range, textNode, offset, char;

        // Chrome, Edge, Safari 支持 caretRangeFromPoint
        if (document.caretRangeFromPoint) {
            range = document.caretRangeFromPoint(e.clientX, e.clientY);
            if (!range) return;
            textNode = range.startContainer;
            offset = range.startOffset;
        }
        // Firefox 支持 caretPositionFromPoint
        else if (document.caretPositionFromPoint) {
            let position = document.caretPositionFromPoint(e.clientX, e.clientY);
            if (!position) return;
            textNode = position.offsetNode;
            offset = position.offset;
        }

        // 确保获取的是文本节点
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
            char = textNode.textContent.charAt(offset);

            // 正则表达式判断是否为汉字 (Unicode 范围)
            if (/[\u4e00-\u9fa5]/.test(char)) {
                // 如果字符变了才朗读，避免鼠标微动导致重复读同一个字
                if (char !== lastChar) {
                    lastChar = char;
                    speak(char);
                }
            } else {
                lastChar = ''; // 移出汉字区域，重置状态
            }
        } else {
            lastChar = '';
        }
    }, { passive: true });

})();