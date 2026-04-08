use ironrdp::pdu::input::fast_path::{FastPathInputEvent, KeyboardFlags};
use ironrdp::pdu::input::mouse::PointerFlags;
use ironrdp::pdu::input::MousePdu;
use minifb::{Key, KeyRepeat, MouseButton, MouseMode, Window};

#[derive(Debug, Clone, Copy, Default)]
pub struct MouseInputState {
    last_position: Option<(u16, u16)>,
    left_down: bool,
    middle_down: bool,
    right_down: bool,
}

pub fn collect_window_input(
    window: &Window,
    width: usize,
    height: usize,
    mouse_state: &mut MouseInputState,
) -> Vec<FastPathInputEvent> {
    let mut events = Vec::new();

    for key in window.get_keys_pressed(KeyRepeat::No) {
        if let Some(event) = key_press_event(key) {
            events.push(event);
        }
    }

    for key in window.get_keys_released() {
        if let Some(event) = key_release_event(key) {
            events.push(event);
        }
    }

    collect_mouse_input(window, width, height, mouse_state, &mut events);

    events
}

fn collect_mouse_input(
    window: &Window,
    width: usize,
    height: usize,
    mouse_state: &mut MouseInputState,
    events: &mut Vec<FastPathInputEvent>,
) {
    let left_down = window.get_mouse_down(MouseButton::Left);
    let middle_down = window.get_mouse_down(MouseButton::Middle);
    let right_down = window.get_mouse_down(MouseButton::Right);
    let current_position = window
        .get_mouse_pos(MouseMode::Discard)
        .map(|(x, y)| normalize_mouse_position(x, y, width, height));

    if let Some(position) = current_position {
        if mouse_state.last_position != Some(position) {
            events.push(mouse_event(current_move_flags(left_down, middle_down, right_down), position));
            mouse_state.last_position = Some(position);
        }
    }

    let button_position = current_position
        .or_else(|| {
            window
                .get_mouse_pos(MouseMode::Clamp)
                .map(|(x, y)| normalize_mouse_position(x, y, width, height))
        })
        .or(mouse_state.last_position)
        .unwrap_or((0, 0));

    push_mouse_button_event(
        events,
        &mut mouse_state.left_down,
        left_down,
        button_position,
        PointerFlags::LEFT_BUTTON,
    );
    push_mouse_button_event(
        events,
        &mut mouse_state.middle_down,
        middle_down,
        button_position,
        PointerFlags::MIDDLE_BUTTON_OR_WHEEL,
    );
    push_mouse_button_event(
        events,
        &mut mouse_state.right_down,
        right_down,
        button_position,
        PointerFlags::RIGHT_BUTTON,
    );

    push_scroll_events(events, button_position, window.get_scroll_wheel());
}

fn push_mouse_button_event(
    events: &mut Vec<FastPathInputEvent>,
    was_down: &mut bool,
    is_down: bool,
    position: (u16, u16),
    button_flag: PointerFlags,
) {
    if *was_down == is_down {
        return;
    }

    let flags = if is_down {
        button_flag | PointerFlags::DOWN
    } else {
        button_flag
    };

    events.push(mouse_event(flags, position));
    *was_down = is_down;
}

fn mouse_event(flags: PointerFlags, (x, y): (u16, u16)) -> FastPathInputEvent {
    mouse_event_with_wheel(flags, (x, y), 0)
}

fn mouse_event_with_wheel(
    flags: PointerFlags,
    (x, y): (u16, u16),
    number_of_wheel_rotation_units: i16,
) -> FastPathInputEvent {
    FastPathInputEvent::MouseEvent(MousePdu {
        flags,
        number_of_wheel_rotation_units,
        x_position: x,
        y_position: y,
    })
}

fn push_scroll_events(
    events: &mut Vec<FastPathInputEvent>,
    position: (u16, u16),
    scroll_delta: Option<(f32, f32)>,
) {
    let Some((delta_x, delta_y)) = scroll_delta else {
        return;
    };

    push_scroll_axis_event(events, position, delta_y, PointerFlags::VERTICAL_WHEEL);
    push_scroll_axis_event(events, position, delta_x, PointerFlags::HORIZONTAL_WHEEL);
}

fn push_scroll_axis_event(
    events: &mut Vec<FastPathInputEvent>,
    position: (u16, u16),
    delta: f32,
    axis_flag: PointerFlags,
) {
    let wheel_units = normalize_scroll_delta(delta);
    if wheel_units == 0 {
        return;
    }

    events.push(mouse_event_with_wheel(axis_flag, position, wheel_units));
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

fn current_move_flags(left_down: bool, middle_down: bool, right_down: bool) -> PointerFlags {
    let mut flags = PointerFlags::MOVE;

    if left_down {
        flags |= PointerFlags::LEFT_BUTTON;
    }

    if middle_down {
        flags |= PointerFlags::MIDDLE_BUTTON_OR_WHEEL;
    }

    if right_down {
        flags |= PointerFlags::RIGHT_BUTTON;
    }

    if left_down || middle_down || right_down {
        flags |= PointerFlags::DOWN;
    }

    flags
}

fn normalize_mouse_position(x: f32, y: f32, width: usize, height: usize) -> (u16, u16) {
    (clamp_mouse_coordinate(x, width), clamp_mouse_coordinate(y, height))
}

fn clamp_mouse_coordinate(value: f32, limit: usize) -> u16 {
    let max = limit.saturating_sub(1) as f32;
    value.clamp(0.0, max).round() as u16
}

fn key_press_event(key: Key) -> Option<FastPathInputEvent> {
    let (scan_code, extended) = key_to_scan_code(key)?;
    Some(FastPathInputEvent::KeyboardEvent(
        keyboard_flags(extended, false),
        scan_code,
    ))
}

fn key_release_event(key: Key) -> Option<FastPathInputEvent> {
    let (scan_code, extended) = key_to_scan_code(key)?;
    Some(FastPathInputEvent::KeyboardEvent(
        keyboard_flags(extended, true),
        scan_code,
    ))
}

fn keyboard_flags(extended: bool, released: bool) -> KeyboardFlags {
    let mut flags = KeyboardFlags::empty();

    if extended {
        flags |= KeyboardFlags::EXTENDED;
    }

    if released {
        flags |= KeyboardFlags::RELEASE;
    }

    flags
}

fn key_to_scan_code(key: Key) -> Option<(u8, bool)> {
    let mapping = match key {
        Key::Key1 => (0x02, false),
        Key::Key2 => (0x03, false),
        Key::Key3 => (0x04, false),
        Key::Key4 => (0x05, false),
        Key::Key5 => (0x06, false),
        Key::Key6 => (0x07, false),
        Key::Key7 => (0x08, false),
        Key::Key8 => (0x09, false),
        Key::Key9 => (0x0A, false),
        Key::Key0 => (0x0B, false),
        Key::A => (0x1E, false),
        Key::B => (0x30, false),
        Key::C => (0x2E, false),
        Key::D => (0x20, false),
        Key::E => (0x12, false),
        Key::F => (0x21, false),
        Key::G => (0x22, false),
        Key::H => (0x23, false),
        Key::I => (0x17, false),
        Key::J => (0x24, false),
        Key::K => (0x25, false),
        Key::L => (0x26, false),
        Key::M => (0x32, false),
        Key::N => (0x31, false),
        Key::O => (0x18, false),
        Key::P => (0x19, false),
        Key::Q => (0x10, false),
        Key::R => (0x13, false),
        Key::S => (0x1F, false),
        Key::T => (0x14, false),
        Key::U => (0x16, false),
        Key::V => (0x2F, false),
        Key::W => (0x11, false),
        Key::X => (0x2D, false),
        Key::Y => (0x15, false),
        Key::Z => (0x2C, false),
        Key::F1 => (0x3B, false),
        Key::F2 => (0x3C, false),
        Key::F3 => (0x3D, false),
        Key::F4 => (0x3E, false),
        Key::F5 => (0x3F, false),
        Key::F6 => (0x40, false),
        Key::F7 => (0x41, false),
        Key::F8 => (0x42, false),
        Key::F9 => (0x43, false),
        Key::F10 => (0x44, false),
        Key::F11 => (0x57, false),
        Key::F12 => (0x58, false),
        Key::Down => (0x50, true),
        Key::Left => (0x4B, true),
        Key::Right => (0x4D, true),
        Key::Up => (0x48, true),
        Key::Apostrophe => (0x28, false),
        Key::Backquote => (0x29, false),
        Key::Backslash => (0x2B, false),
        Key::Comma => (0x33, false),
        Key::Equal => (0x0D, false),
        Key::LeftBracket => (0x1A, false),
        Key::Minus => (0x0C, false),
        Key::Period => (0x34, false),
        Key::RightBracket => (0x1B, false),
        Key::Semicolon => (0x27, false),
        Key::Slash => (0x35, false),
        Key::Backspace => (0x0E, false),
        Key::Delete => (0x53, true),
        Key::End => (0x4F, true),
        Key::Enter => (0x1C, false),
        Key::Escape => (0x01, false),
        Key::Home => (0x47, true),
        Key::Insert => (0x52, true),
        Key::Menu => (0x5D, true),
        Key::PageDown => (0x51, true),
        Key::PageUp => (0x49, true),
        Key::Pause => return None,
        Key::Space => (0x39, false),
        Key::Tab => (0x0F, false),
        Key::NumLock => (0x45, false),
        Key::CapsLock => (0x3A, false),
        Key::ScrollLock => (0x46, false),
        Key::LeftShift => (0x2A, false),
        Key::RightShift => (0x36, false),
        Key::LeftCtrl => (0x1D, false),
        Key::RightCtrl => (0x1D, true),
        Key::NumPad0 => (0x52, false),
        Key::NumPad1 => (0x4F, false),
        Key::NumPad2 => (0x50, false),
        Key::NumPad3 => (0x51, false),
        Key::NumPad4 => (0x4B, false),
        Key::NumPad5 => (0x4C, false),
        Key::NumPad6 => (0x4D, false),
        Key::NumPad7 => (0x47, false),
        Key::NumPad8 => (0x48, false),
        Key::NumPad9 => (0x49, false),
        Key::NumPadDot => (0x53, false),
        Key::NumPadSlash => (0x35, true),
        Key::NumPadAsterisk => (0x37, false),
        Key::NumPadMinus => (0x4A, false),
        Key::NumPadPlus => (0x4E, false),
        Key::NumPadEnter => (0x1C, true),
        Key::LeftAlt => (0x38, false),
        Key::RightAlt => (0x38, true),
        Key::LeftSuper => (0x5B, true),
        Key::RightSuper => (0x5C, true),
        Key::F13 | Key::F14 | Key::F15 | Key::Unknown => return None,
        Key::Count => return None,
    };

    Some(mapping)
}

#[cfg(test)]
mod tests {
    use super::{
        clamp_mouse_coordinate, current_move_flags, key_press_event, key_release_event, key_to_scan_code,
        normalize_scroll_delta,
    };
    use ironrdp::pdu::input::fast_path::{FastPathInputEvent, KeyboardFlags};
    use ironrdp::pdu::input::mouse::PointerFlags;
    use minifb::Key;

    #[test]
    fn maps_basic_letter_key() {
        assert_eq!(key_to_scan_code(Key::A), Some((0x1E, false)));
    }

    #[test]
    fn maps_extended_keys() {
        assert_eq!(key_to_scan_code(Key::RightCtrl), Some((0x1D, true)));
        assert_eq!(key_to_scan_code(Key::Delete), Some((0x53, true)));
        assert_eq!(key_to_scan_code(Key::NumPadEnter), Some((0x1C, true)));
    }

    #[test]
    fn creates_press_and_release_events() {
        assert_eq!(
            key_press_event(Key::Enter),
            Some(FastPathInputEvent::KeyboardEvent(KeyboardFlags::empty(), 0x1C))
        );
        assert_eq!(
            key_release_event(Key::RightAlt),
            Some(FastPathInputEvent::KeyboardEvent(
                KeyboardFlags::EXTENDED | KeyboardFlags::RELEASE,
                0x38,
            ))
        );
    }

    #[test]
    fn clamps_mouse_position_to_viewport() {
        assert_eq!(clamp_mouse_coordinate(-20.0, 1280), 0);
        assert_eq!(clamp_mouse_coordinate(55.4, 1280), 55);
        assert_eq!(clamp_mouse_coordinate(5000.0, 1280), 1279);
    }

    #[test]
    fn normalizes_scroll_delta_from_mouse_and_trackpad_ranges() {
        assert_eq!(normalize_scroll_delta(0.0), 0);
        assert_eq!(normalize_scroll_delta(0.1), -180);
        assert_eq!(normalize_scroll_delta(-0.1), 180);
        assert_eq!(normalize_scroll_delta(12.0), -180);
        assert_eq!(normalize_scroll_delta(-12.0), 180);
        assert_eq!(normalize_scroll_delta(0.5), -255);
    }

    #[test]
    fn includes_button_state_in_move_flags_during_drag() {
        assert_eq!(current_move_flags(false, false, false), PointerFlags::MOVE);
        assert_eq!(
            current_move_flags(true, false, false),
            PointerFlags::MOVE | PointerFlags::LEFT_BUTTON | PointerFlags::DOWN
        );
        assert_eq!(
            current_move_flags(false, false, true),
            PointerFlags::MOVE | PointerFlags::RIGHT_BUTTON | PointerFlags::DOWN
        );
    }
}
