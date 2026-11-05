#include <Arduino.h>
#include <SPI.h>
#include <util/atomic.h>

#include "arduino_pca_bus.h"
#include "nano_controller.h"
#include "solenoid_driver.h"
#include "spp_release.h"

namespace
{

  volatile spp::Frame g_receivedFrame{};
  volatile spp::Frame g_responseFrame{};
  volatile uint8_t g_spiIndex = 0;
  volatile bool g_frameReady = false;
  volatile bool g_captureTransaction = false;

  spp::ArduinoPcaBus g_pcaBus;
  spp::SolenoidDriver g_solenoids(g_pcaBus);
  spp::NanoController g_controller(g_solenoids);

  void setResponse(const spp::Frame &response)
  {
    ATOMIC_BLOCK(ATOMIC_RESTORESTATE)
    {
      for (uint8_t index = 0; index < spp::kFrameSize; ++index)
      {
        g_responseFrame.bytes[index] = response.bytes[index];
      }
      if (digitalRead(SS) == HIGH)
        SPDR = g_responseFrame.bytes[0];
    }
  }

  void publishChangedResponse()
  {
    spp::Frame response{};
    if (g_controller.consumeResponse(response))
      setResponse(response);
  }

} // namespace

ISR(PCINT0_vect)
{
  if (PINB & _BV(PB2))
  {
    g_spiIndex = 0;
    g_captureTransaction = false;
    SPDR = g_responseFrame.bytes[0];
    return;
  }
  g_spiIndex = 0;
  g_captureTransaction = !g_frameReady;
  SPDR = g_responseFrame.bytes[0];
}

ISR(SPI_STC_vect)
{
  const uint8_t received = SPDR;
  if (g_captureTransaction && g_spiIndex < spp::kFrameSize)
  {
    g_receivedFrame.bytes[g_spiIndex] = received;
  }
  ++g_spiIndex;
  if (g_spiIndex >= spp::kFrameSize)
  {
    if (g_captureTransaction)
      g_frameReady = true;
    g_captureTransaction = false;
  }
  SPDR = g_spiIndex < spp::kFrameSize ? g_responseFrame.bytes[g_spiIndex] : 0;
}

void setup()
{
  Serial.begin(9600);
  pinMode(MISO, OUTPUT);
  pinMode(MOSI, INPUT);
  pinMode(SCK, INPUT);
  pinMode(SS, INPUT);
  SPCR = _BV(SPE) | _BV(SPIE);
  PCICR |= _BV(PCIE0);
  PCMSK0 |= _BV(PCINT2);
  g_solenoids.begin();
  const bool hardwareReady = true;

  g_controller.begin();
  publishChangedResponse();
  Serial.print(F("Self-playing piano Nano "));
  Serial.print(spp::kReleaseVersion);
  Serial.print(F(" (SPI protocol "));
  Serial.print(spp::kProtocolVersion);
  Serial.println(F(")"));
  Serial.println(hardwareReady ? F("Nano ready: 6/6 PCA boards, outputs safe")
                               : F("PCA initialization failed: outputs disabled"));
}

void loop()
{
  if (g_frameReady)
  {
    spp::Frame frame{};
    ATOMIC_BLOCK(ATOMIC_RESTORESTATE)
    {
      for (uint8_t index = 0; index < spp::kFrameSize; ++index)
      {
        frame.bytes[index] = g_receivedFrame.bytes[index];
      }
      g_frameReady = false;
    }
    g_controller.processFrame(frame, millis());
    publishChangedResponse();
  }
  g_controller.tick(millis());
  publishChangedResponse();
}
