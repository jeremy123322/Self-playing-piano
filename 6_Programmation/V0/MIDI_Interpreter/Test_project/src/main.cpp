#include <Arduino.h>
#include <WiFi.h>
#include <ESPAsyncWebServer.h>

void setup()
{
    Serial.begin(115200);
    delay(1000); // give serial monitor time to connect
    Serial.println("Hello, world!");
}

void loop()
{
    Serial.print("Wow");
    delay(1000);
    // nothing here
}