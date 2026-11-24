//! Timing for coalescing bursts of file-system events into single notifications.
//!
//! Pure state over caller-supplied instants, so it is tested with a fake clock.

use std::time::{Duration, Instant};

/// Flush this long after the last event (the burst has settled).
pub const SETTLE: Duration = Duration::from_millis(300);
/// Flush at the latest this long after the first unflushed event, even if events keep coming.
pub const MAX_WAIT: Duration = Duration::from_secs(2);

/// Decides when a pending batch of events should be flushed.
#[derive(Debug, Clone)]
pub struct Coalescer {
    settle: Duration,
    max_wait: Duration,
    first: Option<Instant>,
    last: Option<Instant>,
}

impl Default for Coalescer {
    fn default() -> Self {
        Coalescer::new(SETTLE, MAX_WAIT)
    }
}

impl Coalescer {
    pub fn new(settle: Duration, max_wait: Duration) -> Self {
        Coalescer { settle, max_wait, first: None, last: None }
    }

    /// Note that a relevant event arrived at `now`.
    pub fn record(&mut self, now: Instant) {
        self.first.get_or_insert(now);
        self.last = Some(now);
    }

    /// Whether events are waiting to be flushed.
    pub fn is_pending(&self) -> bool {
        self.first.is_some()
    }

    /// When the pending batch is due, or `None` when nothing is pending.
    pub fn deadline(&self) -> Option<Instant> {
        match (self.first, self.last) {
            (Some(first), Some(last)) => Some((last + self.settle).min(first + self.max_wait)),
            _ => None,
        }
    }

    /// If the pending batch is due at `now`, reset and return `true`: the caller flushes it.
    pub fn take_due(&mut self, now: Instant) -> bool {
        match self.deadline() {
            Some(d) if now >= d => {
                self.first = None;
                self.last = None;
                true
            }
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feed events at `times` (offsets from `t0`) and poll at every event and every deadline,
    /// as the watcher loop does; return the flush instants as offsets.
    fn simulate(times: &[Duration], until: Duration) -> Vec<Duration> {
        let t0 = Instant::now();
        let mut c = Coalescer::default();
        let mut flushes = Vec::new();
        let mut events = times.iter().copied().peekable();
        loop {
            let next_event = events.peek().map(|d| t0 + *d);
            let next_deadline = c.deadline();
            let now = match (next_event, next_deadline) {
                (Some(e), Some(d)) => e.min(d),
                (Some(e), None) => e,
                (None, Some(d)) => d,
                (None, None) => break,
            };
            if now > t0 + until {
                break;
            }
            if next_event == Some(now) {
                events.next();
                c.record(now);
            }
            if c.take_due(now) {
                flushes.push(now - t0);
            }
        }
        flushes
    }

    #[test]
    fn burst_flushes_once_after_it_settles() {
        // 200 events within 500 ms.
        let times: Vec<_> = (0..200).map(|i| Duration::from_micros(i * 2500)).collect();
        let last = *times.last().unwrap();
        let flushes = simulate(&times, Duration::from_secs(5));
        assert_eq!(flushes.len(), 1, "{flushes:?}");
        assert!(flushes[0] > last && flushes[0] - last <= Duration::from_secs(1), "{flushes:?}");
    }

    #[test]
    fn continuous_activity_still_flushes_regularly() {
        // An event every 50 ms for 10 s never settles.
        let times: Vec<_> = (0..200).map(|i| Duration::from_millis(i * 50)).collect();
        let flushes = simulate(&times, Duration::from_secs(12));
        assert!(flushes.len() >= 4, "{flushes:?}");
        let mut prev = Duration::ZERO;
        for f in &flushes {
            assert!(*f - prev <= Duration::from_secs(3), "gap before {f:?} in {flushes:?}");
            prev = *f;
        }
    }

    #[test]
    fn nothing_pending_means_no_deadline() {
        let mut c = Coalescer::default();
        assert_eq!(c.deadline(), None);
        assert!(!c.take_due(Instant::now()));
        let t = Instant::now();
        c.record(t);
        assert!(c.is_pending());
        assert!(!c.take_due(t));
        assert!(c.take_due(t + SETTLE));
        assert!(!c.is_pending());
    }
}
