pub mod tpkt;
pub mod x224;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolError {
    InvalidPacket(&'static str),
    NegotiationRejected(u32),
}
