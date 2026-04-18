use ironrdp::pdu::geometry::InclusiveRectangle;

#[derive(Debug)]
pub struct ViewerBuffer {
    width: usize,
    height: usize,
    pixels: Vec<u32>,
    initialized: bool,
}

impl ViewerBuffer {
    pub fn new(width: usize, height: usize) -> Self {
        Self {
            width,
            height,
            pixels: vec![0u32; width * height],
            initialized: false,
        }
    }

    pub fn pixels(&self) -> &[u32] {
        &self.pixels
    }

    /// Atualiza o buffer a partir de uma imagem que cobre exatamente este buffer (single-monitor).
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

    /// Atualiza o buffer a partir de um slice da imagem global do desktop (multimon).
    ///
    /// `full_rgba`  — buffer RGBA do desktop completo (bounding box de todos os monitores).
    /// `full_width` — largura em pixels do desktop completo.
    /// `mon_x`, `mon_y` — posição deste monitor no espaço global (já normalizados para >= 0).
    /// `dirty`      — região suja em coordenadas globais (None = sem atualização).
    pub fn apply_rgba_update_from_full(
        &mut self,
        full_rgba: &[u8],
        full_width: usize,
        mon_x: usize,
        mon_y: usize,
        dirty: Option<&InclusiveRectangle>,
    ) -> bool {
        if !self.initialized {
            self.write_full_from_slice(full_rgba, full_width, mon_x, mon_y);
        } else if let Some(region) = dirty {
            let mon_right = mon_x + self.width;
            let mon_bottom = mon_y + self.height;

            let r_left = usize::from(region.left);
            let r_top = usize::from(region.top);
            let r_right = usize::from(region.right);
            let r_bottom = usize::from(region.bottom);

            // Verifica sobreposição com este monitor
            if r_right < mon_x || r_left >= mon_right || r_bottom < mon_y || r_top >= mon_bottom {
                return false;
            }

            // Recorta a região ao limite deste monitor (coordenadas globais)
            let clip_left = r_left.max(mon_x);
            let clip_top = r_top.max(mon_y);
            let clip_right = r_right.min(mon_right - 1);
            let clip_bottom = r_bottom.min(mon_bottom - 1);

            self.write_region_from_slice(
                full_rgba, full_width,
                mon_x, mon_y,
                clip_left, clip_top, clip_right, clip_bottom,
            );
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

    /// Copia a fatia correspondente a este monitor da imagem global para o buffer local.
    fn write_full_from_slice(
        &mut self,
        full_rgba: &[u8],
        full_width: usize,
        mon_x: usize,
        mon_y: usize,
    ) {
        for local_y in 0..self.height {
            let global_y = mon_y + local_y;
            let src_row_start = (global_y * full_width + mon_x) * 4;
            let dst_row_start = local_y * self.width;
            let src_row = &full_rgba[src_row_start..src_row_start + self.width * 4];
            let dst_row = &mut self.pixels[dst_row_start..dst_row_start + self.width];
            for (dst, src) in dst_row.iter_mut().zip(src_row.chunks_exact(4)) {
                *dst = (u32::from(src[0]) << 16) | (u32::from(src[1]) << 8) | u32::from(src[2]);
            }
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

    /// Copia a região recortada (em coordenadas globais) para as posições locais do buffer.
    #[allow(clippy::too_many_arguments)]
    fn write_region_from_slice(
        &mut self,
        full_rgba: &[u8],
        full_width: usize,
        mon_x: usize,
        mon_y: usize,
        clip_left: usize,
        clip_top: usize,
        clip_right: usize,
        clip_bottom: usize,
    ) {
        let row_width = clip_right - clip_left + 1;
        for global_y in clip_top..=clip_bottom {
            let local_y = global_y - mon_y;
            let local_x = clip_left - mon_x;
            let src_start = (global_y * full_width + clip_left) * 4;
            let dst_start = local_y * self.width + local_x;
            let src_row = &full_rgba[src_start..src_start + row_width * 4];
            let dst_row = &mut self.pixels[dst_start..dst_start + row_width];
            for (dst, src) in dst_row.iter_mut().zip(src_row.chunks_exact(4)) {
                *dst = (u32::from(src[0]) << 16) | (u32::from(src[1]) << 8) | u32::from(src[2]);
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
