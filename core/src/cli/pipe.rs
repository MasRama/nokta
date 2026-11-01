//! How `nokta` talks to the Windows app: a named pipe per user, one JSON
//! line each way, a request and then its answer.

use serde::{Deserialize, Serialize};

/// The longest line either end reads; a longer one is cut there and fails.
pub const MAX_LINE: u64 = 64 * 1024;

/// What `nokta` asks the app; the D-Bus methods it calls on Linux.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "call", rename_all = "kebab-case")]
pub enum Request {
    ActivitySet {
        id: String,
        title: String,
        detail: String,
        icon: String,
        /// 0 to 1, or -1 when unknown.
        progress: f64,
    },
    ActivityEnd {
        id: String,
        success: bool,
        message: String,
    },
    AddCountdown {
        label: String,
        duration_us: i64,
    },
    AddStopwatch {
        label: String,
    },
    AddAlarm {
        label: String,
        unix_us: i64,
    },
    ClearClocks,
    /// Opens the settings window.
    Settings,
}

/// The app's answer: nothing when it did it, else why not.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Answer {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Answer {
    pub fn from_result(result: Result<(), String>) -> Answer {
        Answer {
            error: result.err(),
        }
    }
}

/// `value` as one line, ending in a newline.
pub fn line<T: Serialize>(value: &T) -> String {
    let mut text = serde_json::to_string(value).expect("requests and answers serialize");
    text.push('\n');
    text
}

/// The pipe of the user with this SID; other users have their own.
pub fn name(sid: &str) -> String {
    format!(r"\\.\pipe\nokta-{sid}")
}

/// The SID of the user this process runs as, like `S-1-5-21-…-1001`.
#[cfg(windows)]
pub fn user_sid() -> std::io::Result<String> {
    use windows::Win32::Foundation::{CloseHandle, LocalFree, HANDLE, HLOCAL};
    use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let mut token = HANDLE::default();
    // SAFETY: the current process's pseudo handle needs no closing; `token`
    // is written on success and closed below.
    unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) }?;
    let mut size = 0u32;
    // The first call only says how big the answer is, and fails.
    // SAFETY: no buffer is passed; `size` is written.
    let _ = unsafe { GetTokenInformation(token, TokenUser, None, 0, &mut size) };
    // u64s, so the TOKEN_USER at its start is aligned.
    let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
    // SAFETY: `buffer` holds at least `size` bytes.
    let read = unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            Some(buffer.as_mut_ptr().cast()),
            size,
            &mut size,
        )
    };
    // SAFETY: `token` came from OpenProcessToken.
    let _ = unsafe { CloseHandle(token) };
    read?;
    // SAFETY: the call above filled `buffer` with a TOKEN_USER, aligned.
    let user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
    let mut text = windows::core::PWSTR::null();
    // SAFETY: the SID points into `buffer`, alive here; `text` is freed below.
    unsafe { ConvertSidToStringSidW(user.User.Sid, &mut text) }?;
    // SAFETY: Windows gave a NUL-ended string.
    let sid = unsafe { text.to_string() };
    // SAFETY: ConvertSidToStringSidW allocated `text` with LocalAlloc.
    unsafe { LocalFree(Some(HLOCAL(text.0.cast()))) };
    sid.map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))
}

#[cfg(test)]
mod tests {
    use super::{line, name, Answer, Request};

    #[test]
    fn a_request_is_one_line_naming_its_call() {
        let set = Request::ActivitySet {
            id: "build".into(),
            title: "Building".into(),
            detail: String::new(),
            icon: String::new(),
            progress: 0.4,
        };
        assert_eq!(
            line(&set),
            "{\"call\":\"activity-set\",\"id\":\"build\",\"title\":\"Building\",\"detail\":\"\",\"icon\":\"\",\"progress\":0.4}\n"
        );
        assert_eq!(line(&Request::Settings), "{\"call\":\"settings\"}\n");
        for request in [
            set,
            Request::ActivityEnd {
                id: "build".into(),
                success: false,
                message: "Exit code 3".into(),
            },
            Request::AddCountdown {
                label: "Tea".into(),
                duration_us: 180_000_000,
            },
            Request::AddStopwatch {
                label: "Run".into(),
            },
            Request::AddAlarm {
                label: String::new(),
                unix_us: 1_800_000_000_000_000,
            },
            Request::ClearClocks,
            Request::Settings,
        ] {
            let read: Request = serde_json::from_str(line(&request).trim_end()).unwrap();
            assert_eq!(read, request);
        }
    }

    #[test]
    fn an_answer_says_only_what_went_wrong() {
        assert_eq!(line(&Answer::from_result(Ok(()))), "{}\n");
        let failed = Answer::from_result(Err("the title must not be empty".into()));
        assert_eq!(
            line(&failed),
            "{\"error\":\"the title must not be empty\"}\n"
        );
        assert_eq!(
            serde_json::from_str::<Answer>("{}").unwrap(),
            Answer::default()
        );
    }

    #[test]
    fn an_unknown_call_does_not_read() {
        assert!(serde_json::from_str::<Request>("{\"call\":\"reboot\"}").is_err());
        assert!(serde_json::from_str::<Request>("{\"call\":\"activity-end\"}").is_err());
    }

    #[test]
    fn each_user_has_a_pipe() {
        assert_eq!(
            name("S-1-5-21-1-2-3-1001"),
            r"\\.\pipe\nokta-S-1-5-21-1-2-3-1001"
        );
    }
}
