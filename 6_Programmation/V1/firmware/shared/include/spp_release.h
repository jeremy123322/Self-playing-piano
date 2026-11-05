#pragma once

#include <stdint.h>

#define SPP_RELEASE_VERSION "2.4.1"

namespace spp {

constexpr const char* kReleaseVersion = SPP_RELEASE_VERSION;
constexpr const char* kProfileId = "legacy-v1";
constexpr uint8_t kProfileVersion = 2;
constexpr uint8_t kLegacyArtifactProfileVersion = 1;

inline bool artifactProfileCompatible(uint8_t artifactVersion,
                                      uint8_t profileVersion) {
  return (artifactVersion == 1 &&
          profileVersion == kLegacyArtifactProfileVersion) ||
         (artifactVersion == 2 && profileVersion == kProfileVersion);
}

}  // namespace spp
