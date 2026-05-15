/* ════════════════════════════════════════════════
   ble_manager.js — Web Bluetooth for ESP32 TFT
   Streams raw RGB565 chunks over BLE
   ════════════════════════════════════════════════ */

'use strict';

const BLEManager = (() => {

    const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
    const CHARACTERISTIC_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";

    let device = null;
    let characteristic = null;
    let onDisconnectCb = null;
    let isConnecting = false;

    /* ── Connect ── */
    async function connect(onDisconnect) {
        if (isConnecting) return;
        isConnecting = true;
        onDisconnectCb = onDisconnect || null;

        try {
            console.log('[BLE] Requesting device...');
            device = await navigator.bluetooth.requestDevice({
                filters: [{ name: 'BikeNav-ESP32' }],
                optionalServices: [SERVICE_UUID]
            });

            device.addEventListener('gattserverdisconnected', _onDisconnected);

            console.log('[BLE] Connecting to GATT server...');
            const server = await device.gatt.connect();

            console.log('[BLE] Getting Service...');
            const service = await server.getPrimaryService(SERVICE_UUID);

            console.log('[BLE] Getting Characteristic...');
            characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

            console.log('[BLE] Connected!');
            isConnecting = false;
            return 'BikeNav-ESP32';
        } catch (err) {
            isConnecting = false;
            _cleanup();
            throw err;
        }
    }

    /* ── Disconnect ── */
    function disconnect() {
        if (device && device.gatt.connected) {
            device.gatt.disconnect();
        }
        _cleanup();
    }

    /* ── Send Chunk (Binary Uint8Array) ── */
    async function sendChunk(chunkData) {
        if (!isConnected()) return false;

        try {
            // writeValueWithoutResponse is faster but less reliable. 
            // For a 1 row chunk (260 bytes), it should be fine.
            await characteristic.writeValueWithoutResponse(chunkData);
            return true;
        } catch (err) {
            console.warn('[BLE] Send error:', err.message);
            return false;
        }
    }

    /* ── Status ── */
    function isConnected() {
        return device && device.gatt.connected && characteristic;
    }

    /* ── Internal ── */
    function _onDisconnected() {
        console.log('[BLE] Device disconnected');
        _cleanup();
        if (onDisconnectCb) onDisconnectCb();
    }

    function _cleanup() {
        device = null;
        characteristic = null;
    }

    /* ── Public API ── */
    return { connect, disconnect, sendChunk, isConnected };

})();
