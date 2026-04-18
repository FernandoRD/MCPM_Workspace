use core::time::Duration;
use std::io::Write as _;
use std::net::{TcpStream, ToSocketAddrs as _};

use anyhow::{Context, bail};
use ironrdp::connector;
use ironrdp::connector::BitmapConfig;
use ironrdp::connector::{ConnectionResult, Credentials};
use ironrdp::pdu::gcc::KeyboardType;
use ironrdp::pdu::geometry::{InclusiveRectangle, Rectangle as _};
use ironrdp::pdu::rdp::capability_sets::client_codecs_capabilities;
use ironrdp::pdu::rdp::capability_sets::MajorPlatformType;
use ironrdp::pdu::rdp::client_info::{PerformanceFlags, TimezoneInfo};
use ironrdp::session::ActiveStageOutput;
use sspi::network_client::reqwest_network_client::ReqwestNetworkClient;
use tokio_rustls::rustls;

pub type UpgradedFramed =
    ironrdp_blocking::Framed<rustls::StreamOwned<rustls::ClientConnection, TcpStream>>;

/// Layout de um monitor físico no espaço virtual do desktop remoto.
/// As coordenadas são normalizadas para que a origem seja (0, 0) —
/// o viewer_mvp é responsável por normalizar antes de construir o SessionProfile.
#[derive(Debug, Clone)]
pub struct MonitorLayout {
    pub left: u32,
    pub top: u32,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
    pub scale_factor: u32,
}

impl MonitorLayout {
    /// Calcula o bounding box (largura, altura) que cobre todos os monitores.
    /// Retorna a resolução do desktop virtual a ser negociada com o servidor.
    pub fn desktop_size(monitors: &[MonitorLayout]) -> (u16, u16) {
        let right = monitors.iter()
            .map(|m| m.left + m.width)
            .max()
            .unwrap_or(1280);
        let bottom = monitors.iter()
            .map(|m| m.top + m.height)
            .max()
            .unwrap_or(720);
        (right.min(u16::MAX as u32) as u16, bottom.min(u16::MAX as u32) as u16)
    }
}

#[derive(Debug, Clone)]
pub struct SessionProfile {
    pub desktop_width: u16,
    pub desktop_height: u16,
    pub color_depth: u32,
    pub lossy_compression: bool,
    pub performance: SessionPerformanceConfig,
    /// Lista de monitores. Vazia = single monitor com desktop_width × desktop_height.
    pub monitors: Vec<MonitorLayout>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SessionPerformanceConfig {
    pub wallpaper: bool,
    pub full_window_drag: bool,
    pub menu_animations: bool,
    pub theming: bool,
    pub cursor_shadow: bool,
    pub cursor_settings: bool,
    pub font_smoothing: bool,
    pub desktop_composition: bool,
}

impl SessionPerformanceConfig {
    pub fn performance_flags(self) -> PerformanceFlags {
        let mut flags = PerformanceFlags::empty();

        if !self.wallpaper {
            flags |= PerformanceFlags::DISABLE_WALLPAPER;
        }

        if !self.full_window_drag {
            flags |= PerformanceFlags::DISABLE_FULLWINDOWDRAG;
        }

        if !self.menu_animations {
            flags |= PerformanceFlags::DISABLE_MENUANIMATIONS;
        }

        if !self.theming {
            flags |= PerformanceFlags::DISABLE_THEMING;
        }

        if !self.cursor_shadow {
            flags |= PerformanceFlags::DISABLE_CURSOR_SHADOW;
        }

        if !self.cursor_settings {
            flags |= PerformanceFlags::DISABLE_CURSORSETTINGS;
        }

        if self.font_smoothing {
            flags |= PerformanceFlags::ENABLE_FONT_SMOOTHING;
        }

        if self.desktop_composition {
            flags |= PerformanceFlags::ENABLE_DESKTOP_COMPOSITION;
        }

        flags
    }
}

impl Default for SessionProfile {
    fn default() -> Self {
        Self {
            desktop_width: 1280,
            desktop_height: 720,
            color_depth: 16,
            lossy_compression: true,
            performance: SessionPerformanceConfig::default(),
            monitors: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ActiveStageDrainSummary {
    pub had_activity: bool,
    pub dirty_region: Option<InclusiveRectangle>,
}

pub fn connect_with_password(
    server_name: String,
    port: u16,
    username: String,
    password: String,
    domain: Option<String>,
    profile: SessionProfile,
    handshake_timeout: Duration,
    active_read_timeout: Duration,
) -> anyhow::Result<(ConnectionResult, UpgradedFramed)> {
    let config = build_config(username, password, domain, profile);
    connect(config, server_name, port, handshake_timeout, active_read_timeout)
}

fn build_config(
    username: String,
    password: String,
    domain: Option<String>,
    profile: SessionProfile,
) -> connector::Config {
    connector::Config {
        credentials: Credentials::UsernamePassword { username, password },
        domain,
        enable_tls: false,
        enable_credssp: true,
        keyboard_type: KeyboardType::IbmEnhanced,
        keyboard_subtype: 0,
        keyboard_layout: 0,
        keyboard_functional_keys_count: 12,
        ime_file_name: String::new(),
        dig_product_id: String::new(),
        desktop_size: connector::DesktopSize {
            width: profile.desktop_width,
            height: profile.desktop_height,
        },
        bitmap: Some(BitmapConfig {
            lossy_compression: profile.lossy_compression,
            color_depth: profile.color_depth,
            codecs: client_codecs_capabilities(&[]).expect("default codec capability list is always valid"),
        }),
        client_build: 0,
        client_name: "internal-rdp-client-mvp".to_owned(),
        client_dir: "C:\\Windows\\System32\\mstscax.dll".to_owned(),
        #[cfg(windows)]
        platform: MajorPlatformType::WINDOWS,
        #[cfg(target_os = "macos")]
        platform: MajorPlatformType::MACINTOSH,
        #[cfg(target_os = "ios")]
        platform: MajorPlatformType::IOS,
        #[cfg(target_os = "linux")]
        platform: MajorPlatformType::UNIX,
        #[cfg(target_os = "android")]
        platform: MajorPlatformType::ANDROID,
        #[cfg(target_os = "freebsd")]
        platform: MajorPlatformType::UNIX,
        #[cfg(target_os = "dragonfly")]
        platform: MajorPlatformType::UNIX,
        #[cfg(target_os = "openbsd")]
        platform: MajorPlatformType::UNIX,
        #[cfg(target_os = "netbsd")]
        platform: MajorPlatformType::UNIX,
        enable_server_pointer: true,
        request_data: None,
        autologon: false,
        enable_audio_playback: false,
        pointer_software_rendering: true,
        performance_flags: profile.performance.performance_flags(),
        desktop_scale_factor: 0,
        hardware_id: None,
        license_cache: None,
        timezone_info: TimezoneInfo::default(),
    }
}

fn connect(
    config: connector::Config,
    server_name: String,
    port: u16,
    handshake_timeout: Duration,
    active_read_timeout: Duration,
) -> anyhow::Result<(ConnectionResult, UpgradedFramed)> {
    let server_addr = (server_name.as_str(), port)
        .to_socket_addrs()?
        .next()
        .context("socket address not found")?;

    let tcp_stream = TcpStream::connect(server_addr).context("TCP connect")?;
    tcp_stream
        .set_read_timeout(Some(handshake_timeout))
        .context("set read timeout")?;

    let client_addr = tcp_stream.local_addr().context("get local socket address")?;

    let mut framed = ironrdp_blocking::Framed::new(tcp_stream);
    let mut connector = connector::ClientConnector::new(config, client_addr);

    let should_upgrade =
        ironrdp_blocking::connect_begin(&mut framed, &mut connector).context("begin connection")?;

    let initial_stream = framed.into_inner_no_leftover();
    let (upgraded_stream, server_public_key) =
        tls_upgrade(initial_stream, server_name.clone()).context("TLS upgrade")?;
    let upgraded = ironrdp_blocking::mark_as_upgraded(should_upgrade, &mut connector);

    let mut upgraded_framed = ironrdp_blocking::Framed::new(upgraded_stream);
    let mut network_client = ReqwestNetworkClient;

    let connection_result = ironrdp_blocking::connect_finalize(
        upgraded,
        connector,
        &mut upgraded_framed,
        &mut network_client,
        server_name.into(),
        server_public_key,
        None,
    )
    .context("finalize connection")?;

    upgraded_framed
        .get_inner_mut()
        .0
        .sock
        .set_read_timeout(Some(active_read_timeout))
        .context("set active-stage read timeout")?;

    Ok((connection_result, upgraded_framed))
}

pub fn flush_active_stage_once(
    active_stage: &mut ironrdp::session::ActiveStage,
    framed: &mut UpgradedFramed,
    image: &mut ironrdp::session::image::DecodedImage,
) -> anyhow::Result<bool> {
    Ok(poll_active_stage_once(active_stage, framed, image)?.dirty_region.is_some())
}

pub fn drain_active_stage(
    active_stage: &mut ironrdp::session::ActiveStage,
    framed: &mut UpgradedFramed,
    image: &mut ironrdp::session::image::DecodedImage,
    max_frames: usize,
) -> anyhow::Result<ActiveStageDrainSummary> {
    let mut summary = ActiveStageDrainSummary::default();

    for _ in 0..max_frames {
        let batch = poll_active_stage_once(active_stage, framed, image)?;

        if !batch.had_activity {
            break;
        }

        summary.had_activity = true;
        summary.dirty_region = merge_dirty_region(summary.dirty_region, batch.dirty_region);
    }

    Ok(summary)
}

pub fn apply_active_stage_outputs(
    framed: &mut UpgradedFramed,
    outputs: Vec<ActiveStageOutput>,
) -> anyhow::Result<Option<InclusiveRectangle>> {
    let mut dirty_region = None;

    for output in outputs {
        match output {
            ActiveStageOutput::ResponseFrame(frame) => {
                framed.write_all(&frame).context("write response frame")?;
            }
            ActiveStageOutput::GraphicsUpdate(region) => {
                dirty_region = merge_dirty_region(dirty_region, Some(region));
            }
            ActiveStageOutput::Terminate(reason) => {
                bail!("RDP session terminated: {reason:?}");
            }
            _ => {}
        }
    }

    Ok(dirty_region)
}

fn poll_active_stage_once(
    active_stage: &mut ironrdp::session::ActiveStage,
    framed: &mut UpgradedFramed,
    image: &mut ironrdp::session::image::DecodedImage,
) -> anyhow::Result<ActiveStageDrainSummary> {
    let (action, payload) = match framed.read_pdu() {
        Ok((action, payload)) => (action, payload),
        // On Linux, SO_RCVTIMEO fires as WouldBlock (EAGAIN); on Windows it fires as
        // TimedOut (WSAETIMEDOUT = 10060). Both mean "no data yet" — treat identically.
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock
            || error.kind() == std::io::ErrorKind::TimedOut =>
        {
            return Ok(ActiveStageDrainSummary::default())
        }
        Err(error) => return Err(anyhow::Error::new(error).context("read frame")),
    };

    let outputs = active_stage.process(image, action, &payload)?;
    let dirty_region = apply_active_stage_outputs(framed, outputs)?;

    Ok(ActiveStageDrainSummary {
        had_activity: true,
        dirty_region,
    })
}

fn merge_dirty_region(
    current: Option<InclusiveRectangle>,
    next: Option<InclusiveRectangle>,
) -> Option<InclusiveRectangle> {
    match (current, next) {
        (Some(current), Some(next)) => Some(current.union(&next)),
        (Some(current), None) => Some(current),
        (None, Some(next)) => Some(next),
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::SessionPerformanceConfig;
    use ironrdp::pdu::rdp::client_info::PerformanceFlags;

    #[test]
    fn default_session_performance_prefers_responsiveness() {
        let flags = SessionPerformanceConfig::default().performance_flags();

        assert!(flags.contains(PerformanceFlags::DISABLE_WALLPAPER));
        assert!(flags.contains(PerformanceFlags::DISABLE_FULLWINDOWDRAG));
        assert!(flags.contains(PerformanceFlags::DISABLE_MENUANIMATIONS));
        assert!(flags.contains(PerformanceFlags::DISABLE_THEMING));
        assert!(flags.contains(PerformanceFlags::DISABLE_CURSOR_SHADOW));
        assert!(flags.contains(PerformanceFlags::DISABLE_CURSORSETTINGS));
        assert!(!flags.contains(PerformanceFlags::ENABLE_FONT_SMOOTHING));
        assert!(!flags.contains(PerformanceFlags::ENABLE_DESKTOP_COMPOSITION));
    }

    #[test]
    fn custom_session_performance_enables_visual_features() {
        let flags = SessionPerformanceConfig {
            wallpaper: true,
            full_window_drag: true,
            menu_animations: true,
            theming: true,
            cursor_shadow: true,
            cursor_settings: true,
            font_smoothing: true,
            desktop_composition: true,
        }
        .performance_flags();

        assert!(!flags.contains(PerformanceFlags::DISABLE_WALLPAPER));
        assert!(!flags.contains(PerformanceFlags::DISABLE_FULLWINDOWDRAG));
        assert!(!flags.contains(PerformanceFlags::DISABLE_MENUANIMATIONS));
        assert!(!flags.contains(PerformanceFlags::DISABLE_THEMING));
        assert!(!flags.contains(PerformanceFlags::DISABLE_CURSOR_SHADOW));
        assert!(!flags.contains(PerformanceFlags::DISABLE_CURSORSETTINGS));
        assert!(flags.contains(PerformanceFlags::ENABLE_FONT_SMOOTHING));
        assert!(flags.contains(PerformanceFlags::ENABLE_DESKTOP_COMPOSITION));
    }
}

fn tls_upgrade(
    stream: TcpStream,
    server_name: String,
) -> anyhow::Result<(rustls::StreamOwned<rustls::ClientConnection, TcpStream>, Vec<u8>)> {
    let mut config = rustls::client::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(std::sync::Arc::new(danger::NoCertificateVerification))
        .with_no_client_auth();

    config.key_log = std::sync::Arc::new(rustls::KeyLogFile::new());
    config.resumption = rustls::client::Resumption::disabled();

    let config = std::sync::Arc::new(config);
    let server_name = server_name.try_into()?;
    let client = rustls::ClientConnection::new(config, server_name)?;
    let mut tls_stream = rustls::StreamOwned::new(client, stream);

    tls_stream.flush().context("flush TLS stream")?;

    let cert = tls_stream
        .conn
        .peer_certificates()
        .and_then(|certificates| certificates.first())
        .context("peer certificate is missing")?;

    let server_public_key = extract_tls_server_public_key(cert)?;
    Ok((tls_stream, server_public_key))
}

fn extract_tls_server_public_key(cert: &[u8]) -> anyhow::Result<Vec<u8>> {
    use x509_cert::der::Decode as _;

    let cert = x509_cert::Certificate::from_der(cert)?;
    let public_key = cert
        .tbs_certificate
        .subject_public_key_info
        .subject_public_key
        .as_bytes()
        .context("subject public key BIT STRING is not aligned")?
        .to_owned();

    Ok(public_key)
}

mod danger {
    use tokio_rustls::rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
    use tokio_rustls::rustls::{pki_types, DigitallySignedStruct, Error, SignatureScheme};

    #[derive(Debug)]
    pub(super) struct NoCertificateVerification;

    impl ServerCertVerifier for NoCertificateVerification {
        fn verify_server_cert(
            &self,
            _: &pki_types::CertificateDer<'_>,
            _: &[pki_types::CertificateDer<'_>],
            _: &pki_types::ServerName<'_>,
            _: &[u8],
            _: pki_types::UnixTime,
        ) -> Result<ServerCertVerified, Error> {
            Ok(ServerCertVerified::assertion())
        }

        fn verify_tls12_signature(
            &self,
            _: &[u8],
            _: &pki_types::CertificateDer<'_>,
            _: &DigitallySignedStruct,
        ) -> Result<HandshakeSignatureValid, Error> {
            Ok(HandshakeSignatureValid::assertion())
        }

        fn verify_tls13_signature(
            &self,
            _: &[u8],
            _: &pki_types::CertificateDer<'_>,
            _: &DigitallySignedStruct,
        ) -> Result<HandshakeSignatureValid, Error> {
            Ok(HandshakeSignatureValid::assertion())
        }

        fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
            vec![
                SignatureScheme::RSA_PKCS1_SHA1,
                SignatureScheme::ECDSA_SHA1_Legacy,
                SignatureScheme::RSA_PKCS1_SHA256,
                SignatureScheme::ECDSA_NISTP256_SHA256,
                SignatureScheme::RSA_PKCS1_SHA384,
                SignatureScheme::ECDSA_NISTP384_SHA384,
                SignatureScheme::RSA_PKCS1_SHA512,
                SignatureScheme::ECDSA_NISTP521_SHA512,
                SignatureScheme::RSA_PSS_SHA256,
                SignatureScheme::RSA_PSS_SHA384,
                SignatureScheme::RSA_PSS_SHA512,
                SignatureScheme::ED25519,
                SignatureScheme::ED448,
            ]
        }
    }
}
