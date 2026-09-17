//! Live text: every page with a text open hears the moment it changes, and how many pages are
//! open on it. Only the fact of a change travels here; pages then load the text the usual way,
//! so there is one way to read it and one way to save it.

use std::{collections::HashMap, sync::Mutex, time::Duration};

use axum::{
    extract::{
        Path, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio::sync::broadcast::{self, error::RecvError};
use uuid::Uuid;

use crate::{
    Shared,
    error::{AppError, Result},
    transfers,
};

/// Pages send nothing that matters, so anything larger is not a page.
const MAX_MESSAGE: usize = 1024;
/// Beyond this a page does without and falls back to checking now and then.
const MAX_VIEWERS: usize = 64;
const QUEUE: usize = 16;
/// Keeps idle connections open through proxies that drop silent WebSockets.
const PING_INTERVAL: Duration = Duration::from_secs(25);

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Event {
    Changed,
    Viewers(usize),
}

impl Event {
    fn message(self) -> Message {
        let body = match self {
            Event::Changed => json!({ "t": "changed" }),
            Event::Viewers(count) => json!({ "t": "viewers", "count": count }),
        };
        Message::Text(body.to_string().into())
    }
}

struct Text {
    events: broadcast::Sender<Event>,
    viewers: usize,
}

#[derive(Default)]
pub struct Notes {
    texts: Mutex<HashMap<Uuid, Text>>,
}

impl Notes {
    /// Tells every page open on a text that it changed: its words, its settings, or that it is gone.
    pub fn changed(&self, id: Uuid) {
        if let Some(text) = self.texts.lock().unwrap().get(&id) {
            let _ = text.events.send(Event::Changed);
        }
    }

    fn join(&self, id: Uuid) -> Option<broadcast::Receiver<Event>> {
        let mut texts = self.texts.lock().unwrap();
        let text = texts.entry(id).or_insert_with(|| Text {
            events: broadcast::channel(QUEUE).0,
            viewers: 0,
        });
        if text.viewers >= MAX_VIEWERS {
            return None;
        }
        // Subscribed first, so the page joining hears the count that includes it.
        let events = text.events.subscribe();
        text.viewers += 1;
        let _ = text.events.send(Event::Viewers(text.viewers));
        Some(events)
    }

    fn leave(&self, id: Uuid) {
        let mut texts = self.texts.lock().unwrap();
        let Some(text) = texts.get_mut(&id) else { return };
        text.viewers -= 1;
        if text.viewers == 0 {
            texts.remove(&id);
        } else {
            let _ = text.events.send(Event::Viewers(text.viewers));
        }
    }
}

pub async fn connect(ws: WebSocketUpgrade, State(state): State<Shared>, Path(code): Path<String>) -> Result<Response> {
    let transfer = transfers::find(&state.db, &code).await?;
    if transfer.note.is_none() {
        return Err(AppError::NOT_FOUND);
    }
    Ok(ws
        .max_message_size(MAX_MESSAGE)
        .on_upgrade(move |socket| session(state, transfer.id, socket)))
}

async fn session(state: Shared, id: Uuid, socket: WebSocket) {
    let Some(mut events) = state.notes.join(id) else { return };
    let (mut sink, mut stream) = socket.split();
    let mut ping = tokio::time::interval(PING_INTERVAL);
    loop {
        let outgoing = tokio::select! {
            event = events.recv() => match event {
                Ok(event) => event.message(),
                // Whatever was missed, loading the text again catches up with all of it.
                Err(RecvError::Lagged(_)) => Event::Changed.message(),
                Err(RecvError::Closed) => break,
            },
            incoming = stream.next() => match incoming {
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                _ => continue,
            },
            _ = ping.tick() => Message::Ping(Default::default()),
        };
        if sink.send(outgoing).await.is_err() {
            break;
        }
    }
    state.notes.leave(id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pages_hear_changes_and_how_many_are_open() {
        let notes = Notes::default();
        let id = Uuid::new_v4();
        let mut first = notes.join(id).unwrap();
        assert_eq!(first.try_recv(), Ok(Event::Viewers(1)));

        let mut second = notes.join(id).unwrap();
        assert_eq!(first.try_recv(), Ok(Event::Viewers(2)));
        assert_eq!(
            second.try_recv(),
            Ok(Event::Viewers(2)),
            "a page hears the count that includes it"
        );

        notes.changed(id);
        assert_eq!(first.try_recv(), Ok(Event::Changed));
        assert_eq!(second.try_recv(), Ok(Event::Changed));

        notes.leave(id);
        assert_eq!(first.try_recv(), Ok(Event::Viewers(1)));
        notes.leave(id);
        assert!(
            notes.texts.lock().unwrap().is_empty(),
            "a text no page has open is forgotten"
        );
    }

    #[test]
    fn a_change_to_a_text_no_one_has_open_goes_nowhere() {
        let notes = Notes::default();
        notes.changed(Uuid::new_v4());
        assert!(notes.texts.lock().unwrap().is_empty());
    }

    #[test]
    fn stops_taking_pages_at_the_limit() {
        let notes = Notes::default();
        let id = Uuid::new_v4();
        let open: Vec<_> = (0..MAX_VIEWERS).map(|_| notes.join(id).unwrap()).collect();
        assert!(notes.join(id).is_none());
        drop(open);
    }
}
