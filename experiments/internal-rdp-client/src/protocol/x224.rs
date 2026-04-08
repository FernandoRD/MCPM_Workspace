use super::{tpkt, ProtocolError};

const X224_CONNECTION_REQUEST: u8 = 0xE0;
const X224_CONNECTION_CONFIRM: u8 = 0xD0;
const RDP_NEG_TYPE_REQUEST: u8 = 0x01;
const RDP_NEG_TYPE_RESPONSE: u8 = 0x02;
const RDP_NEG_TYPE_FAILURE: u8 = 0x03;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectionConfirm {
    pub selected_protocol: Option<u32>,
    pub failure: Option<NegotiationFailure>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NegotiationFailure {
    SslRequiredByServer,
    SslNotAllowedByServer,
    SslCertNotOnServer,
    InconsistentFlags,
    HybridRequiredByServer,
    Unknown(u32),
}

pub fn encode_connection_request(cookie_username: Option<&str>, requested_protocols: u32) -> Vec<u8> {
    let mut payload = vec![
        0, // length indicator, preenchido no final
        X224_CONNECTION_REQUEST,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
    ];

    if let Some(username) = cookie_username.filter(|value| !value.trim().is_empty()) {
        payload.extend_from_slice(format!("Cookie: mstshash={}\r\n", username.trim()).as_bytes());
    }

    payload.push(RDP_NEG_TYPE_REQUEST);
    payload.push(0x00);
    payload.extend_from_slice(&8u16.to_le_bytes());
    payload.extend_from_slice(&requested_protocols.to_le_bytes());

    payload[0] = (payload.len() - 1) as u8;
    tpkt::encode(&payload)
}

pub fn decode_connection_confirm(bytes: &[u8]) -> Result<ConnectionConfirm, ProtocolError> {
    let payload = tpkt::decode(bytes)?;

    if payload.len() < 7 {
        return Err(ProtocolError::InvalidPacket("x224 confirm too short"));
    }
    if payload[1] != X224_CONNECTION_CONFIRM {
        return Err(ProtocolError::InvalidPacket("unexpected x224 tpdu"));
    }

    if payload.len() == 7 {
        return Ok(ConnectionConfirm {
            selected_protocol: None,
            failure: None,
        });
    }

    if payload.len() < 15 {
        return Err(ProtocolError::InvalidPacket("rdp negotiation response too short"));
    }

    let negotiation_type = payload[7];
    let negotiation_length = u16::from_le_bytes([payload[9], payload[10]]) as usize;
    if negotiation_length != 8 {
        return Err(ProtocolError::InvalidPacket("unexpected negotiation block length"));
    }

    let value = u32::from_le_bytes([payload[11], payload[12], payload[13], payload[14]]);

    match negotiation_type {
        RDP_NEG_TYPE_RESPONSE => Ok(ConnectionConfirm {
            selected_protocol: Some(value),
            failure: None,
        }),
        RDP_NEG_TYPE_FAILURE => Ok(ConnectionConfirm {
            selected_protocol: None,
            failure: Some(map_failure(value)),
        }),
        _ => Err(ProtocolError::InvalidPacket("unknown negotiation type")),
    }
}

fn map_failure(code: u32) -> NegotiationFailure {
    match code {
        0x0000_0001 => NegotiationFailure::SslRequiredByServer,
        0x0000_0002 => NegotiationFailure::SslNotAllowedByServer,
        0x0000_0003 => NegotiationFailure::SslCertNotOnServer,
        0x0000_0004 => NegotiationFailure::InconsistentFlags,
        0x0000_0005 => NegotiationFailure::HybridRequiredByServer,
        _ => NegotiationFailure::Unknown(code),
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_connection_confirm, encode_connection_request, NegotiationFailure};

    #[test]
    fn encodes_request_with_cookie_and_negotiation() {
        let packet = encode_connection_request(Some("demo"), 0x0000_0003);

        assert_eq!(packet[0], 3);
        assert!(packet.windows("Cookie: mstshash=demo\r\n".len()).any(|window| window == b"Cookie: mstshash=demo\r\n"));
        assert_eq!(&packet[packet.len() - 4..], &0x0000_0003u32.to_le_bytes());
    }

    #[test]
    fn decodes_connection_confirm_with_selected_protocol() {
        let packet = vec![
            0x03, 0x00, 0x00, 0x13, // TPKT
            0x0e, 0xd0, 0x00, 0x00, 0x00, 0x00, 0x00, // X224 confirm
            0x02, 0x00, 0x08, 0x00, // nego response
            0x01, 0x00, 0x00, 0x00, // selected protocol TLS
        ];

        let confirm = decode_connection_confirm(&packet).unwrap();
        assert_eq!(confirm.selected_protocol, Some(1));
        assert_eq!(confirm.failure, None);
    }

    #[test]
    fn decodes_negotiation_failure() {
        let packet = vec![
            0x03, 0x00, 0x00, 0x13,
            0x0e, 0xd0, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x03, 0x00, 0x08, 0x00,
            0x05, 0x00, 0x00, 0x00,
        ];

        let confirm = decode_connection_confirm(&packet).unwrap();
        assert_eq!(confirm.selected_protocol, None);
        assert_eq!(confirm.failure, Some(NegotiationFailure::HybridRequiredByServer));
    }
}
