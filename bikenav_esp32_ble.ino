#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <SPI.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>

// ----------------------------------------------------
// TFT Pins (Matches your working snippet)
// ----------------------------------------------------
#define TFT_CS    5
#define TFT_RST   4
#define TFT_DC    2   // DC/A0 Pin

// Display dimensions
#define TFT_WIDTH  128
#define TFT_HEIGHT 160

// BLE UUIDs (Generated unique ones for this device)
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

// Create display object
Adafruit_ST7735 tft = Adafruit_ST7735(TFT_CS, TFT_DC, TFT_RST);

// BLE Objects
BLEServer* pServer = NULL;
BLECharacteristic* pCharacteristic = NULL;
bool deviceConnected = false;

// ----------------------------------------------------
// BLE Callback Class
// ----------------------------------------------------
class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
      Serial.println("Phone connected via BLE");
      tft.fillScreen(ST77XX_BLACK);
    };

    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      Serial.println("Phone disconnected");
      // Restart advertising
      pServer->getAdvertising()->start();
      tft.fillScreen(ST77XX_BLACK);
      tft.setTextColor(ST77XX_RED);
      tft.setCursor(10, 60);
      tft.println("Disconnected");
    }
};

class MyCharacteristicCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
      std::string value = pCharacteristic->getValue();
      uint8_t* payload = (uint8_t*)value.data();
      size_t length = value.length();

      // Expected format: [chunk_idx, 0, 0, 0, pixel_data...]
      // We expect 1 row per chunk for BLE efficiency
      // 1 row = 128 pixels * 2 bytes = 256 bytes. Total = 260 bytes.
      if (length >= 4) {
        uint8_t chunk_idx = payload[0];
        uint16_t* pixel_data = (uint16_t*)(payload + 4);
        
        // Calculate Y position (assuming 1 row per chunk)
        // If we use multiple rows per chunk, we'd need to adjust this logic.
        // For now, let's assume 1 row per chunk.
        uint16_t start_y = chunk_idx; 

        if (start_y < TFT_HEIGHT) {
          // Draw the row
          // Note: Adafruit_ST7735 handles big-endian RGB565 by default
          tft.drawRGBBitmap(0, start_y, pixel_data, TFT_WIDTH, 1);
        }
      }
    }
};

void setup() {
  Serial.begin(115200);
  Serial.println("Starting ESP32 BLE Navigation Device...");

  // 1. Initialize TFT
  tft.initR(INITR_BLACKTAB);
  tft.setRotation(0); // Portrait (128x160) to match Web App
  tft.fillScreen(ST77XX_BLACK);

  // Splash Screen (Based on your working snippet)
  tft.setTextColor(ST77XX_GREEN);
  tft.setTextSize(2);
  tft.setCursor(10, 20);
  tft.println("BikeNav");
  
  tft.drawRect(5, 5, 118, 150, ST77XX_RED);
  tft.drawCircle(64, 80, 30, ST77XX_BLUE);
  tft.fillCircle(64, 80, 10, ST77XX_YELLOW);

  tft.setTextColor(ST77XX_CYAN);
  tft.setTextSize(1);
  tft.setCursor(15, 120);
  tft.println("BLE Mode Active");
  tft.setCursor(15, 135);
  tft.println("Waiting for app...");

  // 2. Initialize BLE
  BLEDevice::init("BikeNav-ESP32");
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  pCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ   |
                      BLECharacteristic::PROPERTY_WRITE  |
                      BLECharacteristic::PROPERTY_NOTIFY |
                      BLECharacteristic::PROPERTY_WRITE_NR // Write without response for speed
                    );

  pCharacteristic->setCallbacks(new MyCharacteristicCallbacks());
  pCharacteristic->addDescriptor(new BLE2902());

  pService->start();

  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);  // functions that help with iPhone connections issue
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("BLE Advertising started. Device name: BikeNav-ESP32");
}

void loop() {
  // BLE is handled via callbacks
  delay(10);
}
