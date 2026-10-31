//! Which notch windows stay, go or come when the monitors change: one
//! window per monitor, each kept on its own monitor where it still is.
//! Pure, so it is tested on every system.

// Only the Windows app uses it; the stub on other systems does not.
#![cfg_attr(not(windows), allow(dead_code))]

use crate::layout::Rect;

/// The label of every notch window starts so.
pub const PREFIX: &str = "notch-";

/// What to do with the notch windows for the monitors now.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Plan {
    /// A window and the index of the monitor it is placed on.
    pub keep: Vec<(String, usize)>,
    /// Windows whose monitor went.
    pub close: Vec<String>,
    /// A new window's label and its monitor's index.
    pub create: Vec<(String, usize)>,
}

/// `windows` are the notch windows with the monitor each was placed on,
/// `monitors` the monitors now. A window stays on a monitor that did not
/// move; the others take the monitors left, in order (a new resolution or
/// arrangement), and the rest close. Monitors still without a window get
/// one, under a label past every open window's.
pub fn plan(windows: &[(String, Rect)], monitors: &[Rect]) -> Plan {
    let mut taken = vec![false; monitors.len()];
    let mut placed: Vec<Option<usize>> = windows
        .iter()
        .map(|(_, rect)| {
            let found = (0..monitors.len()).find(|&i| !taken[i] && monitors[i] == *rect)?;
            taken[found] = true;
            Some(found)
        })
        .collect();
    for place in placed.iter_mut().filter(|p| p.is_none()) {
        if let Some(free) = taken.iter().position(|t| !t) {
            taken[free] = true;
            *place = Some(free);
        }
    }
    let mut plan = Plan::default();
    for ((label, _), place) in windows.iter().zip(placed) {
        match place {
            Some(index) => plan.keep.push((label.clone(), index)),
            None => plan.close.push(label.clone()),
        }
    }
    let first = windows
        .iter()
        .filter_map(|(label, _)| label.strip_prefix(PREFIX)?.parse::<usize>().ok())
        .max()
        .map_or(0, |last| last + 1);
    let free = (0..monitors.len()).filter(|&i| !taken[i]);
    for (next, index) in (first..).zip(free) {
        plan.create.push((format!("{PREFIX}{next}"), index));
    }
    plan
}

#[cfg(test)]
mod tests {
    use super::*;

    const LAPTOP: Rect = Rect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    };
    const SCREEN: Rect = Rect {
        x: 1920,
        y: 0,
        width: 2560,
        height: 1440,
    };

    fn windows(placed: &[(&str, Rect)]) -> Vec<(String, Rect)> {
        placed.iter().map(|(l, r)| ((*l).to_owned(), *r)).collect()
    }

    #[test]
    fn opens_a_window_on_every_monitor_at_start() {
        let plan = plan(&[], &[LAPTOP, SCREEN]);
        assert_eq!(
            plan.create,
            vec![("notch-0".to_owned(), 0), ("notch-1".to_owned(), 1)]
        );
        assert!(plan.keep.is_empty() && plan.close.is_empty());
    }

    #[test]
    fn a_monitor_plugged_in_gets_a_new_window() {
        let plan = plan(&windows(&[("notch-0", LAPTOP)]), &[LAPTOP, SCREEN]);
        assert_eq!(plan.keep, vec![("notch-0".to_owned(), 0)]);
        assert_eq!(plan.create, vec![("notch-1".to_owned(), 1)]);
    }

    #[test]
    fn the_window_of_a_monitor_pulled_out_closes() {
        let placed = windows(&[("notch-0", LAPTOP), ("notch-1", SCREEN)]);
        let plan = plan(&placed, &[SCREEN]);
        assert_eq!(plan.keep, vec![("notch-1".to_owned(), 0)]);
        assert_eq!(plan.close, vec!["notch-0".to_owned()]);
        assert!(plan.create.is_empty());
    }

    #[test]
    fn a_new_resolution_moves_the_window_with_its_monitor() {
        let smaller = Rect {
            width: 1280,
            height: 720,
            ..LAPTOP
        };
        let plan = plan(&windows(&[("notch-0", LAPTOP)]), &[smaller]);
        assert_eq!(plan.keep, vec![("notch-0".to_owned(), 0)]);
        assert!(plan.close.is_empty() && plan.create.is_empty());
    }

    #[test]
    fn a_new_window_takes_a_label_past_the_open_ones() {
        let plan = plan(&windows(&[("notch-3", SCREEN)]), &[LAPTOP, SCREEN]);
        assert_eq!(plan.keep, vec![("notch-3".to_owned(), 1)]);
        assert_eq!(plan.create, vec![("notch-4".to_owned(), 0)]);
    }
}
