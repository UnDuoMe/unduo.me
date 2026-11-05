//! The setup flow as a state machine of four steps. The plugin keeps the model in
//! its own memory between calls: the host sends browser events, renders the
//! returned view and performs the returned effects.

use crate::activation::{parse_activation_input, try_parse_activation};
use crate::html::first_image_source;
use crate::request::{DuoRequest, activation_request};
use crate::response::{Account, looks_like_duo_response, otpauth_uri, parse_activation_response};
use crate::state::{Search, Session, Step, Totp, encode_hash, parse_search};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// Step indexes.
const PORTAL: usize = 0;
const QR: usize = 1;
const ACTIVATE: usize = 2;
const ADD: usize = 3;
const STEPS: [(&str, &str); 4] = [
    ("Open portal", "Open your Duo device portal"),
    ("Copy QR code", "Copy the activation QR code"),
    ("Activate with Duo", "Activate with Duo"),
    ("Add to authenticator", "Add it to your authenticator"),
];
const PREPARE_FAILURE: &str =
    "Your browser couldn't prepare the request. Use a current browser over HTTPS. Nothing was sent to Duo.";
/// The host waits half a second before each frame, so this is at least five minutes.
const SCAN_FRAMES: u32 = 600;
const HIDDEN_KEY: &str = "•••• •••• •••• •••• •••• ••••";
/// The most UTF-16 code units the page accepts in any string the plugin returns.
const MAX_TEXT: usize = 65_536;

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Busy {
    #[default]
    #[serde(rename = "")]
    Idle,
    Prepare,
    Image,
    Scan,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    pub message: String,
    pub needs_new_code: bool,
}

/// The activation the host is generating a key for. `start` moves to `ACTIVATE`.
#[derive(Debug, PartialEq)]
struct Preparing {
    value: String,
    start: bool,
}

/// Everything the page knows, held in the plugin's memory and never sent to
/// the host as a whole. Reloading or closing the tab discards it.
#[derive(Debug, Default)]
pub struct Model {
    search: Search,
    session: Session,
    /// The URL hash the browser shows, without `#`; `None` forces the next write.
    hash: Option<String>,
    /// The step rendered last; `None` before the first render.
    previous: Option<usize>,
    preparing: Option<Preparing>,
    /// The Duo form for an activation value, once the host has its key.
    request: Option<(String, DuoRequest)>,
    /// Values submitted in this tab, so going back cannot re-offer a used QR code.
    sent: Vec<String>,
    /// Names the image or scan frame the plugin is waiting for; older ones are dropped.
    ticket: u32,
    scan_frames: u32,
    link_error: String,
    link_busy: Busy,
    scan_note: String,
    problem: Option<Problem>,
    revealed: bool,
    copied: &'static str,
    copy_id: u32,
    copy_error: bool,
    apple: bool,
    can_scan: bool,
}

/// What happened in the browser.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Event {
    /// First render: the URL hash and query, `navigator.platform`, and whether
    /// the browser can share a screen.
    Load {
        hash: String,
        legacy: String,
        platform: String,
        scan: bool,
    },
    /// Back, Forward or an edited hash.
    Navigate {
        hash: String,
    },
    GoTo {
        step: usize,
    },
    ChangeType {
        code_type: String,
    },
    StartOver {
        step: usize,
    },
    /// A paste, drop or upload, or a submitted link or reply. `image` says the
    /// host holds an image file.
    Input {
        text: Option<String>,
        html: Option<String>,
        #[serde(default)]
        image: bool,
    },
    EditLink,
    /// The browser couldn't decode the image for `readImage`.
    Unreadable {
        ticket: u32,
    },
    /// The page read the image or screen frame for `ticket`: the text of each
    /// QR code in it, which the page read itself. The plugin never receives pixels.
    Decoded {
        ticket: u32,
        texts: Vec<String>,
    },
    ScanStarted,
    ScanSharing,
    /// Sharing failed or the user stopped it; `error` is the DOMException name.
    ScanEnded {
        #[serde(default)]
        error: String,
    },
    /// The host made a fresh key for `value`'s form, or `ok` is false. The
    /// plugin never sees the key: the host writes it into the form.
    Prepared {
        value: String,
        ok: bool,
    },
    Submitted {
        value: String,
    },
    Retry,
    Reveal,
    Copied {
        kind: String,
    },
    CopyFailed,
    CopyDone {
        id: u32,
    },
}

/// The closed list of things the plugin can ask the host to do.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Effect {
    /// Replace the URL's query and hash. The hash holds only the step and code
    /// type; `push` adds a history entry.
    WriteHash {
        hash: String,
        push: bool,
    },
    /// Generate a key pair and send `prepared` with its public key.
    Prepare {
        value: String,
    },
    /// Decode the image from the last `input` and pass its pixels to `frame`.
    ReadImage {
        ticket: u32,
    },
    /// After half a second, pass a frame of the shared screen to `frame`.
    ScanFrame {
        ticket: u32,
    },
    StopScan,
    /// Replace the text in the link or reply field and drop highlight.
    SetText {
        text: String,
    },
    /// Scroll `scroll` into view, then focus `id`.
    Focus {
        id: &'static str,
        scroll: &'static str,
    },
    /// Send `event` after `ms` milliseconds.
    Later {
        ms: u32,
        event: Value,
    },
}

/// What the page found in one image or screen frame.
struct QrResult {
    /// The first Duo activation among its QR codes, already normalized.
    value: Option<String>,
    found_qr: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressStep {
    index: usize,
    /// The number shown, counting from the page's first step.
    number: usize,
    label: &'static str,
    state: &'static str,
    finished: bool,
    reachable: bool,
    description: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    customer: String,
    /// The base32 secret for copying.
    secret: String,
    /// The secret in groups of four once revealed, else dots.
    key: String,
    revealed: bool,
    uri: String,
    qr_alt: String,
}

/// Display data, bound by the host as text, booleans and classes only. The
/// host checks `request` and `account` before they reach a form, QR code,
/// link or the clipboard.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    current: usize,
    /// The furthest reachable step: `ACTIVATE` with an activation in memory,
    /// `ADD` with an account, else `QR`.
    furthest: usize,
    title: &'static str,
    progress: Vec<ProgressStep>,
    /// The activation value at `ACTIVATE`, or "".
    value: String,
    request: Option<DuoRequest>,
    submitted: bool,
    code_type: &'static str,
    account: Option<AccountView>,
    link_error: String,
    link_busy: Busy,
    scan_note: String,
    can_scan: bool,
    problem: Option<Problem>,
    copied: &'static str,
    copy_error: bool,
    /// The modifier shown in shortcuts: `⌘` on Apple devices, else `Ctrl+`.
    shortcut: &'static str,
}

#[derive(Debug, Serialize)]
pub struct Output {
    pub view: View,
    pub effects: Vec<Effect>,
}

/// The step the URL names, or the furthest one before it that the session
/// allows.
fn current_step(model: &Model) -> usize {
    let (step, session) = (model.search.step, &model.session);
    match step {
        Some(Step::Add) if session.account.is_some() => ADD,
        Some(Step::Activate | Step::Add) if session.value.is_some() => ACTIVATE,
        Some(Step::Qr) => QR,
        _ => PORTAL,
    }
}

/// The hash's step for `step`. The first step has none.
fn step_param(step: usize) -> Option<Step> {
    match step {
        QR => Some(Step::Qr),
        ACTIVATE => Some(Step::Activate),
        ADD.. => Some(Step::Add),
        _ => None,
    }
}

struct Transition<'a> {
    model: &'a mut Model,
    effects: Vec<Effect>,
    /// Whether the hash change adds a history entry rather than replacing one.
    push: bool,
    /// Whether this event set the text field, which a step change clears otherwise.
    text_set: bool,
    /// The link error before this event; a step change clears it if unchanged.
    link_error: String,
}

impl<'a> Transition<'a> {
    fn new(model: &'a mut Model) -> Self {
        Self {
            link_error: model.link_error.clone(),
            model,
            effects: Vec::new(),
            push: false,
            text_set: false,
        }
    }

    fn current(&self) -> usize {
        current_step(self.model)
    }

    fn submitted(&self) -> bool {
        self.current() == ACTIVATE && self.model.session.submitted == Some(true)
    }

    fn set_step(&mut self, step: usize, push: bool) {
        self.model.search.step = step_param(step);
        self.push |= push;
    }

    /// Fill the text field. Text longer than `MAX_TEXT` clears it instead.
    fn set_text(&mut self, text: String) {
        self.text_set = true;
        let text = if text.encode_utf16().count() > MAX_TEXT {
            String::new()
        } else {
            text
        };
        self.effects.push(Effect::SetText { text });
    }

    fn write_hash(&mut self, hash: String, push: bool) {
        if self.model.hash.as_ref() != Some(&hash) {
            self.model.hash = Some(hash.clone());
            self.effects.push(Effect::WriteHash { hash, push });
        }
    }

    /// Abandon pending work. Its results carry an older ticket or value and are dropped.
    fn cancel(&mut self) {
        if self.model.link_busy == Busy::Scan {
            self.effects.push(Effect::StopScan);
        }
        self.model.ticket = self.model.ticket.wrapping_add(1);
        self.model.preparing = None;
        self.model.link_busy = Busy::Idle;
        self.model.scan_note.clear();
    }

    fn show_link_error(&mut self, message: &str, replace: bool) {
        self.model.link_error = message.into();
        if self.current() != QR {
            self.set_step(QR, !replace);
        }
    }

    fn prepare(&mut self, value: String, start: bool) {
        self.model.preparing = Some(Preparing {
            value: value.clone(),
            start,
        });
        self.effects.push(Effect::Prepare { value });
    }

    fn start_activation(&mut self, value: String) {
        self.cancel();
        self.model.link_error.clear();
        self.model.problem = None;
        self.model.link_busy = Busy::Prepare;
        self.prepare(value, true);
    }

    fn import_response(&mut self, text: &str) {
        match parse_activation_response(text) {
            Ok(account) => {
                self.cancel();
                self.model.link_error.clear();
                self.model.problem = None;
                let session = &mut self.model.session;
                session.submitted = session.value.is_some().then_some(true);
                session.account = Some(account);
                self.model.search.totp = None;
                self.set_step(ADD, true);
            }
            Err(error) if self.submitted() => {
                self.model.problem = Some(Problem {
                    message: error.message,
                    needs_new_code: error.needs_new_code,
                });
            }
            Err(error) => self.show_link_error(&error.message, false),
        }
    }

    /// Read the step from the URL, as after Back, Forward or a reload. The URL
    /// never carries the session, so it stays as this tab left it.
    fn restore(&mut self, hash: &str, legacy: Option<&str>) {
        let mut search = parse_search(hash);
        if let Some(legacy) = legacy {
            let old = parse_search(legacy);
            search.step = search.step.or(old.step);
            search.totp = search.totp.or(old.totp);
        }
        self.model.search = search;
    }

    fn end_scan(&mut self, message: &str) {
        self.cancel();
        self.model.link_error = message.into();
    }

    fn read_image(&mut self, result: QrResult) {
        self.model.link_busy = Busy::Idle;
        if let Some(value) = result.value {
            self.start_activation(value);
        } else if result.found_qr {
            self.show_link_error("That QR code isn't a Duo activation code. Copy the one shown after choosing “I have Duo Mobile installed”.", false);
        } else {
            self.show_link_error("No QR code found in that image. Copy the QR code itself, or a screenshot where it's fully visible.", false);
        }
    }

    fn scan_frame(&mut self, result: QrResult) {
        if let Some(value) = result.value {
            return self.start_activation(value);
        }
        if result.found_qr {
            self.model.scan_note =
                "Found a QR code, but not Duo's. Keep the Duo activation QR code visible.".into();
        }
        self.model.scan_frames += 1;
        if self.model.scan_frames < SCAN_FRAMES {
            self.effects.push(Effect::ScanFrame {
                ticket: self.model.ticket,
            });
        } else {
            self.end_scan("No Duo QR code appeared within five minutes, so sharing stopped.");
        }
    }

    fn apply(&mut self, event: Event) {
        match event {
            Event::Load {
                hash,
                legacy,
                platform,
                scan,
            } => {
                let platform = platform.to_ascii_lowercase();
                self.model.apple = ["mac", "iphone", "ipad", "ipod"]
                    .iter()
                    .any(|name| platform.contains(name));
                self.model.can_scan = scan;
                // A query is always rewritten into the hash.
                self.model.hash = legacy.is_empty().then(|| hash.trim_start_matches('#').into());
                self.restore(&hash, Some(&legacy));
            }
            Event::Navigate { hash } => {
                self.model.hash = Some(hash.trim_start_matches('#').into());
                self.restore(&hash, None);
            }
            Event::GoTo { step } => self.set_step(step, true),
            Event::ChangeType { code_type } => {
                self.model.search.totp = (code_type == "totp").then_some(Totp::Totp);
            }
            Event::StartOver { step } => {
                self.cancel();
                self.model.session = Session::default();
                self.model.request = None;
                self.model.link_error.clear();
                self.model.problem = None;
                self.model.search.totp = None;
                self.set_text(String::new());
                self.set_step(step, true);
            }
            Event::Input { text, html, image } => {
                if self.current() == ADD {
                    return;
                }
                let text = text
                    .map(|text| text.trim().to_string())
                    .filter(|text| !text.is_empty());
                if self.submitted() {
                    if let Some(text) = text {
                        self.set_text(text.clone());
                        self.import_response(&text);
                    }
                    return;
                }
                if let Some(text) = text.as_deref().filter(|text| looks_like_duo_response(text)) {
                    return self.import_response(text);
                }
                let from_source =
                    try_parse_activation(html.as_deref().and_then(first_image_source).as_deref());
                if let Some(value) = from_source {
                    self.start_activation(value);
                } else if image {
                    self.cancel();
                    self.model.link_error.clear();
                    self.model.link_busy = Busy::Image;
                    self.effects.push(Effect::ReadImage {
                        ticket: self.model.ticket,
                    });
                } else if let Some(text) = text {
                    self.set_text(text.clone());
                    match parse_activation_input(&text) {
                        Ok(value) => self.start_activation(value),
                        Err(message) => self.show_link_error(&message, false),
                    }
                }
            }
            Event::EditLink => self.model.link_error.clear(),
            Event::Unreadable { ticket } => {
                if ticket == self.model.ticket && self.model.link_busy == Busy::Image {
                    self.model.link_busy = Busy::Idle;
                    self.show_link_error(
                        "That image couldn't be read. Try a PNG or JPEG screenshot.",
                        false,
                    );
                }
            }
            Event::Decoded { ticket, texts } => {
                if ticket != self.model.ticket {
                    return;
                }
                // Unrelated QR codes are skipped; decoded URLs are never fetched.
                let result = QrResult {
                    value: texts.iter().find_map(|text| parse_activation_input(text).ok()),
                    found_qr: !texts.is_empty(),
                };
                match self.model.link_busy {
                    Busy::Image => self.read_image(result),
                    Busy::Scan => self.scan_frame(result),
                    _ => {}
                }
            }
            Event::ScanStarted => {
                self.cancel();
                self.model.link_error.clear();
                self.model.link_busy = Busy::Scan;
                self.model.scan_frames = 0;
                self.model.scan_note =
                    "Choose the window that shows the Duo QR code. Nothing is recorded or uploaded.".into();
            }
            Event::ScanSharing if self.model.link_busy == Busy::Scan => {
                self.model.scan_note = "Looking for the Duo QR code in the shared window…".into();
                self.effects.push(Effect::ScanFrame {
                    ticket: self.model.ticket,
                });
            }
            Event::ScanSharing => {}
            Event::ScanEnded { error } if self.model.link_busy == Busy::Scan => {
                self.end_scan(match error.as_str() {
                    "AbortError" => "",
                    "NotAllowedError" => "Screen sharing was cancelled. Paste the QR code instead.",
                    _ => "Couldn't read the shared screen. Paste the QR code instead.",
                });
            }
            Event::ScanEnded { .. } => {}
            Event::Prepared { value, ok } => {
                let Some(preparing) = self.model.preparing.take_if(|preparing| preparing.value == value)
                else {
                    return;
                };
                if preparing.start {
                    self.model.link_busy = Busy::Idle;
                }
                let Some(request) = activation_request(&value).ok().filter(|_| ok) else {
                    return self.show_link_error(PREPARE_FAILURE, !preparing.start);
                };
                self.model.request = Some((value.clone(), request));
                if preparing.start {
                    let push = self.current() != ACTIVATE;
                    self.model.session = Session {
                        value: Some(value),
                        ..Session::default()
                    };
                    self.set_text(String::new());
                    self.set_step(ACTIVATE, push);
                }
            }
            Event::Submitted { value } => {
                if self.model.session.value.as_ref() != Some(&value) {
                    return;
                }
                if !self.model.sent.contains(&value) {
                    self.model.sent.push(value);
                }
                self.model.session.submitted = Some(true);
                self.effects.push(Effect::Focus {
                    id: "duo-reply",
                    scroll: "duo-reply",
                });
            }
            Event::Retry => {
                self.model.problem = None;
                let value = self.model.session.value.clone();
                self.model.sent.retain(|sent| Some(sent) != value.as_ref());
                self.model.session.submitted = None;
            }
            Event::Reveal => self.model.revealed = !self.model.revealed,
            Event::Copied { kind } => {
                self.model.copied = match kind.as_str() {
                    "uri" => "uri",
                    "portal" => "portal",
                    _ => "key",
                };
                self.model.copy_error = false;
                self.model.copy_id = self.model.copy_id.wrapping_add(1);
                self.effects.push(Effect::Later {
                    ms: 2500,
                    event: json!({ "type": "copyDone", "id": self.model.copy_id }),
                });
            }
            Event::CopyFailed => {
                self.model.copy_error = true;
                self.model.revealed = true;
            }
            Event::CopyDone { id } => {
                if id == self.model.copy_id {
                    self.model.copied = "";
                }
            }
        }
    }

    /// Keep the shown step valid and react to step changes, as a page refresh would.
    fn normalize(&mut self) {
        let value = self.model.session.value.clone();
        if let Some(value) = &value {
            if self.model.session.submitted == Some(true) && !self.model.sent.contains(value) {
                self.model.sent.push(value.clone());
            }
            if self.model.sent.contains(value) {
                self.model.session.submitted = Some(true);
            }
        }
        let current = self.current();
        self.model.search.step = step_param(current);
        if self.model.previous != Some(current) {
            self.model.problem = None;
            if !self.text_set {
                self.set_text(String::new());
            }
            if self.model.link_error == self.link_error {
                self.model.link_error.clear();
            }
            self.model.revealed = false;
            self.model.copied = "";
            self.model.copy_error = false;
            if self.model.previous.is_some() {
                self.effects.push(Effect::Focus {
                    id: "step-title",
                    scroll: "setup-progress",
                });
            }
            self.model.previous = Some(current);
        }
        let prepared = self.model.request.as_ref().map(|(value, _)| value);
        let preparing = self.model.preparing.as_ref().map(|preparing| &preparing.value);
        if let Some(value) = value
            && current == ACTIVATE
            && !self.submitted()
            && prepared != Some(&value)
            && preparing != Some(&value)
        {
            self.prepare(value, false);
        }
    }

    /// The address follows every event; unchanged hashes are not rewritten.
    fn finish(mut self) -> Output {
        self.normalize();
        let push = self.push;
        self.write_hash(encode_hash(&self.model.search), push);
        Output {
            view: view(self.model),
            effects: self.effects,
        }
    }
}

fn group_secret(secret: &str) -> String {
    secret
        .as_bytes()
        .chunks(4)
        .map(|chunk| String::from_utf8_lossy(chunk).into_owned())
        .collect::<Vec<_>>()
        .join(" ")
}

fn view(model: &Model) -> View {
    let current = current_step(model);
    let session = &model.session;
    let furthest = if session.account.is_some() {
        ADD
    } else if session.value.is_some() {
        ACTIVATE
    } else {
        QR
    };
    let has_code = session.value.is_some() || session.account.is_some();
    let finished = [
        current > PORTAL || has_code,
        has_code,
        session.account.is_some(),
        session.account.is_some(),
    ];
    let totp = model.search.totp.is_some();
    let account = (current == ADD)
        .then_some(session.account.as_ref())
        .flatten()
        .map(|account: &Account| AccountView {
            customer: account.customer.clone(),
            secret: account.secret.clone(),
            key: if model.revealed {
                group_secret(&account.secret)
            } else {
                HIDDEN_KEY.into()
            },
            revealed: model.revealed,
            uri: otpauth_uri(account, totp),
            qr_alt: format!(
                "{} authenticator QR code for {}",
                if totp { "Time-based" } else { "Counter-based" },
                account.customer
            ),
        });
    let value = if current == ACTIVATE {
        session.value.clone().unwrap_or_default()
    } else {
        String::new()
    };
    let request = model
        .request
        .as_ref()
        .filter(|(prepared, _)| current == ACTIVATE && *prepared == value)
        .map(|(_, request)| request.clone());
    let count = STEPS.len();
    View {
        current,
        furthest,
        title: STEPS[current].1,
        progress: STEPS
            .iter()
            .enumerate()
            .map(|(index, (label, _))| {
                let state = if index == current {
                    "active"
                } else if finished[index] {
                    "complete"
                } else {
                    "upcoming"
                };
                let status = match state {
                    "active" => "current step",
                    "complete" => "done",
                    _ => "not started",
                };
                let number = index + 1;
                ProgressStep {
                    index,
                    number,
                    label,
                    state,
                    finished: finished[index],
                    reachable: index <= furthest,
                    description: format!(", step {number} of {count}, {status}"),
                }
            })
            .collect(),
        value,
        request,
        submitted: current == ACTIVATE && session.submitted == Some(true),
        code_type: if totp { "totp" } else { "hotp" },
        account,
        link_error: model.link_error.clone(),
        link_busy: model.link_busy,
        scan_note: model.scan_note.clone(),
        can_scan: model.can_scan,
        problem: model.problem.clone(),
        copied: model.copied,
        copy_error: model.copy_error,
        shortcut: if model.apple { "⌘" } else { "Ctrl+" },
    }
}

/// Apply one browser event. Any I/O is returned as effects for the host.
pub fn update(model: &mut Model, event: Event) -> Output {
    let mut transition = Transition::new(model);
    transition.apply(event);
    transition.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALUE: &str = "TESTCODE123-YXBpLTEyMzQ1Njc4LmR1b3NlY3VyaXR5LmNvbQ";
    const LINK: &str = "https://m-12345678.duosecurity.com/activate/TESTCODE123";

    fn send(model: &mut Model, event: Value) -> Output {
        update(model, serde_json::from_value(event).unwrap())
    }

    fn load(hash: &str, legacy: &str) -> (Model, Output) {
        let mut model = Model::default();
        let output = send(
            &mut model,
            json!({ "type": "load", "hash": hash, "legacy": legacy, "platform": "MacIntel", "scan": true }),
        );
        (model, output)
    }

    fn reply() -> String {
        json!({ "stat": "OK", "response": { "customer_name": "ACME University", "hotp_secret": "supersecretkey" } })
            .to_string()
    }

    fn written(output: &Output) -> Option<(&str, bool)> {
        output.effects.iter().rev().find_map(|effect| match effect {
            Effect::WriteHash { hash, push } => Some((hash.as_str(), *push)),
            _ => None,
        })
    }

    fn view_json(output: &Output) -> Value {
        serde_json::to_value(&output.view).unwrap()
    }

    /// Steps 1 and 2: paste the activation link and get its Duo request ready.
    fn activate(model: &mut Model) -> Output {
        send(model, json!({ "type": "input", "text": LINK }));
        send(model, json!({ "type": "prepared", "value": VALUE, "ok": true }))
    }

    #[test]
    fn walks_through_the_whole_flow() {
        let (mut model, loaded) = load("", "");
        assert_eq!(loaded.view.current, PORTAL);
        assert_eq!(loaded.view.progress.len(), 4);
        assert_eq!(loaded.view.progress[0].number, 1);
        assert_eq!(loaded.view.shortcut, "⌘");
        assert!(loaded.view.can_scan);
        assert_eq!(written(&loaded), None, "An unchanged address is not rewritten");

        let qr = send(&mut model, json!({ "type": "goTo", "step": QR }));
        assert_eq!(qr.view.current, QR);
        assert_eq!(written(&qr), Some(("step=qr", true)));
        assert!(qr.effects.contains(&Effect::Focus {
            id: "step-title",
            scroll: "setup-progress"
        }));

        let pasted = send(&mut model, json!({ "type": "input", "text": LINK }));
        assert!(pasted.effects.contains(&Effect::SetText { text: LINK.into() }));
        assert!(pasted.effects.contains(&Effect::Prepare { value: VALUE.into() }));
        assert_eq!(pasted.view.link_busy, Busy::Prepare);
        let prepared = send(
            &mut model,
            json!({ "type": "prepared", "value": VALUE, "ok": true }),
        );
        assert_eq!(prepared.view.current, ACTIVATE);
        assert_eq!(prepared.view.value, VALUE);
        let request = prepared.view.request.as_ref().unwrap();
        assert_eq!(
            request.url,
            "https://api-12345678.duosecurity.com/push/v2/activation/TESTCODE123?customer_protocol=1"
        );
        assert!(
            prepared
                .effects
                .contains(&Effect::SetText { text: String::new() })
        );
        assert_eq!(written(&prepared), Some(("step=activate", true)));

        let sent = send(&mut model, json!({ "type": "submitted", "value": VALUE }));
        assert!(sent.view.submitted);
        assert!(sent.effects.contains(&Effect::Focus {
            id: "duo-reply",
            scroll: "duo-reply"
        }));
        let bad = send(&mut model, json!({ "type": "input", "text": "not a Duo reply" }));
        assert!(bad.effects.contains(&Effect::SetText {
            text: "not a Duo reply".into()
        }));
        assert!(
            bad.view
                .problem
                .as_ref()
                .unwrap()
                .message
                .contains("doesn't look like Duo's reply")
        );
        // Longer text isn't echoed, so the field's text stays within the guard's cap.
        let long = format!("{}x", "-".repeat(MAX_TEXT));
        let pasted_long = send(&mut model, json!({ "type": "input", "text": long }));
        assert!(
            pasted_long
                .effects
                .contains(&Effect::SetText { text: String::new() })
        );
        assert!(pasted_long.view.problem.is_some());

        let done = send(&mut model, json!({ "type": "input", "text": reply() }));
        assert_eq!(done.view.current, ADD);
        let account = view_json(&done)["account"].clone();
        assert_eq!(account["secret"], "ON2XAZLSONSWG4TFORVWK6I");
        assert_eq!(account["key"], HIDDEN_KEY);
        assert!(
            account["uri"]
                .as_str()
                .unwrap()
                .starts_with("otpauth://hotp/Duo:ACME%20University?")
        );
        let revealed = send(&mut model, json!({ "type": "reveal" }));
        assert_eq!(
            view_json(&revealed)["account"]["key"],
            "ON2X AZLS ONSW G4TF ORVW K6I"
        );

        let copied = send(&mut model, json!({ "type": "copied", "kind": "uri" }));
        assert_eq!(copied.view.copied, "uri");
        let Some(Effect::Later { ms: 2500, event }) = copied.effects.first() else {
            panic!("{:?}", copied.effects)
        };
        let reset = send(&mut model, event.clone());
        assert_eq!(reset.view.copied, "");

        let totp = send(&mut model, json!({ "type": "changeType", "codeType": "totp" }));
        assert_eq!(totp.view.code_type, "totp");
        assert!(
            view_json(&totp)["account"]["uri"]
                .as_str()
                .unwrap()
                .contains("/totp/")
        );
        // The address only ever records the step and code type.
        assert_eq!(written(&totp), Some(("step=add&type=totp", false)));

        let over = send(&mut model, json!({ "type": "startOver", "step": PORTAL }));
        assert_eq!(over.view.current, PORTAL);
        assert_eq!(model.session, Session::default());
        assert_eq!(written(&over), Some(("", true)));
    }

    #[test]
    fn keeps_the_session_in_memory() {
        let (mut model, _) = load("#step=qr", "");
        activate(&mut model);
        send(&mut model, json!({ "type": "submitted", "value": VALUE }));
        // Back and Forward change the step; the session stays as this tab left it.
        let back = send(&mut model, json!({ "type": "navigate", "hash": "#step=qr" }));
        assert_eq!(back.view.current, QR);
        let forward = send(
            &mut model,
            json!({ "type": "navigate", "hash": "#step=activate" }),
        );
        assert_eq!(forward.view.current, ACTIVATE);
        assert!(forward.view.submitted);
        assert!(
            !forward
                .effects
                .iter()
                .any(|effect| matches!(effect, Effect::Prepare { .. }))
        );
        assert_eq!(written(&forward), None);
        let retry = send(&mut model, json!({ "type": "retry" }));
        assert!(!retry.view.submitted);
        assert!(retry.view.request.is_some());

        // A reload starts without a session, whatever the address says.
        let (_, reloaded) = load("#step=activate", "");
        assert_eq!(reloaded.view.current, PORTAL);
        assert_eq!(written(&reloaded), Some(("", false)));
    }

    #[test]
    fn ignores_sessions_in_old_links() {
        use base64::Engine;
        let session = json!({ "value": VALUE, "account": { "customer": "ACME", "secret": "ON2XAZLS" } });
        let old = base64::engine::general_purpose::STANDARD
            .encode(json!({ "version": 1, "search": { "step": "add" }, "session": session }).to_string());
        let (model, loaded) = load(&format!("#{old}"), "");
        assert_eq!(loaded.view.current, PORTAL);
        assert_eq!(model.session, Session::default());
        // The host replaces the old address, so its history entry loses the key.
        assert_eq!(written(&loaded), Some(("", false)));
    }

    #[test]
    fn corrects_unavailable_steps_and_reads_legacy_links() {
        let (mut model, loaded) = load("", "?step=add&type=totp");
        assert_eq!(loaded.view.current, PORTAL);
        assert_eq!(loaded.view.shortcut, "⌘");
        // A query is always moved into the hash.
        assert_eq!(written(&loaded), Some(("type=totp", false)));
        let ahead = send(&mut model, json!({ "type": "goTo", "step": ADD }));
        assert_eq!(ahead.view.current, PORTAL);
        assert_eq!(load("#/?step=qr", "").1.view.current, QR);
        // The portal is the first step, so its hash is empty.
        let (_, portal) = load("#step=portal", "");
        assert_eq!(portal.view.current, PORTAL);
        assert_eq!(written(&portal), Some(("", false)));
        let (_, windows) = {
            let mut model = Model::default();
            let output = send(
                &mut model,
                json!({ "type": "load", "hash": "", "legacy": "", "platform": "Win32", "scan": false }),
            );
            (model, output)
        };
        assert_eq!(windows.view.shortcut, "Ctrl+");
        assert!(!windows.view.can_scan);
    }

    #[test]
    fn routes_pasted_content() {
        let (mut model, _) = load("#step=qr", "");
        let html = format!(r#"<img src="https://api-12345678.duosecurity.com/frame/qr?value={VALUE}">"#);
        let copied = send(
            &mut model,
            json!({ "type": "input", "html": html, "image": true }),
        );
        assert!(copied.effects.contains(&Effect::Prepare { value: VALUE.into() }));

        let image = send(&mut model, json!({ "type": "input", "image": true }));
        let ticket = model.ticket;
        assert!(image.effects.contains(&Effect::ReadImage { ticket }));
        assert_eq!(image.view.link_busy, Busy::Image);
        // A late result for older work is not decoded.
        let stale = send(
            &mut model,
            json!({ "type": "decoded", "ticket": ticket.wrapping_sub(1), "texts": [LINK] }),
        );
        assert_eq!(stale.view.link_busy, Busy::Image);
        assert!(stale.effects.is_empty());
        let unrelated = send(
            &mut model,
            json!({ "type": "decoded", "ticket": ticket, "texts": ["https://university.example/login"] }),
        );
        assert!(unrelated.view.link_error.contains("isn't a Duo activation code"));
        assert_eq!(unrelated.view.link_busy, Busy::Idle);

        let image = send(&mut model, json!({ "type": "input", "image": true }));
        assert!(image.view.link_error.is_empty());
        let ticket = model.ticket;
        let unreadable = send(&mut model, json!({ "type": "unreadable", "ticket": ticket }));
        assert!(unreadable.view.link_error.contains("couldn't be read"));
        let found = send(&mut model, json!({ "type": "input", "image": true }));
        assert_eq!(found.view.link_busy, Busy::Image);
        let ticket = model.ticket;
        // The first Duo activation counts; other QR codes in the image don't.
        let decoded = send(
            &mut model,
            json!({ "type": "decoded", "ticket": ticket, "texts": ["otpauth://totp/Other?secret=GEZDGNBVGY3TQOJQ", LINK] }),
        );
        assert!(decoded.effects.contains(&Effect::Prepare { value: VALUE.into() }));

        let wrong = send(
            &mut model,
            json!({ "type": "input", "text": "https://example.com" }),
        );
        assert!(wrong.effects.contains(&Effect::SetText {
            text: "https://example.com".into()
        }));
        assert!(wrong.view.link_error.contains("not a Duo link"));
        // Leaving the step drops its error and text.
        let left = send(&mut model, json!({ "type": "goTo", "step": PORTAL }));
        assert!(left.view.link_error.is_empty());
        assert!(left.effects.contains(&Effect::SetText { text: String::new() }));
        // A paste from another step keeps what it shows.
        let pasted = send(
            &mut model,
            json!({ "type": "input", "text": "https://example.com" }),
        );
        assert_eq!(pasted.view.current, QR);
        assert!(pasted.view.link_error.contains("not a Duo link"));
        assert!(!pasted.effects.contains(&Effect::SetText { text: String::new() }));

        let direct = send(&mut model, json!({ "type": "input", "text": reply() }));
        assert_eq!(direct.view.current, ADD);
        let ignored = send(&mut model, json!({ "type": "input", "text": LINK }));
        assert!(ignored.effects.is_empty(), "{:?}", ignored.effects);
    }

    #[test]
    fn ignores_unrelated_and_unsafe_codes() {
        for text in [
            "https://university.example/login",
            "otpauth://totp/AlreadyActivated?secret=GEZDGNBVGY3TQOJQ",
            "FIDO:/1234567890",
            "duo://TESTCODE123-bG9jYWxob3N0",
            &format!("https://evil.example/?value={VALUE}"),
        ] {
            let (mut model, _) = load("#step=qr", "");
            send(&mut model, json!({ "type": "input", "image": true }));
            let ticket = model.ticket;
            let decoded = send(
                &mut model,
                json!({ "type": "decoded", "ticket": ticket, "texts": [text] }),
            );
            assert!(
                decoded.view.link_error.contains("isn't a Duo activation code"),
                "{text}"
            );
            assert!(
                !decoded
                    .effects
                    .iter()
                    .any(|effect| matches!(effect, Effect::Prepare { .. }))
            );
        }
    }

    #[test]
    fn reports_scans_and_failures() {
        let (mut model, _) = load("#step=qr", "");
        let started = send(&mut model, json!({ "type": "scanStarted" }));
        assert_eq!(started.view.link_busy, Busy::Scan);
        let sharing = send(&mut model, json!({ "type": "scanSharing" }));
        assert!(sharing.view.scan_note.contains("Looking for"));
        let ticket = model.ticket;
        assert_eq!(sharing.effects, vec![Effect::ScanFrame { ticket }]);
        let unrelated = send(
            &mut model,
            json!({ "type": "decoded", "ticket": ticket, "texts": ["FIDO:/1234567890"] }),
        );
        assert!(unrelated.view.scan_note.contains("not Duo's"));
        assert_eq!(unrelated.effects, vec![Effect::ScanFrame { ticket }]);
        let found = send(
            &mut model,
            json!({ "type": "decoded", "ticket": ticket, "texts": [format!("duo://{VALUE}")] }),
        );
        assert_eq!(found.effects[0], Effect::StopScan);
        assert!(found.effects.contains(&Effect::Prepare { value: VALUE.into() }));
        assert_eq!(found.view.link_busy, Busy::Prepare);
        // A frame that was already being decoded is dropped.
        let late = send(
            &mut model,
            json!({ "type": "decoded", "ticket": ticket, "texts": [LINK] }),
        );
        assert!(late.effects.is_empty());

        let failed = send(
            &mut model,
            json!({ "type": "prepared", "value": VALUE, "ok": false }),
        );
        assert!(failed.view.link_error.contains("couldn't prepare"));
        assert_eq!(failed.view.link_busy, Busy::Idle);
        // A result for an abandoned request is ignored.
        let stale = send(
            &mut model,
            json!({ "type": "prepared", "value": VALUE, "ok": true }),
        );
        assert_eq!(stale.view.current, QR);

        send(&mut model, json!({ "type": "scanStarted" }));
        let denied = send(
            &mut model,
            json!({ "type": "scanEnded", "error": "NotAllowedError" }),
        );
        assert!(denied.view.link_error.contains("cancelled"));
        assert_eq!(denied.effects, vec![Effect::StopScan]);
        send(&mut model, json!({ "type": "scanStarted" }));
        let odd = send(&mut model, json!({ "type": "scanEnded" }));
        assert!(odd.view.link_error.contains("Couldn't read the shared screen"));

        send(&mut model, json!({ "type": "scanStarted" }));
        send(&mut model, json!({ "type": "scanSharing" }));
        let ticket = model.ticket;
        let mut last = None;
        for _ in 0..SCAN_FRAMES {
            last = Some(send(
                &mut model,
                json!({ "type": "decoded", "ticket": ticket, "texts": [] }),
            ));
        }
        let last = last.unwrap();
        assert_eq!(last.effects, vec![Effect::StopScan]);
        assert!(last.view.link_error.contains("five minutes"));
    }

    #[test]
    fn copies_the_portal_link() {
        let (mut model, _) = load("", "");
        let copied = send(&mut model, json!({ "type": "copied", "kind": "portal" }));
        assert_eq!(copied.view.copied, "portal");
        let next = send(&mut model, json!({ "type": "goTo", "step": QR }));
        assert_eq!(next.view.copied, "");
    }

    #[test]
    fn copies_and_reveals_the_key() {
        let (mut model, _) = load("#step=qr", "");
        send(&mut model, json!({ "type": "input", "text": reply() }));
        let failed = send(&mut model, json!({ "type": "copyFailed" }));
        assert!(failed.view.copy_error);
        assert!(failed.view.account.as_ref().unwrap().revealed);
        send(&mut model, json!({ "type": "copied", "kind": "key" }));
        let again = send(&mut model, json!({ "type": "copied", "kind": "key" }));
        assert!(!again.view.copy_error);
        // Only the latest copy's timer clears the label.
        let id = model.copy_id - 1;
        let early = send(&mut model, json!({ "type": "copyDone", "id": id }));
        assert_eq!(early.view.copied, "key");
        let back = send(&mut model, json!({ "type": "startOver", "step": 1 }));
        assert_eq!(back.view.copied, "");
        assert!(!model.revealed);
    }

    #[test]
    fn serializes_for_the_host() {
        let (mut model, output) = load("", "");
        let json = serde_json::to_value(&output).unwrap();
        assert_eq!(json["view"]["linkBusy"], "");
        assert_eq!(json["view"]["codeType"], "hotp");
        assert_eq!(json["view"]["request"], Value::Null);
        assert_eq!(json["effects"], json!([{ "type": "setText", "text": "" }]));
        let prepared = activate(&mut model);
        let json = serde_json::to_value(&prepared).unwrap();
        assert_eq!(
            json["view"]["request"],
            json!({ "url": "https://api-12345678.duosecurity.com/push/v2/activation/TESTCODE123?customer_protocol=1" })
        );
        let focus = serde_json::to_value(Effect::Focus {
            id: "step-title",
            scroll: "setup-progress",
        })
        .unwrap();
        assert_eq!(
            focus,
            json!({ "type": "focus", "id": "step-title", "scroll": "setup-progress" })
        );
    }
}
