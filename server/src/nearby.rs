//! Presence for the devices using this server, so a sender can pick one to send to instead of
//! reading out a code. Flux runs on a home network and only local devices reach it, so every
//! page connected here counts as nearby — no grouping by address is needed.
//!
//! An offer carries an ordinary transfer code. Everything after the receiver accepts is the
//! same transfer anyone could open with that code, so nothing here touches the bytes.

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
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::mpsc;

use crate::{Shared, transfers::normalize_code};

const MAX_MESSAGE: usize = 8 * 1024;
const MAX_CONNECTIONS: usize = 256;
const QUEUE: usize = 64;
const HELLO_TIMEOUT: Duration = Duration::from_secs(10);
/// Keeps idle connections open through proxies that drop silent WebSockets.
const PING_INTERVAL: Duration = Duration::from_secs(25);
const MAX_DEVICE_ID: usize = 64;
const MAX_NAME: usize = 40;
const MAX_TITLE: usize = 200;
const UNNAMED: &str = "Unnamed device";

type Tx = mpsc::Sender<Message>;

struct Connection {
    device: String,
    name: String,
    tx: Tx,
}

#[derive(Default)]
pub struct Presence {
    connections: Mutex<HashMap<u64, Connection>>,
    next_id: AtomicU64,
}

fn send(tx: &Tx, msg: Value) {
    // A client that can't keep up only loses presence news meant for itself.
    let _ = tx.try_send(Message::Text(msg.to_string().into()));
}

/// A device id is only ever compared, so anything short and printable will do.
fn valid_device(device: &str) -> bool {
    !device.is_empty()
        && device.len() <= MAX_DEVICE_ID
        && device.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn clean_name(name: &str) -> String {
    let name: String = name.trim().chars().filter(|c| !c.is_control()).take(MAX_NAME).collect();
    if name.is_empty() { UNNAMED.to_owned() } else { name }
}

impl Presence {
    /// Every other device, once each however many tabs it has open.
    fn peers_of(connections: &HashMap<u64, Connection>, device: &str) -> Vec<Value> {
        let mut named: HashMap<&str, &str> = HashMap::new();
        for c in connections.values().filter(|c| c.device != device) {
            named.insert(&c.device, &c.name);
        }
        let mut peers: Vec<_> = named.into_iter().collect();
        peers.sort();
        peers.into_iter().map(|(device, name)| json!({ "device": device, "name": name })).collect()
    }

    fn join(&self, device: String, name: String, tx: Tx) -> Option<u64> {
        let mut connections = self.connections.lock().unwrap();
        if connections.len() >= MAX_CONNECTIONS {
            return None;
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        send(&tx, json!({ "t": "peers", "peers": Self::peers_of(&connections, &device) }));
        for other in connections.values().filter(|c| c.device != device) {
            send(&other.tx, json!({ "t": "peer", "device": device, "name": name }));
        }
        connections.insert(id, Connection { device, name, tx });
        Some(id)
    }

    fn rename(&self, id: u64, name: String) {
        let mut connections = self.connections.lock().unwrap();
        let Some(me) = connections.get_mut(&id) else { return };
        me.name = name.clone();
        let device = me.device.clone();
        // Another tab of the same device answers to the same name.
        for c in connections.values_mut().filter(|c| c.device == device) {
            c.name = name.clone();
        }
        for other in connections.values().filter(|c| c.device != device) {
            send(&other.tx, json!({ "t": "peer", "device": device, "name": name }));
        }
    }

    fn leave(&self, id: u64) {
        let mut connections = self.connections.lock().unwrap();
        let Some(gone) = connections.remove(&id) else { return };
        // Still here while any tab of it is.
        if connections.values().any(|c| c.device == gone.device) {
            return;
        }
        for other in connections.values() {
            send(&other.tx, json!({ "t": "gone", "device": gone.device }));
        }
    }

    /// Hands `msg` to every tab of `to`, stamped with who it came from.
    fn deliver(&self, from: u64, to: &str, mut msg: Value) {
        let connections = self.connections.lock().unwrap();
        let Some(sender) = connections.get(&from) else { return };
        if sender.device == to {
            return;
        }
        msg["from"] = json!({ "device": sender.device, "name": sender.name });
        for target in connections.values().filter(|c| c.device == to) {
            send(&target.tx, msg.clone());
        }
    }
}

/// First message on a connection: who this is.
#[derive(Deserialize)]
struct Hello {
    device: String,
    #[serde(default)]
    name: String,
}

#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
enum Incoming {
    Rename {
        name: String,
    },
    /// An invitation to open a transfer that has already been created.
    Offer {
        to: String,
        code: String,
        title: String,
        files: u64,
        size: u64,
    },
    Answer {
        to: String,
        code: String,
        accepted: bool,
    },
}

impl Presence {
    fn handle(&self, id: u64, incoming: Incoming) {
        match incoming {
            Incoming::Rename { name } => self.rename(id, clean_name(&name)),
            Incoming::Offer { to, code, title, files, size } => {
                let title: String = title.chars().filter(|c| !c.is_control()).take(MAX_TITLE).collect();
                let msg = json!({ "t": "offer", "code": normalize_code(&code), "title": title, "files": files, "size": size });
                self.deliver(id, &to, msg);
            }
            Incoming::Answer { to, code, accepted } => {
                let msg = json!({ "t": "answer", "code": normalize_code(&code), "accepted": accepted });
                self.deliver(id, &to, msg);
            }
        }
    }
}

pub async fn connect(ws: WebSocketUpgrade, State(state): State<Shared>) -> Response {
    ws.max_message_size(MAX_MESSAGE).on_upgrade(move |socket| session(state, socket))
}

async fn session(state: Shared, socket: WebSocket) {
    let (mut sink, mut stream) = socket.split();
    let hello = match tokio::time::timeout(HELLO_TIMEOUT, stream.next()).await {
        Ok(Some(Ok(Message::Text(text)))) => serde_json::from_str::<Hello>(text.as_str()).ok(),
        _ => None,
    };
    let Some(hello) = hello.filter(|h| valid_device(&h.device)) else { return };

    let (tx, mut rx) = mpsc::channel(QUEUE);
    let Some(id) = state.nearby.join(hello.device, clean_name(&hello.name), tx) else { return };
    let mut ping = tokio::time::interval(PING_INTERVAL);
    loop {
        tokio::select! {
            outgoing = rx.recv() => match outgoing {
                Some(msg) => {
                    if sink.send(msg).await.is_err() {
                        break;
                    }
                }
                None => break,
            },
            incoming = stream.next() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    if let Ok(incoming) = serde_json::from_str::<Incoming>(text.as_str()) {
                        state.nearby.handle(id, incoming);
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
    state.nearby.leave(id);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn channel() -> (Tx, mpsc::Receiver<Message>) {
        mpsc::channel(QUEUE)
    }

    /// Everything waiting on a connection, decoded.
    fn drain(rx: &mut mpsc::Receiver<Message>) -> Vec<Value> {
        let mut out = Vec::new();
        while let Ok(Message::Text(text)) = rx.try_recv() {
            out.push(serde_json::from_str(text.as_str()).unwrap());
        }
        out
    }

    #[test]
    fn a_new_device_learns_who_is_here_and_everyone_learns_of_it() {
        let presence = Presence::default();
        let (alice_tx, mut alice) = channel();
        presence.join("alice".into(), "Alice's Mac".into(), alice_tx);
        assert_eq!(drain(&mut alice), [json!({ "t": "peers", "peers": [] })]);

        let (bob_tx, mut bob) = channel();
        presence.join("bob".into(), "Bob's iPhone".into(), bob_tx);
        assert_eq!(
            drain(&mut bob),
            [json!({ "t": "peers", "peers": [{ "device": "alice", "name": "Alice's Mac" }] })]
        );
        assert_eq!(drain(&mut alice), [json!({ "t": "peer", "device": "bob", "name": "Bob's iPhone" })]);
    }

    #[test]
    fn a_device_with_two_tabs_is_listed_once_and_leaves_with_its_last() {
        let presence = Presence::default();
        let (watcher_tx, mut watcher) = channel();
        presence.join("watcher".into(), "Watcher".into(), watcher_tx);

        let (a_tx, _a) = channel();
        let (b_tx, _b) = channel();
        let first = presence.join("phone".into(), "Phone".into(), a_tx).unwrap();
        let second = presence.join("phone".into(), "Phone".into(), b_tx).unwrap();

        let (late_tx, mut late) = channel();
        presence.join("late".into(), "Late".into(), late_tx);
        let peers = &drain(&mut late)[0]["peers"];
        assert_eq!(peers.as_array().unwrap().iter().filter(|p| p["device"] == "phone").count(), 1);

        drain(&mut watcher);
        presence.leave(first);
        assert!(drain(&mut watcher).is_empty(), "still open in another tab");
        presence.leave(second);
        assert_eq!(drain(&mut watcher), [json!({ "t": "gone", "device": "phone" })]);
    }

    #[test]
    fn an_offer_reaches_every_tab_of_its_target_and_no_one_else() {
        let presence = Presence::default();
        let (sender_tx, mut sender) = channel();
        let (tab1_tx, mut tab1) = channel();
        let (tab2_tx, mut tab2) = channel();
        let (bystander_tx, mut bystander) = channel();
        let from = presence.join("sender".into(), "Sender".into(), sender_tx).unwrap();
        presence.join("target".into(), "Target".into(), tab1_tx);
        presence.join("target".into(), "Target".into(), tab2_tx);
        presence.join("bystander".into(), "Bystander".into(), bystander_tx);
        for rx in [&mut sender, &mut tab1, &mut tab2, &mut bystander] {
            drain(rx);
        }

        presence.handle(
            from,
            Incoming::Offer { to: "target".into(), code: "ABCD-EFGH".into(), title: "photos".into(), files: 3, size: 1024 },
        );
        let expected = json!({
            "t": "offer", "code": "abcdefgh", "title": "photos", "files": 3, "size": 1024,
            "from": { "device": "sender", "name": "Sender" },
        });
        assert_eq!(drain(&mut tab1), [expected.clone()]);
        assert_eq!(drain(&mut tab2), [expected]);
        assert!(drain(&mut bystander).is_empty());
        assert!(drain(&mut sender).is_empty());
    }

    #[test]
    fn an_answer_goes_back_to_the_sender() {
        let presence = Presence::default();
        let (sender_tx, mut sender) = channel();
        let (target_tx, _target) = channel();
        presence.join("sender".into(), "Sender".into(), sender_tx);
        let target = presence.join("target".into(), "Target".into(), target_tx).unwrap();
        drain(&mut sender);

        presence.handle(target, Incoming::Answer { to: "sender".into(), code: "abcdefgh".into(), accepted: true });
        assert_eq!(
            drain(&mut sender),
            [json!({ "t": "answer", "code": "abcdefgh", "accepted": true, "from": { "device": "target", "name": "Target" } })]
        );
    }

    #[test]
    fn a_device_cannot_offer_to_itself_or_to_nobody() {
        let presence = Presence::default();
        let (me_tx, mut me) = channel();
        let id = presence.join("me".into(), "Me".into(), me_tx).unwrap();
        drain(&mut me);
        for to in ["me", "nobody"] {
            presence.handle(id, Incoming::Offer { to: to.into(), code: "abcdefgh".into(), title: "x".into(), files: 1, size: 1 });
        }
        assert!(drain(&mut me).is_empty());
    }

    #[test]
    fn a_rename_reaches_the_others() {
        let presence = Presence::default();
        let (watcher_tx, mut watcher) = channel();
        let (phone_tx, _phone) = channel();
        presence.join("watcher".into(), "Watcher".into(), watcher_tx);
        let phone = presence.join("phone".into(), "Phone".into(), phone_tx).unwrap();
        drain(&mut watcher);

        presence.handle(phone, Incoming::Rename { name: "  Kitchen iPad  ".into() });
        assert_eq!(drain(&mut watcher), [json!({ "t": "peer", "device": "phone", "name": "Kitchen iPad" })]);
    }

    #[test]
    fn names_are_kept_short_and_printable() {
        assert_eq!(clean_name("   "), UNNAMED);
        assert_eq!(clean_name("a\u{0}b\nc"), "abc");
        assert_eq!(clean_name(&"x".repeat(100)).chars().count(), MAX_NAME);
    }

    #[test]
    fn only_plain_device_ids_are_accepted() {
        assert!(valid_device("3f2a-9c1b"));
        assert!(!valid_device(""));
        assert!(!valid_device("has space"));
        assert!(!valid_device(&"a".repeat(MAX_DEVICE_ID + 1)));
    }
}
