use std::collections::HashMap;
use std::sync::Mutex;

use metrics::{Counter, Gauge, Histogram, Key, KeyName, Metadata, Recorder, SharedString, Unit};
use opentelemetry::KeyValue;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::logs::SdkLoggerProvider;
use opentelemetry_sdk::metrics::SdkMeterProvider;
use opentelemetry_sdk::trace::SdkTracerProvider;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, Layer, Registry, filter::filter_fn, fmt};

const OTLP_ENDPOINT: &str = "OTEL_EXPORTER_OTLP_ENDPOINT";

#[must_use = "dropping Telemetry shuts the exporters down"]
pub struct Telemetry {
    otel: Option<Providers>,
}

struct Providers {
    tracer: SdkTracerProvider,
    logger: SdkLoggerProvider,
    meter: SdkMeterProvider,
}

pub fn init(service: &'static str, version: &'static str) -> Telemetry {
    let otel = match std::env::var(OTLP_ENDPOINT) {
        Ok(endpoint) if !endpoint.trim().is_empty() => match Providers::new(service, version) {
            Ok(p) => Some(p),
            Err(err) => {
                eprintln!("telemetry: OTLP export disabled, setup failed: {err}");
                None
            }
        },
        _ => None,
    };

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let stdout = if std::env::var("LOG_FORMAT").as_deref() == Ok("json") {
        fmt::layer().json().boxed()
    } else {
        fmt::layer().boxed()
    };

    let mut layers: Vec<Box<dyn Layer<Registry> + Send + Sync>> = vec![stdout];
    if let Some(p) = &otel {
        layers.push(
            tracing_opentelemetry::layer()
                .with_tracer(p.tracer.tracer(service))
                .boxed(),
        );
        layers.push(
            OpenTelemetryTracingBridge::new(&p.logger)
                .with_filter(filter_fn(|m| !is_exporter_internal(m.target())))
                .boxed(),
        );
    }
    tracing_subscriber::registry()
        .with(layers.with_filter(filter))
        .init();

    tracing::info!(service, otlp = otel.is_some(), "telemetry initialised");
    Telemetry { otel }
}

fn is_exporter_internal(target: &str) -> bool {
    ["opentelemetry", "tonic", "h2", "hyper", "tower"]
        .iter()
        .any(|p| target.starts_with(p))
}

impl Providers {
    fn new(service: &'static str, version: &'static str) -> anyhow::Result<Self> {
        let env = std::env::var("APP_ENV").unwrap_or_else(|_| "development".into());
        let name = std::env::var("OTEL_SERVICE_NAME")
            .ok()
            .filter(|n| !n.trim().is_empty())
            .unwrap_or_else(|| service.to_owned());
        let resource = Resource::builder()
            .with_service_name(name)
            .with_attributes([
                KeyValue::new("service.version", version),
                KeyValue::new("deployment.environment", env.clone()),
                KeyValue::new("deployment.environment.name", env),
            ])
            .build();

        let tracer = SdkTracerProvider::builder()
            .with_batch_exporter(
                opentelemetry_otlp::SpanExporter::builder()
                    .with_tonic()
                    .build()?,
            )
            .with_resource(resource.clone())
            .build();
        let logger = SdkLoggerProvider::builder()
            .with_batch_exporter(
                opentelemetry_otlp::LogExporter::builder()
                    .with_tonic()
                    .build()?,
            )
            .with_resource(resource.clone())
            .build();
        let meter = SdkMeterProvider::builder()
            .with_periodic_exporter(
                opentelemetry_otlp::MetricExporter::builder()
                    .with_tonic()
                    .build()?,
            )
            .with_resource(resource)
            .build();
        Ok(Self {
            tracer,
            logger,
            meter,
        })
    }
}

impl Telemetry {
    pub fn install_metrics<R>(&self, local: R) -> anyhow::Result<()>
    where
        R: Recorder + Send + Sync + 'static,
    {
        match &self.otel {
            None => metrics::set_global_recorder(local)
                .map_err(|_| anyhow::anyhow!("metrics recorder already set"))?,
            Some(p) => {
                let otel = metrics_exporter_opentelemetry::Recorder::with_meter(
                    opentelemetry::metrics::MeterProvider::meter(&p.meter, "metrics"),
                );
                let fanout = metrics_util::layers::FanoutBuilder::default()
                    .add_recorder(local)
                    .add_recorder(Cached::new(otel))
                    .build();
                metrics::set_global_recorder(fanout)
                    .map_err(|_| anyhow::anyhow!("metrics recorder already set"))?;
            }
        }
        Ok(())
    }

    pub fn shutdown(&mut self) {
        if let Some(p) = self.otel.take() {
            let _ = p.tracer.shutdown();
            let _ = p.logger.shutdown();
            let _ = p.meter.shutdown();
        }
    }
}

impl Drop for Telemetry {
    fn drop(&mut self) {
        self.shutdown();
    }
}

struct Cached<R> {
    inner: R,
    counters: Mutex<HashMap<Key, Counter>>,
    gauges: Mutex<HashMap<Key, Gauge>>,
    histograms: Mutex<HashMap<Key, Histogram>>,
}

impl<R> Cached<R> {
    fn new(inner: R) -> Self {
        Self {
            inner,
            counters: Mutex::default(),
            gauges: Mutex::default(),
            histograms: Mutex::default(),
        }
    }
}

fn cached<T: Clone>(map: &Mutex<HashMap<Key, T>>, key: &Key, make: impl FnOnce() -> T) -> T {
    let mut map = map.lock().unwrap_or_else(|e| e.into_inner());
    map.entry(key.clone()).or_insert_with(make).clone()
}

impl<R: Recorder> Recorder for Cached<R> {
    fn describe_counter(&self, key: KeyName, unit: Option<Unit>, description: SharedString) {
        self.inner.describe_counter(key, unit, description);
    }
    fn describe_gauge(&self, key: KeyName, unit: Option<Unit>, description: SharedString) {
        self.inner.describe_gauge(key, unit, description);
    }
    fn describe_histogram(&self, key: KeyName, unit: Option<Unit>, description: SharedString) {
        self.inner.describe_histogram(key, unit, description);
    }
    fn register_counter(&self, key: &Key, metadata: &Metadata<'_>) -> Counter {
        cached(&self.counters, key, || {
            self.inner.register_counter(key, metadata)
        })
    }
    fn register_gauge(&self, key: &Key, metadata: &Metadata<'_>) -> Gauge {
        cached(&self.gauges, key, || {
            self.inner.register_gauge(key, metadata)
        })
    }
    fn register_histogram(&self, key: &Key, metadata: &Metadata<'_>) -> Histogram {
        cached(&self.histograms, key, || {
            self.inner.register_histogram(key, metadata)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exporter_logs_are_not_reexported() {
        assert!(is_exporter_internal("opentelemetry_sdk::logs"));
        assert!(is_exporter_internal("h2::codec"));
        assert!(!is_exporter_internal("api::features::auth"));
    }

    #[test]
    fn cached_recorder_returns_same_gauge() {
        let otel = metrics_exporter_opentelemetry::Recorder::with_meter(
            opentelemetry::global::meter("test"),
        );
        let rec = Cached::new(otel);
        let key = Key::from_name("g");
        let meta = Metadata::new("t", metrics::Level::INFO, None);
        rec.register_gauge(&key, &meta).increment(1.0);
        assert_eq!(rec.gauges.lock().unwrap().len(), 1);
        rec.register_gauge(&key, &meta).increment(1.0);
        assert_eq!(rec.gauges.lock().unwrap().len(), 1);
    }
}
