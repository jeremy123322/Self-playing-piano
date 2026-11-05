#pragma once

#include <Arduino.h>
#include <SPI.h>

#include "spi_transport.h"

namespace spp {

class Esp32SpiLink final : public SpiFrameLink {
 public:
  void begin();
  void transfer(const Frame& outgoing, Frame& incoming) override;

 private:
  static constexpr uint8_t kClockPin = 14;
  static constexpr uint8_t kMisoPin = 12;
  static constexpr uint8_t kMosiPin = 13;
  static constexpr uint8_t kSelectPin = 32;
};

}  // namespace spp
