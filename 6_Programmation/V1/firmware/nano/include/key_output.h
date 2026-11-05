#pragma once

#include <stdint.h>

namespace spp {

class KeyOutput {
 public:
  virtual ~KeyOutput() = default;
  virtual bool allOff() = 0;
  virtual bool setKey(uint8_t keyIndex, bool on, uint8_t velocity) = 0;
  virtual bool ready() const = 0;
};

}  // namespace spp
