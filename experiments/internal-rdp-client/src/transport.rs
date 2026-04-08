use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use crate::config::RdpEndpoint;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportError {
    NotConnected,
    ConnectFailed(String),
    SendFailed(String),
    ReceiveFailed(String),
    EndOfStream,
}

pub trait Transport {
    fn connect(&mut self, endpoint: &RdpEndpoint, timeout: Duration) -> Result<(), TransportError>;
    fn send(&mut self, bytes: &[u8]) -> Result<(), TransportError>;
    fn receive(&mut self) -> Result<Vec<u8>, TransportError>;
}

#[derive(Debug, Default)]
pub struct TcpTransport {
    stream: Option<TcpStream>,
    endpoint: Option<RdpEndpoint>,
}

impl TcpTransport {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn endpoint(&self) -> Option<&RdpEndpoint> {
        self.endpoint.as_ref()
    }

    fn stream_mut(&mut self) -> Result<&mut TcpStream, TransportError> {
        self.stream.as_mut().ok_or(TransportError::NotConnected)
    }
}

#[derive(Debug, Default)]
pub struct MemoryTransport {
    connected: bool,
    sent_packets: Vec<Vec<u8>>,
    scripted_reads: Vec<Vec<u8>>,
    endpoint: Option<RdpEndpoint>,
}

impl MemoryTransport {
    pub fn new(scripted_reads: Vec<Vec<u8>>) -> Self {
        Self {
            connected: false,
            sent_packets: Vec::new(),
            scripted_reads,
            endpoint: None,
        }
    }

    pub fn sent_packets(&self) -> &[Vec<u8>] {
        &self.sent_packets
    }

    pub fn endpoint(&self) -> Option<&RdpEndpoint> {
        self.endpoint.as_ref()
    }
}

impl Transport for MemoryTransport {
    fn connect(&mut self, endpoint: &RdpEndpoint, _timeout: Duration) -> Result<(), TransportError> {
        self.connected = true;
        self.endpoint = Some(endpoint.clone());
        Ok(())
    }

    fn send(&mut self, bytes: &[u8]) -> Result<(), TransportError> {
        if !self.connected {
            return Err(TransportError::NotConnected);
        }

        self.sent_packets.push(bytes.to_vec());
        Ok(())
    }

    fn receive(&mut self) -> Result<Vec<u8>, TransportError> {
        if !self.connected {
            return Err(TransportError::NotConnected);
        }

        if self.scripted_reads.is_empty() {
            return Err(TransportError::EndOfStream);
        }

        Ok(self.scripted_reads.remove(0))
    }
}

impl Transport for TcpTransport {
    fn connect(&mut self, endpoint: &RdpEndpoint, timeout: Duration) -> Result<(), TransportError> {
        let socket_addrs = (endpoint.host.as_str(), endpoint.port)
            .to_socket_addrs()
            .map_err(|error| TransportError::ConnectFailed(error.to_string()))?;

        let mut last_error: Option<String> = None;

        for socket_addr in socket_addrs {
            match TcpStream::connect_timeout(&socket_addr, timeout) {
                Ok(stream) => {
                    stream
                        .set_read_timeout(Some(timeout))
                        .map_err(|error| TransportError::ConnectFailed(error.to_string()))?;
                    stream
                        .set_write_timeout(Some(timeout))
                        .map_err(|error| TransportError::ConnectFailed(error.to_string()))?;

                    self.stream = Some(stream);
                    self.endpoint = Some(endpoint.clone());
                    return Ok(());
                }
                Err(error) => {
                    last_error = Some(error.to_string());
                }
            }
        }

        Err(TransportError::ConnectFailed(
            last_error.unwrap_or_else(|| "nenhum endereço resolvido para conexão".to_string()),
        ))
    }

    fn send(&mut self, bytes: &[u8]) -> Result<(), TransportError> {
        let stream = self.stream_mut()?;
        stream
            .write_all(bytes)
            .map_err(|error| TransportError::SendFailed(error.to_string()))
    }

    fn receive(&mut self) -> Result<Vec<u8>, TransportError> {
        let stream = self.stream_mut()?;
        read_tpkt_packet(stream)
    }
}

fn read_tpkt_packet(stream: &mut TcpStream) -> Result<Vec<u8>, TransportError> {
    let mut header = [0u8; 4];
    stream
        .read_exact(&mut header)
        .map_err(map_receive_error)?;

    if header[0] != 3 {
        return Err(TransportError::ReceiveFailed(
            "pacote TPKT com versão inválida".to_string(),
        ));
    }

    let declared_length = u16::from_be_bytes([header[2], header[3]]) as usize;
    if declared_length < 4 {
        return Err(TransportError::ReceiveFailed(
            "pacote TPKT com tamanho inválido".to_string(),
        ));
    }

    let mut packet = header.to_vec();
    let remaining_length = declared_length - 4;
    let mut payload = vec![0u8; remaining_length];
    stream
        .read_exact(&mut payload)
        .map_err(map_receive_error)?;
    packet.extend_from_slice(&payload);

    Ok(packet)
}

fn map_receive_error(error: std::io::Error) -> TransportError {
    if error.kind() == std::io::ErrorKind::UnexpectedEof {
        return TransportError::EndOfStream;
    }

    TransportError::ReceiveFailed(error.to_string())
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::Duration;

    use super::{TcpTransport, Transport};
    use crate::config::RdpEndpoint;

    #[test]
    fn tcp_transport_sends_and_receives_full_tpkt_packet() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();

        let server = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();

            let mut request_header = [0u8; 4];
            socket.read_exact(&mut request_header).unwrap();
            let request_length = u16::from_be_bytes([request_header[2], request_header[3]]) as usize;
            let mut request_payload = vec![0u8; request_length - 4];
            socket.read_exact(&mut request_payload).unwrap();

            let mut full_request = request_header.to_vec();
            full_request.extend_from_slice(&request_payload);

            let confirm_packet = vec![
                0x03, 0x00, 0x00, 0x13,
                0x0e, 0xd0, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x02, 0x00, 0x08, 0x00,
                0x01, 0x00, 0x00, 0x00,
            ];
            socket.write_all(&confirm_packet).unwrap();

            full_request
        });

        let mut transport = TcpTransport::new();
        transport
            .connect(
                &RdpEndpoint::new("127.0.0.1", address.port()),
                Duration::from_secs(2),
            )
            .unwrap();
        transport.send(&[0x03, 0x00, 0x00, 0x08, 0xAA, 0xBB, 0xCC, 0xDD]).unwrap();

        let received = transport.receive().unwrap();
        let sent_request = server.join().unwrap();

        assert_eq!(sent_request, vec![0x03, 0x00, 0x00, 0x08, 0xAA, 0xBB, 0xCC, 0xDD]);
        assert_eq!(
            received,
            vec![
                0x03, 0x00, 0x00, 0x13,
                0x0e, 0xd0, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x02, 0x00, 0x08, 0x00,
                0x01, 0x00, 0x00, 0x00,
            ]
        );
    }
}
