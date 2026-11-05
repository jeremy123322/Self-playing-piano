#pragma once

#include <stdint.h>

namespace spp {

constexpr uint8_t kFrameMagic = 0xA5;
constexpr uint8_t kProtocolVersion = 2;
constexpr uint8_t kFrameSize = 12;

enum class MessageType : uint8_t {
  kSyncClock = 0x01,
  kNoteOn = 0x02,
  kNoteOff = 0x03,
  kFlushAllOff = 0x04,
  kHeartbeat = 0x05,
  kStatus = 0x06,
  kAck = 0x80,
  kNack = 0x81,
};

enum class ErrorCode : uint8_t {
  kNone = 0,
  kBadMagic = 1,
  kBadVersion = 2,
  kBadCrc = 3,
  kBufferFull = 4,
  kInvalidKey = 5,
  kHardwareUnavailable = 6,
  kUnknownMessage = 7,
};

enum StatusFlag : uint8_t {
  kClockRunning = 1 << 0,
  kHardwareReady = 1 << 1,
};

struct Frame {
  uint8_t bytes[kFrameSize]{};
};

inline uint16_t frameCrc(const uint8_t* data, uint8_t length) {
  uint16_t crc = 0xFFFF;
  for (uint8_t index = 0; index < length; ++index) {
    crc ^= static_cast<uint16_t>(data[index]) << 8;
    for (uint8_t bit = 0; bit < 8; ++bit) {
      crc = (crc & 0x8000) ? static_cast<uint16_t>((crc << 1) ^ 0x1021)
                           : static_cast<uint16_t>(crc << 1);
    }
  }
  return crc;
}

inline void writeUint32(uint8_t* destination, uint32_t value) {
  destination[0] = value & 0xFF;
  destination[1] = (value >> 8) & 0xFF;
  destination[2] = (value >> 16) & 0xFF;
  destination[3] = (value >> 24) & 0xFF;
}

inline uint32_t readUint32(const uint8_t* source) {
  return static_cast<uint32_t>(source[0]) |
         (static_cast<uint32_t>(source[1]) << 8) |
         (static_cast<uint32_t>(source[2]) << 16) |
         (static_cast<uint32_t>(source[3]) << 24);
}

inline void finishFrame(Frame& frame) {
  const uint16_t crc = frameCrc(frame.bytes, kFrameSize - 2);
  frame.bytes[10] = crc & 0xFF;
  frame.bytes[11] = crc >> 8;
}

inline Frame makeRequest(MessageType type, uint8_t sequence) {
  Frame frame{};
  frame.bytes[0] = kFrameMagic;
  frame.bytes[1] = kProtocolVersion;
  frame.bytes[2] = static_cast<uint8_t>(type);
  frame.bytes[3] = sequence;
  finishFrame(frame);
  return frame;
}

inline Frame makeSyncClock(uint8_t sequence, uint32_t positionMs) {
  Frame frame = makeRequest(MessageType::kSyncClock, sequence);
  writeUint32(&frame.bytes[4], positionMs);
  finishFrame(frame);
  return frame;
}

inline Frame makeNote(MessageType type, uint8_t sequence, uint8_t keyIndex,
                      uint8_t velocity, uint32_t timeMs) {
  Frame frame = makeRequest(type, sequence);
  frame.bytes[4] = keyIndex;
  frame.bytes[5] = velocity;
  writeUint32(&frame.bytes[6], timeMs);
  finishFrame(frame);
  return frame;
}

inline Frame makeResponse(MessageType result, uint8_t acknowledgedSequence,
                          uint8_t freeSlots, ErrorCode error, uint8_t flags) {
  Frame frame = makeRequest(result, 0);
  frame.bytes[4] = acknowledgedSequence;
  frame.bytes[5] = freeSlots;
  frame.bytes[6] = flags;
  frame.bytes[7] = static_cast<uint8_t>(error);
  finishFrame(frame);
  return frame;
}

inline bool validateFrame(const Frame& frame, ErrorCode& error) {
  if (frame.bytes[0] != kFrameMagic) {
    error = ErrorCode::kBadMagic;
    return false;
  }
  if (frame.bytes[1] != kProtocolVersion) {
    error = ErrorCode::kBadVersion;
    return false;
  }
  const uint16_t actual = static_cast<uint16_t>(frame.bytes[10]) |
                          (static_cast<uint16_t>(frame.bytes[11]) << 8);
  if (actual != frameCrc(frame.bytes, kFrameSize - 2)) {
    error = ErrorCode::kBadCrc;
    return false;
  }
  error = ErrorCode::kNone;
  return true;
}

}  // namespace spp
