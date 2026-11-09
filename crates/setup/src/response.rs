//! Parse Duo's activation reply as pasted by the user and build the authenticator
//! account. Ported from `packages/me/unduo/lib/activation/activation-response.ts`.

use regex_lite::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::LazyLock;

/// Duo's reply embeds the organization's logo, so allow generous sizes.
pub const MAX_RESPONSE_LENGTH: usize = 2_000_000;
/// Duo's code for an activation link that is unknown, expired or already used.
const UNKNOWN_ACTIVATION: i64 = 40403;
const NOT_A_RESPONSE: &str = "That doesn't look like Duo's reply. Click in Duo's reply, select everything (Ctrl+A or ⌘A), copy it, then paste it here.";
/// Duo's reply didn't turn on time-based codes, the only kind UnDuo exports.
pub const UNSUPPORTED: &str = "Your organization's Duo is using an unsupported setting :(";

static RESPONSE_KEY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#""?\b(?:hotp_secret|stat)\b"?\s*:?"#).unwrap());
static RESPONSE_STATUS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b(?:OK|FAIL)\b").unwrap());
static CUSTOMER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)(?:^|[\s"{,])customer_name"?[\s:]*(?:"([^"\n]*)"|([^\n]*))"#).unwrap()
});

/// What a time-based authenticator needs: the organization and the unpadded
/// base32 secret.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Account {
    pub customer: String,
    pub secret: String,
}

/// Why an import failed, and whether the user needs a fresh QR code.
#[derive(Debug, PartialEq)]
pub struct ReplyError {
    pub message: String,
    pub needs_new_code: bool,
}

impl ReplyError {
    fn other(message: &str) -> Self {
        Self {
            message: message.into(),
            needs_new_code: false,
        }
    }
}

fn js_length(text: &str) -> usize {
    text.encode_utf16().count()
}

fn parse_json(text: &str) -> Option<Value> {
    serde_json::from_str(text).ok().or_else(|| {
        // Browsers may add labels (e.g. Chrome's “Pretty-print”) around the JSON.
        let start = text.find('{')?;
        let end = text.rfind('}')?;
        (end > start)
            .then(|| serde_json::from_str(&text[start..=end]).ok())
            .flatten()
    })
}

fn viewer_field(text: &str, name: &str) -> Option<(Option<String>, Option<String>)> {
    let pattern = format!(r#"(?m)(?:^|[\s"{{,]){name}"?[\s:]*(?:"([^"\n]*)"|([^\s",}}]+))"#);
    let captures = Regex::new(&pattern).ok()?.captures(text)?;
    let group = |index| captures.get(index).map(|m| m.as_str().to_string());
    Some((group(1), group(2)))
}

/// Firefox's JSON viewer copies `key: value` lines instead of JSON.
fn parse_viewer_text(text: &str) -> Value {
    let status = viewer_field(text, "stat").and_then(|(quoted, bare)| quoted.or(bare));
    if status.as_deref() == Some("FAIL") {
        let code = viewer_field(text, "code")
            .and_then(|(_, bare)| bare)
            .and_then(|code| code.parse::<f64>().ok())
            .filter(|code| code.fract() == 0.0);
        let message = viewer_field(text, "message").and_then(|(quoted, _)| quoted);
        let mut failure = serde_json::json!({ "stat": "FAIL" });
        if let Some(code) = code {
            failure["code"] = code.into();
        }
        if let Some(message) = message {
            failure["message"] = message.into();
        }
        return failure;
    }
    let secret = viewer_field(text, "hotp_secret").and_then(|(quoted, bare)| quoted.or(bare));
    let customer = CUSTOMER
        .captures(text)
        .and_then(|c| {
            c.get(1)
                .or_else(|| c.get(2))
                .map(|m| m.as_str().trim().to_string())
        })
        .unwrap_or_default();
    let mut data = serde_json::json!({
        "stat": status,
        "response": { "customer_name": customer, "hotp_secret": secret },
    });
    if let Some((quoted, bare)) = viewer_field(text, "use_totp") {
        data["response"]["use_totp"] = match (quoted, bare.as_deref()) {
            (None, Some("true")) => Value::Bool(true),
            (None, Some("false")) => Value::Bool(false),
            _ => Value::Null,
        };
    }
    data
}

/// True when pasted text is plausibly Duo's activation reply rather than a link.
pub fn looks_like_duo_response(text: &str) -> bool {
    RESPONSE_KEY.is_match(text) && RESPONSE_STATUS.is_match(text)
}

fn string_up_to(value: Option<&Value>, min: usize, max: usize) -> Option<&str> {
    let text = value?.as_str()?;
    (min..=max).contains(&js_length(text)).then_some(text)
}

/// A JSON number that is a safe integer, as `z.number().int()` requires.
fn safe_integer(value: &Value) -> Option<i64> {
    let number = value.as_f64()?;
    (number.fract() == 0.0 && number.abs() <= 9_007_199_254_740_991.0).then_some(number as i64)
}

/// RFC 4648 base32 without padding, as authenticator apps expect.
pub fn base32(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut out = String::with_capacity(bytes.len().div_ceil(5) * 8);
    let (mut buffer, mut bits) = (0u32, 0u32);
    for &byte in bytes {
        buffer = (buffer << 8) | u32::from(byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(ALPHABET[((buffer >> bits) & 31) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(ALPHABET[((buffer << (5 - bits)) & 31) as usize] as char);
    }
    out
}

fn duo_error(code: Option<i64>, message: Option<&str>) -> ReplyError {
    if code == Some(UNKNOWN_ACTIVATION) {
        return ReplyError {
            message: "Duo didn't accept this QR code: it has expired or was already used. Each code works once — create a new one in your Duo portal.".into(),
            needs_new_code: true,
        };
    }
    let detail: String = message
        .unwrap_or("")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(200)
        .collect();
    let detail = if detail.is_empty() {
        String::new()
    } else {
        format!(": “{detail}”")
    };
    let code = code.map(|code| format!(" (error {code})")).unwrap_or_default();
    ReplyError {
        message: format!(
            "Duo didn't activate the device{detail}{code}. Your organization may not allow adding devices this way."
        ),
        needs_new_code: false,
    }
}

/// Returns only what an authenticator needs. Fails with Duo's reason when the
/// activation failed. Never evaluates code or echoes pasted credentials.
pub fn parse_activation_response(text: &str) -> Result<Account, ReplyError> {
    if js_length(text) > MAX_RESPONSE_LENGTH {
        return Err(ReplyError::other(
            "That's too long to be Duo's reply. Copy only the text of Duo's reply.",
        ));
    }
    let data = parse_json(text)
        .or_else(|| looks_like_duo_response(text).then(|| parse_viewer_text(text)))
        .ok_or_else(|| ReplyError::other(NOT_A_RESPONSE))?;
    let stat = data.get("stat").and_then(Value::as_str);
    if stat == Some("OK") {
        let response = data.get("response").filter(|value| value.is_object());
        let customer = string_up_to(response.and_then(|r| r.get("customer_name")), 0, 4096);
        let secret = string_up_to(response.and_then(|r| r.get("hotp_secret")), 1, 4096);
        if let (Some(customer), Some(secret)) = (customer, secret) {
            // Duo Mobile reads `use_totp` and makes counter-based codes when
            // it is false or missing. UnDuo makes only time-based codes.
            match response.and_then(|r| r.get("use_totp")) {
                Some(Value::Bool(true)) => {}
                None | Some(Value::Bool(false)) => return Err(ReplyError::other(UNSUPPORTED)),
                _ => return Err(ReplyError::other(NOT_A_RESPONSE)),
            }
            let customer = customer.trim();
            return Ok(Account {
                customer: if customer.is_empty() {
                    "Duo".into()
                } else {
                    customer.into()
                },
                secret: base32(secret.as_bytes()),
            });
        }
    }
    if stat == Some("FAIL") {
        // Like zod's `.optional()`: a missing field is fine, but `null` is not.
        let code = data
            .get("code")
            .map_or(Some(None), |value| safe_integer(value).map(Some));
        let message = data
            .get("message")
            .map_or(Some(None), |value| string_up_to(Some(value), 0, 1000).map(Some));
        if let (Some(code), Some(message)) = (code, message) {
            return Err(duo_error(code, message));
        }
    }
    Err(ReplyError::other(NOT_A_RESPONSE))
}

/// Encode a URI component as JavaScript's `encodeURIComponent` does.
fn encode_component(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// A Key URI Format link for time-based codes: SHA-1, six digits, 30 seconds.
pub fn otpauth_uri(account: &Account) -> String {
    let label = format!("Duo:{}", encode_component(&account.customer));
    format!(
        "otpauth://totp/{label}?secret={}&issuer=Duo&algorithm=SHA1&digits=6&period=30",
        account.secret
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(customer: &str, secret: &str) -> String {
        serde_json::json!({ "stat": "OK", "response": { "customer_name": customer, "hotp_secret": secret, "use_totp": true } })
            .to_string()
    }

    #[test]
    fn parses_replies_as_browsers_copy_them() {
        let account = Account {
            customer: "ACME University".into(),
            secret: "ON2XAZLSONSWG4TFORVWK6I".into(),
        };
        let json = ok("ACME University", "supersecretkey");
        assert_eq!(parse_activation_response(&json), Ok(account.clone()));
        assert_eq!(
            parse_activation_response(&format!("Pretty-print\n{json}\n")),
            Ok(account.clone())
        );
        let viewer = "response\ncustomer_name: \"ACME University\"\nhotp_secret: \"supersecretkey\"\nuse_totp: true\nstat: \"OK\"";
        assert_eq!(parse_activation_response(viewer), Ok(account.clone()));
        let bare = "customer_name: ACME University\nhotp_secret: supersecretkey\nuse_totp: true\nstat: OK";
        assert_eq!(parse_activation_response(bare), Ok(account));
        assert_eq!(parse_activation_response(&ok("  ", "x")).unwrap().customer, "Duo");
    }

    #[test]
    fn refuses_replies_without_time_based_codes() {
        for flag in [Some(false), None] {
            let mut data: Value = serde_json::from_str(&ok("ACME", "secret")).unwrap();
            match flag {
                Some(flag) => data["response"]["use_totp"] = Value::Bool(flag),
                None => {
                    data["response"].as_object_mut().unwrap().remove("use_totp");
                }
            }
            let error = parse_activation_response(&data.to_string()).unwrap_err();
            assert_eq!(error, ReplyError::other(UNSUPPORTED));
            let line = flag.map(|flag| format!("use_totp: {flag}\n")).unwrap_or_default();
            let viewer = format!("customer_name: ACME\nhotp_secret: secret\n{line}stat: OK");
            assert_eq!(parse_activation_response(&viewer).unwrap_err(), error);
        }
    }

    #[test]
    fn rejects_malformed_flags() {
        for setting in [Value::Null, serde_json::json!("true"), serde_json::json!(1)] {
            let mut data: Value = serde_json::from_str(&ok("ACME", "secret")).unwrap();
            data["response"]["use_totp"] = setting;
            assert_eq!(
                parse_activation_response(&data.to_string()).unwrap_err().message,
                NOT_A_RESPONSE
            );
        }
        for flag in ["\"true\"", "null", "trueish", "1"] {
            let viewer = format!("customer_name: ACME\nhotp_secret: secret\nuse_totp: {flag}\nstat: OK");
            assert_eq!(
                parse_activation_response(&viewer).unwrap_err().message,
                NOT_A_RESPONSE
            );
        }
    }

    #[test]
    fn explains_duo_failures() {
        let used =
            parse_activation_response(r#"{"code":40403,"message":"Unknown activation code","stat":"FAIL"}"#)
                .unwrap_err();
        assert!(used.needs_new_code && used.message.contains("expired or was already used"));
        let other = parse_activation_response(
            r#"{"code":40002,"message":"Invalid   request\nparameters","stat":"FAIL"}"#,
        )
        .unwrap_err();
        assert!(!other.needs_new_code);
        assert!(
            other
                .message
                .contains("“Invalid request parameters” (error 40002)"),
            "{}",
            other.message
        );
        let viewer =
            parse_activation_response("code: 40403\nmessage: \"Unknown activation code\"\nstat: \"FAIL\"")
                .unwrap_err();
        assert!(viewer.needs_new_code);
        let bare = parse_activation_response(r#"{"stat":"FAIL"}"#).unwrap_err();
        assert_eq!(
            bare.message,
            "Duo didn't activate the device. Your organization may not allow adding devices this way."
        );
    }

    #[test]
    fn rejects_anything_else() {
        for text in [
            "",
            "hello",
            r#"{"stat":"OK"}"#,
            r#"{"stat":"OK","response":{"customer_name":"A","hotp_secret":""}}"#,
            r#"{"stat":"FAIL","code":"40403"}"#,
            r#"{"stat":"FAIL","code":1.5}"#,
            r#"{"stat":"FAIL","code":null}"#,
            "[1,2,3]",
        ] {
            assert_eq!(
                parse_activation_response(text).unwrap_err().message,
                NOT_A_RESPONSE,
                "{text}"
            );
        }
        assert!(
            parse_activation_response(&"x".repeat(MAX_RESPONSE_LENGTH + 1))
                .unwrap_err()
                .message
                .contains("too long")
        );
    }

    #[test]
    fn recognizes_replies() {
        assert!(looks_like_duo_response(r#"{"stat": "OK"}"#));
        assert!(looks_like_duo_response("hotp_secret: x\nstat: FAIL"));
        assert!(!looks_like_duo_response(
            "https://m-1.duosecurity.com/activate/ABCDE"
        ));
    }

    #[test]
    fn builds_authenticator_links() {
        assert_eq!(base32(b"supersecretkey"), "ON2XAZLSONSWG4TFORVWK6I");
        assert_eq!(base32(b""), "");
        assert_eq!(base32(b"f"), "MY");
        assert_eq!(base32(b"foobar"), "MZXW6YTBOI");
        let account = Account {
            customer: "ACME U & Co".into(),
            secret: "ABC".into(),
        };
        assert_eq!(
            otpauth_uri(&account),
            "otpauth://totp/Duo:ACME%20U%20%26%20Co?secret=ABC&issuer=Duo&algorithm=SHA1&digits=6&period=30"
        );
    }
}
