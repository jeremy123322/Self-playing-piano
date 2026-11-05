#pragma once

#include <Adafruit_PWMServoDriver.h>

#include "pca_bus.h"

namespace spp {

class ArduinoPcaBus final : public PcaBus {
 public:
  void begin() override;
  bool addressPresent(uint8_t address) override;
  bool beginBoard(uint8_t boardIndex) override;
  bool setPwm(uint8_t boardIndex, uint8_t channel, uint16_t pwm) override;
  bool clearBoard(uint8_t boardIndex) override;
  void setOutputsEnabled(bool enabled) override;

 private:
  static constexpr uint8_t kBoardCount = 6;
  static constexpr uint8_t kOutputEnablePin = 4;

  Adafruit_PWMServoDriver drivers_[kBoardCount] = {
      Adafruit_PWMServoDriver(0x40), Adafruit_PWMServoDriver(0x41),
      Adafruit_PWMServoDriver(0x42), Adafruit_PWMServoDriver(0x43),
      Adafruit_PWMServoDriver(0x44), Adafruit_PWMServoDriver(0x45),
  };

  bool readRegister(uint8_t address, uint8_t registerAddress,
                    uint8_t& value);
};

}  // namespace spp
