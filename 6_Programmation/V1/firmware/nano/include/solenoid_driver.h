#pragma once

#include "key_output.h"
#include "pca_bus.h"

namespace spp {

class SolenoidDriver final : public KeyOutput {
 public:
  explicit SolenoidDriver(PcaBus& bus) : bus_(bus) {}

  bool begin();
  bool allOff() override;
  bool setKey(uint8_t keyIndex, bool on, uint8_t velocity) override;
  bool ready() const override { return ready_; }

 private:
  static constexpr uint8_t kDriverCount = 6;
  static constexpr uint8_t kOutputsPerDriver = 16;
  static constexpr uint16_t kFullPowerPwm = 4095;
  PcaBus& bus_;
  bool ready_ = false;

  bool setOutput(uint8_t output, uint16_t pwm);
  uint16_t activationPwm(uint8_t velocity) const;
};

}  // namespace spp
