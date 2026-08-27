use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Rate limiter com janela deslizante por chave de comando.
/// A chave aceita qualquer `&str`, permitindo granularidade por operação + alvo
/// (ex: `"ssh_connect:192.168.1.1"`).
pub struct RateLimiter {
    windows: Mutex<HashMap<String, VecDeque<Instant>>>,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            windows: Mutex::new(HashMap::new()),
        }
    }

    /// Verifica e registra uma chamada para `key`.
    /// Retorna `Err` se já houve `max_calls` chamadas dentro de `window`.
    pub fn check(&self, key: &str, max_calls: usize, window: Duration) -> Result<(), String> {
        let mut windows = self
            .windows
            .lock()
            .map_err(|_| "Rate limiter indisponível".to_string())?;
        let now = Instant::now();
        let timestamps = windows.entry(key.to_string()).or_default();

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
                "Limite de chamadas excedido: máximo {} por {} segundos. Tente novamente em breve.",
                max_calls,
                window.as_secs()
            ));
        }

        timestamps.push_back(now);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_calls_up_to_the_limit() {
        let limiter = RateLimiter::new();
        for _ in 0..3 {
            assert!(limiter.check("cmd", 3, Duration::from_secs(60)).is_ok());
        }
    }

    #[test]
    fn rejects_call_beyond_the_limit() {
        let limiter = RateLimiter::new();
        for _ in 0..3 {
            limiter.check("cmd", 3, Duration::from_secs(60)).unwrap();
        }

        let err = limiter
            .check("cmd", 3, Duration::from_secs(60))
            .expect_err("quarta chamada deveria ser rejeitada");

        assert!(err.contains("Limite de chamadas excedido"));
        assert!(err.contains("máximo 3 por 60 segundos"));
    }

    #[test]
    fn tracks_keys_independently() {
        let limiter = RateLimiter::new();
        let window = Duration::from_secs(60);
        limiter.check("ssh_connect:host-a", 1, window).unwrap();

        // A chave esgotada é rejeitada, mas outra chave ainda passa
        assert!(limiter.check("ssh_connect:host-a", 1, window).is_err());
        assert!(limiter.check("ssh_connect:host-b", 1, window).is_ok());
    }

    #[test]
    fn frees_slots_after_window_expires() {
        let limiter = RateLimiter::new();
        let window = Duration::from_millis(50);

        limiter.check("cmd", 1, window).unwrap();
        assert!(limiter.check("cmd", 1, window).is_err());

        std::thread::sleep(Duration::from_millis(80));
        assert!(limiter.check("cmd", 1, window).is_ok());
    }

    #[test]
    fn rejected_call_does_not_consume_slot() {
        let limiter = RateLimiter::new();
        let window = Duration::from_millis(50);

        limiter.check("cmd", 1, window).unwrap();
        // Chamadas rejeitadas não devem ser registradas na janela
        assert!(limiter.check("cmd", 1, window).is_err());
        assert!(limiter.check("cmd", 1, window).is_err());

        std::thread::sleep(Duration::from_millis(80));
        assert!(limiter.check("cmd", 1, window).is_ok());
    }
}
