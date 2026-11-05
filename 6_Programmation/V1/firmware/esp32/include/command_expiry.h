#pragma once

#include <stdint.h>

namespace spp {

inline bool commandExpired(uint32_t expiresAtEpochSeconds,
                           uint32_t nowEpochSeconds,
                           bool clockSynchronized) {
  return !clockSynchronized || expiresAtEpochSeconds == 0 ||
         nowEpochSeconds >= expiresAtEpochSeconds;
}

}  // namespace spp
