use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use tauri_plugin_shell::process::CommandChild;

/// Strips ANSI escape sequences (color codes) from a string.
/// aria2c emits colored output (e.g., `\x1b[1;31mERROR\x1b[0m`) which
/// produces garbage in log files. This removes all CSI sequences.
pub(crate) fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_escape = false;
    for ch in input.chars() {
        if in_escape {
            // CSI sequences end with a letter (A-Z, a-z)
            if ch.is_ascii_alphabetic() {
                in_escape = false;
            }
        } else if ch == '\x1b' {
            in_escape = true;
        } else {
            out.push(ch);
        }
    }
    out
}

/// Logs aria2c stdout with semantic log levels based on aria2's own tags.
///
/// aria2 prefixes output with `[NOTICE]`, `[ERROR]`, or `[WARN]`.
/// This function maps them to the correct `log` level so the global
/// log-level filter works correctly — no `level_for` override needed.
///
/// | aria2 tag   | log level |
/// |-------------|-----------|
/// | `[NOTICE]`  | `info!`   |
/// | `[ERROR]`   | `error!`  |
/// | `[WARN]`    | `warn!`   |
/// | (other)     | `debug!`  |
pub(crate) fn log_engine_stdout(raw: &str) {
    let clean = strip_ansi(raw);
    let trimmed = clean.trim();
    if trimmed.is_empty() {
        return;
    }
    if trimmed.contains("[ERROR]") {
        log::error!("engine: {}", trimmed);
    } else if trimmed.contains("[WARN]") {
        log::warn!("engine: {}", trimmed);
    } else if trimmed.contains("[NOTICE]") {
        log::info!("engine: {}", trimmed);
    } else {
        log::debug!("engine: {}", trimmed);
    }
}

/// Holds the aria2c child process handle, protected by a Mutex for thread-safe access.
///
/// `intentional_stop` distinguishes deliberate kills (restart, update, relaunch)
/// from genuine crashes.  Set to `true` before `child.kill()`, checked by the
/// async Terminated handler to suppress false `engine-error` events.
pub struct EngineState {
    pub(crate) child: Mutex<Option<CommandChild>>,
    pub(crate) intentional_stop: AtomicBool,
    /// Monotonically increasing generation counter.
    /// Each call to `start_engine` / `restart_engine` increments this.
    /// Terminated handlers capture their generation at spawn time and
    /// silently ignore events when their generation is stale.
    gen: AtomicU32,
}

impl EngineState {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            intentional_stop: AtomicBool::new(false),
            gen: AtomicU32::new(0),
        }
    }

    /// Returns the current generation value (used by tests).
    #[cfg(test)]
    pub fn generation(&self) -> u32 {
        self.gen.load(Ordering::SeqCst)
    }

    /// Atomically increments the generation counter and returns the new value.
    pub fn next_generation(&self) -> u32 {
        self.gen.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Returns `true` if `gen` matches the current generation.
    pub fn is_current_generation(&self, gen: u32) -> bool {
        self.gen.load(Ordering::SeqCst) == gen
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── strip_ansi tests ────────────────────────────────────────────────

    #[test]
    fn strip_ansi_removes_color_codes() {
        let input = "\x1b[1;31mERROR\x1b[0m Something went wrong";
        assert_eq!(strip_ansi(input), "ERROR Something went wrong");
    }

    #[test]
    fn strip_ansi_preserves_plain_text() {
        let input = "normal text";
        assert_eq!(strip_ansi(input), "normal text");
    }

    #[test]
    fn strip_ansi_handles_notice_tag() {
        let input =
            "03/15 00:56:16 [\x1b[1;32mNOTICE\x1b[0m] IPv4 RPC: listening on TCP port 16800";
        let clean = strip_ansi(input);
        assert!(clean.contains("[NOTICE]"));
        assert!(!clean.contains("\x1b"));
    }

    #[test]
    fn strip_ansi_handles_error_tag() {
        let input = "03/15 00:23:41 [\x1b[1;31mERROR\x1b[0m] Unrecognized URI";
        let clean = strip_ansi(input);
        assert!(clean.contains("[ERROR]"));
        assert!(!clean.contains("\x1b"));
    }

    #[test]
    fn strip_ansi_empty_string() {
        assert_eq!(strip_ansi(""), "");
    }

    #[test]
    fn strip_ansi_multiple_sequences_in_one_line() {
        let input = "\x1b[32m[NOTICE]\x1b[0m downloading \x1b[1mfile.zip\x1b[0m (100%)";
        let clean = strip_ansi(input);
        assert_eq!(clean, "[NOTICE] downloading file.zip (100%)");
        assert!(!clean.contains('\x1b'));
    }

    #[test]
    fn strip_ansi_partial_escape_at_eof() {
        // Unterminated escape sequence: ESC [ but no closing alpha char
        let input = "trailing\x1b[";
        let clean = strip_ansi(input);
        assert_eq!(clean, "trailing");
    }

    // ── Generation counter tests ────────────────────────────────────────

    #[test]
    fn engine_state_starts_at_generation_zero() {
        let state = EngineState::new();
        assert_eq!(state.generation(), 0);
    }

    #[test]
    fn next_generation_increments_monotonically() {
        let state = EngineState::new();
        assert_eq!(state.next_generation(), 1);
        assert_eq!(state.next_generation(), 2);
        assert_eq!(state.next_generation(), 3);
        assert_eq!(state.generation(), 3);
    }

    #[test]
    fn is_current_generation_true_for_matching() {
        let state = EngineState::new();
        let gen = state.next_generation();
        assert!(state.is_current_generation(gen));
    }

    #[test]
    fn is_current_generation_false_for_stale() {
        let state = EngineState::new();
        let old_gen = state.next_generation();
        let _new_gen = state.next_generation();
        // Old generation must NOT match current
        assert!(!state.is_current_generation(old_gen));
    }

    #[test]
    fn is_current_generation_false_for_zero() {
        let state = EngineState::new();
        let _gen = state.next_generation();
        // Generation 0 (initial) is never "current" after any increment
        assert!(!state.is_current_generation(0));
    }

    #[test]
    fn intentional_stop_is_independent_of_generation() {
        let state = EngineState::new();
        state.intentional_stop.store(true, Ordering::SeqCst);
        let _gen = state.next_generation();
        // Incrementing generation must NOT touch intentional_stop
        assert!(state.intentional_stop.load(Ordering::SeqCst));
    }
}
