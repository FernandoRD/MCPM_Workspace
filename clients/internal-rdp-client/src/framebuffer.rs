#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Framebuffer {
    width: u16,
    height: u16,
    pixels: Vec<u32>,
}

impl Framebuffer {
    pub fn new(width: u16, height: u16) -> Self {
        let pixel_count = width as usize * height as usize;
        Self {
            width,
            height,
            pixels: vec![0; pixel_count],
        }
    }

    pub fn width(&self) -> u16 {
        self.width
    }

    pub fn height(&self) -> u16 {
        self.height
    }

    pub fn pixels(&self) -> &[u32] {
        &self.pixels
    }

    pub fn resize(&mut self, width: u16, height: u16) {
        self.width = width;
        self.height = height;
        self.pixels.resize(width as usize * height as usize, 0);
    }

    pub fn clear(&mut self, argb: u32) {
        self.pixels.fill(argb);
    }

    pub fn write_pixel(&mut self, x: u16, y: u16, argb: u32) -> Result<(), &'static str> {
        let index = self.index(x, y).ok_or("pixel out of bounds")?;
        self.pixels[index] = argb;
        Ok(())
    }

    fn index(&self, x: u16, y: u16) -> Option<usize> {
        if x >= self.width || y >= self.height {
            return None;
        }

        Some(y as usize * self.width as usize + x as usize)
    }
}

#[cfg(test)]
mod tests {
    use super::Framebuffer;

    #[test]
    fn clears_and_writes_pixels() {
        let mut framebuffer = Framebuffer::new(4, 2);
        framebuffer.clear(0xFF11_2233);
        framebuffer.write_pixel(1, 1, 0xFFAA_BBCC).unwrap();

        assert_eq!(framebuffer.pixels()[0], 0xFF11_2233);
        assert_eq!(framebuffer.pixels()[5], 0xFFAA_BBCC);
    }
}
