use super::ProtocolError;

const TPKT_VERSION: u8 = 3;

pub fn encode(payload: &[u8]) -> Vec<u8> {
    let total_length = payload.len() + 4;
    let mut packet = Vec::with_capacity(total_length);
    packet.push(TPKT_VERSION);
    packet.push(0);
    packet.extend_from_slice(&(total_length as u16).to_be_bytes());
    packet.extend_from_slice(payload);
    packet
}

pub fn decode(bytes: &[u8]) -> Result<&[u8], ProtocolError> {
    if bytes.len() < 4 {
        return Err(ProtocolError::InvalidPacket("tpkt too short"));
    }
    if bytes[0] != TPKT_VERSION {
        return Err(ProtocolError::InvalidPacket("invalid tpkt version"));
    }

    let declared_length = u16::from_be_bytes([bytes[2], bytes[3]]) as usize;
    if declared_length != bytes.len() {
        return Err(ProtocolError::InvalidPacket("tpkt length mismatch"));
    }

    Ok(&bytes[4..])
}

#[cfg(test)]
mod tests {
    use super::{decode, encode};

    #[test]
    fn roundtrips_tpkt_payload() {
        let payload = vec![0xAA, 0xBB, 0xCC];
        let packet = encode(&payload);

        assert_eq!(decode(&packet).unwrap(), payload.as_slice());
    }
}
