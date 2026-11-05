//! The browser's direct-to-Duo form. The plugin names only the activation URL;
//! the host checks it and fills in Duo Mobile's device fields and its own key.

use crate::activation::{parse_activation_input, parse_activation_value};
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct DuoRequest {
    pub url: String,
}

/// The Duo Mobile activation URL for an activation link or value.
pub fn activation_request(value: &str) -> Result<DuoRequest, String> {
    let value = parse_activation_input(value)?;
    let (code, host) = parse_activation_value(&value)?;
    Ok(DuoRequest {
        url: format!("https://{host}/push/v2/activation/{code}?customer_protocol=1"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_duo_mobile_activation_url() {
        let request = activation_request("https://m-12345678.duosecurity.com/activate/TESTCODE123").unwrap();
        assert_eq!(
            request.url,
            "https://api-12345678.duosecurity.com/push/v2/activation/TESTCODE123?customer_protocol=1"
        );
        assert!(activation_request("nope").is_err());
    }
}
