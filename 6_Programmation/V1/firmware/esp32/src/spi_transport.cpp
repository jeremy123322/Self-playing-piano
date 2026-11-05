#include "spi_transport.h"

namespace spp {

SpiResult SpiTransport::interpret(const Frame& response, uint8_t expectedSequence) {
  ErrorCode validationError = ErrorCode::kNone;
  if (!validateFrame(response, validationError) || response.bytes[4] != expectedSequence) {
    return SpiResult::kUnavailable;
  }
  freeSlots_ = response.bytes[5];
  clockRunning_ = response.bytes[6] & StatusFlag::kClockRunning;
  hardwareReady_ = response.bytes[6] & StatusFlag::kHardwareReady;
  if (!hardwareReady_) return SpiResult::kHardwareUnavailable;
  if (response.bytes[2] == static_cast<uint8_t>(MessageType::kAck)) return SpiResult::kOk;
  const auto error = static_cast<ErrorCode>(response.bytes[7]);
  if (error == ErrorCode::kBufferFull) return SpiResult::kBufferFull;
  if (error == ErrorCode::kBadMagic || error == ErrorCode::kBadVersion ||
      error == ErrorCode::kBadCrc) return SpiResult::kUnavailable;
  return SpiResult::kRejected;
}

SpiResult SpiTransport::send(const Frame& frame, uint32_t timeoutMs) {
  Frame ignored{};
  link_.transfer(frame, ignored);
  const uint8_t expectedSequence = frame.bytes[3];
  const uint32_t startedAt = clock_.nowMs();
  uint32_t lastTransmitAt = startedAt;
  while (clock_.nowMs() - startedAt < timeoutMs) {
    clock_.delayMs(2);
    const Frame poll = makeRequest(MessageType::kStatus, ++sequence_);
    Frame response{};
    link_.transfer(poll, response);
    const SpiResult result = interpret(response, expectedSequence);
    if (result != SpiResult::kUnavailable) return result;
    if (clock_.nowMs() - lastTransmitAt >= 10) {
      link_.transfer(frame, ignored);
      lastTransmitAt = clock_.nowMs();
    }
  }
  return SpiResult::kUnavailable;
}

SpiResult SpiTransport::syncClock(uint32_t positionMs) {
  return send(makeSyncClock(++sequence_, positionMs), 250);
}

SpiResult SpiTransport::sendNote(bool on, uint8_t keyIndex, uint8_t velocity,
                                 uint32_t timeMs) {
  return send(makeNote(on ? MessageType::kNoteOn : MessageType::kNoteOff,
                       ++sequence_, keyIndex, velocity, timeMs), 100);
}

SpiResult SpiTransport::flushAllOff() {
  return send(makeRequest(MessageType::kFlushAllOff, ++sequence_), 250);
}

SpiResult SpiTransport::heartbeat() {
  const SpiResult result = send(makeRequest(MessageType::kHeartbeat, ++sequence_), 100);
  if (result == SpiResult::kOk && !clockRunning_) return SpiResult::kClockStopped;
  return result;
}

}  // namespace spp
