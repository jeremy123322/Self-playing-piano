#pragma once

#include <stdint.h>

namespace spp {

class PcaBus {
 public:
  virtual ~PcaBus() = default;
  virtual void begin() = 0;
  virtual bool addressPresent(uint8_t address) = 0;
  virtual bool beginBoard(uint8_t boardIndex) = 0;
  virtual bool setPwm(uint8_t boardIndex, uint8_t channel,
                      uint16_t pwm) = 0;
  virtual bool clearBoard(uint8_t boardIndex) = 0;
  virtual void setOutputsEnabled(bool enabled) = 0;
};

}  // namespace spp
