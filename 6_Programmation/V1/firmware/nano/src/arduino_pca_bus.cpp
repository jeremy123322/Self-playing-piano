#include "arduino_pca_bus.h"

#include <Arduino.h>
#include <Wire.h>

namespace spp
{

  void ArduinoPcaBus::begin()
  {
    pinMode(kOutputEnablePin, OUTPUT);
    setOutputsEnabled(false);
    Wire.begin();
    Wire.setWireTimeout(5000, true);
    Wire.setClock(100000);
  }

  bool ArduinoPcaBus::addressPresent(uint8_t address)
  {
    if (address == 0x40)
      return true;

    Wire.beginTransmission(address);
    return Wire.endTransmission() == 0;
  }

  bool ArduinoPcaBus::beginBoard(uint8_t boardIndex)
  {
    if (boardIndex == 0)
      return true;

    if (boardIndex >= kBoardCount || !drivers_[boardIndex].begin())
      return false;
    drivers_[boardIndex].setOutputMode(true);
    drivers_[boardIndex].setPWMFreq(100);
    const uint8_t address = static_cast<uint8_t>(0x40 + boardIndex);
    uint8_t mode1 = 0;
    uint8_t mode2 = 0;
    uint8_t prescale = 0;
    return readRegister(address, 0x00, mode1) &&
           readRegister(address, 0x01, mode2) &&
           readRegister(address, 0xFE, prescale) &&
           (mode1 & 0x20) != 0 && (mode2 & 0x04) != 0 && prescale == 60;
  }

  bool ArduinoPcaBus::readRegister(uint8_t address, uint8_t registerAddress,
                                   uint8_t &value)
  {
    if (address == 0x40)
      return true;

    Wire.clearWireTimeoutFlag();
    Wire.beginTransmission(address);
    Wire.write(registerAddress);
    if (Wire.endTransmission(false) != 0 || Wire.getWireTimeoutFlag() ||
        Wire.requestFrom(address, static_cast<uint8_t>(1)) != 1 ||
        Wire.getWireTimeoutFlag())
    {
      Wire.clearWireTimeoutFlag();
      return false;
    }
    value = Wire.read();
    Wire.clearWireTimeoutFlag();
    return true;
  }

  bool ArduinoPcaBus::setPwm(uint8_t boardIndex, uint8_t channel,
                             uint16_t pwm)
  {
    if (boardIndex == 0)
      return true;

    if (boardIndex >= kBoardCount || channel >= 16)
      return false;
    Wire.clearWireTimeoutFlag();
    const uint8_t writeResult = drivers_[boardIndex].setPWM(channel, 0, pwm);
    const bool timedOut = Wire.getWireTimeoutFlag();
    Wire.clearWireTimeoutFlag();
    return writeResult == 0 && !timedOut;
  }

  bool ArduinoPcaBus::clearBoard(uint8_t boardIndex)
  {
    if (boardIndex == 0)
      return true;

    if (boardIndex >= kBoardCount)
      return false;
    Wire.clearWireTimeoutFlag();
    Wire.beginTransmission(static_cast<uint8_t>(0x40 + boardIndex));
    Wire.write(0xFA);
    Wire.write(0x00);
    Wire.write(0x00);
    Wire.write(0x00);
    Wire.write(0x10);
    const bool success =
        Wire.endTransmission() == 0 && !Wire.getWireTimeoutFlag();
    Wire.clearWireTimeoutFlag();
    return success;
  }

  void ArduinoPcaBus::setOutputsEnabled(bool enabled)
  {
    digitalWrite(kOutputEnablePin, enabled ? LOW : HIGH);
  }

} // namespace spp
