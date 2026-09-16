use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

#[derive(Debug)]
pub struct AppError(pub StatusCode, pub &'static str);

pub type Result<T, E = AppError> = std::result::Result<T, E>;

impl AppError {
    pub const NOT_FOUND: Self = Self(StatusCode::NOT_FOUND, "not found");
    pub const UNAUTHORIZED: Self = Self(StatusCode::UNAUTHORIZED, "unauthorized");
    pub const INTERNAL: Self = Self(StatusCode::INTERNAL_SERVER_ERROR, "internal error");

    pub fn bad_request(message: &'static str) -> Self {
        Self(StatusCode::BAD_REQUEST, message)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        tracing::error!("database error: {err}");
        Self::INTERNAL
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        tracing::error!("io error: {err}");
        Self::INTERNAL
    }
}
