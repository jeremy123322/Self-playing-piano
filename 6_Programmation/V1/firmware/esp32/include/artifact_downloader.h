#pragma once

#include <Arduino.h>

#include "artifact.h"

namespace spp {

enum class ArtifactDownloadStatus : uint8_t {
  kSuccess,
  kRetryableFailure,
  kPermanentFailure,
};

struct ArtifactDownloadResult {
  ArtifactDownloadStatus status = ArtifactDownloadStatus::kPermanentFailure;
  String message;

  ArtifactDownloadResult() = default;
  ArtifactDownloadResult(ArtifactDownloadStatus resultStatus,
                         const String& resultMessage)
      : status(resultStatus), message(resultMessage) {}

  bool succeeded() const { return status == ArtifactDownloadStatus::kSuccess; }
  bool retryable() const {
    return status == ArtifactDownloadStatus::kRetryableFailure;
  }
};

class ArtifactDownloader {
 public:
  ArtifactDownloadResult download(const char* sessionId,
                                  const char* expectedSha256,
                                  size_t expectedBytes, Artifact& artifact);
};

}  // namespace spp
