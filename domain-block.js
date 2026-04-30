// ==UserScript==
// @name         Domain Whitelist Guard (Stable)
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  白名单控制（稳定版）
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const whitelist = [
        "minecraft.wiki"
    ];

    const host = location.hostname;

    function isAllowed(host) {
        return whitelist.some(domain =>
            host === domain || host.endsWith("." + domain)
        );
    }

    if (!isAllowed(host)) {

        // 关键：用 document.write 覆盖页面（最稳定）
        document.open();
        document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>禁止访问</title>
                <style>
                    body {
                        margin: 0;
                        background: #111;
                        color: #fff;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        font-size: 40px;
                        font-family: sans-serif;
                    }
                </style>
            </head>
            <body>
                🚫 禁止使用该网站
            </body>
            </html>
        `);
        document.close();

        // 不要用 window.stop()
    }
})();