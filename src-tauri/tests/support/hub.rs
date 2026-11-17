//! A real Parachute hub for tests: parachute-core (named by `PARACHUTE_CORE`) bootstrapped in a throwaway home and
//! served on loopback. Used by tests/door_hub.rs and tests/services_hub.rs.
#![allow(dead_code)]
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::time::Duration;

pub struct Hub {
    pub child: std::process::Child,
    pub home: std::path::PathBuf,
    pub origin: String,
    pub bin: String,
}

impl Drop for Hub {
    fn drop(&mut self) {
        let _ = Command::new("kill").args(["--", &format!("-{}", self.child.id())]).status();
        let _ = self.child.kill();
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

pub fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

pub fn hub(bin: String) -> Hub {
    hub_in(bin, "door")
}

/// A hub in its own throwaway home (`name` keeps two tests of this process apart).
pub fn hub_in(bin: String, name: &str) -> Hub {
    let home = std::env::temp_dir().join(format!("parachute-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&home).unwrap();
    std::fs::write(home.join("pw"), "correct horse battery staple 1").unwrap();
    let ph = home.join("home");
    let ok = Command::new(&bin)
        .args(["bootstrap", "--embedded", "--home", ph.to_str().unwrap(), "--username", "owner", "--password-file", home.join("pw").to_str().unwrap(), "--vault", "recipes", "--json"])
        .env("PARACHUTE_HOME", &ph)
        .stdout(Stdio::null())
        .status()
        .unwrap();
    assert!(ok.success(), "bootstrap");
    let (port, vport) = (free_port(), free_port());
    let origin = format!("http://127.0.0.1:{port}");
    let log = std::fs::File::create(home.join("serve.log")).unwrap();
    // embedded serve stops when its parent goes; a shell that waits on it is the parent, in its own group
    // (its own process group, not setsid: macOS has no setsid command)
    let mut sh = Command::new("sh");
    #[cfg(unix)]
    sh.process_group(0);
    let child = sh
        .args(["-c", "\"$@\"; :", "_", &bin, "serve", "--embedded", "--home", ph.to_str().unwrap(), "--listen", &format!("127.0.0.1:{port}"), "--vault-listen", &format!("127.0.0.1:{vport}")])
        .env("PARACHUTE_HOME", &ph)
        .env("PARACHUTE_HUB_ORIGIN", &origin)
        .stdout(log.try_clone().unwrap())
        .stderr(log)
        .spawn()
        .unwrap();
    let h = Hub { child, home, origin, bin };
    for _ in 0..120 {
        if std::fs::read_to_string(h.home.join("serve.log")).unwrap_or_default().contains("ready: hub") {
            return h;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    panic!("hub didn't start: {}", std::fs::read_to_string(h.home.join("serve.log")).unwrap_or_default());
}

/// One `parachute-core` command against the test hub, as its operator.
pub fn cli(h: &Hub, args: &[&str]) -> std::process::Output {
    let out = Command::new(&h.bin).args(args).env("PARACHUTE_HOME", h.home.join("home")).env("PORT", h.origin.rsplit(':').next().unwrap()).output().unwrap();
    assert!(out.status.success(), "{args:?}: {}", String::from_utf8_lossy(&out.stderr));
    out
}
