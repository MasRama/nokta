//! HTTP clients.

/// Builds a client from `configure`. On a system without CA certificates
/// (a bare container) the client trusts no certificate, so HTTPS requests
/// fail one by one instead of noktad failing to start.
pub fn client(
    configure: impl Fn(reqwest::ClientBuilder) -> reqwest::ClientBuilder,
) -> reqwest::Client {
    // TLS runs on ring, a few MB smaller than rustls' default aws-lc. Only
    // the first call installs it; the later ones find it there.
    let _ = rustls::crypto::ring::default_provider().install_default();
    match configure(reqwest::Client::builder()).build() {
        Ok(client) => client,
        Err(err) => {
            tracing::warn!("no HTTPS, so no lyrics or covers from the web: {err:#}");
            configure(reqwest::Client::builder())
                .tls_certs_only([])
                .build()
                .expect("a client without certificates always builds")
        }
    }
}
