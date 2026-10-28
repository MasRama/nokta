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
        [first, ..] => Err(format!("unknown command {first:?}")),
    }
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
