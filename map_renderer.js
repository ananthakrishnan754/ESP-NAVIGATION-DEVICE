/* ════════════════════════════════════════════════
   map_renderer.js — DOM to Canvas to RGB565
   Requires html2canvas. Handles 128x160 TFT stream.
   ════════════════════════════════════════════════ */

'use strict';

const MapRenderer = (() => {

    const TFT_W = 128;
    const TFT_H = 160;
    const CHUNK_ROWS = 8;  // 20 chunks of 8 rows = 160 rows

    let isGenerating = false;
    let turnDirection = null;
    let distanceStr = '--';

    // Bike state for native canvas render
    let bikeLat = 0;
    let bikeLng = 0;
    let currentSpeed = 0;
    let headingDegrees = 0;

    /* ── State Setters for Canvas ── */
    function setBikeState(lat, lng, speed) {
        bikeLat = lat; bikeLng = lng; currentSpeed = speed;
    }

    function setHeading(hdg) {
        headingDegrees = hdg;
    }

    function updateDistance(dist) { distanceStr = dist; }
    function updateTurnArrow(dir) { turnDirection = dir; }

    /* ── Utilities ── */
    function haversine(p1, p2) {
        const R = 6371e3; // meters
        const φ1 = p1.lat * Math.PI / 180, φ2 = p2.lat * Math.PI / 180;
        const Δφ = (p2.lat - p1.lat) * Math.PI / 180;
        const Δλ = (p2.lng - p1.lng) * Math.PI / 180;
        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /* ── Native UI Drawing ── */
    // Extracted native arrow drawing so we can draw it directly on the final composite
    function drawArrow(ctx, direction, x, y) {
        if (!direction) return;
        ctx.save();
        ctx.translate(x, y);
        ctx.strokeStyle = '#FFEB3B';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        switch (direction) {
            case 'LEFT':
                ctx.beginPath(); ctx.moveTo(8, -8); ctx.lineTo(-8, 0); ctx.lineTo(8, 8); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(12, 0); ctx.stroke();
                break;
            case 'RIGHT':
                ctx.beginPath(); ctx.moveTo(-8, -8); ctx.lineTo(8, 0); ctx.lineTo(-8, 8); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(8, 0); ctx.stroke();
                break;
            case 'UTURN':
                ctx.beginPath(); ctx.arc(0, -4, 8, Math.PI, 0, false); ctx.lineTo(8, 10); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(4, 6); ctx.lineTo(8, 12); ctx.lineTo(12, 6); ctx.stroke();
                break;
            default: // STRAIGHT
                ctx.beginPath(); ctx.moveTo(0, 12); ctx.lineTo(0, -12); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(-8, -4); ctx.lineTo(0, -12); ctx.lineTo(8, -4); ctx.stroke();
        }
        ctx.restore();
    }

    /* ── Generate Frame & Stream ── */
    async function generateAndStreamFrame() {
        if (isGenerating) return;
        isGenerating = true;

        try {
            // 1. Snapshot the cartoDB base map (if tiles load)
            const mapEl = document.getElementById('tftMap');
            const canvasMap = await html2canvas(mapEl, {
                width: TFT_W,
                height: TFT_H,
                useCORS: true,
                logging: false,
                backgroundColor: '#000000', // Solid black base fallback
                scale: 1 // Crucial for performance, don't upsample
            });

            // 2. Draw composite onto our preview canvas
            const compCanvas = document.getElementById('tftComposite');
            const ctx = compCanvas.getContext('2d', { willReadFrequently: true });

            // Clear and draw base map
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, TFT_W, TFT_H);
            ctx.drawImage(canvasMap, 0, 0);

            // 3. Draw Native Vector Overlays
            // This guarantees razor sharp UI elements on the TFT!

            // Dark Top Bar (30px)
            ctx.fillStyle = 'rgba(20, 20, 26, 0.9)';
            ctx.fillRect(0, 0, TFT_W, 30);
            ctx.beginPath(); ctx.moveTo(0, 30); ctx.lineTo(TFT_W, 30);
            ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.stroke();

            // Arrow Layer
            drawArrow(ctx, turnDirection, 18, 15);

            // Distance Layer
            if (distanceStr && distanceStr !== '--') {
                ctx.fillStyle = '#FFFFFF';
                ctx.font = 'bold 15px sans-serif';
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'right';
                ctx.fillText(distanceStr, TFT_W - 8, 15);
            }

            // Dark Bottom Bar for Speed (20px)
            ctx.fillStyle = 'rgba(20, 20, 26, 0.9)';
            ctx.fillRect(0, TFT_H - 22, TFT_W, 22);
            ctx.beginPath(); ctx.moveTo(0, TFT_H - 22); ctx.lineTo(TFT_W, TFT_H - 22);
            ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.stroke();

            // Speed
            const speedKmh = Math.round((currentSpeed || 0) * 3.6);
            ctx.fillStyle = '#4FC3F7';
            ctx.font = 'bold 16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(speedKmh + ' km/h', TFT_W / 2, TFT_H - 10);

            // Draw sharp bike cursor in center of map
            // Center is approx (64, 80)
            const mapCy = (TFT_H / 2) + 5; // Offset slightly for top bar
            ctx.save();
            ctx.translate(TFT_W / 2, mapCy);
            // Draw a neat blue triangle pointing up
            ctx.rotate(headingDegrees * Math.PI / 180);
            ctx.beginPath();
            ctx.moveTo(0, -9);
            ctx.lineTo(7, 7);
            ctx.lineTo(0, 4);
            ctx.lineTo(-7, 7);
            ctx.closePath();
            ctx.fillStyle = '#00E676';
            ctx.fill();
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();

            // 4. Extract pixels and stream if WS connected
            if (WSManager.isConnected()) {
                const imgData = ctx.getImageData(0, 0, TFT_W, TFT_H).data;
                _streamRGB565Chunks(imgData);
            }

        } catch (err) {
            console.warn('Frame generation error:', err);
        }

        isGenerating = false;
    }

    /* ── Convert RGBA to RGB565 and send in chunks ── */
    function _streamRGB565Chunks(rgbaData) {
        const totalPixels = TFT_W * TFT_H;

        // Each pixel is 2 bytes in RGB565
        // One chunk = CHUNK_ROWS * TFT_W pixels = 8 * 128 = 1024 pixels = 2048 bytes
        // Plus 4 byte header for 32-bit memory alignment on ESP8266: [ChunkIdx, 0, 0, 0]
        const chunkPixelCount = TFT_W * CHUNK_ROWS;
        const chunkByteSize = (chunkPixelCount * 2) + 4;

        // Total chunks = 160 / 8 = 20
        const numChunks = TFT_H / CHUNK_ROWS;

        for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
            const buffer = new Uint8Array(chunkByteSize);
            buffer[0] = chunkIdx; // Header: Row Index
            buffer[1] = 0; buffer[2] = 0; buffer[3] = 0; // Padding for 32-bit alignment

            const pixelStartOffset = chunkIdx * chunkPixelCount;

            for (let i = 0; i < chunkPixelCount; i++) {
                const globalPixelIdx = pixelStartOffset + i;
                const rgbaIdx = globalPixelIdx * 4;

                const r = rgbaData[rgbaIdx];
                const g = rgbaData[rgbaIdx + 1];
                const b = rgbaData[rgbaIdx + 2];

                // Convert RGB888 to RGB565
                const rgb565 = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);

                // Store big-endian (TFT_eSPI uses this by default over SPI)
                buffer[4 + (i * 2)] = rgb565 >> 8;   // High byte
                buffer[4 + (i * 2) + 1] = rgb565 & 0xFF; // Low byte
            }

            // Queue the chunk to send
            // WSManager will drop it if the buffer is flooding
            WSManager.sendChunk(buffer);
        }
    }

    /* ── Public API ── */
    return {
        TFT_W, TFT_H,
        updateTurnArrow,
        updateDistance,
        setBikeState,
        setHeading,
        generateAndStreamFrame,
        haversine
    };

})();
