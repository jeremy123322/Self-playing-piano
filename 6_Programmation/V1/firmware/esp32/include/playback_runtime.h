#pragma once

#include <stdint.h>

namespace spp {

enum class SpiResult : uint8_t {
  kOk,
  kBufferFull,
  kRejected,
  kUnavailable,
  kClockStopped,
  kHardwareUnavailable,
};

class PlaybackClock {
 public:
  virtual ~PlaybackClock() = default;
  virtual uint32_t nowMs() const = 0;
  virtual void delayMs(uint32_t durationMs) = 0;
};

class PlaybackTransport {
 public:
  virtual ~PlaybackTransport() = default;
  virtual SpiResult syncClock(uint32_t positionMs) = 0;
  virtual SpiResult sendNote(bool on, uint8_t keyIndex, uint8_t velocity,
                             uint32_t timeMs) = 0;
  virtual SpiResult flushAllOff() = 0;
  virtual SpiResult heartbeat() = 0;
  virtual uint8_t freeSlots() const = 0;
  virtual bool clockRunning() const = 0;
  virtual bool hardwareReady() const = 0;
};

}  // namespace spp
