//! An address the page opens with may name a step and code type, form-encoded
//! like a query: `#step=add&type=totp`. The plugin only reads it, and the page
//! never changes its address after opening. The activation value and key are a
//! [`Session`] in the plugin model, which the host keeps in memory. They never
//! reach the address, history state or browser storage.

use crate::response::Account;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Step {
    Qr,
    Activate,
    Add,
}

/// Public navigation fields: the step and the code type, serialized as `type`
/// and only ever `totp`. The host accepts no other hash.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Search {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<Step>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub totp: Option<Totp>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Totp {
    Totp,
}

/// Sensitive progress: the activation value, whether it was sent, and the
/// account. Held only in memory; reloading or closing the tab discards it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Session {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub submitted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<Account>,
}

/// Keep only valid public fields from untrusted input.
pub fn validate_search(data: &Map<String, Value>) -> Search {
    let step = match data.get("step").and_then(Value::as_str) {
        Some("qr") => Some(Step::Qr),
        Some("activate") => Some(Step::Activate),
        Some("add") => Some(Step::Add),
        _ => None,
    };
    let totp = (data.get("type").and_then(Value::as_str) == Some("totp")).then_some(Totp::Totp);
    Search { step, totp }
}

/// Hashes and queries are untrusted input: keep only valid public fields. Reads
/// `#step=…`, `?step=…` and the legacy `#/?step=…`; anything else, including
/// the earlier base64 hashes, yields no fields.
pub fn parse_search(text: &str) -> Search {
    let query = text.trim_start_matches(['#', '/', '?']);
    let mut data = Map::new();
    for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
        data.insert(key.into_owned(), Value::String(value.into_owned()));
    }
    validate_search(&data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_public_fields() {
        let search = Search {
            step: Some(Step::Activate),
            totp: Some(Totp::Totp),
        };
        assert_eq!(parse_search("#step=activate&type=totp"), search);
    }

    #[test]
    fn drops_invalid_fields() {
        let crafted = "#step=nope&type=hotp&university=UofT&value=X&secret=Y";
        assert_eq!(parse_search(crafted), Search::default());
        // A base64 hash from before this format, carrying a session, keeps nothing.
        let old = "eyJ2ZXJzaW9uIjoxLCJzZWFyY2giOnsic3RlcCI6InFyIn0sInNlc3Npb24iOnt9fQ==";
        for hash in ["", "#", "!!!", old] {
            assert_eq!(parse_search(hash), Search::default(), "{hash}");
        }
    }

    #[test]
    fn reads_queries_and_legacy_hashes() {
        let expected = Search {
            step: Some(Step::Add),
            totp: Some(Totp::Totp),
        };
        for text in [
            "?step=add&type=totp&university=Uof%20T",
            "#/?step=add&type=totp",
            "step=add&type=totp",
        ] {
            assert_eq!(parse_search(text), expected, "{text}");
        }
        assert_eq!(parse_search("").step, None);
    }
}
