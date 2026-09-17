//! Whether the server still answers.
//!
//! Docker's healthcheck asks through `flux healthcheck`, which only makes the state visible:
//! Compose reports an unhealthy container but never restarts one. So the server also asks
//! itself, from a thread outside the async runtime a hang would most likely be stuck in, and
//! exits when it stops answering — which `restart: unless-stopped` does act on.

use std::{
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream},
    time::Duration,
};

const PROBE_TIMEOUT: Duration = Duration::from_secs(10);
const WATCH_INTERVAL: Duration = Duration::from_secs(30);
/// Minutes rather than seconds of silence before giving up: a restart drops every upload and
/// direct transfer in flight, and all of them can pick up again, but a slow moment isn't a hang.
const MAX_MISSES: u32 = 3;

/// Where to reach a server listening on `addr` from the same machine.
pub fn local(addr: SocketAddr) -> SocketAddr {
    match addr.ip() {
        IpAddr::V4(ip) if ip.is_unspecified() => SocketAddr::new(Ipv4Addr::LOCALHOST.into(), addr.port()),
        IpAddr::V6(ip) if ip.is_unspecified() => SocketAddr::new(Ipv6Addr::LOCALHOST.into(), addr.port()),
        _ => addr,
    }
}

/// Asks for the cheapest page the server has, which touches neither the disk nor the database:
/// the question is whether it answers, not whether everything behind it is well.
fn probe_with(addr: SocketAddr, timeout: Duration) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, timeout) else {
        return false;
    };
    if stream.set_read_timeout(Some(timeout)).is_err() || stream.set_write_timeout(Some(timeout)).is_err() {
        return false;
    }
    let request = b"GET /api/config HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";
    let mut status = [0u8; 12];
    stream.write_all(request).is_ok() && stream.read_exact(&mut status).is_ok() && &status == b"HTTP/1.1 200"
}

pub fn probe(addr: SocketAddr) -> bool {
    probe_with(local(addr), PROBE_TIMEOUT)
}

/// Returns once `alive` has said no `max_misses` times in a row; any yes starts the count again.
fn watchdog(mut alive: impl FnMut() -> bool, interval: Duration, max_misses: u32) {
    let mut misses = 0;
    loop {
        std::thread::sleep(interval);
        if alive() {
            misses = 0;
            continue;
        }
        misses += 1;
        tracing::warn!("server didn't answer its own health probe ({misses} of {max_misses})");
        if misses >= max_misses {
            return;
        }
    }
}

/// Exits the process once the server listening on `addr` stops answering for good.
pub fn watch(addr: SocketAddr) {
    std::thread::spawn(move || {
        watchdog(|| probe(addr), WATCH_INTERVAL, MAX_MISSES);
        tracing::error!("server stopped answering; exiting so it can be restarted");
        std::process::exit(1);
    });
}

#[cfg(test)]
mod tests {
    use std::{net::TcpListener, thread};

    use super::*;

    const QUICK: Duration = Duration::from_millis(300);

    /// A server on a spare port that answers every connection with `reply`, or never answers.
    fn server(reply: Option<&'static [u8]>) -> SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            for mut stream in listener.incoming().flatten() {
                let mut request = [0u8; 256];
                let _ = stream.read(&mut request);
                match reply {
                    Some(reply) => drop(stream.write_all(reply)),
                    // Holds the connection open without a word, the way a stuck server does.
                    None => thread::sleep(Duration::from_secs(5)),
                }
            }
        });
        addr
    }

    #[test]
    fn a_server_that_answers_is_alive() {
        assert!(probe_with(
            server(Some(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\n{}")),
            QUICK
        ));
    }

    #[test]
    fn an_error_is_not_an_answer() {
        assert!(!probe_with(
            server(Some(b"HTTP/1.1 500 Internal Server Error\r\n\r\n")),
            QUICK
        ));
        assert!(!probe_with(server(Some(b"nonsense")), QUICK));
    }

    #[test]
    fn a_server_that_says_nothing_is_not_alive_and_the_probe_doesnt_wait_forever() {
        let started = std::time::Instant::now();
        assert!(!probe_with(server(None), QUICK));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn nothing_listening_is_not_alive() {
        let addr = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap();
        assert!(!probe_with(addr, QUICK));
    }

    #[test]
    fn probes_a_wildcard_listener_on_loopback() {
        assert_eq!(
            local("0.0.0.0:8080".parse().unwrap()),
            "127.0.0.1:8080".parse().unwrap()
        );
        assert_eq!(local("[::]:8080".parse().unwrap()), "[::1]:8080".parse().unwrap());
        assert_eq!(
            local("10.0.0.2:8080".parse().unwrap()),
            "10.0.0.2:8080".parse().unwrap()
        );
    }

    #[test]
    fn gives_up_only_after_misses_in_a_row() {
        // Two misses, a recovery, then three in a row: only the last run counts.
        let mut answers = [false, false, true, false, false, false].into_iter();
        let mut asked = 0;
        watchdog(
            || {
                asked += 1;
                answers.next().expect("stopped at the third miss in a row")
            },
            Duration::ZERO,
            3,
        );
        assert_eq!(asked, 6);
    }
}
