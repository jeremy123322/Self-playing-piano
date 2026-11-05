#ifdef SPP_NANO_LOOPBACK

#include "nano_loopback_link.h"

#include <string.h>

#include "note_mapping.h"

namespace spp {

bool NanoLoopbackOutput::allOff() {
  memset(active_, 0, sizeof(active_));
  return true;
}

bool NanoLoopbackOutput::setKey(uint8_t keyIndex, bool on, uint8_t velocity) {
  (void)velocity;
  if (outputForKey(keyIndex) == kUnmappedOutput) return false;
  active_[keyIndex] = on;
  return true;
}

void NanoLoopbackLink::begin() {
  controller_.begin();
  Serial.println("Nano loopback enabled; no physical outputs are driven");
}

void NanoLoopbackLink::transfer(const Frame& outgoing, Frame& incoming) {
  controller_.tick(millis());
  incoming = controller_.response();
  controller_.processFrame(outgoing, millis());
}

}  // namespace spp

#endif
