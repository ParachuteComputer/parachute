//! A tiny HTTP/1.1 server on loopback for the broker's tests (tests/services_http.rs): it records every request it gets
//! and answers each with what the test's handler says. One request per connection.
#![allow(dead_code)]
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Clone, Debug)]
pub struct Seen {
    pub method: String,
    pub path: String,
    /// names lower-cased, in the order sent
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Seen {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
}

pub struct Reply {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

pub fn reply(status: u16, headers: &[(&str, &str)], body: &[u8]) -> Reply {
    Reply { status, headers: headers.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(), body: body.to_vec() }
}

pub type Log = Arc<Mutex<Vec<Seen>>>;

/// Serve on 127.0.0.1 until the test ends: the origin (`http://127.0.0.1:port`) and what it has seen.
pub async fn serve<F>(handler: F) -> (String, Log)
where
    F: Fn(&Seen) -> Reply + Send + Sync + 'static,
{
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen: Log = Arc::default();
    let log = seen.clone();
    let handler = Arc::new(handler);
    tokio::spawn(async move {
        while let Ok((mut sock, _)) = listener.accept().await {
            let log = log.clone();
            let handler = handler.clone();
            tokio::spawn(async move {
                let mut buf = Vec::new();
                let mut chunk = [0u8; 8192];
                let head_end = loop {
                    if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        break i;
                    }
                    match sock.read(&mut chunk).await {
                        Ok(0) | Err(_) => return,
                        Ok(n) => buf.extend_from_slice(&chunk[..n]),
                    }
                };
                let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
                let mut lines = head.split("\r\n");
                let mut first = lines.next().unwrap_or("").split(' ');
                let (method, path) = (first.next().unwrap_or("").to_string(), first.next().unwrap_or("").to_string());
                let headers: Vec<(String, String)> = lines.filter_map(|l| l.split_once(':')).map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string())).collect();
                let len: usize = headers.iter().find(|(k, _)| k == "content-length").and_then(|(_, v)| v.parse().ok()).unwrap_or(0);
                let mut body = buf[head_end + 4..].to_vec();
                while body.len() < len {
                    match sock.read(&mut chunk).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => body.extend_from_slice(&chunk[..n]),
                    }
                }
                let seen = Seen { method, path, headers, body };
                let r = handler(&seen);
                log.lock().unwrap().push(seen);
                let mut out = format!("HTTP/1.1 {} X\r\nconnection: close\r\n", r.status);
                let mut has_len = false;
                for (k, v) in &r.headers {
                    has_len |= k.eq_ignore_ascii_case("content-length");
                    out.push_str(&format!("{k}: {v}\r\n"));
                }
                if !has_len {
                    out.push_str(&format!("content-length: {}\r\n", r.body.len()));
                }
                out.push_str("\r\n");
                let _ = sock.write_all(out.as_bytes()).await;
                let _ = sock.write_all(&r.body).await;
                let _ = sock.shutdown().await;
            });
        }
    });
    (format!("http://127.0.0.1:{port}"), seen)
}
