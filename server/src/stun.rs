//! A STUN binding responder (RFC 5389), so two devices on this network can learn the
//! addresses they actually reach each other on.
//!
//! Browsers hide a machine's real address behind an `<uuid>.local` name in the candidates
//! they offer, and plenty of networks won't resolve those between two devices — which
//! leaves a direct transfer with nothing to connect to. A reply from here carries the
//! address this server sees the device on, and because this server sits on the same
//! network as both of them, that is the address that works. No third party is involved.

use std::net::{IpAddr, SocketAddr};

use axum::{Json, extract::State};
use serde::Serialize;
use tokio::net::UdpSocket;

use crate::Shared;

const BINDING_REQUEST: u16 = 0x0001;
const BINDING_RESPONSE: u16 = 0x0101;
const MAGIC_COOKIE: u32 = 0x2112_A442;
const XOR_MAPPED_ADDRESS: u16 = 0x0020;
const HEADER: usize = 20;
/// Binding requests are tiny; anything larger isn't one.
const MAX_REQUEST: usize = 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// Port to reach this server's STUN responder on, or null when it isn't running.
    stun_port: Option<u16>,
}

/// What a page needs to know before it can set up a direct transfer.
pub async fn config(State(state): State<Shared>) -> Json<Config> {
    Json(Config {
        stun_port: state.stun_port,
    })
}

pub fn spawn(socket: UdpSocket) {
    tokio::spawn(async move {
        let mut buf = [0u8; MAX_REQUEST];
        loop {
            let Ok((len, from)) = socket.recv_from(&mut buf).await else {
                continue;
            };
            if let Some(reply) = respond(&buf[..len], from) {
                let _ = socket.send_to(&reply, from).await;
            }
        }
    });
}

/// Answers a binding request with the source address it arrived from. Anything else is
/// ignored, so this never replies with more than it was asked for.
fn respond(msg: &[u8], from: SocketAddr) -> Option<Vec<u8>> {
    if msg.len() < HEADER {
        return None;
    }
    let kind = u16::from_be_bytes([msg[0], msg[1]]);
    let length = u16::from_be_bytes([msg[2], msg[3]]) as usize;
    let cookie = u32::from_be_bytes([msg[4], msg[5], msg[6], msg[7]]);
    if kind != BINDING_REQUEST || cookie != MAGIC_COOKIE || HEADER + length > msg.len() {
        return None;
    }
    let transaction = &msg[8..HEADER];

    // The address is sent XOR'd with the cookie so that NATs rewriting a bare address in
    // the payload can't corrupt it.
    let port = from.port() ^ (MAGIC_COOKIE >> 16) as u16;
    let ip = match from.ip() {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map_or(IpAddr::V6(v6), IpAddr::V4),
        ip => ip,
    };
    let mut value = vec![0, if ip.is_ipv4() { 0x01 } else { 0x02 }];
    value.extend_from_slice(&port.to_be_bytes());
    match ip {
        IpAddr::V4(v4) => value.extend_from_slice(&(u32::from(v4) ^ MAGIC_COOKIE).to_be_bytes()),
        IpAddr::V6(v6) => {
            let mut key = [0u8; 16];
            key[..4].copy_from_slice(&MAGIC_COOKIE.to_be_bytes());
            key[4..].copy_from_slice(transaction);
            value.extend(v6.octets().iter().zip(key).map(|(byte, k)| byte ^ k));
        }
    }

    let mut out = Vec::with_capacity(HEADER + 4 + value.len());
    out.extend_from_slice(&BINDING_RESPONSE.to_be_bytes());
    out.extend_from_slice(&((4 + value.len()) as u16).to_be_bytes());
    out.extend_from_slice(&MAGIC_COOKIE.to_be_bytes());
    out.extend_from_slice(transaction);
    out.extend_from_slice(&XOR_MAPPED_ADDRESS.to_be_bytes());
    out.extend_from_slice(&(value.len() as u16).to_be_bytes());
    out.extend_from_slice(&value);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> Vec<u8> {
        let mut msg = vec![0x00, 0x01, 0x00, 0x00];
        msg.extend_from_slice(&MAGIC_COOKIE.to_be_bytes());
        msg.extend_from_slice(&[7u8; 12]);
        msg
    }

    #[test]
    fn maps_an_ipv4_source_back_to_the_caller() {
        let from: SocketAddr = "192.168.1.20:54321".parse().unwrap();
        let reply = respond(&request(), from).expect("binding response");
        assert_eq!(u16::from_be_bytes([reply[0], reply[1]]), BINDING_RESPONSE);
        assert_eq!(&reply[8..20], &[7u8; 12], "transaction id is echoed");
        assert_eq!(u16::from_be_bytes([reply[20], reply[21]]), XOR_MAPPED_ADDRESS);
        let port = u16::from_be_bytes([reply[26], reply[27]]) ^ (MAGIC_COOKIE >> 16) as u16;
        let ip = u32::from_be_bytes([reply[28], reply[29], reply[30], reply[31]]) ^ MAGIC_COOKIE;
        assert_eq!(port, 54321);
        assert_eq!(
            std::net::Ipv4Addr::from(ip),
            "192.168.1.20".parse::<std::net::Ipv4Addr>().unwrap()
        );
    }

    #[test]
    fn ignores_anything_that_is_not_a_binding_request() {
        let from: SocketAddr = "192.168.1.20:1".parse().unwrap();
        assert!(respond(&[], from).is_none());
        assert!(respond(&[0; 8], from).is_none(), "too short to be a header");
        let mut wrong_cookie = request();
        wrong_cookie[4] = 0;
        assert!(respond(&wrong_cookie, from).is_none());
        let mut wrong_kind = request();
        wrong_kind[1] = 0x03;
        assert!(respond(&wrong_kind, from).is_none());
    }
}
