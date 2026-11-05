#include "artifact.h"

#include <string.h>

#include "spp_release.h"

namespace spp {

uint32_t Artifact::readUint32(const uint8_t* bytes) {
  return static_cast<uint32_t>(bytes[0]) |
         (static_cast<uint32_t>(bytes[1]) << 8) |
         (static_cast<uint32_t>(bytes[2]) << 16) |
         (static_cast<uint32_t>(bytes[3]) << 24);
}

const char* artifactErrorMessage(ArtifactError error) {
  switch (error) {
    case ArtifactError::kInvalidSize: return "Artifact size is invalid";
    case ArtifactError::kUnsupportedFormat: return "Artifact format is unsupported";
    case ArtifactError::kIncompatibleProfile: return "Artifact profile is incompatible with this firmware";
    case ArtifactError::kInvalidRecordCount: return "Artifact record count is invalid";
    case ArtifactError::kInvalidRecord: return "Artifact contains an invalid note";
    case ArtifactError::kUnsortedRecords: return "Artifact notes are not sorted";
    case ArtifactError::kPolyphonyExceeded: return "Artifact exceeds supported polyphony";
    case ArtifactError::kNone: return "";
  }
  return "Artifact is invalid";
}

bool Artifact::adopt(std::unique_ptr<uint8_t[]> data, size_t size,
                     ArtifactError& error) {
  if (!data || size < kHeaderSize || size > kMaxSize) {
    error = ArtifactError::kInvalidSize;
    return false;
  }
  const uint8_t version = data[4];
  if (memcmp(data.get(), "SPP1", 4) != 0 ||
      (version != 1 && version != 2) ||
      data[6] != kRecordSize || data[7] != 0) {
    error = ArtifactError::kUnsupportedFormat;
    return false;
  }
  const uint8_t profileVersion = data[5];
  if (!artifactProfileCompatible(version, profileVersion)) {
    error = ArtifactError::kIncompatibleProfile;
    return false;
  }
  const uint32_t count = readUint32(data.get() + 8);
  if (count == 0 || count > (size - kHeaderSize) / kRecordSize ||
      kHeaderSize + static_cast<size_t>(count) * kRecordSize != size) {
    error = ArtifactError::kInvalidRecordCount;
    return false;
  }

  uint32_t activeEnds[10]{};
  uint8_t activeCount = 0;
  uint32_t keyEnds[88]{};
  bool keySeen[88]{};
  uint32_t previousActivation = 0;
  uint32_t maximumEnd = 0;
  for (uint32_t index = 0; index < count; ++index) {
    const uint8_t* record = data.get() + kHeaderSize + index * kRecordSize;
    const uint32_t start = readUint32(record);
    const uint32_t duration = readUint32(record + 4);
    const uint8_t key = record[8];
    const uint8_t activationLead = version >= 2 ? record[11] : 0;
    const uint32_t activation = start - activationLead;
    const uint64_t wideEnd = static_cast<uint64_t>(start) + duration;
    if (duration == 0 || key >= 88 || activationLead > start ||
        (version == 1 && record[11] != 0) ||
        wideEnd > INT32_MAX ||
        (keySeen[key] &&
         (keyEnds[key] > activation || activation - keyEnds[key] < 100))) {
      error = ArtifactError::kInvalidRecord;
      return false;
    }
    if (index > 0 && activation < previousActivation) {
      error = ArtifactError::kUnsortedRecords;
      return false;
    }
    previousActivation = activation;

    for (uint8_t active = 0; active < activeCount;) {
      if (activeEnds[active] > activation) {
        ++active;
        continue;
      }
      activeEnds[active] = activeEnds[activeCount - 1];
      --activeCount;
    }
    if (activeCount >= 10) {
      error = ArtifactError::kPolyphonyExceeded;
      return false;
    }

    const uint32_t end = static_cast<uint32_t>(wideEnd);
    activeEnds[activeCount++] = end;
    keyEnds[key] = end;
    keySeen[key] = true;
    if (end > maximumEnd) maximumEnd = end;
  }
  if (readUint32(data.get() + 12) != maximumEnd) {
    error = ArtifactError::kInvalidRecord;
    return false;
  }
  data_ = std::move(data);
  size_ = size;
  noteCount_ = count;
  durationMs_ = readUint32(data_.get() + 12);
  version_ = version;
  error = ArtifactError::kNone;
  return true;
}

void Artifact::clear() {
  data_.reset();
  size_ = 0;
  noteCount_ = 0;
  durationMs_ = 0;
  version_ = 0;
}

bool Artifact::noteAt(uint32_t index, ArtifactNote& note) const {
  if (!data_ || index >= noteCount_) return false;
  const uint8_t* record = data_.get() + kHeaderSize + index * kRecordSize;
  note.startMs = readUint32(record);
  note.durationMs = readUint32(record + 4);
  note.keyIndex = record[8];
  note.velocity = record[9];
  note.flags = record[10];
  note.activationLeadMs = version_ >= 2 ? record[11] : 0;
  return note.keyIndex < 88 && note.durationMs > 0;
}

}  // namespace spp
