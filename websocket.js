/* ════════════════════════════════════════════════
   websocket.js — WebSockets for ESP8266 TFT
   Streams raw RGB565 chunks over WiFi
   ════════════════════════════════════════════════ */

'use strict';

const WSManager = (() => {

    let _wsUrl = '192.168.4.1';

    /* ── Set IP ── */
    function setIP(ip) {
        if (ip) _wsUrl = ip;
    }

    /* ── State ── */
    let ws = null;
    let onDisconnectCb = null;

    /* ── Connect ── */
    function connect(onDisconnect) {
        onDisconnectCb = onDisconnect || null;

        return new Promise((resolve, reject) => {
            // Browser must be on same WiFi network
            try {
                ws = new WebSocket(`ws://${_wsUrl}:81`);
                ws.binaryType = "arraybuffer";
            } catch (err) {
                return reject(new Error('WebSocket init failed (Are you on ESP WiFi?)'));
            }

            const timeout = setTimeout(() => {
                if (ws && ws.readyState !== WebSocket.OPEN) {
                    ws.close();
                    reject(new Error('Connection timeout (8s). Check IP and ensure you are on the same WiFi map.'));
                }
            }, 8000);

            ws.onopen = () => {
                clearTimeout(timeout);
                resolve('ESP8266 TFT');
            };

            ws.onerror = (err) => {
                clearTimeout(timeout);
                console.error('[WS] Error connection to', _wsUrl, ':', err);

                if (window.location.protocol === 'https:') {
                    reject(new Error('Browser blocked local IP on HTTPS. Host this via local python HTTP or use ngrok.'));
                } else {
                    reject(new Error('WebSocket connection refused. Is the IP correct?'));
                }
            };

            ws.onclose = () => {
                clearTimeout(timeout);
                _cleanup();
            };
        });
    }

    /* ── Disconnect ── */
    function disconnect() {
        if (ws) {
            ws.close();
        }
        _cleanup();
    }

    /* ── Send Chunk (Binary Uint8Array) ── */
    function sendChunk(chunkData) {
        if (!isConnected()) return false;

        // Allow up to ~100KB in the buffer before dropping chunks to prevent tearing the frame
        if (ws.bufferedAmount > 100000) {
            return false; // drop frame
        }

        try {
            ws.send(chunkData);
            return true;
        } catch (err) {
            console.warn('[WS] Send error:', err.message);
            return false;
        }
    }

    /* ── Status ── */
    function isConnected() {
        return ws && ws.readyState === WebSocket.OPEN;
    }

    /* ── Internal ── */
    function _cleanup() {
        ws = null;
        if (onDisconnectCb) onDisconnectCb();
    }

    /* ── Public API ── */
    return { connect, disconnect, sendChunk, isConnected, setIP };

})();
