//! The command line, parsed by hand: it is small and has no dependencies.

#[derive(Clone, Debug, PartialEq)]
pub enum Cli {
    Help,
    Version,
    /// Opens the extension's settings window.
    Settings,
    Set {
        id: String,
        title: String,
        detail: String,
        icon: String,
        /// 0 to 1, or -1 when unknown.
        progress: f64,
    },
    End {
        id: String,
        success: bool,
        message: String,
    },
    Run {
        title: String,
        icon: String,
        command: Vec<String>,
    },
    Countdown {
        duration_us: i64,
        label: String,
    },
    Stopwatch {
        label: String,
    },
    /// Rings at the next time the local clock shows `hour:minute`.
    Alarm {
        hour: u8,
        minute: u8,
        label: String,
    },
    ClearClocks,
    /// Installs the latest release; `yes` skips the question, `check_only`
    /// only says what it found.
    Update {
        yes: bool,
        check_only: bool,
    },
}

pub fn parse(args: &[String]) -> Result<Cli, String> {
    let words: Vec<&str> = args.iter().map(String::as_str).collect();
    match words.as_slice() {
        [] | ["--help" | "-h" | "help"] => Ok(Cli::Help),
        ["--version" | "-V"] => Ok(Cli::Version),
        ["settings"] => Ok(Cli::Settings),
        ["activity", "set", rest @ ..] => {
            let (id, options) = id_and_options(rest)?;
            let mut o = Options::read(
                options,
                &["--title", "--detail", "--icon", "--progress"],
                &[],
            )?;
            let title = o.take("--title").ok_or("activity set needs --title")?;
            let progress = match o.take("--progress") {
                None => -1.0,
                Some(text) => match text.parse::<f64>() {
                    Ok(p) if (0.0..=100.0).contains(&p) => p / 100.0,
                    _ => {
                        return Err(format!(
                            "--progress must be a number from 0 to 100, got {text:?}"
                        ))
                    }
                },
            };
            Ok(Cli::Set {
                id,
                title,
                detail: o.take("--detail").unwrap_or_default(),
                icon: o.take("--icon").unwrap_or_default(),
                progress,
            })
        }
        ["activity", "end", rest @ ..] => {
            let (id, options) = id_and_options(rest)?;
            let mut o = Options::read(options, &["--message"], &["--failed"])?;
            Ok(Cli::End {
                id,
                success: !o.flag("--failed"),
                message: o.take("--message").unwrap_or_default(),
            })
        }
        ["run", rest @ ..] => {
            let dashes = rest
                .iter()
                .position(|w| *w == "--")
                .ok_or("run needs -- before the command")?;
            let command: Vec<String> = rest[dashes + 1..].iter().map(|w| (*w).to_owned()).collect();
            if command.is_empty() {
                return Err("run needs a command after --".into());
            }
            let mut o = Options::read(&rest[..dashes], &["--title", "--icon"], &[])?;
            Ok(Cli::Run {
                title: o.take("--title").unwrap_or_else(|| default_title(&command)),
                icon: o.take("--icon").unwrap_or_default(),
                command,
            })
        }
        ["timer", "clear"] => Ok(Cli::ClearClocks),
        ["timer", length, label @ ..] => Ok(Cli::Countdown {
            duration_us: parse_duration(length).ok_or_else(|| {
                format!("the timer length is like 10m, 1h30m or 45s, got {length:?}")
            })?,
            label: label.join(" "),
        }),
        ["timer"] => Err("timer needs a length, like: nokta timer 10m Tea".into()),
        ["stopwatch", label @ ..] => Ok(Cli::Stopwatch {
            label: label.join(" "),
        }),
        ["alarm", time, label @ ..] => {
            let (hour, minute) = parse_time_of_day(time)
                .ok_or_else(|| format!("the alarm time is like 07:30, got {time:?}"))?;
            Ok(Cli::Alarm {
                hour,
                minute,
                label: label.join(" "),
            })
        }
        ["alarm"] => Err("alarm needs a time, like: nokta alarm 07:30 Wake up".into()),
        ["update", rest @ ..] => {
            let mut o = Options::read(rest, &[], &["--yes", "--check"])?;
            let (yes, check_only) = (o.flag("--yes"), o.flag("--check"));
            if yes && check_only {
                return Err("update takes --yes or --check, not both".into());
            }
            Ok(Cli::Update { yes, check_only })
        }
        [first, ..] => Err(format!("unknown command {first:?}")),
    }
}

/// `1h30m`, `10m`, `45s` or a bare number of minutes, in microseconds.
/// Units go from hours down to seconds, each at most once.
pub fn parse_duration(text: &str) -> Option<i64> {
    if let Ok(minutes) = text.parse::<u32>() {
        return Some(i64::from(minutes) * 60_000_000);
    }
    let units = [
        ('h', 3_600_000_000_i64),
        ('m', 60_000_000),
        ('s', 1_000_000),
    ];
    let mut rest = text;
    let mut next_unit = 0;
    let mut total = 0_i64;
    while !rest.is_empty() {
        let digits = rest.find(|c: char| !c.is_ascii_digit())?;
        if digits == 0 {
            return None;
        }
        let number: i64 = rest[..digits].parse().ok()?;
        let unit = rest[digits..].chars().next()?;
        let index = units[next_unit..].iter().position(|(u, _)| *u == unit)? + next_unit;
        total = total.checked_add(number.checked_mul(units[index].1)?)?;
        next_unit = index + 1;
        rest = &rest[digits + 1..];
    }
    (total > 0).then_some(total)
}

/// `07:30` or `7:30`, on a 24-hour clock.
pub fn parse_time_of_day(text: &str) -> Option<(u8, u8)> {
    let (hour, minute) = text.split_once(':')?;
    if !(1..=2).contains(&hour.len()) || minute.len() != 2 {
        return None;
    }
    let hour: u8 = hour.parse().ok()?;
    let minute: u8 = minute.parse().ok()?;
    (hour < 24 && minute < 60).then_some((hour, minute))
}

/// The program's file name, and its first argument unless that is an option:
/// `cargo build --release` gives `cargo build`.
pub fn default_title(command: &[String]) -> String {
    let program = command
        .first()
        .map_or("", |p| p.rsplit('/').next().unwrap_or(p));
    match command.get(1) {
        Some(word) if !word.starts_with('-') => format!("{program} {word}"),
        _ => program.to_owned(),
    }
}

fn id_and_options<'a>(rest: &'a [&'a str]) -> Result<(String, &'a [&'a str]), String> {
    match rest.split_first() {
        Some((id, options)) if !id.starts_with('-') => Ok(((*id).to_owned(), options)),
        _ => Err("the activity needs an id, like: nokta activity set build --title Build".into()),
    }
}

/// `--name value` pairs and bare `--flag`s.
struct Options {
    values: Vec<(String, String)>,
    flags: Vec<String>,
}

impl Options {
    fn read(words: &[&str], with_value: &[&str], flags: &[&str]) -> Result<Options, String> {
        let mut o = Options {
            values: Vec::new(),
            flags: Vec::new(),
        };
        let mut words = words.iter();
        while let Some(word) = words.next() {
            if flags.contains(word) {
                o.flags.push((*word).to_owned());
            } else if with_value.contains(word) {
                let value = words
                    .next()
                    .ok_or_else(|| format!("{word} needs a value"))?;
                o.values.push(((*word).to_owned(), (*value).to_owned()));
            } else {
                return Err(format!("unknown option {word:?}"));
            }
        }
        Ok(o)
    }

    fn take(&mut self, name: &str) -> Option<String> {
        let index = self.values.iter().rposition(|(n, _)| n == name)?;
        Some(self.values.remove(index).1)
    }

    fn flag(&mut self, name: &str) -> bool {
        self.flags.iter().any(|f| f == name)
    }
}
