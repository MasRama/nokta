//! Active player selection (spec 4.2).
//!
//! A playing player wins, the one that most recently started playing first.
//! Otherwise the paused player that stopped playing most recently. A player that was
//! already paused when Nokta first saw it ranks below every player seen
//! playing, so a paused player at login still shows up.

use std::collections::HashMap;

use super::PlaybackStatus;

#[derive(Debug, Default)]
pub struct Selector {
    players: HashMap<String, Entry>,
    seq: u64,
}

#[derive(Debug)]
struct Entry {
    status: PlaybackStatus,
    /// `Selector::seq` when this player last changed to `Playing`; 0 if never.
    started_at: u64,
    /// `Selector::seq` when this player last left `Playing`; 0 if never.
    stopped_at: u64,
}

impl Selector {
    pub fn set_status(&mut self, bus_name: &str, status: PlaybackStatus) {
        let entry = self.players.entry(bus_name.to_owned()).or_insert(Entry {
            status: PlaybackStatus::Stopped,
            started_at: 0,
            stopped_at: 0,
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
    }

    pub fn remove(&mut self, bus_name: &str) {
        self.players.remove(bus_name);
    }

    pub fn active(&self) -> Option<&str> {
        self.best(PlaybackStatus::Playing, |e| e.started_at)
            .or_else(|| self.best(PlaybackStatus::Paused, |e| e.stopped_at))
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
