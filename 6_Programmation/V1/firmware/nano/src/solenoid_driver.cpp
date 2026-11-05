#include "solenoid_driver.h"

#include "note_mapping.h"

namespace spp {

bool SolenoidDriver::begin() {
  bus_.begin();
  bus_.setOutputsEnabled(false);
  for (uint8_t index = 0; index < kDriverCount; ++index) {
    if (!bus_.addressPresent(static_cast<uint8_t>(0x40 + index))) return false;
  }
  for (uint8_t index = 0; index < kDriverCount; ++index) {
    if (!bus_.beginBoard(index)) return false;
  }

  ready_ = true;
  return allOff();
}

bool SolenoidDriver::setOutput(uint8_t output, uint16_t pwm) {
  if (output >= kDriverCount * kOutputsPerDriver) return false;
  const uint8_t driverIndex = output / kOutputsPerDriver;
  const uint8_t channel = 15 - (output % kOutputsPerDriver);
  if (bus_.setPwm(driverIndex, channel, pwm)) return true;
  ready_ = false;
  bus_.setOutputsEnabled(false);
  return false;
}

uint16_t SolenoidDriver::activationPwm(uint8_t velocity) const {
  (void)velocity;
  return kFullPowerPwm;
}

bool SolenoidDriver::setKey(uint8_t keyIndex, bool on, uint8_t velocity) {
  if (!ready_) return false;
  const uint8_t output = outputForKey(keyIndex);
  if (output == kUnmappedOutput) return false;
  return setOutput(output, on ? activationPwm(velocity) : 0);
}

bool SolenoidDriver::allOff() {
  bus_.setOutputsEnabled(false);
  bool cleared = true;
  for (uint8_t index = 0; index < kDriverCount; ++index) {
    if (!bus_.clearBoard(index)) cleared = false;
  }
  if (!cleared) ready_ = false;
  if (ready_) bus_.setOutputsEnabled(true);
  return cleared;
}

}  // namespace spp
