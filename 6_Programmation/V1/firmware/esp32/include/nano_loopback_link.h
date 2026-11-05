#pragma once

#ifdef SPP_NANO_LOOPBACK

#include <Arduino.h>

#include "key_output.h"
#include "nano_controller.h"
#include "spi_transport.h"

namespace spp {

class NanoLoopbackOutput final : public KeyOutput {
 public:
  bool allOff() override;
  bool setKey(uint8_t keyIndex, bool on, uint8_t velocity) override;
  bool ready() const override { return true; }

 private:
  bool active_[88]{};
};

class NanoLoopbackLink final : public SpiFrameLink {
 public:
  NanoLoopbackLink() : controller_(output_) {}

  void begin();
  void transfer(const Frame& outgoing, Frame& incoming) override;

 private:
  NanoLoopbackOutput output_;
  NanoController controller_;
};

}  // namespace spp

#endif
