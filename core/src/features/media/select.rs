//! Active player selection.
//!
//! A playing player wins, the one that most recently started playing first.
//! Otherwise the paused player that stopped playing most recently. A player that was
//! already paused when Nokta first saw it ranks below every player seen
//! playing, so a paused player at login still shows up.
//!
//! The user can choose a player. It counts as just started playing and stays
//! active, even paused, until another player starts playing or it stops.

use std::collections::HashMap;

use super::PlaybackStatus;

#[derive(Debug, Default)]
pub struct Selector {
    players: HashMap<String, Entry>,
    seq: u64,
    /// The player the user chose and `seq` at that moment.
    chosen: Option<(String, u64)>,
}

#[derive(Debug)]
struct Entry {
    status: PlaybackStatus,
    /// `Selector::seq` when this player last changed to `Playing`; 0 if never.
    started_at: u64,
    /// `Selector::seq` when this player last left `Playing`; 0 if never.
    stopped_at: u64,
    /// `Selector::seq` when the player first appeared, for the list order.
    seen_at: u64,
}

impl Selector {
    pub fn set_status(&mut self, bus_name: &str, status: PlaybackStatus) {
        if !self.players.contains_key(bus_name) {
            self.seq += 1;
        }
        let seq = self.seq;
        let entry = self.players.entry(bus_name.to_owned()).or_insert(Entry {
            status: PlaybackStatus::Stopped,
            started_at: 0,
            stopped_at: 0,
            seen_at: seq,
        });
        let was_playing = entry.status == PlaybackStatus::Playing;
        let is_playing = status == PlaybackStatus::Playing;
        if was_playing != is_playing {
            self.seq += 1;
            if is_playing {
                entry.started_at = self.seq;
            } else {
                entry.stopped_at = self.seq;
            }
        }
        entry.status = status;
        if status == PlaybackStatus::Stopped {
            self.forget_choice(bus_name);
        }
    }

    pub fn remove(&mut self, bus_name: &str) {
        self.players.remove(bus_name);
        self.forget_choice(bus_name);
    }

    /// Makes `bus_name` the active player. Returns false, changing nothing,
    /// for an unknown or stopped player.
    pub fn select(&mut self, bus_name: &str) -> bool {
        match self.players.get(bus_name) {
            Some(e) if e.status != PlaybackStatus::Stopped => {
                self.seq += 1;
                self.chosen = Some((bus_name.to_owned(), self.seq));
                true
            }
            _ => false,
        }
    }

    /// Playing and paused players, in the order they appeared.
    pub fn players(&self) -> Vec<&str> {
        let mut running: Vec<_> = self
            .players
            .iter()
            .filter(|(_, e)| e.status != PlaybackStatus::Stopped)
            .collect();
        running.sort_by_key(|(_, e)| e.seen_at);
        running.into_iter().map(|(name, _)| name.as_str()).collect()
    }

    pub fn active(&self) -> Option<&str> {
        self.chosen()
            .or_else(|| self.best(PlaybackStatus::Playing, |e| e.started_at))
            .or_else(|| self.best(PlaybackStatus::Paused, |e| e.stopped_at))
    }

    /// The chosen player, unless another one started playing since.
    fn chosen(&self) -> Option<&str> {
        let (name, at) = self.chosen.as_ref()?;
        let overtaken = self.players.iter().any(|(other, e)| {
            other != name && e.status == PlaybackStatus::Playing && e.started_at > *at
        });
        (!overtaken).then_some(name.as_str())
    }

    fn forget_choice(&mut self, bus_name: &str) {
        if self
            .chosen
            .as_ref()
            .is_some_and(|(name, _)| name == bus_name)
        {
            self.chosen = None;
        }
    }

    fn best(&self, status: PlaybackStatus, rank: fn(&Entry) -> u64) -> Option<&str> {
        self.players
            .iter()
            .filter(|(_, e)| e.status == status)
            // Ties only happen between never-played players; the name keeps it stable.
            .max_by(|(an, a), (bn, b)| rank(a).cmp(&rank(b)).then_with(|| bn.cmp(an)))
            .map(|(name, _)| name.as_str())
    }
}
