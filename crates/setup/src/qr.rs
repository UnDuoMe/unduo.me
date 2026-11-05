//! The `read` export, with the `qr-reader` feature: the text of every QR code in
//! a grayscale image. The page reads QR codes itself and doesn't use it, and the
//! published module is built without it, so the plugin never gets pixels.

/// The longest side the page sends; it scales larger images down first.
pub const MAX_SIDE: usize = 1920;
/// At most this many codes are returned.
pub const MAX_CODES: usize = 16;

struct Area {
    x: usize,
    y: usize,
    width: usize,
    height: usize,
}

/// The text of each QR code found in `area`, if it isn't already in `texts`.
fn read_area(luma: &[u8], width: usize, area: &Area, invert: bool, texts: &mut Vec<String>) {
    let mut image = rqrr::PreparedImage::prepare_from_greyscale(area.width, area.height, |x, y| {
        let value = luma[(area.y + y) * width + area.x + x];
        if invert { 255 - value } else { value }
    });
    for grid in image.detect_grids() {
        let Ok((_, text)) = grid.decode() else { continue };
        if texts.len() < MAX_CODES && !texts.contains(&text) {
            texts.push(text);
        }
    }
}

/// The text of every QR code in `luma`, one byte per pixel, row by row. Dark
/// codes on a light background come first; inverted codes are tried only when
/// none are found. Impossible dimensions hold no codes.
pub fn read(luma: &[u8], width: usize, height: usize) -> Vec<String> {
    if width == 0 || height == 0 || width.max(height) > MAX_SIDE || luma.len() != width * height {
        return Vec::new();
    }
    // A detector can confuse finder patterns that belong to different QR codes.
    // Inspect the whole image first, then two overlapping parts of its longest side.
    let mut areas = vec![Area {
        x: 0,
        y: 0,
        width,
        height,
    }];
    if width >= height && width > 1 {
        let part = (width * 3).div_ceil(5);
        areas.push(Area {
            x: 0,
            y: 0,
            width: part,
            height,
        });
        areas.push(Area {
            x: width - part,
            y: 0,
            width: part,
            height,
        });
    } else if height > 1 {
        let part = (height * 3).div_ceil(5);
        areas.push(Area {
            x: 0,
            y: 0,
            width,
            height: part,
        });
        areas.push(Area {
            x: 0,
            y: height - part,
            width,
            height: part,
        });
    }
    let mut texts = Vec::new();
    for invert in [false, true] {
        for area in &areas {
            read_area(luma, width, area, invert, &mut texts);
        }
        if !texts.is_empty() {
            break;
        }
    }
    texts
}

/// The export's input: width and height as little-endian u32s, then the
/// pixels. Malformed input holds no codes.
pub fn read_input(input: &[u8]) -> Vec<String> {
    let word = |at: usize| {
        input
            .get(at..at + 4)
            .map(|bytes| u32::from_le_bytes(bytes.try_into().unwrap()) as usize)
    };
    match (word(0), word(4)) {
        (Some(width), Some(height)) => read(&input[8..], width, height),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use qrcode::{Color, QrCode};

    /// A white image with these QR codes side by side, or a black one with
    /// light codes when `inverted`.
    fn draw(payloads: &[&str], inverted: bool) -> (Vec<u8>, usize, usize) {
        let scale = 5;
        let codes: Vec<_> = payloads
            .iter()
            .map(|p| QrCode::new(p.as_bytes()).unwrap())
            .collect();
        let sizes: Vec<_> = codes.iter().map(|c| (c.width() + 8) * scale).collect();
        let width = sizes.iter().sum::<usize>() + 40 * payloads.len();
        let height = *sizes.iter().max().unwrap() + 40;
        let mut luma = vec![if inverted { 0 } else { 255 }; width * height];
        let mut left = 20;
        for (code, size) in codes.iter().zip(&sizes) {
            let colors = code.to_colors();
            let n = code.width() as isize;
            for y in 0..*size {
                for x in 0..*size {
                    let (row, col) = ((y / scale) as isize - 4, (x / scale) as isize - 4);
                    let dark = row >= 0
                        && col >= 0
                        && row < n
                        && col < n
                        && colors[(row * n + col) as usize] == Color::Dark;
                    luma[(y + 20) * width + left + x] = if dark != inverted { 0 } else { 255 };
                }
            }
            left += size + 40;
        }
        (luma, width, height)
    }

    const VALUE: &str = "https://api-12345678.duosecurity.com/frame/qr?value=TESTCODE123-YXBp";

    #[test]
    fn reads_a_code() {
        let (luma, width, height) = draw(&[VALUE], false);
        assert_eq!(read(&luma, width, height), [VALUE]);
    }

    #[test]
    fn reads_inverted_codes() {
        let (luma, width, height) = draw(&[VALUE], true);
        assert_eq!(read(&luma, width, height), [VALUE]);
    }

    #[test]
    fn reads_every_code_once() {
        let (luma, width, height) = draw(&["https://university.example/help", VALUE], false);
        let mut texts = read(&luma, width, height);
        texts.sort();
        assert_eq!(texts, [VALUE, "https://university.example/help"]);
    }

    #[test]
    fn reads_the_export_input() {
        let (luma, width, height) = draw(&[VALUE], false);
        let mut input = [(width as u32).to_le_bytes(), (height as u32).to_le_bytes()].concat();
        input.extend(luma);
        assert_eq!(read_input(&input), [VALUE]);
        // Truncated or inconsistent input holds no codes.
        assert!(read_input(&[1, 0]).is_empty());
        assert!(read_input(&input[..input.len() - 1]).is_empty());
    }

    #[test]
    fn finds_nothing_in_blank_or_impossible_images() {
        assert!(read(&vec![255; 100 * 100], 100, 100).is_empty());
        assert!(read(&[0; 4], 0, 1).is_empty());
        assert!(read(&[0; 4], 10, 10).is_empty());
        assert!(read(&vec![255; MAX_SIDE + 1], MAX_SIDE + 1, 1).is_empty());
    }
}
