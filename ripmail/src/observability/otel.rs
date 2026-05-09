//! OpenTelemetry traces → New Relic via OTLP/HTTP (protobuf).
//!
//! Enabled when `NEW_RELIC_LICENSE_KEY` is non-empty (same signal as the Node agent).
//! Parent trace: W3C `TRACEPARENT` / `TRACESTATE` from Brain’s subprocess env.

use std::collections::HashMap;
use std::sync::Mutex;

use opentelemetry::global;
use opentelemetry::propagation::{Extractor, TextMapPropagator};
use opentelemetry::trace::{SpanKind, Status, TraceContextExt, Tracer};
use opentelemetry::Context;
use opentelemetry::KeyValue;
use opentelemetry_otlp::{Protocol, SpanExporter, WithExportConfig, WithHttpConfig};
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::SdkTracerProvider;
use opentelemetry_sdk::Resource;
use opentelemetry_semantic_conventions::attribute::{
    HTTP_REQUEST_METHOD, HTTP_RESPONSE_STATUS_CODE, URL_FULL,
};

const DEFAULT_NR_OTLP_ENDPOINT: &str = "https://otlp.nr-data.net";
const RIPMAIL_TRACER_NAME: &str = "ripmail";

static TRACER_PROVIDER: Mutex<Option<SdkTracerProvider>> = Mutex::new(None);

struct EnvMapExtractor<'a>(&'a HashMap<String, String>);

impl Extractor for EnvMapExtractor<'_> {
    fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).map(String::as_str)
    }

    fn keys(&self) -> Vec<&str> {
        self.0.keys().map(String::as_str).collect()
    }
}

/// True when OTLP export should run (mirrors Node `agent_enabled` when license key present).
pub fn nr_otel_enabled_from_parts(license_key: Option<&str>) -> bool {
    license_key
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_some()
}

fn nr_otel_enabled_process() -> bool {
    nr_otel_enabled_from_parts(std::env::var("NEW_RELIC_LICENSE_KEY").ok().as_deref())
}

fn trim_env(key: &str) -> Option<String> {
    std::env::var(key).ok().and_then(|s| {
        let t = s.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    })
}

fn parent_context_from_carrier(map: &HashMap<String, String>) -> Context {
    if map.is_empty() {
        return Context::new();
    }
    TraceContextPropagator::new().extract(&EnvMapExtractor(map))
}

fn parent_context_from_env() -> Context {
    let mut map = HashMap::new();
    if let Some(v) = trim_env("TRACEPARENT") {
        map.insert("traceparent".to_string(), v);
    }
    if let Some(v) = trim_env("TRACESTATE") {
        map.insert("tracestate".to_string(), v);
    }
    parent_context_from_carrier(&map)
}

fn build_otlp_headers(license: &str) -> HashMap<String, String> {
    if let Ok(raw) = std::env::var("OTEL_EXPORTER_OTLP_HEADERS") {
        let t = raw.trim();
        if !t.is_empty() {
            return parse_otlp_headers(&raw);
        }
    }
    let mut h = HashMap::new();
    h.insert("api-key".to_string(), license.to_string());
    h
}

fn parse_otlp_headers(raw: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for part in raw.split(',') {
        let part = part.trim();
        if let Some((k, v)) = part.split_once('=') {
            let k = k.trim();
            let v = v.trim();
            if !k.is_empty() {
                out.insert(k.to_string(), v.to_string());
            }
        }
    }
    out
}

fn resolve_otlp_endpoint() -> String {
    if let Some(e) = trim_env("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") {
        return e;
    }
    if let Some(e) = trim_env("OTEL_EXPORTER_OTLP_ENDPOINT") {
        return e;
    }
    DEFAULT_NR_OTLP_ENDPOINT.to_string()
}

fn build_exporter() -> Result<SpanExporter, String> {
    let license = trim_env("NEW_RELIC_LICENSE_KEY").ok_or("missing NEW_RELIC_LICENSE_KEY")?;
    let endpoint = resolve_otlp_endpoint();
    let headers = build_otlp_headers(&license);

    let protocol = Protocol::from_env().unwrap_or(Protocol::HttpBinary);

    SpanExporter::builder()
        .with_http()
        .with_endpoint(endpoint)
        .with_protocol(protocol)
        .with_headers(headers)
        .with_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("otlp span exporter: {e}"))
}

fn build_resource() -> Resource {
    let mut b = Resource::builder_empty().with_service_name("ripmail");
    b = b.with_attribute(KeyValue::new(
        opentelemetry_semantic_conventions::resource::SERVICE_VERSION,
        env!("CARGO_PKG_VERSION"),
    ));
    if let Some(name) = trim_env("NEW_RELIC_APP_NAME") {
        b = b.with_attribute(KeyValue::new("brain.nr_app_name", name));
    }
    b.build()
}

/// Install global tracer provider. No-op if disabled or exporter build fails.
pub fn init_from_env() {
    if !nr_otel_enabled_process() {
        return;
    }
    let exporter = match build_exporter() {
        Ok(e) => e,
        Err(_) => return,
    };
    let resource = build_resource();
    let provider = SdkTracerProvider::builder()
        .with_resource(resource)
        .with_simple_exporter(exporter)
        .build();
    global::set_tracer_provider(provider.clone());
    if let Ok(mut g) = TRACER_PROVIDER.lock() {
        *g = Some(provider);
    }
}

/// Flush and shut down the tracer provider installed by [`init_from_env`].
pub fn shutdown() {
    if let Ok(mut g) = TRACER_PROVIDER.lock() {
        if let Some(p) = g.take() {
            let _ = p.shutdown();
        }
    }
    global::set_tracer_provider(opentelemetry::trace::noop::NoopTracerProvider::new());
}

fn otel_tracing_active() -> bool {
    nr_otel_enabled_process() && TRACER_PROVIDER.lock().map(|g| g.is_some()).unwrap_or(false)
}

fn invocation_attributes(subcommand: &str) -> Vec<KeyValue> {
    let mut attrs = vec![
        KeyValue::new("ripmail.subcommand", subcommand.to_string()),
        KeyValue::new("ripmail.version", env!("CARGO_PKG_VERSION")),
    ];
    if let Some(s) = trim_env("RIPMAIL_TIMEOUT") {
        attrs.push(KeyValue::new("ripmail.timeout_sec", s));
    }
    if let Some(s) = trim_env("RIPMAIL_SPAWN_LABEL") {
        attrs.push(KeyValue::new("ripmail.spawn_label", s));
    }
    if let Some(s) = trim_env("BRAIN_TENANT_USER_ID") {
        attrs.push(KeyValue::new("brain.tenant_user_id", s));
    }
    if let Some(s) = trim_env("BRAIN_WORKSPACE_HANDLE") {
        attrs.push(KeyValue::new("brain.workspace_handle", s));
    }
    attrs
}

/// CLI result type used by [`run_invocation_traced`].
pub type OtelCliResult = Result<(), Box<dyn std::error::Error>>;

/// Wrap the CLI body in span `ripmail.invoke` (child of `TRACEPARENT` when present).
pub fn run_invocation_traced(subcommand: &str, f: impl FnOnce() -> OtelCliResult) -> OtelCliResult {
    if !otel_tracing_active() {
        return f();
    }

    let tracer = global::tracer(RIPMAIL_TRACER_NAME);
    let parent = parent_context_from_env();

    let span = tracer
        .span_builder("ripmail.invoke")
        .with_kind(SpanKind::Internal)
        .with_attributes(invocation_attributes(subcommand))
        .start_with_context(&tracer, &parent);

    let cx = parent.with_span(span);
    let _guard = cx.clone().attach();

    let res = f();

    let span = cx.span();
    match &res {
        Ok(()) => span.set_status(Status::Ok),
        Err(e) => span.set_status(Status::error(format!("{e}"))),
    }

    drop(_guard);
    span.end();

    res
}

/// Run `f` inside a client span (nested under current context, e.g. `ripmail.invoke`).
/// `f` returns the HTTP status when the request completed (for Ok).
pub fn with_http_client_span<R, E: std::fmt::Display>(
    operation_name: impl Into<std::borrow::Cow<'static, str>>,
    method: &str,
    url: &str,
    f: impl FnOnce() -> Result<(R, u16), E>,
) -> Result<R, E> {
    if !nr_otel_enabled_process() {
        return f().map(|(r, _)| r);
    }

    let tracer = global::tracer(RIPMAIL_TRACER_NAME);
    let span = tracer
        .span_builder(operation_name)
        .with_kind(SpanKind::Client)
        .with_attributes([
            KeyValue::new(HTTP_REQUEST_METHOD, method.to_string()),
            KeyValue::new(URL_FULL, url.to_string()),
        ])
        .start(&tracer);

    let cx = Context::current().with_span(span);
    let _guard = cx.clone().attach();

    let out = f();

    let span = cx.span();
    match &out {
        Ok((_, code)) => {
            span.set_attribute(KeyValue::new(HTTP_RESPONSE_STATUS_CODE, i64::from(*code)));
            if *code >= 400 {
                span.set_status(Status::error(format!("HTTP {code}")));
            } else {
                span.set_status(Status::Ok);
            }
        }
        Err(e) => {
            span.set_status(Status::error(format!("{e}")));
        }
    }

    drop(_guard);
    span.end();

    out.map(|(r, _)| r)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use opentelemetry::trace::TraceContextExt;

    use super::{nr_otel_enabled_from_parts, parent_context_from_carrier};

    #[test]
    fn nr_otel_enabled_from_license_trim() {
        assert!(!nr_otel_enabled_from_parts(None));
        assert!(!nr_otel_enabled_from_parts(Some("")));
        assert!(!nr_otel_enabled_from_parts(Some("  \t ")));
        assert!(nr_otel_enabled_from_parts(Some(" nrkey ")));
    }

    #[test]
    fn traceparent_carrier_links_to_parent_trace() {
        let mut map = HashMap::new();
        map.insert(
            "traceparent".into(),
            "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01".into(),
        );
        let cx = parent_context_from_carrier(&map);
        let span = cx.span();
        let sc = span.span_context();
        assert!(sc.is_valid());
        assert_eq!(
            format!("{:032x}", sc.trace_id()),
            "0af7651916cd43dd8448eb211c80319c"
        );
    }

    #[test]
    fn empty_carrier_is_no_remote_parent() {
        let map = HashMap::new();
        let cx = parent_context_from_carrier(&map);
        let span = cx.span();
        assert!(!span.span_context().is_valid());
    }
}
