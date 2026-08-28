//! Lightweight counters for observing viewer throughput and rendering cost.
//!
//! The type intentionally has no timing or logging dependencies. Callers measure
//! durations at the boundary they care about and record them here.

use std::time::Duration;

/// Accumulated viewer metrics.
#[derive(Debug, Default, Clone)]
pub struct ViewerMetrics {
    frames_received: u64,
    frames_rendered: u64,
    window_updates: u64,
    bytes_converted: u64,
    pixels_converted: u64,
    regions_merged: u64,
    decode_time: Duration,
    network_read_time: Duration,
    rdp_processing_time: Duration,
    response_write_time: Duration,
    conversion_time: Duration,
    presentation_time: Duration,
}

/// An immutable point-in-time copy of [`ViewerMetrics`].
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Snapshot {
    pub frames_received: u64,
    pub frames_rendered: u64,
    pub window_updates: u64,
    pub bytes_converted: u64,
    pub pixels_converted: u64,
    pub regions_merged: u64,
    pub decode_time: Duration,
    pub network_read_time: Duration,
    pub rdp_processing_time: Duration,
    pub response_write_time: Duration,
    pub conversion_time: Duration,
    pub presentation_time: Duration,
}

impl ViewerMetrics {
    pub fn record_frame_received(&mut self) {
        self.frames_received = self.frames_received.saturating_add(1);
    }

    pub fn record_frame_rendered(&mut self) {
        self.frames_rendered = self.frames_rendered.saturating_add(1);
    }

    pub fn record_window_update(&mut self) {
        self.window_updates = self.window_updates.saturating_add(1);
    }

    pub fn record_conversion(&mut self, bytes: u64, pixels: u64) {
        self.bytes_converted = self.bytes_converted.saturating_add(bytes);
        self.pixels_converted = self.pixels_converted.saturating_add(pixels);
    }

    pub fn record_regions_merged(&mut self, count: u64) {
        self.regions_merged = self.regions_merged.saturating_add(count);
    }

    pub fn record_decode_time(&mut self, elapsed: Duration) {
        self.decode_time = self.decode_time.saturating_add(elapsed);
    }

    pub fn record_network_read_time(&mut self, elapsed: Duration) {
        self.network_read_time = self.network_read_time.saturating_add(elapsed);
    }

    pub fn record_rdp_processing_time(&mut self, elapsed: Duration) {
        self.rdp_processing_time = self.rdp_processing_time.saturating_add(elapsed);
    }

    pub fn record_response_write_time(&mut self, elapsed: Duration) {
        self.response_write_time = self.response_write_time.saturating_add(elapsed);
    }

    pub fn record_conversion_time(&mut self, elapsed: Duration) {
        self.conversion_time = self.conversion_time.saturating_add(elapsed);
    }

    pub fn record_presentation_time(&mut self, elapsed: Duration) {
        self.presentation_time = self.presentation_time.saturating_add(elapsed);
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            frames_received: self.frames_received,
            frames_rendered: self.frames_rendered,
            window_updates: self.window_updates,
            bytes_converted: self.bytes_converted,
            pixels_converted: self.pixels_converted,
            regions_merged: self.regions_merged,
            decode_time: self.decode_time,
            network_read_time: self.network_read_time,
            rdp_processing_time: self.rdp_processing_time,
            response_write_time: self.response_write_time,
            conversion_time: self.conversion_time,
            presentation_time: self.presentation_time,
        }
    }

    /// Clears all counters and returns the values accumulated before the reset.
    pub fn reset(&mut self) -> Snapshot {
        let previous = self.snapshot();
        *self = Self::default();
        previous
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_counters_and_durations() {
        let mut metrics = ViewerMetrics::default();
        metrics.record_frame_received();
        metrics.record_frame_rendered();
        metrics.record_window_update();
        metrics.record_conversion(128, 32);
        metrics.record_regions_merged(3);
        metrics.record_decode_time(Duration::from_millis(2));
        metrics.record_network_read_time(Duration::from_micros(80));
        metrics.record_rdp_processing_time(Duration::from_millis(3));
        metrics.record_response_write_time(Duration::from_micros(20));
        metrics.record_conversion_time(Duration::from_micros(40));
        metrics.record_presentation_time(Duration::from_millis(1));

        assert_eq!(
            metrics.snapshot(),
            Snapshot {
                frames_received: 1,
                frames_rendered: 1,
                window_updates: 1,
                bytes_converted: 128,
                pixels_converted: 32,
                regions_merged: 3,
                decode_time: Duration::from_millis(2),
                network_read_time: Duration::from_micros(80),
                rdp_processing_time: Duration::from_millis(3),
                response_write_time: Duration::from_micros(20),
                conversion_time: Duration::from_micros(40),
                presentation_time: Duration::from_millis(1),
            }
        );
    }

    #[test]
    fn reset_returns_previous_values_and_clears_metrics() {
        let mut metrics = ViewerMetrics::default();
        metrics.record_frame_received();
        metrics.record_conversion(4, 1);
        metrics.record_network_read_time(Duration::from_millis(1));

        let previous = metrics.reset();
        assert_eq!(previous.frames_received, 1);
        assert_eq!(previous.bytes_converted, 4);
        assert_eq!(previous.network_read_time, Duration::from_millis(1));
        assert_eq!(metrics.snapshot(), Snapshot::default());
    }
}
