#include "nano_controller.h"

#include "note_mapping.h"

namespace spp {

void NanoController::begin() {
  lastError_ = output_.ready() ? ErrorCode::kNone
                               : ErrorCode::kHardwareUnavailable;
  lastResult_ = output_.ready() ? MessageType::kAck : MessageType::kNack;
  publishResponse();
}

uint8_t NanoController::statusFlags() const {
  uint8_t flags = 0;
  if (clockRunning_) flags |= StatusFlag::kClockRunning;
  if (output_.ready()) flags |= StatusFlag::kHardwareReady;
  return flags;
}

void NanoController::publishResponse() {
  response_ = makeResponse(lastResult_, responseSequence_, events_.freeSlots(),
                           lastError_, statusFlags());
  responseDirty_ = true;
}

bool NanoController::consumeResponse(Frame& response) {
  if (!responseDirty_) return false;
  response = response_;
  responseDirty_ = false;
  return true;
}

void NanoController::setCommandResult(uint8_t sequence, MessageType result,
                                      ErrorCode error, bool executed) {
  responseSequence_ = sequence;
  lastResult_ = result;
  lastError_ = error;
  if (executed) {
    lastExecutedSequence_ = sequence;
    hasExecutedSequence_ = true;
    executedResult_ = result;
    executedError_ = error;
  }
  publishResponse();
}

void NanoController::allOffAndStop() {
  events_.clear();
  clockRunning_ = false;
  output_.allOff();
}

void NanoController::processFrame(const Frame& frame, uint32_t nowMs) {
  ErrorCode validationError = ErrorCode::kNone;
  const uint8_t sequence = frame.bytes[3];
  if (!validateFrame(frame, validationError)) {
    setCommandResult(sequence, MessageType::kNack, validationError, false);
    return;
  }

  const auto type = static_cast<MessageType>(frame.bytes[2]);
  if (type == MessageType::kStatus) {
    publishResponse();
    return;
  }
  if (hasExecutedSequence_ && sequence == lastExecutedSequence_) {
    responseSequence_ = sequence;
    lastResult_ = executedResult_;
    lastError_ = executedError_;
    publishResponse();
    return;
  }
  if (!output_.ready()) {
    setCommandResult(sequence, MessageType::kNack,
                     ErrorCode::kHardwareUnavailable, false);
    return;
  }

  switch (type) {
    case MessageType::kSyncClock:
      allOffAndStop();
      if (!output_.ready()) {
        setCommandResult(sequence, MessageType::kNack,
                         ErrorCode::kHardwareUnavailable, false);
        return;
      }
      clockPositionMs_ = readUint32(&frame.bytes[4]);
      clockStartedAtMs_ = nowMs;
      lastHeartbeatMs_ = nowMs;
      clockRunning_ = true;
      break;
    case MessageType::kNoteOn:
    case MessageType::kNoteOff: {
      if (!clockRunning_) {
        setCommandResult(sequence, MessageType::kNack,
                         ErrorCode::kHardwareUnavailable, false);
        return;
      }
      if (outputForKey(frame.bytes[4]) == kUnmappedOutput) {
        setCommandResult(sequence, MessageType::kNack,
                         ErrorCode::kInvalidKey);
        return;
      }
      const ScheduledEvent event{
          readUint32(&frame.bytes[6]), frame.bytes[4], frame.bytes[5],
          type == MessageType::kNoteOn};
      if (!events_.push(event)) {
        setCommandResult(sequence, MessageType::kNack,
                         ErrorCode::kBufferFull, false);
        return;
      }
      break;
    }
    case MessageType::kFlushAllOff:
      allOffAndStop();
      if (!output_.ready()) {
        setCommandResult(sequence, MessageType::kNack,
                         ErrorCode::kHardwareUnavailable);
        return;
      }
      break;
    case MessageType::kHeartbeat:
      lastHeartbeatMs_ = nowMs;
      break;
    default:
      setCommandResult(sequence, MessageType::kNack,
                       ErrorCode::kUnknownMessage);
      return;
  }

  setCommandResult(sequence, MessageType::kAck);
}

void NanoController::tick(uint32_t nowMs) {
  if (!clockRunning_) return;
  if (nowMs - lastHeartbeatMs_ > kCommunicationTimeoutMs) {
    allOffAndStop();
    publishResponse();
    return;
  }

  const uint32_t positionMs = clockPositionMs_ + (nowMs - clockStartedAtMs_);
  while (const ScheduledEvent* event = events_.front()) {
    if (static_cast<int32_t>(positionMs - event->timeMs) < 0) break;
    if (!output_.setKey(event->keyIndex, event->on, event->velocity)) {
      allOffAndStop();
      lastResult_ = MessageType::kNack;
      lastError_ = ErrorCode::kHardwareUnavailable;
      publishResponse();
      return;
    }
    events_.pop();
  }
}

}  // namespace spp
