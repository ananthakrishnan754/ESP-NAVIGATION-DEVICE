#include <ESP8266WiFi.h>
#include <WebSocketsServer.h> // WebSockets by Markus Sattler
#include <TFT_eSPI.h>         // TFT_eSPI by Bodmer

// ----------------------------------------------------
// Setup TFT and WebSocket Objects
// ----------------------------------------------------
TFT_eSPI tft = TFT_eSPI(); 
WebSocketsServer webSocket = WebSocketsServer(81);

// ----------------------------------------------------
// Constants & Settings
// ----------------------------------------------------
const char *ssid = "BikeNav_AP";
const char *password = "12345678"; // Min 8 chars for WPA2

// The chunk settings must match what the phone web app sends.
// The web app sends chunks of 16 horizontal rows.
#define TFT_WIDTH  128
#define TFT_HEIGHT 160
#define CHUNK_ROWS 8
#define BYTES_PER_PIXEL 2

void setup() {
  Serial.begin(115200);
  Serial.println("\n\n--- BikeNav ESP8266 Boot ---");

  // 1. Initialize TFT
  tft.init();
  tft.setRotation(0); // Portrait (128x160)
  tft.setSwapBytes(true); // RGB565 usually needs swapped bytes over SPI
  
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextDatum(MC_DATUM); // Middle center
  
  tft.drawString("Starting WiFi...", TFT_WIDTH/2, 60, 2);

  // 2. Setup WiFi Access Point
  WiFi.softAP(ssid, password);
  IPAddress IP = WiFi.softAPIP();
  
  Serial.print("AP IP address: ");
  Serial.println(IP);

  // Update TFT with WiFi info
  tft.fillScreen(TFT_BLACK);
  tft.drawString("BikeNav Ready", TFT_WIDTH/2, 40, 2);
  tft.drawString("Connect Phone:", TFT_WIDTH/2, 70, 1);
  tft.drawString(ssid, TFT_WIDTH/2, 85, 2);
  tft.drawString(IP.toString(), TFT_WIDTH/2, 105, 1);
  tft.fillCircle(TFT_WIDTH/2, 140, 5, TFT_YELLOW);

  // 3. Start WebSocket Server
  webSocket.begin();
  webSocket.onEvent(webSocketEvent);
  
  Serial.println("WebSocket server started on port 81");
}

void loop() {
  // Continuously handle incoming WebSocket messages
  webSocket.loop();
}

// ----------------------------------------------------
// WebSocket Event Handler
// ----------------------------------------------------
void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {

  switch (type) {
    case WStype_DISCONNECTED:
      Serial.printf("[%u] Disconnected!\n", num);
      tft.fillScreen(TFT_BLACK);
      tft.drawString("Disconnected", TFT_WIDTH/2, TFT_HEIGHT/2, 2);
      break;

    case WStype_CONNECTED:
      {
        IPAddress ip = webSocket.remoteIP(num);
        Serial.printf("[%u] Connected from %d.%d.%d.%d url: %s\n", num, ip[0], ip[1], ip[2], ip[3], payload);
        tft.fillScreen(TFT_BLACK);
      }
      break;

    // Handle incoming binary image chunks
    case WStype_BIN:
      {
        // Safety check: Expected: 4 bytes (header) + (128 * 8 * 2) bytes (pixels) = 2052 bytes
        if (length != (TFT_WIDTH * CHUNK_ROWS * BYTES_PER_PIXEL) + 4) {
          Serial.printf("Warning: received chunk of unexpected size: %u bytes\n", length);
          return;
        }

        // Parse header
        uint8_t chunk_idx = payload[0];
        
        // Calculate Y offset on the screen
        uint16_t start_y = chunk_idx * CHUNK_ROWS;

        // Pointer skip the first 4 bytes (header) to point at the pixel array
        // Because payload[4] is 32-bit aligned, casting to uint16_t* via DMA won't distort
        uint16_t *pixel_data = (uint16_t *)(payload + 4);

        // Blast the pixels straight to the SPI TFT driver
        tft.pushImage(0, start_y, TFT_WIDTH, CHUNK_ROWS, pixel_data);
      }
      break;

    case WStype_TEXT:
      // We only expect binary chunks, but keeping this for debugging
      Serial.printf("[%u] text: %s\n", num, payload);
      break;
      
    case WStype_ERROR:			
    case WStype_FRAGMENT_TEXT_START:
    case WStype_FRAGMENT_BIN_START:
    case WStype_FRAGMENT:
    case WStype_FRAGMENT_FIN:
      break;
  }
}
