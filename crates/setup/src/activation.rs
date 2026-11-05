//! Normalize anything a user can copy from Duo into a `CODE-BASE64HOST` value.
//! Pure parsing: nothing is fetched. Ported from `packages/me/unduo/lib/activation`.

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD};
use regex_lite::Regex;
use std::sync::LazyLock;
use url::Url;

const MAX_INPUT: usize = 4096;
const NOT_ACTIVATION: &str =
    "That isn't a Duo activation code. Copy the QR code from your Duo portal's “Add a device” screen.";

static CANDIDATE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)(?:https://|duo://)[^\s<>"')\]]+"#).unwrap());

pub type Result<T> = std::result::Result<T, String>;

fn fail<T>(message: &str) -> Result<T> {
    Err(message.to_string())
}

/// Duo's eight-character account ID between a prefix and `.duosecurity.com`,
/// e.g. `api-1234abcd.duosecurity.com`. The page's guard accepts only this
/// shape, so a host cannot carry other data in its DNS lookup.
fn duo_host_id<'a>(host: &'a str, prefix: &str) -> Option<&'a str> {
    let id = host.strip_prefix(prefix)?.strip_suffix(".duosecurity.com")?;
    let valid = id.len() == 8 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit());
    valid.then_some(id)
}

fn is_code(code: &str) -> bool {
    (5..=128).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// `/activate/CODE`, `/android/CODE` and `/iphone/CODE` all embed the same activation.
fn mobile_code(path: &str) -> Option<&str> {
    let rest = ["/activate/", "/android/", "/iphone/"]
        .iter()
        .find_map(|prefix| path.strip_prefix(prefix))?;
    let code = rest.strip_suffix('/').unwrap_or(rest);
    is_code(code).then_some(code)
}

fn is_base64_host(encoded: &str) -> bool {
    let body = encoded.trim_end_matches('=');
    encoded.len() - body.len() <= 2
        && !body.is_empty()
        && body
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'_' | b'-'))
}

fn decode_host(encoded: &str) -> Result<String> {
    let standard = encoded.replace('-', "+").replace('_', "/");
    let standard = standard.trim_end_matches('=');
    let padded = format!("{standard}{}", "=".repeat((4 - standard.len() % 4) % 4));
    STANDARD
        .decode(padded)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .map(|host| host.to_lowercase())
        .ok_or_else(|| "The activation code contains an invalid Duo host.".to_string())
}

fn encode_value(code: &str, host: &str) -> String {
    format!("{code}-{}", STANDARD_NO_PAD.encode(host))
}

/// Split and validate a `CODE-BASE64HOST` value. Only Duo API hosts are accepted.
/// Returns the code and the API host.
pub fn parse_activation_value(value: &str) -> Result<(String, String)> {
    let Some((code, encoded)) = value.split_once('-') else {
        return fail(NOT_ACTIVATION);
    };
    if !is_code(code) || !is_base64_host(encoded) {
        return fail(NOT_ACTIVATION);
    }
    let host = decode_host(encoded)?;
    if duo_host_id(&host, "api-").is_none() {
        return fail("The activation code must point to a Duo API host (api-….duosecurity.com).");
    }
    Ok((code.to_string(), host))
}

fn parse_url(text: &str, depth: u8) -> Result<String> {
    let url = Url::parse(text).map_err(|_| {
        "That link is incomplete. Copy the whole QR image address or activation link.".to_string()
    })?;
    let host = url.host_str().unwrap_or("").to_lowercase();
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return fail(NOT_ACTIVATION);
    }
    if duo_host_id(&host, "api-").is_some() {
        // The QR image address: `https://api-…/frame/qr?value=<the QR's text>`.
        let Some((_, value)) = url.query_pairs().find(|(key, _)| key == "value") else {
            return fail(
                "That's a Duo page, not the QR code. Right-click the QR code and copy the image or its address.",
            );
        };
        if value.is_empty() {
            return fail(
                "That's a Duo page, not the QR code. Right-click the QR code and copy the image or its address.",
            );
        }
        // Form decoding turns a literal `+` from the base64 host into a space.
        return parse_activation_text(&value.replace(' ', "+"), depth + 1);
    }
    if let (Some(id), Some(code)) = (duo_host_id(&host, "m-"), mobile_code(url.path())) {
        // What the QR code itself contains, and what Duo emails.
        return Ok(encode_value(code, &format!("api-{id}.duosecurity.com")));
    }
    if host.ends_with(".duosecurity.com") {
        return fail(
            "That Duo link isn't an activation link. Copy the QR code shown after choosing “I have Duo Mobile installed”.",
        );
    }
    fail("That's not a Duo link. Sign in to your Duo portal, add a device, then copy the QR code it shows.")
}

fn strip_prefix_ignore_case<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let head = text.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix).then(|| &text[prefix.len()..])
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = text.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn parse_activation_text(input: &str, depth: u8) -> Result<String> {
    if depth > 2 {
        return fail(NOT_ACTIVATION);
    }
    let mut text = input.trim().to_string();
    if strip_prefix_ignore_case(&text, "duo%3a%2f%2f").is_some() {
        text = percent_decode(&text).ok_or_else(|| NOT_ACTIVATION.to_string())?;
    }
    if let Some(rest) = strip_prefix_ignore_case(&text, "duo://") {
        text = rest.to_string();
    }
    if strip_prefix_ignore_case(&text, "https://").is_some()
        || strip_prefix_ignore_case(&text, "http://").is_some()
    {
        return parse_url(&text, depth);
    }
    let (code, host) = parse_activation_value(&text)?;
    Ok(encode_value(&code, &host))
}

/// Accepts the QR image address, the QR's decoded text (`https://m-…/activate/CODE`
/// or `duo://CODE-HOST`), activation links from Duo emails, raw values, and any
/// of these inside a pasted message.
pub fn parse_activation_input(input: &str) -> Result<String> {
    let text = input.trim();
    if text.is_empty() {
        return fail("Paste the QR code, its image address, or your activation link.");
    }
    if text.encode_utf16().count() > MAX_INPUT {
        return fail("That's too long to be a Duo activation link.");
    }
    parse_activation_text(text, 0).or_else(|error| {
        // Pasted email or chat text: use the first Duo activation link inside it.
        if text.chars().any(char::is_whitespace) {
            for candidate in CANDIDATE.find_iter(text) {
                // Sentences often end right after a link.
                let link = candidate
                    .as_str()
                    .trim_end_matches(['.', ',', ';', ':', '!', '?']);
                if let Ok(value) = parse_activation_text(link, 0) {
                    return Ok(value);
                }
            }
        }
        Err(error)
    })
}

/// Parse, returning `None` instead of a message.
pub fn try_parse_activation(text: Option<&str>) -> Option<String> {
    text.and_then(|text| parse_activation_input(text).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALUE: &str = "TESTCODE123-YXBpLTEyMzQ1Njc4LmR1b3NlY3VyaXR5LmNvbQ";

    #[test]
    fn accepts_every_copyable_format() {
        for input in [
            VALUE,
            "TESTCODE123-YXBpLTEyMzQ1Njc4LmR1b3NlY3VyaXR5LmNvbQ==",
            "duo://TESTCODE123-YXBpLTEyMzQ1Njc4LmR1b3NlY3VyaXR5LmNvbQ",
            "duo%3A%2F%2FTESTCODE123-YXBpLTEyMzQ1Njc4LmR1b3NlY3VyaXR5LmNvbQ",
            "https://m-12345678.duosecurity.com/activate/TESTCODE123",
            "https://m-12345678.duosecurity.com/android/TESTCODE123/",
            "https://M-12345678.DUOSECURITY.COM/iphone/TESTCODE123",
            "https://api-12345678.duosecurity.com/frame/qr?value=TESTCODE123-YXBpLTEyMzQ1Njc4LmR1b3NlY3VyaXR5LmNvbQ",
            "https://api-12345678.duosecurity.com/frame/qr?value=duo%3A%2F%2FTESTCODE123-YXBpLTEyMzQ1Njc4LmR1b3NlY3VyaXR5LmNvbQ",
            "  https://m-12345678.duosecurity.com/activate/TESTCODE123  ",
            "Your link: https://m-12345678.duosecurity.com/activate/TESTCODE123. Thanks!",
        ] {
            assert_eq!(parse_activation_input(input).as_deref(), Ok(VALUE), "{input}");
        }
    }

    #[test]
    fn restores_plus_signs_that_form_decoding_turned_into_spaces() {
        // Valid API hosts never encode to `+`, but a literal `+` must reach the
        // base64 decoder (and fail there) rather than be rejected as a space.
        let address = "https://api-12345678.duosecurity.com/frame/qr?value=ABCDE12345-++++";
        assert_eq!(
            parse_activation_input(address),
            Err("The activation code contains an invalid Duo host.".into())
        );
    }

    #[test]
    fn rejects_unsafe_and_unrelated_input() {
        for (input, message) in [
            ("", "Paste the QR code"),
            (
                "https://evil.example/?value=TESTCODE123-YXBpLTEyMzQ1Njc4LmR1b3NlY3VyaXR5LmNvbQ",
                "not a Duo link",
            ),
            (
                "http://m-12345678.duosecurity.com/activate/TESTCODE123",
                "isn't a Duo activation code",
            ),
            (
                "https://user@m-12345678.duosecurity.com/activate/TESTCODE123",
                "isn't a Duo activation code",
            ),
            (
                "https://m-12345678.duosecurity.com:8443/activate/TESTCODE123",
                "isn't a Duo activation code",
            ),
            ("https://api-12345678.duosecurity.com/frame/qr", "not the QR code"),
            (
                "https://m-12345678.duosecurity.com/manage",
                "isn't an activation link",
            ),
            ("TESTCODE123-bG9jYWxob3N0", "must point to a Duo API host"),
            ("duo://TESTCODE123-bG9jYWxob3N0", "must point to a Duo API host"),
            ("https://", "incomplete"),
            ("TEST-%%%%", "isn't a Duo activation code"),
        ] {
            let error = parse_activation_input(input).unwrap_err();
            assert!(error.contains(message), "{input}: {error}");
        }
        assert!(
            parse_activation_input(&"A".repeat(4097))
                .unwrap_err()
                .contains("too long")
        );
        // Nested image addresses stop after two levels.
        let nested = format!(
            "https://api-12345678.duosecurity.com/frame/qr?value=https://api-12345678.duosecurity.com/frame/qr?value=https://api-12345678.duosecurity.com/frame/qr?value={VALUE}"
        );
        assert!(parse_activation_input(&nested).is_err());
    }

    #[test]
    fn validates_values() {
        assert_eq!(
            parse_activation_value(VALUE),
            Ok(("TESTCODE123".into(), "api-12345678.duosecurity.com".into()))
        );
        assert!(parse_activation_value("ABCD-YXBpLTEyMzQ1Njc4LmR1b3NlY3VyaXR5LmNvbQ").is_err());
        assert!(parse_activation_value("TESTCODE123").is_err());
        // Duo account IDs are eight characters, so a host cannot carry more.
        for host in ["api-1234567.duosecurity.com", "api-123456789.duosecurity.com"] {
            let error = parse_activation_value(&encode_value("TESTCODE123", host)).unwrap_err();
            assert!(error.contains("must point to a Duo API host"), "{host}: {error}");
        }
        assert!(parse_activation_input("https://m-123456789.duosecurity.com/activate/TESTCODE123").is_err());
    }
}
