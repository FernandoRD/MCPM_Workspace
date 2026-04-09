use std::fs;
use std::path::{Path, PathBuf};

use anyhow::Context;
use serde::Deserialize;
use serde_json::Value;

use crate::mvp_runtime::SessionPerformanceConfig;

const APP_DATA_DIR_NAME: &str = "mpcm-workspace";
const MIRRORED_SETTINGS_FILE_NAME: &str = "internal-rdp-client-settings.json";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LoadedRdpPreferences {
    pub fullscreen: Option<bool>,
    pub width: Option<u16>,
    pub height: Option<u16>,
    pub performance: SessionPerformanceConfig,
}

pub fn load_rdp_preferences(path: &Path) -> anyhow::Result<LoadedRdpPreferences> {
    let raw = fs::read_to_string(path).with_context(|| format!("read settings file {}", path.display()))?;
    let root: Value =
        serde_json::from_str(&raw).with_context(|| format!("parse settings JSON from {}", path.display()))?;

    let rdp_value = if root
        .get("app")
        .and_then(Value::as_str)
        .is_some_and(|value| value == "ssh-vault")
    {
        root.get("settings")
            .and_then(|settings| settings.get("rdp"))
            .cloned()
            .or_else(|| root.get("rdp").cloned())
    } else {
        root.get("rdp").cloned()
    }
    .with_context(|| format!("RDP settings not found in {}", path.display()))?;

    let parsed: RdpSettingsFile = serde_json::from_value(rdp_value)
        .with_context(|| format!("decode RDP settings from {}", path.display()))?;

    Ok(LoadedRdpPreferences {
        fullscreen: parsed.fullscreen,
        width: parsed.width,
        height: parsed.height,
        performance: parsed.internal_client_performance.into_runtime(),
    })
}

pub fn default_settings_file_path() -> Option<PathBuf> {
    let data_dir = dirs::data_dir()?;
    Some(data_dir.join(APP_DATA_DIR_NAME).join(MIRRORED_SETTINGS_FILE_NAME))
}

pub fn load_default_rdp_preferences() -> anyhow::Result<Option<LoadedRdpPreferences>> {
    let Some(path) = default_settings_file_path() else {
        return Ok(None);
    };

    if !path.exists() {
        return Ok(None);
    }

    load_rdp_preferences(&path).map(Some)
}

#[derive(Debug, Clone, Copy, Default)]
pub struct PerformanceOverrides {
    pub wallpaper: Option<bool>,
    pub full_window_drag: Option<bool>,
    pub menu_animations: Option<bool>,
    pub theming: Option<bool>,
    pub cursor_shadow: Option<bool>,
    pub cursor_settings: Option<bool>,
    pub font_smoothing: Option<bool>,
    pub desktop_composition: Option<bool>,
}

impl PerformanceOverrides {
    pub fn apply_to(self, performance: &mut SessionPerformanceConfig) {
        if let Some(value) = self.wallpaper {
            performance.wallpaper = value;
        }
        if let Some(value) = self.full_window_drag {
            performance.full_window_drag = value;
        }
        if let Some(value) = self.menu_animations {
            performance.menu_animations = value;
        }
        if let Some(value) = self.theming {
            performance.theming = value;
        }
        if let Some(value) = self.cursor_shadow {
            performance.cursor_shadow = value;
        }
        if let Some(value) = self.cursor_settings {
            performance.cursor_settings = value;
        }
        if let Some(value) = self.font_smoothing {
            performance.font_smoothing = value;
        }
        if let Some(value) = self.desktop_composition {
            performance.desktop_composition = value;
        }
    }
}

pub fn apply_profile_preferences(
    base_width: u16,
    base_height: u16,
    loaded: Option<LoadedRdpPreferences>,
    fullscreen_override: Option<bool>,
    width_override: Option<u16>,
    height_override: Option<u16>,
    performance_overrides: PerformanceOverrides,
) -> (u16, u16, bool, SessionPerformanceConfig) {
    let mut performance = loaded.map(|prefs| prefs.performance).unwrap_or_default();
    performance_overrides.apply_to(&mut performance);

    let fullscreen = fullscreen_override
        .or_else(|| loaded.and_then(|prefs| prefs.fullscreen))
        .unwrap_or(false);
    let width = width_override
        .or_else(|| loaded.and_then(|prefs| prefs.width))
        .unwrap_or(base_width);
    let height = height_override
        .or_else(|| loaded.and_then(|prefs| prefs.height))
        .unwrap_or(base_height);

    (width, height, fullscreen, performance)
}

pub fn parse_bool_toggle(
    overrides: &mut PerformanceOverrides,
    flag: &str,
    enabled: bool,
) -> anyhow::Result<bool> {
    match flag {
        "--show-wallpaper" => overrides.wallpaper = Some(enabled),
        "--full-window-drag" => overrides.full_window_drag = Some(enabled),
        "--menu-animations" => overrides.menu_animations = Some(enabled),
        "--theming" => overrides.theming = Some(enabled),
        "--cursor-shadow" => overrides.cursor_shadow = Some(enabled),
        "--cursor-settings" => overrides.cursor_settings = Some(enabled),
        "--font-smoothing" => overrides.font_smoothing = Some(enabled),
        "--desktop-composition" => overrides.desktop_composition = Some(enabled),
        _ => return Ok(false),
    }

    Ok(true)
}

pub fn parse_negative_bool_toggle(
    overrides: &mut PerformanceOverrides,
    flag: &str,
) -> anyhow::Result<bool> {
    let normalized = match flag {
        "--hide-wallpaper" => "--show-wallpaper",
        "--no-full-window-drag" => "--full-window-drag",
        "--no-menu-animations" => "--menu-animations",
        "--no-theming" => "--theming",
        "--no-cursor-shadow" => "--cursor-shadow",
        "--no-cursor-settings" => "--cursor-settings",
        "--no-font-smoothing" => "--font-smoothing",
        "--no-desktop-composition" => "--desktop-composition",
        _ => return Ok(false),
    };

    parse_bool_toggle(overrides, normalized, false)
}

#[derive(Debug, Deserialize)]
#[serde(default)]
struct RdpSettingsFile {
    fullscreen: Option<bool>,
    width: Option<u16>,
    height: Option<u16>,
    #[serde(rename = "internalClientPerformance")]
    internal_client_performance: InternalClientPerformanceFile,
}

impl Default for RdpSettingsFile {
    fn default() -> Self {
        Self {
            fullscreen: None,
            width: None,
            height: None,
            internal_client_performance: InternalClientPerformanceFile::default(),
        }
    }
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct InternalClientPerformanceFile {
    wallpaper: bool,
    #[serde(rename = "fullWindowDrag")]
    full_window_drag: bool,
    #[serde(rename = "menuAnimations")]
    menu_animations: bool,
    theming: bool,
    #[serde(rename = "cursorShadow")]
    cursor_shadow: bool,
    #[serde(rename = "cursorSettings")]
    cursor_settings: bool,
    #[serde(rename = "fontSmoothing")]
    font_smoothing: bool,
    #[serde(rename = "desktopComposition")]
    desktop_composition: bool,
}

impl InternalClientPerformanceFile {
    fn into_runtime(self) -> SessionPerformanceConfig {
        SessionPerformanceConfig {
            wallpaper: self.wallpaper,
            full_window_drag: self.full_window_drag,
            menu_animations: self.menu_animations,
            theming: self.theming,
            cursor_shadow: self.cursor_shadow,
            cursor_settings: self.cursor_settings,
            font_smoothing: self.font_smoothing,
            desktop_composition: self.desktop_composition,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    fn temp_settings_path(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("internal-rdp-client-{name}-{unique}.json"))
    }

    #[test]
    fn loads_preferences_from_app_settings_json() {
        let path = temp_settings_path("app-settings");
        fs::write(
            &path,
            r#"{
              "rdp": {
                "fullscreen": true,
                "width": 1920,
                "height": 1080,
                "internalClientPerformance": {
                  "wallpaper": true,
                  "fontSmoothing": true
                }
              }
            }"#,
        )
        .expect("write temp settings");

        let loaded = load_rdp_preferences(&path).expect("load app settings");
        let _ = fs::remove_file(&path);

        assert_eq!(loaded.fullscreen, Some(true));
        assert_eq!(loaded.width, Some(1920));
        assert_eq!(loaded.height, Some(1080));
        assert!(loaded.performance.wallpaper);
        assert!(loaded.performance.font_smoothing);
        assert!(!loaded.performance.full_window_drag);
    }

    #[test]
    fn loads_preferences_from_backup_file() {
        let path = temp_settings_path("backup-settings");
        fs::write(
            &path,
            r#"{
              "app": "ssh-vault",
              "version": 1,
              "settings": {
                "rdp": {
                  "fullscreen": false,
                  "width": 1600,
                  "height": 900,
                  "internalClientPerformance": {
                    "desktopComposition": true,
                    "cursorSettings": true
                  }
                }
              }
            }"#,
        )
        .expect("write temp backup");

        let loaded = load_rdp_preferences(&path).expect("load backup settings");
        let _ = fs::remove_file(&path);

        assert_eq!(loaded.fullscreen, Some(false));
        assert_eq!(loaded.width, Some(1600));
        assert_eq!(loaded.height, Some(900));
        assert!(loaded.performance.desktop_composition);
        assert!(loaded.performance.cursor_settings);
        assert!(!loaded.performance.wallpaper);
    }

    #[test]
    fn loads_preferences_from_mirrored_settings_snapshot() {
        let path = temp_settings_path("mirrored-settings");
        fs::write(
            &path,
            r#"{
              "app": "ssh-vault",
              "kind": "internal-rdp-client-settings",
              "version": 1,
              "rdp": {
                "fullscreen": true,
                "width": 1440,
                "height": 900,
                "internalClientPerformance": {
                  "wallpaper": true,
                  "menuAnimations": true
                }
              }
            }"#,
        )
        .expect("write temp mirrored settings");

        let loaded = load_rdp_preferences(&path).expect("load mirrored settings");
        let _ = fs::remove_file(&path);

        assert_eq!(loaded.fullscreen, Some(true));
        assert_eq!(loaded.width, Some(1440));
        assert_eq!(loaded.height, Some(900));
        assert!(loaded.performance.wallpaper);
        assert!(loaded.performance.menu_animations);
        assert!(!loaded.performance.cursor_settings);
    }

    #[test]
    fn profile_preferences_allow_cli_overrides_over_loaded_settings() {
        let loaded = LoadedRdpPreferences {
            fullscreen: Some(true),
            width: Some(1920),
            height: Some(1080),
            performance: SessionPerformanceConfig {
                wallpaper: true,
                full_window_drag: true,
                ..SessionPerformanceConfig::default()
            },
        };
        let mut overrides = PerformanceOverrides::default();
        overrides.wallpaper = Some(false);
        overrides.font_smoothing = Some(true);

        let (width, height, fullscreen, performance) =
            apply_profile_preferences(1280, 720, Some(loaded), Some(false), Some(1366), None, overrides);

        assert_eq!(width, 1366);
        assert_eq!(height, 1080);
        assert!(!fullscreen);
        assert!(!performance.wallpaper);
        assert!(performance.full_window_drag);
        assert!(performance.font_smoothing);
    }
}
