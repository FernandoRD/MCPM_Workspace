use crate::config::{RdpClientConfig, SecurityProtocol};
use crate::protocol::x224::{decode_connection_confirm, encode_connection_request};
use crate::protocol::ProtocolError;
use crate::transport::{Transport, TransportError};

#[derive(Debug)]
pub enum RdpClientError {
    InvalidState(&'static str),
    Transport(TransportError),
    Protocol(ProtocolError),
}

impl From<TransportError> for RdpClientError {
    fn from(value: TransportError) -> Self {
        Self::Transport(value)
    }
}

impl From<ProtocolError> for RdpClientError {
    fn from(value: ProtocolError) -> Self {
        Self::Protocol(value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionState {
    Idle,
    TcpConnected,
    NegotiatingX224,
    X224Ready,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HandshakeSummary {
    pub selected_protocol: Option<SecurityProtocol>,
}

pub struct RdpClientSession<T: Transport> {
    transport: T,
    config: RdpClientConfig,
    state: SessionState,
    summary: Option<HandshakeSummary>,
}

impl<T: Transport> RdpClientSession<T> {
    pub fn new(config: RdpClientConfig, transport: T) -> Self {
        Self {
            transport,
            config,
            state: SessionState::Idle,
            summary: None,
        }
    }

    pub fn state(&self) -> &SessionState {
        &self.state
    }

    pub fn summary(&self) -> Option<&HandshakeSummary> {
        self.summary.as_ref()
    }

    pub fn transport(&self) -> &T {
        &self.transport
    }

    pub fn begin_negotiation(&mut self) -> Result<(), RdpClientError> {
        if self.state != SessionState::Idle {
            return Err(RdpClientError::InvalidState(
                "begin_negotiation só pode ser chamado em Idle",
            ));
        }

        self.transport
            .connect(&self.config.endpoint, self.config.connect_timeout)?;
        self.state = SessionState::TcpConnected;

        let packet = encode_connection_request(
            self.config.username.as_deref(),
            self.config.requested_protocol_flags(),
        );
        self.transport.send(&packet)?;
        self.state = SessionState::NegotiatingX224;
        Ok(())
    }

    pub fn complete_negotiation(&mut self) -> Result<&HandshakeSummary, RdpClientError> {
        if self.state != SessionState::NegotiatingX224 {
            return Err(RdpClientError::InvalidState(
                "complete_negotiation só pode ser chamado durante NegotiatingX224",
            ));
        }

        let packet = self.transport.receive()?;
        let confirm = decode_connection_confirm(&packet)?;

        if let Some(failure) = confirm.failure {
            self.state = SessionState::Closed;
            return Err(RdpClientError::Protocol(ProtocolError::NegotiationRejected(
                failure_code(&failure),
            )));
        }

        let summary = HandshakeSummary {
            selected_protocol: confirm.selected_protocol.and_then(map_protocol),
        };

        self.summary = Some(summary);
        self.state = SessionState::X224Ready;
        Ok(self.summary.as_ref().expect("summary set"))
    }
}

fn map_protocol(value: u32) -> Option<SecurityProtocol> {
    match value {
        0 => Some(SecurityProtocol::StandardRdp),
        1 => Some(SecurityProtocol::Tls),
        2 => Some(SecurityProtocol::Hybrid),
        8 => Some(SecurityProtocol::HybridEx),
        _ => None,
    }
}

fn failure_code(failure: &crate::protocol::x224::NegotiationFailure) -> u32 {
    match failure {
        crate::protocol::x224::NegotiationFailure::SslRequiredByServer => 1,
        crate::protocol::x224::NegotiationFailure::SslNotAllowedByServer => 2,
        crate::protocol::x224::NegotiationFailure::SslCertNotOnServer => 3,
        crate::protocol::x224::NegotiationFailure::InconsistentFlags => 4,
        crate::protocol::x224::NegotiationFailure::HybridRequiredByServer => 5,
        crate::protocol::x224::NegotiationFailure::Unknown(value) => *value,
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::Duration;

    use crate::config::{RdpClientConfig, RdpEndpoint, SecurityProtocol};
    use crate::session::{RdpClientSession, SessionState};
    use crate::transport::{MemoryTransport, TcpTransport};

    fn confirm_tls_packet() -> Vec<u8> {
        vec![
            0x03, 0x00, 0x00, 0x13,
            0x0e, 0xd0, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x02, 0x00, 0x08, 0x00,
            0x01, 0x00, 0x00, 0x00,
        ]
    }

    #[test]
    fn negotiates_x224_and_captures_selected_protocol() {
        let mut session = RdpClientSession::new(
            RdpClientConfig {
                endpoint: RdpEndpoint::new("rdp.internal", 3389),
                username: Some("fernando".to_string()),
                requested_protocols: vec![SecurityProtocol::Tls, SecurityProtocol::Hybrid],
                ..RdpClientConfig::default()
            },
            MemoryTransport::new(vec![confirm_tls_packet()]),
        );

        session.begin_negotiation().unwrap();
        assert_eq!(session.state(), &SessionState::NegotiatingX224);

        let summary = session.complete_negotiation().unwrap();
        assert_eq!(summary.selected_protocol, Some(SecurityProtocol::Tls));
        assert_eq!(session.state(), &SessionState::X224Ready);
        assert_eq!(session.transport().sent_packets().len(), 1);
    }

    #[test]
    fn negotiates_x224_over_real_tcp_transport() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();

        let server = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();

            let mut header = [0u8; 4];
            socket.read_exact(&mut header).unwrap();
            let length = u16::from_be_bytes([header[2], header[3]]) as usize;
            let mut payload = vec![0u8; length - 4];
            socket.read_exact(&mut payload).unwrap();

            let confirm_packet = confirm_tls_packet();
            socket.write_all(&confirm_packet).unwrap();

            let mut request = header.to_vec();
            request.extend_from_slice(&payload);
            request
        });

        let mut session = RdpClientSession::new(
            RdpClientConfig {
                endpoint: RdpEndpoint::new("127.0.0.1", address.port()),
                username: Some("lab-user".to_string()),
                connect_timeout: Duration::from_secs(2),
                requested_protocols: vec![SecurityProtocol::Tls, SecurityProtocol::Hybrid],
                ..RdpClientConfig::default()
            },
            TcpTransport::new(),
        );

        session.begin_negotiation().unwrap();
        let summary = session.complete_negotiation().unwrap();
        let request_packet = server.join().unwrap();

        assert_eq!(summary.selected_protocol, Some(SecurityProtocol::Tls));
        assert_eq!(session.state(), &SessionState::X224Ready);
        assert!(request_packet.starts_with(&[0x03, 0x00]));
        assert!(request_packet
            .windows("Cookie: mstshash=lab-user\r\n".len())
            .any(|window| window == b"Cookie: mstshash=lab-user\r\n"));
    }
}
