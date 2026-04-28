// ==UserScript==
// @name         中文字符选中即读 (拖动+双击)
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  鼠标拖动选中或双击文字后，自动朗读选中的内容（限制1-5个字）
// @author       Gemini
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const synth = window.speechSynthesis;

    function speak(text) {
        // 如果正在读，先掐断，保证反馈及时
        if (synth.speaking) {
            synth.cancel();
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN';
        utterance.rate = 1.0;

        // 某些浏览器需要通过这个小技巧确保声音发出
        synth.speak(utterance);
    }

    // 监听鼠标抬起事件（涵盖了拖动结束和双击结束）
    document.addEventListener('mouseup', function() {
        // 延迟一小会儿确保浏览器已经完成选中操作
        setTimeout(() => {
            const selection = window.getSelection();
            const selectedText = selection.toString().trim();

            // 逻辑：
            // 1. 内容不能为空
            // 2. 限制长度（比如 1 到 5 个字），防止不小心选中一大段话也读
            if (selectedText.length >= 1 && selectedText.length <= 500) {
                console.log("触发朗读:", selectedText);
                speak(selectedText);
            }
        }, 10);
    });

    // 针对移动端或特殊选框，也可以监听选择变化（可选）
    // document.onselectionchange = function() { ... };

})();