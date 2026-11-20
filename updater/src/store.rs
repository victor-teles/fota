//! Durable storage for [`PatchState`].
//!
//! The state file is a small versioned text document written atomically (temp file, fsync,
//! rename, directory fsync), so a process killed at any instruction leaves either the previous
//! or the new state on disk, never a mix.

use std::fmt;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use crate::state::PatchState;

/// Format version written by this build. Loading any other version fails.
pub const STATE_FORMAT_VERSION: u32 = 1;

/// State files larger than this many bytes are rejected as corrupt.
pub const MAX_STATE_FILE_BYTES: u64 = 64 * 1024;

const HEADER: &str = "fota-state";

/// Failure to load or save a [`PatchState`].
#[derive(Debug)]
pub enum StoreError {
    /// The filesystem rejected a read, write, fsync or rename.
    Io(io::Error),
    /// The file exists but was written by an unknown format version.
    UnsupportedVersion(u32),
    /// The file exists but is not a valid state document.
    Corrupt(&'static str),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreError::Io(error) => write!(f, "state file i/o failed: {error}"),
            StoreError::UnsupportedVersion(version) => {
                write!(f, "unsupported state format version {version}")
            }
            StoreError::Corrupt(reason) => write!(f, "corrupt state file: {reason}"),
        }
    }
}

impl std::error::Error for StoreError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            StoreError::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<io::Error> for StoreError {
    fn from(error: io::Error) -> Self {
        StoreError::Io(error)
    }
}

/// Reads and writes a [`PatchState`] at a fixed path.
///
/// The parent directory must exist. A sibling file with a `.tmp` suffix is used while saving.
#[derive(Debug, Clone)]
pub struct StateStore {
    path: PathBuf,
    temp_path: PathBuf,
}

impl StateStore {
    /// Creates a store for the state file at `path`. Does not touch the filesystem.
    pub fn new(path: impl Into<PathBuf>) -> Self {
        let path = path.into();
        let mut temp_name = path.file_name().unwrap_or_default().to_os_string();
        temp_name.push(".tmp");
        let temp_path = path.with_file_name(temp_name);
        StateStore { path, temp_path }
    }

    /// Path of the state file.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Loads the saved state. Returns `Ok(None)` when no state has been saved yet.
    ///
    /// Fails with [`StoreError::Corrupt`] or [`StoreError::UnsupportedVersion`] when the file
    /// exists but cannot be trusted; callers should then boot the base snapshot.
    pub fn load(&self) -> Result<Option<PatchState>, StoreError> {
        let file = match File::open(&self.path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        let mut bytes = Vec::new();
        file.take(MAX_STATE_FILE_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_STATE_FILE_BYTES {
            return Err(StoreError::Corrupt("file too large"));
        }
        let text = std::str::from_utf8(&bytes).map_err(|_| StoreError::Corrupt("not utf-8"))?;
        decode(text).map(Some)
    }

    /// Atomically replaces the saved state with `state`.
    ///
    /// On error the previously saved state is left intact.
    pub fn save(&self, state: &PatchState) -> Result<(), StoreError> {
        let encoded = encode(state);
        let mut file = File::create(&self.temp_path)?;
        file.write_all(encoded.as_bytes())?;
        file.sync_all()?;
        drop(file);
        fs::rename(&self.temp_path, &self.path)?;
        sync_parent_directory(&self.path)?;
        Ok(())
    }
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) -> io::Result<()> {
    match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => File::open(parent)?.sync_all(),
        _ => File::open(".")?.sync_all(),
    }
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) -> io::Result<()> {
    Ok(())
}

fn encode(state: &PatchState) -> String {
    let bad_patches = state
        .bad_patches
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{HEADER} {STATE_FORMAT_VERSION}\n\
         next_patch={}\n\
         current_patch={}\n\
         pending_patch={}\n\
         failed_boots={}\n\
         bad_patches={bad_patches}\n",
        encode_optional(state.next_patch),
        encode_optional(state.current_patch),
        encode_optional(state.pending_patch),
        state.failed_boots,
    )
}

fn encode_optional(value: Option<u32>) -> String {
    value.map(|number| number.to_string()).unwrap_or_default()
}

fn decode(text: &str) -> Result<PatchState, StoreError> {
    let body = text
        .strip_suffix('\n')
        .ok_or(StoreError::Corrupt("missing trailing newline"))?;
    let mut lines = body.split('\n');

    let header = lines.next().ok_or(StoreError::Corrupt("empty file"))?;
    let version = header
        .strip_prefix(HEADER)
        .and_then(|rest| rest.strip_prefix(' '))
        .ok_or(StoreError::Corrupt("missing header"))?;
    let version = parse_u32(version).ok_or(StoreError::Corrupt("invalid version"))?;
    if version != STATE_FORMAT_VERSION {
        return Err(StoreError::UnsupportedVersion(version));
    }

    let next_patch = parse_optional(field(&mut lines, "next_patch")?)?;
    let current_patch = parse_optional(field(&mut lines, "current_patch")?)?;
    let pending_patch = parse_optional(field(&mut lines, "pending_patch")?)?;
    let failed_boots = parse_u32(field(&mut lines, "failed_boots")?)
        .ok_or(StoreError::Corrupt("invalid failed_boots"))?;
    let bad_patches = parse_list(field(&mut lines, "bad_patches")?)?;

    if lines.next().is_some() {
        return Err(StoreError::Corrupt("unexpected trailing data"));
    }

    Ok(PatchState {
        next_patch,
        current_patch,
        pending_patch,
        failed_boots,
        bad_patches,
    })
}

fn field<'a>(
    lines: &mut impl Iterator<Item = &'a str>,
    key: &'static str,
) -> Result<&'a str, StoreError> {
    lines
        .next()
        .and_then(|line| line.strip_prefix(key))
        .and_then(|rest| rest.strip_prefix('='))
        .ok_or(StoreError::Corrupt("missing or out-of-order field"))
}

fn parse_u32(text: &str) -> Option<u32> {
    if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

fn parse_optional(text: &str) -> Result<Option<u32>, StoreError> {
    if text.is_empty() {
        return Ok(None);
    }
    parse_u32(text)
        .map(Some)
        .ok_or(StoreError::Corrupt("invalid patch number"))
}

fn parse_list(text: &str) -> Result<Vec<u32>, StoreError> {
    if text.is_empty() {
        return Ok(Vec::new());
    }
    text.split(',')
        .map(|item| parse_u32(item).ok_or(StoreError::Corrupt("invalid patch number")))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            static COUNTER: AtomicU32 = AtomicU32::new(0);
            let path = std::env::temp_dir().join(format!(
                "fota-store-test-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            TempDir(path)
        }

        fn store(&self) -> StateStore {
            StateStore::new(self.0.join("state"))
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn sample_state() -> PatchState {
        PatchState {
            next_patch: Some(4),
            current_patch: Some(2),
            pending_patch: Some(3),
            failed_boots: 1,
            bad_patches: vec![1, 7],
        }
    }

    fn assert_corrupt(text: &str) {
        let dir = TempDir::new();
        let store = dir.store();
        fs::write(store.path(), text).unwrap();
        assert!(
            matches!(store.load(), Err(StoreError::Corrupt(_))),
            "expected corrupt for {text:?}"
        );
    }

    #[test]
    fn load_returns_none_when_nothing_saved() {
        let dir = TempDir::new();
        assert_eq!(dir.store().load().unwrap(), None);
    }

    #[test]
    fn round_trips_full_state() {
        let dir = TempDir::new();
        let store = dir.store();
        store.save(&sample_state()).unwrap();
        assert_eq!(store.load().unwrap(), Some(sample_state()));
    }

    #[test]
    fn round_trips_empty_state() {
        let dir = TempDir::new();
        let store = dir.store();
        store.save(&PatchState::default()).unwrap();
        assert_eq!(store.load().unwrap(), Some(PatchState::default()));
    }

    #[test]
    fn save_replaces_previous_state_and_leaves_no_temp_file() {
        let dir = TempDir::new();
        let store = dir.store();
        store.save(&sample_state()).unwrap();
        store.save(&PatchState::default()).unwrap();
        assert_eq!(store.load().unwrap(), Some(PatchState::default()));
        assert!(!dir.0.join("state.tmp").exists());
    }

    #[test]
    fn interrupted_save_keeps_previous_state() {
        let dir = TempDir::new();
        let store = dir.store();
        store.save(&sample_state()).unwrap();
        fs::write(dir.0.join("state.tmp"), "fota-state 1\nnext_pa").unwrap();
        assert_eq!(store.load().unwrap(), Some(sample_state()));
        store.save(&PatchState::default()).unwrap();
        assert_eq!(store.load().unwrap(), Some(PatchState::default()));
    }

    #[test]
    fn writes_documented_format() {
        let dir = TempDir::new();
        let store = dir.store();
        store.save(&sample_state()).unwrap();
        assert_eq!(
            fs::read_to_string(store.path()).unwrap(),
            "fota-state 1\nnext_patch=4\ncurrent_patch=2\npending_patch=3\nfailed_boots=1\nbad_patches=1,7\n"
        );
    }

    #[test]
    fn rejects_unknown_version() {
        let dir = TempDir::new();
        let store = dir.store();
        fs::write(
            store.path(),
            "fota-state 2\nnext_patch=\ncurrent_patch=\npending_patch=\nfailed_boots=0\nbad_patches=\n",
        )
        .unwrap();
        assert!(matches!(
            store.load(),
            Err(StoreError::UnsupportedVersion(2))
        ));
    }

    #[test]
    fn rejects_corrupt_documents() {
        let valid = "fota-state 1\nnext_patch=\ncurrent_patch=\npending_patch=\nfailed_boots=0\nbad_patches=\n";
        assert_corrupt("");
        assert_corrupt(&valid[..valid.len() - 1]);
        assert_corrupt(&valid[..valid.len() / 2]);
        assert_corrupt(&format!("{valid}extra=1\n"));
        assert_corrupt(&valid.replace("fota-state", "other"));
        assert_corrupt(&valid.replace("failed_boots=0", "failed_boots=+1"));
        assert_corrupt(&valid.replace("failed_boots=0", "failed_boots=-1"));
        assert_corrupt(&valid.replace("failed_boots=0", "failed_boots=99999999999"));
        assert_corrupt(&valid.replace("next_patch=", "next_patch=x"));
        assert_corrupt(&valid.replace("bad_patches=", "bad_patches=1,,2"));
        assert_corrupt(&valid.replace("bad_patches=", "bad_patches=1,"));
        assert_corrupt(
            &valid.replace("next_patch=\ncurrent_patch=", "current_patch=\nnext_patch="),
        );
        assert_corrupt(&valid.replace('\n', "\r\n"));
    }

    #[test]
    fn rejects_oversized_file() {
        let dir = TempDir::new();
        let store = dir.store();
        fs::write(store.path(), vec![b'a'; MAX_STATE_FILE_BYTES as usize + 1]).unwrap();
        assert!(matches!(store.load(), Err(StoreError::Corrupt(_))));
    }

    #[test]
    fn rejects_non_utf8() {
        let dir = TempDir::new();
        let store = dir.store();
        fs::write(store.path(), [0xff, 0xfe, b'\n']).unwrap();
        assert!(matches!(store.load(), Err(StoreError::Corrupt(_))));
    }
}
