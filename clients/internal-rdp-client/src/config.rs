use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RdpEndpoint {
    pub host: String,
    pub port: u16,
}

impl RdpEndpoint {
    pub fn new(host: impl Into<String>, port: u16) -> Self {
        Self {
            host: host.into(),
            port,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecurityProtocol {
    StandardRdp,
    Tls,
    Hybrid,
    HybridEx,
}

impl SecurityProtocol {
    pub fn flag(self) -> u32 {
        match self {
            Self::StandardRdp => 0,
            Self::Tls => 0x0000_0001,
            Self::Hybrid => 0x0000_0002,
            Self::HybridEx => 0x0000_0008,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DesktopSize {
    pub width: u16,
    pub height: u16,
}

impl DesktopSize {
    pub fn new(width: u16, height: u16) -> Self {
        Self { width, height }
    }
}

#[derive(Debug, Clone)]
pub struct RdpClientConfig {
    pub endpoint: RdpEndpoint,
    pub username: Option<String>,
    pub password: Option<String>,
    pub desktop_size: DesktopSize,
    pub requested_protocols: Vec<SecurityProtocol>,
    pub connect_timeout: Duration,
}

impl RdpClientConfig {
    pub fn requested_protocol_flags(&self) -> u32 {
        self.requested_protocols
            .iter()
            .fold(0u32, |acc, protocol| acc | protocol.flag())
    }
}

impl Default for RdpClientConfig {
    fn default() -> Self {
        Self {
            endpoint: RdpEndpoint::new("127.0.0.1", 3389),
            username: None,
            password: None,
            desktop_size: DesktopSize::new(1280, 720),
            requested_protocols: vec![SecurityProtocol::Tls, SecurityProtocol::Hybrid],
            connect_timeout: Duration::from_secs(10),
        }
    }
}
