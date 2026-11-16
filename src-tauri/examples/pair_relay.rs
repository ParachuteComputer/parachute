//! The Buzz pairing relay (buzz-pair-relay, the code wss://pairing.buzz.xyz runs) on this machine, for device tests.
//!   cargo run --example pair_relay -- 127.0.0.1:7777
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let addr = std::env::args().nth(1).unwrap_or_else(|| "127.0.0.1:7777".into());
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("bind");
    println!("pairing relay on ws://{addr}");
    buzz_pair_relay::run_server(listener, Arc::new(buzz_pair_relay::Relay::new())).await;
}
