use ironrdp::pdu::geometry::InclusiveRectangle;

#[derive(Debug)]
pub struct ViewerBuffer {
    width: usize,
    pixels: Vec<u32>,
    initialized: bool,
}

impl ViewerBuffer {
    pub fn new(width: usize, height: usize) -> Self {
        Self {
            width,
            pixels: vec![0u32; width * height],
            initialized: false,
        }
    }

    pub fn pixels(&self) -> &[u32] {
        &self.pixels
    }

    pub fn apply_rgba_update(&mut self, rgba: &[u8], dirty_region: Option<&InclusiveRectangle>) -> bool {
        if !self.initialized {
            self.write_full(rgba);
        } else if let Some(region) = dirty_region {
            self.write_region(rgba, region);
        } else {
            return false;
        }

        self.initialized = true;
        true
    }

    fn write_full(&mut self, rgba: &[u8]) {
        for (index, pixel) in rgba.chunks_exact(4).enumerate() {
            let red = u32::from(pixel[0]);
            let green = u32::from(pixel[1]);
            let blue = u32::from(pixel[2]);
            self.pixels[index] = (red << 16) | (green << 8) | blue;
        }
    }

    fn write_region(&mut self, rgba: &[u8], region: &InclusiveRectangle) {
        let left = usize::from(region.left);
        let top = usize::from(region.top);
        let right = usize::from(region.right);
        let bottom = usize::from(region.bottom);

        for y in top..=bottom {
            let row_start = y * self.width;
            for x in left..=right {
                let index = row_start + x;
                let pixel_offset = index * 4;
                let red = u32::from(rgba[pixel_offset]);
                let green = u32::from(rgba[pixel_offset + 1]);
                let blue = u32::from(rgba[pixel_offset + 2]);
                self.pixels[index] = (red << 16) | (green << 8) | blue;
            }
        }
    }
}

pub fn merge_dirty_region(
    current: Option<InclusiveRectangle>,
    next: Option<InclusiveRectangle>,
) -> Option<InclusiveRectangle> {
    match (current, next) {
        (Some(current), Some(next)) => Some(InclusiveRectangle {
            left: current.left.min(next.left),
            top: current.top.min(next.top),
            right: current.right.max(next.right),
            bottom: current.bottom.max(next.bottom),
        }),
        (Some(current), None) => Some(current),
        (None, Some(next)) => Some(next),
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{merge_dirty_region, ViewerBuffer};
    use ironrdp::pdu::geometry::InclusiveRectangle;

    #[test]
    fn merges_regions_by_union() {
        let merged = merge_dirty_region(
            Some(InclusiveRectangle {
                left: 10,
                top: 20,
                right: 30,
                bottom: 40,
            }),
            Some(InclusiveRectangle {
                left: 5,
                top: 25,
                right: 50,
                bottom: 35,
            }),
        )
        .expect("merged region");

        assert_eq!(merged.left, 5);
        assert_eq!(merged.top, 20);
        assert_eq!(merged.right, 50);
        assert_eq!(merged.bottom, 40);
    }

    #[test]
    fn initializes_buffer_with_first_partial_update() {
        let mut buffer = ViewerBuffer::new(2, 1);
        let rgba = [
            255, 0, 0, 255, //
            0, 255, 0, 255,
        ];

        let changed = buffer.apply_rgba_update(
            &rgba,
            Some(&InclusiveRectangle {
                left: 1,
                top: 0,
                right: 1,
                bottom: 0,
            }),
        );

        assert!(changed);
        assert_eq!(buffer.pixels(), &[0x00FF0000, 0x0000FF00]);
    }
}
