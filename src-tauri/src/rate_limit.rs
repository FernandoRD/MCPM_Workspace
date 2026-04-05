use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Rate limiter com janela deslizante por chave de comando.
pub struct RateLimiter {
    windows: Mutex<HashMap<&'static str, VecDeque<Instant>>>,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            windows: Mutex::new(HashMap::new()),
        }
    }

    /// Verifica e registra uma chamada para `key`.
    /// Retorna `Err` se já houve `max_calls` chamadas dentro de `window`.
    pub fn check(&self, key: &'static str, max_calls: usize, window: Duration) -> Result<(), String> {
        let mut windows = self.windows.lock().unwrap();
        let now = Instant::now();
        let timestamps = windows.entry(key).or_default();

        // Remove entradas fora da janela de tempo
        while let Some(&front) = timestamps.front() {
            if now.duration_since(front) > window {
                timestamps.pop_front();
            } else {
                break;
            }
        }

        if timestamps.len() >= max_calls {
            return Err(format!(
                "Limite de chamadas excedido para '{}': máximo {} por {} segundos. Tente novamente em breve.",
                key, max_calls, window.as_secs()
            ));
        }

        timestamps.push_back(now);
        Ok(())
    }
}
