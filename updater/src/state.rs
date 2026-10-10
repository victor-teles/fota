//! Boot state machine used to decide which snapshot to load and when to roll back.

/// Snapshot the engine should load on this boot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BootTarget {
    /// The snapshot bundled in the app binary.
    Base,
    /// A downloaded, verified patch.
    Patch(u32),
}

/// Persisted per-release state.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PatchState {
    /// Patch staged and verified, waiting for the next cold start.
    pub next_patch: Option<u32>,
    /// Patch that booted successfully at least once.
    pub current_patch: Option<u32>,
    /// Patch currently being tried and not yet confirmed by a successful boot.
    pub pending_patch: Option<u32>,
    /// Consecutive boots of `pending_patch` that did not report success.
    pub failed_boots: u32,
    /// Patches that failed and must never be loaded again.
    pub bad_patches: Vec<u32>,
}

impl PatchState {
    /// Decides what to load and records the attempt. Call once per cold start, before the
    /// Dart VM starts.
    pub fn begin_boot(&mut self, max_failed_boots: u32) -> BootTarget {
        if let Some(pending) = self.pending_patch {
            if self.failed_boots >= max_failed_boots {
                self.bad_patches.push(pending);
                self.pending_patch = None;
                self.failed_boots = 0;
            }
        }

        if let Some(next) = self.next_patch.take() {
            if !self.bad_patches.contains(&next) {
                self.pending_patch = Some(next);
                self.failed_boots = 0;
            }
        }

        if let Some(pending) = self.pending_patch {
            self.failed_boots += 1;
            return BootTarget::Patch(pending);
        }
        match self.current_patch {
            Some(p) => BootTarget::Patch(p),
            None => BootTarget::Base,
        }
    }

    /// Called when the app signals a healthy boot (e.g. first frame rendered).
    pub fn mark_boot_success(&mut self) {
        if let Some(pending) = self.pending_patch.take() {
            self.current_patch = Some(pending);
            self.failed_boots = 0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boots_base_without_patches() {
        let mut s = PatchState::default();
        assert_eq!(s.begin_boot(2), BootTarget::Base);
    }

    #[test]
    fn promotes_patch_after_successful_boot() {
        let mut s = PatchState {
            next_patch: Some(1),
            ..Default::default()
        };
        assert_eq!(s.begin_boot(2), BootTarget::Patch(1));
        s.mark_boot_success();
        assert_eq!(s.current_patch, Some(1));
        assert_eq!(s.begin_boot(2), BootTarget::Patch(1));
    }

    #[test]
    fn rolls_back_after_repeated_crashes() {
        let mut s = PatchState {
            next_patch: Some(1),
            ..Default::default()
        };
        assert_eq!(s.begin_boot(2), BootTarget::Patch(1));
        assert_eq!(s.begin_boot(2), BootTarget::Patch(1));
        assert_eq!(s.begin_boot(2), BootTarget::Base);
        assert_eq!(s.bad_patches, vec![1]);
    }

    #[test]
    fn rolls_back_to_previous_good_patch() {
        let mut s = PatchState {
            current_patch: Some(1),
            next_patch: Some(2),
            ..Default::default()
        };
        assert_eq!(s.begin_boot(1), BootTarget::Patch(2));
        assert_eq!(s.begin_boot(1), BootTarget::Patch(1));
    }

    #[test]
    fn never_retries_a_bad_patch() {
        let mut s = PatchState {
            next_patch: Some(3),
            bad_patches: vec![3],
            ..Default::default()
        };
        assert_eq!(s.begin_boot(2), BootTarget::Base);
    }
}
