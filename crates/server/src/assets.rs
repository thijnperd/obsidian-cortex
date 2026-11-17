//! Web assets, embedded into the binary in release builds and read from disk in
//! debug builds (so the UI can be edited without recompiling).

use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "../../web"]
pub struct Assets;

pub fn get(path: &str) -> Option<(Vec<u8>, &'static str)> {
    let path = sanitize(path)?;
    let file = Assets::get(&path)?;
    Some((file.data.into_owned(), mime(&path)))
}

pub fn iter() -> impl Iterator<Item = String> {
    Assets::iter().map(|name| name.to_string())
}

/// Normalises a request path. Returns `None` for anything that could escape the
/// asset root or address a hidden file.
pub fn sanitize(raw: &str) -> Option<String> {
    let decoded = percent_decode(raw.trim_start_matches('/'))?;
    if decoded.is_empty() || decoded.len() > 512 {
        return None;
    }
    if decoded.contains('\0') || decoded.contains('\\') || decoded.starts_with('/') {
        return None;
    }
    if decoded.split('/').any(|segment| {
        segment.is_empty() || segment == "." || segment == ".." || segment.starts_with('.')
    }) {
        return None;
    }
    Some(decoded)
}

fn percent_decode(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = raw.get(index + 1..index + 3)?;
            let value = u8::from_str_radix(hex, 16).ok()?;
            if value == 0 {
                return None;
            }
            out.push(value);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

pub fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_paths() {
        assert_eq!(sanitize("/index.html").as_deref(), Some("index.html"));
        assert_eq!(sanitize("/js/main.js").as_deref(), Some("js/main.js"));
        assert!(sanitize("/../Cargo.toml").is_none());
        assert!(sanitize("/%2e%2e/secret").is_none());
        assert!(sanitize("/js/%2e%2e/main.js").is_none());
        assert!(sanitize("/.env").is_none());
        assert!(sanitize("/css/..%2f..%2fx").is_none());
        assert!(sanitize("").is_none());
    }

    #[test]
    fn embedded_assets_exist() {
        assert!(get("index.html").is_some());
        assert!(get("styles.css").is_some());
        assert_eq!(get("index.html").unwrap().1, "text/html; charset=utf-8");
    }
}
