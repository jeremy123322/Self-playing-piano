#pragma once

#include <stddef.h>
#include <stdint.h>
#include <memory>

namespace spp {

struct ArtifactNote {
  uint32_t startMs;
  uint32_t durationMs;
  uint8_t keyIndex;
  uint8_t velocity;
  uint8_t flags;
  uint8_t activationLeadMs;
};

enum class ArtifactError : uint8_t {
  kNone,
  kInvalidSize,
  kUnsupportedFormat,
  kIncompatibleProfile,
  kInvalidRecordCount,
  kInvalidRecord,
  kUnsortedRecords,
  kPolyphonyExceeded,
};

const char* artifactErrorMessage(ArtifactError error);

class Artifact {
 public:
  Artifact() = default;
  Artifact(Artifact&&) = default;
  Artifact& operator=(Artifact&&) = default;
  Artifact(const Artifact&) = delete;
  Artifact& operator=(const Artifact&) = delete;
  bool adopt(std::unique_ptr<uint8_t[]> data, size_t size,
             ArtifactError& error);
  void clear();
  bool noteAt(uint32_t index, ArtifactNote& note) const;
  uint32_t noteCount() const { return noteCount_; }
  uint32_t durationMs() const { return durationMs_; }

 private:
  static constexpr size_t kHeaderSize = 16;
  static constexpr size_t kRecordSize = 12;
  static constexpr size_t kMaxSize = 128 * 1024;
  std::unique_ptr<uint8_t[]> data_;
  size_t size_ = 0;
  uint32_t noteCount_ = 0;
  uint32_t durationMs_ = 0;
  uint8_t version_ = 0;

  static uint32_t readUint32(const uint8_t* bytes);
};

}  // namespace spp
