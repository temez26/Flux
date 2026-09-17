mod cleanup;
mod download;
mod error;
mod health;
mod nearby;
mod notes;
mod signal;
mod stun;
mod thumbs;
mod transfers;
mod upload;
mod zip;

use std::{net::SocketAddr, path::PathBuf, sync::Arc};

use axum::{
    Router,
    extract::DefaultBodyLimit,
    http::{HeaderValue, header},
    response::Redirect,
    routing::{get, patch, post, put},
};
use sqlx::postgres::PgPoolOptions;
use tower_http::{
    compression::CompressionLayer,
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
};
use tracing_subscriber::EnvFilter;

pub struct AppState {
    pub db: sqlx::PgPool,
    pub data_dir: PathBuf,
    pub uploads: upload::Registry,
    pub rooms: signal::Rooms,
    pub nearby: nearby::Presence,
    pub notes: notes::Notes,
    /// Where pages should look for this server's STUN responder, if it started.
    pub stun_port: Option<u16>,
}

pub type Shared = Arc<AppState>;

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_owned())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr: SocketAddr = env_or("FLUX_ADDR", "0.0.0.0:8080").parse()?;
    // Docker's healthcheck runs this; the distroless image has nothing else to ask with.
    if std::env::args().nth(1).as_deref() == Some("healthcheck") {
        std::process::exit(if health::probe(addr) { 0 } else { 1 });
    }

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let database_url = std::env::var("DATABASE_URL").map_err(|_| "DATABASE_URL must be set")?;
    let data_dir = PathBuf::from(env_or("FLUX_DATA_DIR", "data"));
    let web_dir = PathBuf::from(env_or("FLUX_WEB_DIR", "../web/out"));

    tokio::fs::create_dir_all(&data_dir).await?;
    let db = PgPoolOptions::new().max_connections(16).connect(&database_url).await?;
    sqlx::migrate!().run(&db).await?;

    // Set FLUX_STUN_PORT=0 to leave it off; direct transfers then depend on the browsers
    // resolving each other's mDNS names, which many networks don't do.
    let stun_port: u16 = env_or("FLUX_STUN_PORT", "3478").parse().unwrap_or(3478);
    let stun = match stun_port {
        0 => None,
        port => match tokio::net::UdpSocket::bind(("0.0.0.0", port)).await {
            Ok(socket) => {
                tracing::info!("stun responder on 0.0.0.0:{port}");
                stun::spawn(socket);
                Some(port)
            }
            Err(err) => {
                tracing::warn!("no stun responder on {port}: {err}; direct transfers may not connect");
                None
            }
        },
    };

    let state = Arc::new(AppState {
        db,
        data_dir,
        uploads: Default::default(),
        rooms: Default::default(),
        nearby: Default::default(),
        notes: Default::default(),
        stun_port: stun,
    });
    cleanup::remove_orphans(&state).await?;
    cleanup::spawn(state.clone());

    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("listening on {addr}");
    health::watch(addr);
    // Each connection's address, for telling a page which one it reaches this server from.
    axum::serve(
        listener,
        app(state, &web_dir).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;
    Ok(())
}

fn app(state: Shared, web_dir: &std::path::Path) -> Router {
    let api = Router::new()
        .route(
            "/transfers",
            post(transfers::create).layer(DefaultBodyLimit::max(64 << 20)),
        )
        .route(
            "/transfers/{code}",
            get(transfers::get)
                .layer(CompressionLayer::new())
                .patch(transfers::update)
                .delete(transfers::delete),
        )
        .route(
            "/transfers/{code}/files",
            post(transfers::add_files).layer(DefaultBodyLimit::max(64 << 20)),
        )
        .route(
            "/transfers/{code}/files/{idx}",
            patch(upload::chunk)
                .layer(DefaultBodyLimit::disable())
                .get(download::file)
                .delete(transfers::delete_file),
        )
        .route("/transfers/{code}/files/{idx}/thumb", get(thumbs::thumb))
        .route("/transfers/{code}/zip", get(download::zip))
        .route("/transfers/{code}/summary", get(transfers::summary))
        .route(
            "/transfers/{code}/note",
            put(transfers::save_note).layer(DefaultBodyLimit::max(8 << 20)),
        )
        .route("/transfers/{code}/note/live", get(notes::connect))
        .route("/transfers/{code}/downloads", post(transfers::count_download))
        .route("/transfers/{code}/signal", get(signal::connect))
        .route("/nearby", get(nearby::connect))
        .route("/public", get(transfers::list_public).layer(CompressionLayer::new()))
        .route("/config", get(stun::config))
        .fallback(|| async { error::AppError::NOT_FOUND })
        .with_state(state);

    // Hashed build assets never change; everything else must revalidate so updates ship immediately.
    let immutable = ServeDir::new(web_dir.join("_next/static"));
    // Unknown paths (e.g. /<code>) fall back to the single-page app shell.
    let shell = ServeDir::new(web_dir).fallback(ServeFile::new(web_dir.join("index.html")));

    Router::new()
        .nest("/api", api)
        // The installed app's service worker answers shares from other apps. Without one — not
        // installed after all, or not running yet — the share is lost, but it lands on the
        // home page rather than an error.
        .route("/share-target", post(|| async { Redirect::to("/") }))
        .nest_service(
            "/_next/static",
            tower::ServiceBuilder::new()
                .layer(SetResponseHeaderLayer::overriding(
                    header::CACHE_CONTROL,
                    HeaderValue::from_static("public, max-age=31536000, immutable"),
                ))
                .layer(CompressionLayer::new())
                .service(immutable),
        )
        .fallback_service(
            tower::ServiceBuilder::new()
                .layer(SetResponseHeaderLayer::overriding(
                    header::CACHE_CONTROL,
                    HeaderValue::from_static("no-cache"),
                ))
                .layer(CompressionLayer::new())
                .service(shell),
        )
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.ok();
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
