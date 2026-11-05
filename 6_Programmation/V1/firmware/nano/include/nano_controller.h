#pragma once

#include <stdint.h>

#include "event_queue.h"
#include "key_output.h"
#include "spp_spi_protocol.h"

namespace spp {

class NanoController {
 public:
  static constexpr uint8_t kQueueCapacity = 64;
  static constexpr uint32_t kCommunicationTimeoutMs = 2000;

  explicit NanoController(KeyOutput& output) : output_(output) {}

  void begin();
  void processFrame(const Frame& frame, uint32_t nowMs);
  void tick(uint32_t nowMs);
  const Frame& response() const { return response_; }
  bool consumeResponse(Frame& response);
  bool clockRunning() const { return clockRunning_; }
  uint8_t queuedEvents() const { return events_.size(); }

 private:
  KeyOutput& output_;
  EventQueue<kQueueCapacity> events_;
  Frame response_{};
  uint8_t responseSequence_ = 0;
  uint8_t lastExecutedSequence_ = 0;
  bool hasExecutedSequence_ = false;
  MessageType lastResult_ = MessageType::kAck;
  ErrorCode lastError_ = ErrorCode::kNone;
  MessageType executedResult_ = MessageType::kAck;
  ErrorCode executedError_ = ErrorCode::kNone;
  uint32_t clockPositionMs_ = 0;
  uint32_t clockStartedAtMs_ = 0;
  uint32_t lastHeartbeatMs_ = 0;
  bool clockRunning_ = false;
  bool responseDirty_ = false;

  uint8_t statusFlags() const;
  void publishResponse();
  void setCommandResult(uint8_t sequence, MessageType result,
                        ErrorCode error = ErrorCode::kNone,
                        bool executed = true);
  void allOffAndStop();
};

}  // namespace spp
