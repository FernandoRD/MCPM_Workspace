//! Tradução de eventos do winit 0.30 para entradas Fast Path do IronRDP.
//!
//! O módulo é independente do renderer/janela usados pelo viewer. O chamador
//! pode encaminhar cada `WindowEvent` para [`WinitInputState::handle_window_event`]
//! e enviar os eventos retornados ao servidor RDP.

use ironrdp::pdu::input::fast_path::{FastPathInputEvent, KeyboardFlags};
use ironrdp::pdu::input::mouse::PointerFlags;
use ironrdp::pdu::input::MousePdu;
use winit::event::{DeviceEvent, ElementState, MouseButton, MouseScrollDelta, WindowEvent};
use winit::keyboard::{KeyCode, PhysicalKey};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DisplayMapping {
    pub display_width: u32,
    pub display_height: u32,
    pub buffer_width: u32,
    pub buffer_height: u32,
    pub offset_x: i32,
    pub offset_y: i32,
}

impl DisplayMapping {
    pub fn new(
        display_width: u32,
        display_height: u32,
        buffer_width: u32,
        buffer_height: u32,
    ) -> Self {
        Self {
            display_width,
            display_height,
            buffer_width,
            buffer_height,
            offset_x: 0,
            offset_y: 0,
        }
    }

    pub fn with_offset(mut self, offset_x: i32, offset_y: i32) -> Self {
        self.offset_x = offset_x;
        self.offset_y = offset_y;
        self
    }

    pub fn normalize(&self, x: f64, y: f64) -> (u16, u16) {
        let dx = x.clamp(0.0, self.display_width.saturating_sub(1) as f64);
        let dy = y.clamp(0.0, self.display_height.saturating_sub(1) as f64);
        let bx = if self.display_width == 0 {
            0
        } else {
            (dx * self.buffer_width as f64 / self.display_width as f64).round() as i32
        };
        let by = if self.display_height == 0 {
            0
        } else {
            (dy * self.buffer_height as f64 / self.display_height as f64).round() as i32
        };
        (
            (bx + self.offset_x).max(0).min(u16::MAX as i32) as u16,
            (by + self.offset_y).max(0).min(u16::MAX as i32) as u16,
        )
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct WinitMouseState {
    pub last_position: Option<(u16, u16)>,
    pub left_down: bool,
    pub middle_down: bool,
    pub right_down: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct WinitInputState {
    pub mapping: DisplayMapping,
    pub mouse: WinitMouseState,
}

impl WinitInputState {
    pub fn new(mapping: DisplayMapping) -> Self {
        Self {
            mapping,
            mouse: WinitMouseState::default(),
        }
    }

    pub fn handle_window_event(&mut self, event: &WindowEvent) -> Vec<FastPathInputEvent> {
        match event {
            WindowEvent::KeyboardInput { event, .. } => {
                self.keyboard(event.physical_key, event.state)
            }
            WindowEvent::CursorMoved { position, .. } => self.cursor_moved(position.x, position.y),
            WindowEvent::MouseInput { state, button, .. } => self.mouse_button(*button, *state),
            WindowEvent::MouseWheel { delta, .. } => self.mouse_wheel(*delta),
            _ => Vec::new(),
        }
    }

    pub fn handle_device_event(&mut self, event: &DeviceEvent) -> Vec<FastPathInputEvent> {
        match event {
            DeviceEvent::MouseMotion { delta: (x, y) } => {
                let (px, py) = self.mouse.last_position.unwrap_or((0, 0));
                let x =
                    (px as f64 + x).clamp(0.0, self.mapping.buffer_width.saturating_sub(1) as f64);
                let y =
                    (py as f64 + y).clamp(0.0, self.mapping.buffer_height.saturating_sub(1) as f64);
                self.cursor_buffer(x, y)
            }
            _ => Vec::new(),
        }
    }

    pub fn keyboard(&self, key: PhysicalKey, state: ElementState) -> Vec<FastPathInputEvent> {
        let Some((scan, extended)) = scan_code(key) else {
            return Vec::new();
        };
        let mut flags = if state == ElementState::Released {
            KeyboardFlags::RELEASE
        } else {
            KeyboardFlags::empty()
        };
        if extended {
            flags |= KeyboardFlags::EXTENDED;
        }
        vec![FastPathInputEvent::KeyboardEvent(flags, scan)]
    }

    pub fn cursor_moved(&mut self, x: f64, y: f64) -> Vec<FastPathInputEvent> {
        let (x, y) = self.mapping.normalize(x, y);
        self.cursor_buffer(x as f64, y as f64)
    }

    fn cursor_buffer(&mut self, x: f64, y: f64) -> Vec<FastPathInputEvent> {
        let pos = (
            x.round().clamp(0.0, u16::MAX as f64) as u16,
            y.round().clamp(0.0, u16::MAX as f64) as u16,
        );
        if self.mouse.last_position == Some(pos) {
            return Vec::new();
        }
        self.mouse.last_position = Some(pos);
        vec![mouse_event(current_move_flags(&self.mouse), pos)]
    }

    pub fn mouse_button(
        &mut self,
        button: MouseButton,
        state: ElementState,
    ) -> Vec<FastPathInputEvent> {
        let (down, flag) = match button {
            MouseButton::Left => (&mut self.mouse.left_down, PointerFlags::LEFT_BUTTON),
            MouseButton::Middle => (
                &mut self.mouse.middle_down,
                PointerFlags::MIDDLE_BUTTON_OR_WHEEL,
            ),
            MouseButton::Right => (&mut self.mouse.right_down, PointerFlags::RIGHT_BUTTON),
            _ => return Vec::new(),
        };
        let is_down = state == ElementState::Pressed;
        if *down == is_down {
            return Vec::new();
        }
        *down = is_down;
        vec![mouse_event(
            if is_down {
                flag | PointerFlags::DOWN
            } else {
                flag
            },
            self.mouse.last_position.unwrap_or((0, 0)),
        )]
    }

    pub fn mouse_wheel(&self, delta: MouseScrollDelta) -> Vec<FastPathInputEvent> {
        let (x, y) = match delta {
            MouseScrollDelta::LineDelta(x, y) => (x, y),
            MouseScrollDelta::PixelDelta(p) => (p.x as f32, p.y as f32),
        };
        let pos = self.mouse.last_position.unwrap_or((0, 0));
        [
            (y, PointerFlags::VERTICAL_WHEEL),
            (x, PointerFlags::HORIZONTAL_WHEEL),
        ]
        .into_iter()
        .filter_map(|(v, flag)| {
            let units = normalize_scroll_delta(v);
            (units != 0).then(|| mouse_event_with_wheel(flag, pos, units))
        })
        .collect()
    }
}

fn current_move_flags(mouse: &WinitMouseState) -> PointerFlags {
    let mut flags = PointerFlags::MOVE;
    if mouse.left_down {
        flags |= PointerFlags::LEFT_BUTTON;
    }
    if mouse.middle_down {
        flags |= PointerFlags::MIDDLE_BUTTON_OR_WHEEL;
    }
    if mouse.right_down {
        flags |= PointerFlags::RIGHT_BUTTON;
    }
    if mouse.left_down || mouse.middle_down || mouse.right_down {
        flags |= PointerFlags::DOWN;
    }
    flags
}

fn mouse_event(flags: PointerFlags, (x, y): (u16, u16)) -> FastPathInputEvent {
    mouse_event_with_wheel(flags, (x, y), 0)
}
fn mouse_event_with_wheel(
    flags: PointerFlags,
    (x, y): (u16, u16),
    units: i16,
) -> FastPathInputEvent {
    FastPathInputEvent::MouseEvent(MousePdu {
        flags,
        number_of_wheel_rotation_units: units,
        x_position: x,
        y_position: y,
    })
}

fn normalize_scroll_delta(delta: f32) -> i16 {
    if delta.abs() < f32::EPSILON {
        return 0;
    }
    let scaled = if delta.abs() <= 1.0 {
        -delta * 1800.0
    } else {
        -delta * 15.0
    };
    scaled.round().clamp(-255.0, 255.0) as i16
}

fn scan_code(key: PhysicalKey) -> Option<(u8, bool)> {
    let code = match key {
        PhysicalKey::Code(code) => code,
        PhysicalKey::Unidentified(_) => return None,
    };
    let value = match code {
        KeyCode::Digit1 => (0x02, false),
        KeyCode::Digit2 => (0x03, false),
        KeyCode::Digit3 => (0x04, false),
        KeyCode::Digit4 => (0x05, false),
        KeyCode::Digit5 => (0x06, false),
        KeyCode::Digit6 => (0x07, false),
        KeyCode::Digit7 => (0x08, false),
        KeyCode::Digit8 => (0x09, false),
        KeyCode::Digit9 => (0x0A, false),
        KeyCode::Digit0 => (0x0B, false),
        KeyCode::KeyA => (0x1E, false),
        KeyCode::KeyB => (0x30, false),
        KeyCode::KeyC => (0x2E, false),
        KeyCode::KeyD => (0x20, false),
        KeyCode::KeyE => (0x12, false),
        KeyCode::KeyF => (0x21, false),
        KeyCode::KeyG => (0x22, false),
        KeyCode::KeyH => (0x23, false),
        KeyCode::KeyI => (0x17, false),
        KeyCode::KeyJ => (0x24, false),
        KeyCode::KeyK => (0x25, false),
        KeyCode::KeyL => (0x26, false),
        KeyCode::KeyM => (0x32, false),
        KeyCode::KeyN => (0x31, false),
        KeyCode::KeyO => (0x18, false),
        KeyCode::KeyP => (0x19, false),
        KeyCode::KeyQ => (0x10, false),
        KeyCode::KeyR => (0x13, false),
        KeyCode::KeyS => (0x1F, false),
        KeyCode::KeyT => (0x14, false),
        KeyCode::KeyU => (0x16, false),
        KeyCode::KeyV => (0x2F, false),
        KeyCode::KeyW => (0x11, false),
        KeyCode::KeyX => (0x2D, false),
        KeyCode::KeyY => (0x15, false),
        KeyCode::KeyZ => (0x2C, false),
        KeyCode::F1 => (0x3B, false),
        KeyCode::F2 => (0x3C, false),
        KeyCode::F3 => (0x3D, false),
        KeyCode::F4 => (0x3E, false),
        KeyCode::F5 => (0x3F, false),
        KeyCode::F6 => (0x40, false),
        KeyCode::F7 => (0x41, false),
        KeyCode::F8 => (0x42, false),
        KeyCode::F9 => (0x43, false),
        KeyCode::F10 => (0x44, false),
        KeyCode::F11 => (0x57, false),
        KeyCode::F12 => (0x58, false),
        KeyCode::ArrowDown => (0x50, true),
        KeyCode::ArrowLeft => (0x4B, true),
        KeyCode::ArrowRight => (0x4D, true),
        KeyCode::ArrowUp => (0x48, true),
        KeyCode::Backspace => (0x0E, false),
        KeyCode::Delete => (0x53, true),
        KeyCode::End => (0x4F, true),
        KeyCode::Enter => (0x1C, false),
        KeyCode::Escape => (0x01, false),
        KeyCode::Home => (0x47, true),
        KeyCode::Insert => (0x52, true),
        KeyCode::PageDown => (0x51, true),
        KeyCode::PageUp => (0x49, true),
        KeyCode::Space => (0x39, false),
        KeyCode::Tab => (0x0F, false),
        KeyCode::NumLock => (0x45, false),
        KeyCode::CapsLock => (0x3A, false),
        KeyCode::ScrollLock => (0x46, false),
        KeyCode::ShiftLeft => (0x2A, false),
        KeyCode::ShiftRight => (0x36, false),
        KeyCode::ControlLeft => (0x1D, false),
        KeyCode::ControlRight => (0x1D, true),
        KeyCode::AltLeft => (0x38, false),
        KeyCode::AltRight => (0x38, true),
        KeyCode::SuperLeft => (0x5B, true),
        KeyCode::SuperRight => (0x5C, true),
        KeyCode::Quote => (0x28, false),
        KeyCode::Backquote => (0x29, false),
        KeyCode::Backslash => (0x2B, false),
        // ABNT/ISO keyboards report the extra key (\\ and |) separately from
        // the ANSI backslash key. RDP scan code 0x56 preserves that distinction
        // for the remote keyboard layout.
        KeyCode::IntlBackslash => (0x56, false),
        KeyCode::Comma => (0x33, false),
        KeyCode::Equal => (0x0D, false),
        KeyCode::BracketLeft => (0x1A, false),
        KeyCode::Minus => (0x0C, false),
        KeyCode::Period => (0x34, false),
        KeyCode::BracketRight => (0x1B, false),
        KeyCode::Semicolon => (0x27, false),
        KeyCode::Slash => (0x35, false),
        KeyCode::Numpad0 => (0x52, false),
        KeyCode::Numpad1 => (0x4F, false),
        KeyCode::Numpad2 => (0x50, false),
        KeyCode::Numpad3 => (0x51, false),
        KeyCode::Numpad4 => (0x4B, false),
        KeyCode::Numpad5 => (0x4C, false),
        KeyCode::Numpad6 => (0x4D, false),
        KeyCode::Numpad7 => (0x47, false),
        KeyCode::Numpad8 => (0x48, false),
        KeyCode::Numpad9 => (0x49, false),
        KeyCode::NumpadDecimal => (0x53, false),
        KeyCode::NumpadDivide => (0x35, true),
        KeyCode::NumpadMultiply => (0x37, false),
        KeyCode::NumpadSubtract => (0x4A, false),
        KeyCode::NumpadAdd => (0x4E, false),
        KeyCode::NumpadEnter => (0x1C, true),
        _ => return None,
    };
    Some(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scales_and_offsets_coordinates() {
        let m = DisplayMapping::new(1600, 900, 800, 450).with_offset(10, 20);
        assert_eq!(m.normalize(1599.0, 899.0), (810, 470));
    }
    #[test]
    fn emits_keyboard_scan_and_release() {
        let s = WinitInputState::new(DisplayMapping::new(1, 1, 1, 1));
        assert!(
            matches!(s.keyboard(PhysicalKey::Code(KeyCode::Enter), ElementState::Pressed)[0], FastPathInputEvent::KeyboardEvent(f, 0x1C) if f.is_empty())
        );
        assert!(
            matches!(s.keyboard(PhysicalKey::Code(KeyCode::ArrowLeft), ElementState::Released)[0], FastPathInputEvent::KeyboardEvent(f, 0x4B) if f == (KeyboardFlags::EXTENDED | KeyboardFlags::RELEASE))
        );
    }
    #[test]
    fn maps_iso_backslash_key_for_abnt_layouts() {
        let s = WinitInputState::new(DisplayMapping::new(1, 1, 1, 1));
        assert!(
            matches!(s.keyboard(PhysicalKey::Code(KeyCode::IntlBackslash), ElementState::Pressed)[0], FastPathInputEvent::KeyboardEvent(f, 0x56) if f.is_empty())
        );
    }
    #[test]
    fn tracks_button_and_drag_flags() {
        let mut s = WinitInputState::new(DisplayMapping::new(100, 100, 100, 100));
        s.cursor_moved(10.0, 20.0);
        assert_eq!(
            s.mouse_button(MouseButton::Left, ElementState::Pressed)
                .len(),
            1
        );
        let e = s.cursor_moved(11.0, 20.0);
        assert!(
            matches!(e[0], FastPathInputEvent::MouseEvent(MousePdu { flags, .. }) if flags.contains(PointerFlags::LEFT_BUTTON) && flags.contains(PointerFlags::DOWN))
        );
    }
    #[test]
    fn emits_vertical_and_horizontal_wheel() {
        let mut s = WinitInputState::new(DisplayMapping::new(100, 100, 100, 100));
        s.cursor_moved(5.0, 5.0);
        assert_eq!(
            s.mouse_wheel(MouseScrollDelta::LineDelta(1.0, 1.0)).len(),
            2
        );
    }
}
