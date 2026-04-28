// ==UserScript==
// @name         极速悬停点读
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    let synth = window.speechSynthesis;
    document.addEventListener('mouseover', function(e) {
        if (e.target.innerText && e.target.innerText.length < 10) { // 仅针对短句或汉字，防止误触读长篇
            let utter = new SpeechSynthesisUtterance(e.target.innerText);
            utter.lang = 'zh-CN';
            utter.rate = 1.2; // 语速稍微加快显得延迟更低
            synth.cancel(); // 停止之前的，立即读当前的
            synth.speak(utter);
        }
    }, false);
})();