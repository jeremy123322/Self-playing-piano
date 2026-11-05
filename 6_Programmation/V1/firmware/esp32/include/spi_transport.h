#pragma once

#include "playback_runtime.h"
#include "spp_spi_protocol.h"

namespace spp {

class SpiFrameLink {
 public:
  virtual ~SpiFrameLink() = default;
  virtual void transfer(const Frame& outgoing, Frame& incoming) = 0;
};

class SpiTransport final : public PlaybackTransport {
 public:
  SpiTransport(SpiFrameLink& link, PlaybackClock& clock)
      : link_(link), clock_(clock) {}

  SpiResult syncClock(uint32_t positionMs) override;
  SpiResult sendNote(bool on, uint8_t keyIndex, uint8_t velocity,
                     uint32_t timeMs) override;
  SpiResult flushAllOff() override;
  SpiResult heartbeat() override;
  uint8_t freeSlots() const override { return freeSlots_; }
  bool clockRunning() const override { return clockRunning_; }
  bool hardwareReady() const override { return hardwareReady_; }

 private:
  SpiFrameLink& link_;
  PlaybackClock& clock_;
  uint8_t sequence_ = 0;
  uint8_t freeSlots_ = 0;
  bool clockRunning_ = false;
  bool hardwareReady_ = false;

  SpiResult send(const Frame& frame, uint32_t timeoutMs);
  SpiResult interpret(const Frame& response, uint8_t expectedSequence);
};

}  // namespace spp
