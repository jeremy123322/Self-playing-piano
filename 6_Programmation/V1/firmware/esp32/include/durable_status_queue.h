#pragma once

#include <stddef.h>

#include "playback_controller.h"

namespace spp {

template <size_t Capacity>
class DurableStatusQueue {
 public:
  static_assert(Capacity > 0, "Durable status queue capacity must be positive");

  bool push(const PlaybackSnapshot& snapshot) {
    if (count_ == Capacity) return false;
    entries_[(head_ + count_) % Capacity] = snapshot;
    ++count_;
    return true;
  }

  const PlaybackSnapshot* front() const {
    return count_ == 0 ? nullptr : &entries_[head_];
  }

  bool pop() {
    if (count_ == 0) return false;
    head_ = (head_ + 1) % Capacity;
    --count_;
    return true;
  }

  size_t size() const { return count_; }
  bool empty() const { return count_ == 0; }

 private:
  PlaybackSnapshot entries_[Capacity]{};
  size_t head_ = 0;
  size_t count_ = 0;
};

}  // namespace spp
