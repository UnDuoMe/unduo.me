//! Find the address of the first image in copied HTML, as `DOMParser` +
//! `querySelector("img")` would. Browsers copy an image as `<img src="…">`.

/// Decode the character references that appear in copied attribute values.
fn decode_entities(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        rest = &rest[start..];
        let end = rest.find(';').filter(|&end| end <= 10);
        let decoded = end.and_then(|end| {
            let name = &rest[1..end];
            let character = match name {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some('\u{a0}'),
                _ => name
                    .strip_prefix("#x")
                    .or_else(|| name.strip_prefix("#X"))
                    .map(|hex| u32::from_str_radix(hex, 16))
                    .or_else(|| name.strip_prefix('#').map(str::parse::<u32>))
                    .and_then(Result::ok)
                    .and_then(char::from_u32),
            };
            character.map(|character| (character, end))
        });
        match decoded {
            Some((character, end)) => {
                out.push(character);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn without_comments(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(start) = rest.find("<!--") {
        out.push_str(&rest[..start]);
        rest = match rest[start + 4..].find("-->") {
            Some(end) => &rest[start + 4 + end + 3..],
            None => "",
        };
    }
    out.push_str(rest);
    out
}

/// The `src` of the first `<img>` element, if any.
pub fn first_image_source(html: &str) -> Option<String> {
    let html = without_comments(html);
    let lower = html.to_ascii_lowercase();
    let mut search = 0;
    while let Some(found) = lower[search..].find("<img") {
        let start = search + found + 4;
        search = start;
        if !matches!(
            lower.as_bytes().get(start),
            Some(b' ' | b'\t' | b'\n' | b'\r' | b'\x0c' | b'/' | b'>')
        ) {
            continue;
        }
        let bytes = html.as_bytes();
        let mut i = start;
        loop {
            while i < bytes.len() && (bytes[i].is_ascii_whitespace() || bytes[i] == b'/') {
                i += 1;
            }
            if i >= bytes.len() || bytes[i] == b'>' {
                break;
            }
            let name_start = i;
            while i < bytes.len() && !bytes[i].is_ascii_whitespace() && !b"/>=".contains(&bytes[i]) {
                i += 1;
            }
            let name = &lower[name_start..i];
            while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                i += 1;
            }
            let mut value = None;
            if i < bytes.len() && bytes[i] == b'=' {
                i += 1;
                while i < bytes.len() && bytes[i].is_ascii_whitespace() {
                    i += 1;
                }
                let (begin, end) = match bytes.get(i) {
                    Some(&quote @ (b'"' | b'\'')) => {
                        let begin = i + 1;
                        let end = html[begin..]
                            .find(quote as char)
                            .map_or(bytes.len(), |n| begin + n);
                        i = (end + 1).min(bytes.len());
                        (begin, end)
                    }
                    _ => {
                        let begin = i;
                        while i < bytes.len() && !bytes[i].is_ascii_whitespace() && bytes[i] != b'>' {
                            i += 1;
                        }
                        (begin, i)
                    }
                };
                value = Some(&html[begin..end]);
            }
            if name == "src" {
                return value.map(decode_entities);
            }
        }
        // The first image has no src, like `querySelector("img")?.getAttribute("src")`.
        return None;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::first_image_source;

    #[test]
    fn reads_copied_images() {
        let copied = r#"<meta charset='utf-8'><img src="https://api-1.duosecurity.com/frame/qr?value=A&amp;b=1" alt="QR">"#;
        assert_eq!(
            first_image_source(copied).as_deref(),
            Some("https://api-1.duosecurity.com/frame/qr?value=A&b=1")
        );
        assert_eq!(
            first_image_source("<IMG ALT=x SRC='a&#x2F;b&#47;c'>").as_deref(),
            Some("a/b/c")
        );
        assert_eq!(first_image_source("<img src=plain>").as_deref(), Some("plain"));
        assert_eq!(
            first_image_source("<!-- <img src=hidden> --><img src=shown>").as_deref(),
            Some("shown")
        );
        assert_eq!(first_image_source("<imgx src=a><img alt=b>"), None);
        assert_eq!(first_image_source("<p>text</p>"), None);
        assert_eq!(
            first_image_source("<img src=\"unterminated").as_deref(),
            Some("unterminated")
        );
    }
}
