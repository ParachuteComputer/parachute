//! A web picture for an applet allowed `pictures` (Mail, once the person shows a sender's pictures): fetched here, not
//! by the frame, whose CSP lets no web address in (src/applet/srcdoc.ts). The web side checks the call first
//! (src/applet/modules/app.ts, `pictureUrlOk` in src/applet/files.ts); this checks it again and fetches:
//! - http or https, a name on the public internet: never this device, the local network or the tailnet (`localhost`,
//!   `.local`, `.internal`, `.lan`, `.home.arpa`, `.ts.net`, and any address, by name or written out, that is
//!   loopback, private, link-local, shared (100.64/10, the tailnet's), multicast or otherwise not global). Every name is
//!   resolved here and only its global addresses are dialled, redirects too (at most 4), so a name can't point
//!   somewhere private later.
//! - no cookies, no referrer, no proxy; 20 seconds at most; 10 MB at most, counted as it comes.
//! - a PNG, JPEG, GIF or WebP by its first bytes, whatever the server says it is (never SVG: it is a document).
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

/// A picture, in bytes (PICTURE_MAX in src/applet/files.ts).
pub const PICTURE_MAX: usize = 10 * 1024 * 1024;
const LINK_MAX: usize = 2000;
const REDIRECTS: usize = 4;

/// A name that is this device's, the local network's or the tailnet's, never the public internet's.
fn local_name(host: &str) -> bool {
    let h = host.trim_end_matches('.').to_ascii_lowercase();
    h == "localhost" || ["localhost", "local", "internal", "lan", "home.arpa", "intranet", "corp", "ts.net"].iter().any(|s| h.ends_with(&format!(".{s}")))
        || !h.contains('.')
}

/// An address on the public internet: not loopback, private, link-local, shared (CGNAT, the tailnet), documentation,
/// benchmarking, multicast, broadcast, unspecified or reserved; for IPv6 also unique-local, and an IPv4 one inside it
/// judged as IPv4.
pub fn global(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            !(v.is_loopback() || v.is_private() || v.is_link_local() || v.is_multicast() || v.is_broadcast() || v.is_unspecified() || v.is_documentation()
                || o[0] == 0 || (o[0] == 100 && (o[1] & 0xc0) == 64) || (o[0] == 192 && o[1] == 0 && o[2] == 0) || (o[0] == 198 && (o[1] & 0xfe) == 18) || o[0] >= 240)
        }
        IpAddr::V6(v) => {
            if let Some(v4) = v.to_ipv4_mapped() {
                return global(IpAddr::V4(v4));
            }
            let s = v.segments();
            !(v.is_loopback() || v.is_unspecified() || v.is_multicast() || (s[0] & 0xfe00) == 0xfc00 || (s[0] & 0xffc0) == 0xfe80
                || (s[0] == 0x2001 && s[1] == 0x0db8) || (s[0] == 0x64 && s[1] == 0xff9b) || (s[0] == 0x2002) || (s[0] == 0x2001 && s[1] < 0x200))
        }
    }
}

/// A web picture's address that may be fetched: http or https, at most 2,000 bytes, nothing hidden or spaced in it, a
/// public name or a global address written out. The address, parsed.
pub fn checked(raw: &str) -> Result<url::Url, String> {
    let refuse = || Err("Only a picture on the public web can be loaded".to_string());
    if raw.is_empty() || raw.len() > LINK_MAX || raw.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return refuse();
    }
    let Ok(u) = url::Url::parse(raw) else { return refuse() };
    if !matches!(u.scheme(), "http" | "https") || !u.username().is_empty() || u.password().is_some() {
        return refuse();
    }
    match u.host() {
        Some(url::Host::Domain(d)) if !local_name(d) => Ok(u),
        Some(url::Host::Ipv4(ip)) if global(IpAddr::V4(ip)) => Ok(u),
        Some(url::Host::Ipv6(ip)) if global(IpAddr::V6(ip)) => Ok(u),
        _ => refuse(),
    }
}

/// What the first bytes say a picture is: one of the four it may be, or none.
pub fn sniff(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if b.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if b.len() >= 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/// Resolves a name and keeps only its global addresses; none left is a refusal.
struct PublicOnly;
impl reqwest::dns::Resolve for PublicOnly {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            if local_name(&host) {
                return Err("not a public name".into());
            }
            let found: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0)).await?.filter(|a| global(a.ip())).collect();
            if found.is_empty() {
                return Err("no public address".into());
            }
            Ok(Box::new(found.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

fn client() -> Result<reqwest::Client, String> {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let provider = rustls::crypto::CryptoProvider::get_default().cloned().unwrap_or_else(|| Arc::new(rustls::crypto::ring::default_provider()));
    let tls = rustls::ClientConfig::builder_with_provider(provider).with_safe_default_protocol_versions().map_err(|e| e.to_string())?.with_root_certificates(roots).with_no_client_auth();
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= REDIRECTS || checked(attempt.url().as_str()).is_err() {
            attempt.error("a redirect somewhere it may not go")
        } else {
            attempt.follow()
        }
    });
    reqwest::Client::builder()
        .tls_backend_preconfigured(tls)
        .dns_resolver(Arc::new(PublicOnly))
        .redirect(policy)
        .no_proxy()
        .referer(false)
        .timeout(Duration::from_secs(20))
        .user_agent("Mozilla/5.0 (compatible; Parachute)")
        .build()
        .map_err(|e| e.to_string())
}

/// The picture's bytes, checked (above). The type is the web side's to read again from the same first bytes.
pub async fn fetch(raw: &str) -> Result<Vec<u8>, String> {
    let url = checked(raw)?;
    let mut res = client()?
        .get(url)
        .header(reqwest::header::ACCEPT, "image/png,image/jpeg,image/gif,image/webp;q=0.9,*/*;q=0.1")
        .send()
        .await
        .map_err(|_| "The picture couldn't be loaded".to_string())?;
    if !res.status().is_success() {
        return Err(format!("The picture's server said {}", res.status().as_u16()));
    }
    if res.content_length().is_some_and(|n| n as usize > PICTURE_MAX) {
        return Err("The picture is over 10 MB".into());
    }
    let mut out = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|_| "The picture couldn't be loaded".to_string())? {
        out.extend_from_slice(&chunk);
        if out.len() > PICTURE_MAX {
            return Err("The picture is over 10 MB".into());
        }
    }
    if sniff(&out).is_none() {
        return Err("It isn't a PNG, JPEG, GIF or WebP picture".into());
    }
    Ok(out)
}

/// The command: a web picture's bytes, as an ArrayBuffer on the web side.
#[tauri::command]
pub async fn web_picture(url: String) -> Result<tauri::ipc::Response, String> {
    fetch(&url).await.map(tauri::ipc::Response::new)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_public_web() {
        for ok in ["https://cdn.example.com/a.png", "http://93.184.215.14/x.gif", "https://[2606:2800:21f:cb07:6820:80da:af6b:8b2c]/p.jpg"] {
            assert!(checked(ok).is_ok(), "{ok}");
        }
        for bad in [
            "https://localhost/a.png", "http://127.0.0.1/a.png", "http://10.0.0.1/", "http://192.168.1.1/", "http://172.16.5.4/", "http://169.254.169.254/latest",
            "http://100.101.102.103/", "https://uni.tail1234.ts.net/x.png", "https://printer.local/x.png", "https://box.internal/", "http://[::1]/", "http://[fd00::1]/",
            "http://[fe80::1]/", "http://[::ffff:127.0.0.1]/", "http://0.0.0.0/", "https://intranet/x.png", "file:///etc/passwd", "ftp://x.example.com/a.png",
            "https://user:pw@cdn.example.com/a.png", "https://cdn.example.com/a b.png", "data:image/png;base64,AAAA", "http://224.0.0.1/", "http://255.255.255.255/",
        ] {
            assert!(checked(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_picture_by_its_first_bytes() {
        assert_eq!(sniff(b"\x89PNG\r\n\x1a\nrest"), Some("image/png"));
        assert_eq!(sniff(&[0xff, 0xd8, 0xff, 0xe0]), Some("image/jpeg"));
        assert_eq!(sniff(b"GIF89a.."), Some("image/gif"));
        assert_eq!(sniff(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(sniff(b"<svg xmlns=\"http://www.w3.org/2000/svg\"><script>x</script></svg>"), None);
        assert_eq!(sniff(b"<html>"), None);
    }

    #[tokio::test]
    async fn a_name_that_points_somewhere_private_is_refused() {
        // localhost resolves to loopback on every machine: the resolver keeps no address, so nothing is dialled
        let r = PublicOnly;
        let name: reqwest::dns::Name = "localhost.".parse().unwrap();
        assert!(reqwest::dns::Resolve::resolve(&r, name).await.is_err());
        assert!(fetch("http://127.0.0.1:9/x.png").await.is_err());
    }
}
