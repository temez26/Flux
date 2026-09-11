//! Rendezvous for direct transfers: relays WebRTC offers, answers and ICE candidates
//! between a transfer's sender and its receivers. Payloads are opaque to the server.

use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use axum::{
    extract::{
        Path, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::{
    Shared,
    error::Result,
    transfers::{self, Transfer},
};

const MAX_MESSAGE: usize = 64 * 1024;
const MAX_RECEIVERS: usize = 16;
const QUEUE: usize = 256;
const HELLO_TIMEOUT: Duration = Duration::from_secs(10);
/// Keeps idle connections open through proxies that drop silent WebSockets.
const PING_INTERVAL: Duration = Duration::from_secs(25);

type Tx = mpsc::Sender<Message>;

#[derive(Default)]
pub struct Rooms {
    rooms: Mutex<HashMap<Uuid, Room>>,
    next_id: AtomicU64,
}

#[derive(Default)]
struct Room {
    sender: Option<(u64, Tx)>,
    receivers: HashMap<u64, Tx>,
}

fn send(tx: &Tx, msg: Value) {
    // A client that can't keep up only loses signaling meant for itself.
    let _ = tx.try_send(Message::Text(msg.to_string().into()));
}

impl Rooms {
    fn join(&self, room_id: Uuid, is_sender: bool, tx: Tx) -> Option<u64> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let mut rooms = self.rooms.lock().unwrap();
        let room = rooms.entry(room_id).or_default();
        if is_sender {
            for (receiver, rtx) in &room.receivers {
                send(rtx, json!({ "t": "peer", "online": true }));
                send(&tx, json!({ "t": "join", "id": receiver }));
            }
            // A reconnecting sender (e.g. after a reload) replaces the previous connection.
            room.sender = Some((id, tx));
        } else {
            if room.receivers.len() >= MAX_RECEIVERS {
                return None;
            }
            send(&tx, json!({ "t": "peer", "online": room.sender.is_some() }));
            if let Some((_, stx)) = &room.sender {
                send(stx, json!({ "t": "join", "id": id }));
            }
            room.receivers.insert(id, tx);
        }
        Some(id)
    }

    fn leave(&self, room_id: Uuid, id: u64) {
        let mut rooms = self.rooms.lock().unwrap();
        let Some(room) = rooms.get_mut(&room_id) else { return };
        if room.sender.as_ref().is_some_and(|(sender, _)| *sender == id) {
            room.sender = None;
            for rtx in room.receivers.values() {
                send(rtx, json!({ "t": "peer", "online": false }));
            }
        } else if room.receivers.remove(&id).is_some()
            && let Some((_, stx)) = &room.sender
        {
            send(stx, json!({ "t": "leave", "id": id }));
        }
        if room.sender.is_none() && room.receivers.is_empty() {
            rooms.remove(&room_id);
        }
    }

    fn relay(&self, room_id: Uuid, from: u64, to: Option<u64>, data: Value) {
        let rooms = self.rooms.lock().unwrap();
        let Some(room) = rooms.get(&room_id) else { return };
        match &room.sender {
            Some((sender, _)) if *sender == from => {
                if let Some(rtx) = to.and_then(|to| room.receivers.get(&to)) {
                    send(rtx, json!({ "t": "signal", "data": data }));
                }
            }
            Some((_, stx)) if room.receivers.contains_key(&from) => {
                send(stx, json!({ "t": "signal", "from": from, "data": data }));
            }
            _ => {}
        }
    }
}

/// First message on a connection. The sender proves ownership with its token here rather
/// than in the URL, so it never shows up in proxy logs.
#[derive(Deserialize)]
struct Hello {
    role: String,
    token: Option<String>,
}

#[derive(Deserialize)]
struct Envelope {
    t: String,
    to: Option<u64>,
    #[serde(default)]
    data: Value,
}

pub async fn connect(
    ws: WebSocketUpgrade,
    State(state): State<Shared>,
    Path(code): Path<String>,
) -> Result<Response> {
    let transfer = transfers::find(&state.db, &code).await?;
    Ok(ws
        .max_message_size(MAX_MESSAGE)
        .on_upgrade(move |socket| session(state, transfer, socket)))
}

async fn session(state: Shared, transfer: Transfer, socket: WebSocket) {
    let (mut sink, mut stream) = socket.split();
    let hello = match tokio::time::timeout(HELLO_TIMEOUT, stream.next()).await {
        Ok(Some(Ok(Message::Text(text)))) => serde_json::from_str::<Hello>(text.as_str()).ok(),
        _ => None,
    };
    let Some(hello) = hello else { return };
    let is_sender = hello.role == "sender";
    if is_sender && !hello.token.is_some_and(|token| transfers::token_matches(&token, &transfer)) {
        return;
    }

    let (tx, mut rx) = mpsc::channel(QUEUE);
    let Some(id) = state.rooms.join(transfer.id, is_sender, tx) else { return };
    let mut ping = tokio::time::interval(PING_INTERVAL);
    loop {
        tokio::select! {
            outgoing = rx.recv() => match outgoing {
                Some(msg) => {
                    if sink.send(msg).await.is_err() {
                        break;
                    }
                }
                // Replaced by a newer connection for the same role.
                None => break,
            },
            incoming = stream.next() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    if let Ok(envelope) = serde_json::from_str::<Envelope>(text.as_str())
                        && envelope.t == "signal"
                    {
                        state.rooms.relay(transfer.id, id, envelope.to, envelope.data);
                    }
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                _ => {}
            },
            _ = ping.tick() => {
                if sink.send(Message::Ping(Default::default())).await.is_err() {
                    break;
                }
            }
        }
    }
    state.rooms.leave(transfer.id, id);
}
