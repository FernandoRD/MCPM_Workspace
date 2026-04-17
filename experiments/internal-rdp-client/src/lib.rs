pub mod config;
pub mod framebuffer;
pub mod mvp_runtime;
pub mod protocol;
pub mod session;
pub mod settings_bridge;
pub mod transport;
pub mod viewer_input;
pub mod viewer_renderer;

pub use config::{DesktopSize, RdpClientConfig, RdpEndpoint, SecurityProtocol};
pub use framebuffer::Framebuffer;
pub use mvp_runtime::{MonitorLayout, SessionPerformanceConfig, SessionProfile};
pub use protocol::x224::{
    decode_connection_confirm, encode_connection_request, ConnectionConfirm, NegotiationFailure,
};
pub use settings_bridge::{
    apply_profile_preferences, default_settings_file_path, load_default_rdp_preferences,
    load_rdp_preferences, PerformanceOverrides,
};
pub use session::{HandshakeSummary, RdpClientError, RdpClientSession, SessionState};
pub use transport::{MemoryTransport, TcpTransport, Transport, TransportError};
pub use viewer_renderer::{merge_dirty_region, ViewerBuffer};
