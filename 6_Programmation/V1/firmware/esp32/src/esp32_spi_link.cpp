#include "esp32_spi_link.h"

namespace spp {

void Esp32SpiLink::begin() {
  pinMode(kSelectPin, OUTPUT);
  digitalWrite(kSelectPin, HIGH);
  SPI.begin(kClockPin, kMisoPin, kMosiPin, kSelectPin);
  delay(50);
}

void Esp32SpiLink::transfer(const Frame& outgoing, Frame& incoming) {
  SPI.beginTransaction(SPISettings(500000, MSBFIRST, SPI_MODE0));
  digitalWrite(kSelectPin, LOW);
  delayMicroseconds(20);
  for (uint8_t index = 0; index < kFrameSize; ++index) {
    incoming.bytes[index] = SPI.transfer(outgoing.bytes[index]);
  }
  digitalWrite(kSelectPin, HIGH);
  SPI.endTransaction();
}

}  // namespace spp
