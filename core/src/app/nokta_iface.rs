//! `io.nokta.Nokta1` at `/io/nokta/Nokta`: what clients check before anything else.

pub const PATH: &str = "/io/nokta/Nokta";
/// Bumped on any incompatible change to `contracts/*.xml`.
pub const API_VERSION: u32 = 1;

pub struct NoktaInterface;

#[zbus::interface(name = "io.nokta.Nokta1")]
impl NoktaInterface {
    #[zbus(property(emits_changed_signal = "const"))]
    fn api_version(&self) -> u32 {
        API_VERSION
    }

    #[zbus(property(emits_changed_signal = "const"))]
    fn daemon_version(&self) -> String {
        env!("CARGO_PKG_VERSION").to_owned()
    }
}
